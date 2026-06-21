/**
 * Penilaian tangan Riichi: hitung fu, han, dan poin (termasuk tabel mangan+).
 *
 * Memilih dekomposisi dengan poin tertinggi (aturan baku: tangan ditafsir
 * semenguntungkan mungkin bagi pemenang).
 */
import {
  checkAgari,
  Decomposition,
  expandMeld,
  Meld,
  winningDecompositions,
} from "./agari";
import { doraFromIndicator } from "./deal";
import { isHonor, isTerminal, rankOf } from "./tiles";
import {
  WinContext,
  Yaku,
  yakuForChiitoitsu,
  yakuForKokushi,
  yakuForStandard,
} from "./yaku";

const DRAGONS = [31, 32, 33];

export interface ScoreInput {
  /** counts 34-elemen ubin TERTUTUP (termasuk ubin penyelesai; TIDAK termasuk meld terbuka/kan) */
  counts: number[];
  /** meld tetap hasil call/kan (open: true untuk pon/chi/daiminkan, false untuk ankan) */
  openMelds?: Meld[];
  ctx: WinContext;
  /** kind indikator dora yang terbuka */
  doraIndicators?: number[];
  /** indikator uradora (hanya bila riichi) */
  uraIndicators?: number[];
  /** jumlah red-five (aka dora) di tangan */
  aka?: number;
  /** apakah pemenang adalah dealer (East) */
  isDealer: boolean;
}

export interface Payments {
  /** total poin yang diterima pemenang */
  total: number;
  /** untuk ron: jumlah yang dibayar pembuang */
  ron?: number;
  /** untuk tsumo non-dealer: { fromDealer, fromEach } */
  tsumo?: { fromDealer: number; fromEach: number } | { fromEach: number };
}

export interface ScoreResult {
  agari: boolean;
  han: number;
  fu: number;
  yaku: Yaku[];
  yakuman: boolean;
  limitName?: string;
  payments?: Payments;
}

const NO_WIN: ScoreResult = { agari: false, han: 0, fu: 0, yaku: [], yakuman: false };

function roundUp100(n: number): number {
  return Math.ceil(n / 100) * 100;
}
function roundUp10(n: number): number {
  return Math.ceil(n / 10) * 10;
}

/** Hitung fu untuk satu dekomposisi standar. */
export function computeFu(d: Decomposition, ctx: WinContext): number {
  // Pinfu: tsumo 20, ron 30
  const seqs = d.melds.filter((m) => m.type === "sequence");
  const isPinfuShape =
    ctx.isMenzen &&
    seqs.length === 4 &&
    !DRAGONS.includes(d.pair) &&
    d.pair !== ctx.roundWind &&
    d.pair !== ctx.seatWind;

  let fu = 20;

  // pasangan yakuhai
  if (DRAGONS.includes(d.pair)) fu += 2;
  if (d.pair === ctx.roundWind) fu += 2;
  if (d.pair === ctx.seatWind) fu += 2;

  // triplet
  for (const m of d.melds) {
    if (m.type !== "triplet" && m.type !== "kan") continue;
    const terminalHonor = isHonor(m.kind) || isTerminal(m.kind);
    const ronCompletes = !ctx.isTsumo && m.kind === ctx.winningTile && !m.open;
    const concealed = !m.open && !ronCompletes;
    let base = terminalHonor ? 8 : 4;
    if (m.type === "kan") base *= 4;
    if (!concealed) base /= 2;
    fu += base;
  }

  // tunggu kanchan/penchan/tanki +2
  fu += waitFu(d, ctx);

  // tsumo +2 (kecuali pinfu)
  if (ctx.isTsumo && !isPinfuShape) fu += 2;
  // menzen ron +10
  if (!ctx.isTsumo && ctx.isMenzen) fu += 10;

  if (isPinfuShape) return ctx.isTsumo ? 20 : 30;

  return Math.max(roundUp10(fu), 20);
}

function waitFu(d: Decomposition, ctx: WinContext): number {
  const w = ctx.winningTile;
  if (d.pair === w) return 2; // tanki (tunggu pasangan)
  for (const m of d.melds) {
    if (m.type !== "sequence") continue;
    const low = m.kind;
    const r = rankOf(low);
    if (w === low + 1) return 2; // kanchan (tengah)
    if (w === low && r === 1) return 2; // penchan 1-2 menunggu 3 -> low=1? edge
    if (w === low + 2 && rankOf(low + 2) === 9) return 2; // penchan 8-9 menunggu 7
  }
  return 0;
}

function dealerSplit(base: number, isTsumo: boolean): Payments {
  if (isTsumo) {
    const each = roundUp100(base * 2);
    return { total: each * 3, tsumo: { fromEach: each } };
  }
  const ron = roundUp100(base * 6);
  return { total: ron, ron };
}

function nonDealerSplit(base: number, isTsumo: boolean): Payments {
  if (isTsumo) {
    const fromDealer = roundUp100(base * 2);
    const fromEach = roundUp100(base * 1);
    return { total: fromDealer + fromEach * 2, tsumo: { fromDealer, fromEach } };
  }
  const ron = roundUp100(base * 4);
  return { total: ron, ron };
}

/** Tentukan base point & nama limit dari han/fu. */
function baseAndLimit(han: number, fu: number): { base: number; limit?: string } {
  if (han >= 11) return { base: 6000, limit: "Sanbaiman" };
  if (han >= 8) return { base: 4000, limit: "Baiman" };
  if (han >= 6) return { base: 3000, limit: "Haneman" };
  if (han >= 5) return { base: 2000, limit: "Mangan" };
  const raw = fu * Math.pow(2, 2 + han);
  if (raw >= 2000) return { base: 2000, limit: "Mangan" };
  return { base: raw };
}

function paymentsFor(han: number, fu: number, isDealer: boolean, isTsumo: boolean): { p: Payments; limit?: string } {
  const { base, limit } = baseAndLimit(han, fu);
  const p = isDealer ? dealerSplit(base, isTsumo) : nonDealerSplit(base, isTsumo);
  return { p, limit };
}

function yakumanPayments(multiplier: number, isDealer: boolean, isTsumo: boolean): Payments {
  const base = 8000 * multiplier;
  return isDealer ? dealerSplit(base, isTsumo) : nonDealerSplit(base, isTsumo);
}

function countDora(fullCounts: number[], indicators: number[] | undefined, aka: number): number {
  let n = aka ?? 0;
  if (indicators) {
    for (const ind of indicators) {
      const dk = doraFromIndicator(ind);
      n += fullCounts[dk];
    }
  }
  return n;
}

/** Hitung seluruh ubin (tertutup + meld) sebagai counts 34-elemen, untuk dora. */
function fullCountsOf(input: ScoreInput): number[] {
  const full = input.counts.slice();
  for (const m of input.openMelds ?? []) {
    for (const k of expandMeld(m)) full[k]++;
  }
  return full;
}

/** Skor untuk satu interpretasi standar. */
function scoreStandard(d: Decomposition, input: ScoreInput, fullCounts: number[]): ScoreResult {
  const { ctx } = input;
  const yaku = yakuForStandard(d, ctx);
  if (yaku.length === 0) return NO_WIN; // tidak ada yaku -> tak bisa menang

  const yakuman = yaku.some((y) => y.yakuman);
  if (yakuman) {
    const mult = yaku.filter((y) => y.yakuman).reduce((s, y) => s + Math.round(y.han / 13), 0);
    const payments = yakumanPayments(mult, input.isDealer, ctx.isTsumo);
    return { agari: true, han: 13 * mult, fu: 0, yaku, yakuman: true, limitName: "Yakuman", payments };
  }

  let han = yaku.reduce((s, y) => s + y.han, 0);
  han += countDora(fullCounts, input.doraIndicators, input.aka ?? 0);
  if (ctx.riichi || ctx.doubleRiichi) han += countDora(fullCounts, input.uraIndicators, 0);

  const fu = computeFu(d, ctx);
  const { p, limit } = paymentsFor(han, fu, input.isDealer, ctx.isTsumo);
  return { agari: true, han, fu, yaku, yakuman: false, limitName: limit, payments: p };
}

/** Skor tangan lengkap; memilih interpretasi terbaik. */
export function scoreHand(input: ScoreInput): ScoreResult {
  const melds = input.openMelds ?? [];
  const fullCounts = fullCountsOf(input);
  const candidates: ScoreResult[] = [];

  // chiitoitsu & kokushi hanya untuk tangan tertutup penuh (tanpa call/kan)
  if (melds.length === 0) {
    const agari = checkAgari(input.counts);

    if (agari.kokushi) {
      const yaku = yakuForKokushi(input.counts, input.ctx);
      const mult = Math.round(yaku[0].han / 13);
      candidates.push({
        agari: true,
        han: yaku[0].han,
        fu: 0,
        yaku,
        yakuman: true,
        limitName: "Yakuman",
        payments: yakumanPayments(mult, input.isDealer, input.ctx.isTsumo),
      });
    }

    if (agari.chiitoitsu) {
      const yaku = yakuForChiitoitsu(input.counts, input.ctx);
      if (yaku.some((y) => y.yakuman)) {
        const mult = yaku.filter((y) => y.yakuman).reduce((s, y) => s + Math.round(y.han / 13), 0);
        candidates.push({
          agari: true,
          han: 13 * mult,
          fu: 25,
          yaku,
          yakuman: true,
          limitName: "Yakuman",
          payments: yakumanPayments(mult, input.isDealer, input.ctx.isTsumo),
        });
      } else if (yaku.length > 0) {
        let han = yaku.reduce((s, y) => s + y.han, 0);
        han += countDora(fullCounts, input.doraIndicators, input.aka ?? 0);
        if (input.ctx.riichi || input.ctx.doubleRiichi) {
          han += countDora(fullCounts, input.uraIndicators, 0);
        }
        const { p, limit } = paymentsFor(han, 25, input.isDealer, input.ctx.isTsumo);
        candidates.push({ agari: true, han, fu: 25, yaku, yakuman: false, limitName: limit, payments: p });
      }
    }
  }

  // dekomposisi standar (memperhitungkan meld terbuka/kan)
  for (const d of winningDecompositions(input.counts, melds)) {
    const r = scoreStandard(d, input, fullCounts);
    if (r.agari) candidates.push(r);
  }

  if (candidates.length === 0) return NO_WIN; // bukan menang / tanpa yaku
  // pilih poin tertinggi (yakuman > han > fu)
  candidates.sort((a, b) => {
    const pa = a.payments?.total ?? 0;
    const pb = b.payments?.total ?? 0;
    if (pb !== pa) return pb - pa;
    if (b.han !== a.han) return b.han - a.han;
    return b.fu - a.fu;
  });
  return candidates[0];
}
