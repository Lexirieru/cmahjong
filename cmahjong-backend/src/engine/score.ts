/**
 * Riichi hand scoring: compute fu, han, and points (including the mangan+ table).
 *
 * Picks the decomposition with the highest points (standard rule: the hand is
 * interpreted as favorably as possible for the winner).
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
  /** 34-element counts of CONCEALED tiles (including the winning tile; NOT including open melds/kan) */
  counts: number[];
  /** fixed melds from call/kan (open: true for pon/chi/daiminkan, false for ankan) */
  openMelds?: Meld[];
  ctx: WinContext;
  /** revealed dora indicator kinds */
  doraIndicators?: number[];
  /** uradora indicators (only when riichi) */
  uraIndicators?: number[];
  /** number of red-fives (aka dora) in the hand */
  aka?: number;
  /** whether the winner is the dealer (East) */
  isDealer: boolean;
}

export interface Payments {
  /** total points received by the winner */
  total: number;
  /** for ron: the amount paid by the discarder */
  ron?: number;
  /** for non-dealer tsumo: { fromDealer, fromEach } */
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

/** Compute fu for a single standard decomposition. */
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

  // yakuhai pair
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

  // kanchan/penchan/tanki wait +2
  fu += waitFu(d, ctx);

  // tsumo +2 (except pinfu)
  if (ctx.isTsumo && !isPinfuShape) fu += 2;
  // menzen ron +10
  if (!ctx.isTsumo && ctx.isMenzen) fu += 10;

  if (isPinfuShape) return ctx.isTsumo ? 20 : 30;

  return Math.max(roundUp10(fu), 20);
}

function waitFu(d: Decomposition, ctx: WinContext): number {
  const w = ctx.winningTile;
  if (d.pair === w) return 2; // tanki (pair wait)
  for (const m of d.melds) {
    if (m.type !== "sequence") continue;
    const low = m.kind;
    const r = rankOf(low);
    if (w === low + 1) return 2; // kanchan (middle)
    if (w === low && r === 1) return 2; // penchan 1-2 waiting on 3 -> low=1? edge
    if (w === low + 2 && rankOf(low + 2) === 9) return 2; // penchan 8-9 waiting on 7
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

/** Determine base point & limit name from han/fu. */
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

/** Count all tiles (concealed + melds) as 34-element counts, for dora. */
function fullCountsOf(input: ScoreInput): number[] {
  const full = input.counts.slice();
  for (const m of input.openMelds ?? []) {
    for (const k of expandMeld(m)) full[k]++;
  }
  return full;
}

/** Score for a single standard interpretation. */
function scoreStandard(d: Decomposition, input: ScoreInput, fullCounts: number[]): ScoreResult {
  const { ctx } = input;
  const yaku = yakuForStandard(d, ctx);
  if (yaku.length === 0) return NO_WIN; // no yaku -> cannot win

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

/** Score the full hand; pick the best interpretation. */
export function scoreHand(input: ScoreInput): ScoreResult {
  const melds = input.openMelds ?? [];
  const fullCounts = fullCountsOf(input);
  const candidates: ScoreResult[] = [];

  // chiitoitsu & kokushi only for a fully concealed hand (no call/kan)
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

  // standard decomposition (accounting for open melds/kan)
  for (const d of winningDecompositions(input.counts, melds)) {
    const r = scoreStandard(d, input, fullCounts);
    if (r.agari) candidates.push(r);
  }

  if (candidates.length === 0) return NO_WIN; // not a win / no yaku
  // pick the highest points (yakuman > han > fu)
  candidates.sort((a, b) => {
    const pa = a.payments?.total ?? 0;
    const pb = b.payments?.total ?? 0;
    if (pb !== pa) return pb - pa;
    if (b.han !== a.han) return b.han - a.han;
    return b.fu - a.fu;
  });
  return candidates[0];
}
