/**
 * Deteksi yaku Riichi untuk satu dekomposisi tangan menang.
 *
 * Cakupan saat ini: yaku umum + yakuman utama (lihat daftar di bawah). Yaku langka
 * tertentu (mis. sankantsu, suukantsu — butuh model kan) ditandai TODO. Dora dihitung
 * terpisah di score.ts (bukan yaku, tapi menambah han).
 */
import { Decomposition, Meld } from "./agari";
import { isHonor, isTerminal, isYaochuu, suitOf, rankOf } from "./tiles";

export interface WinContext {
  seatWind: number; // kind 27..30 (E,S,W,N)
  roundWind: number; // kind 27..30
  winningTile: number; // kind ubin penyelesai
  isTsumo: boolean;
  isMenzen: boolean; // tangan tertutup penuh (tanpa call terbuka)
  riichi?: boolean;
  doubleRiichi?: boolean;
  ippatsu?: boolean;
  haitei?: boolean; // menang dari ubin terakhir (tsumo)
  houtei?: boolean; // menang dari buangan terakhir (ron)
  rinshan?: boolean; // menang dari ubin pengganti setelah kan
  chankan?: boolean; // merampok kan
  tenhou?: boolean; // dealer menang di tangan pembuka
  chiihou?: boolean; // non-dealer menang di draw pertama
}

export interface Yaku {
  name: string;
  han: number;
  yakuman?: boolean;
}

const DRAGONS = [31, 32, 33];

function isSequence(m: Meld): boolean {
  return m.type === "sequence";
}
function isTripletLike(m: Meld): boolean {
  return m.type === "triplet" || m.type === "kan";
}

/** Yaku untuk dekomposisi standar (4 set + pasangan). */
export function yakuForStandard(d: Decomposition, ctx: WinContext): Yaku[] {
  const yaku: Yaku[] = [];
  const allKinds: number[] = [];
  for (const m of d.melds) {
    if (isSequence(m)) allKinds.push(m.kind, m.kind + 1, m.kind + 2);
    else allKinds.push(m.kind, m.kind, m.kind);
  }
  allKinds.push(d.pair, d.pair);

  const seqs = d.melds.filter(isSequence);
  const triplets = d.melds.filter(isTripletLike);
  const menzen = ctx.isMenzen;

  // --- Yakuman lebih dulu (mengabaikan yaku biasa) ---
  const ym = yakumanForStandard(d, ctx);
  if (ym.length) return ym;

  // --- riichi & situasional ---
  if (ctx.doubleRiichi) yaku.push({ name: "Double Riichi", han: 2 });
  else if (ctx.riichi) yaku.push({ name: "Riichi", han: 1 });
  if (ctx.ippatsu) yaku.push({ name: "Ippatsu", han: 1 });
  if (ctx.isTsumo && menzen) yaku.push({ name: "Menzen Tsumo", han: 1 });
  if (ctx.haitei) yaku.push({ name: "Haitei", han: 1 });
  if (ctx.houtei) yaku.push({ name: "Houtei", han: 1 });
  if (ctx.rinshan) yaku.push({ name: "Rinshan Kaihou", han: 1 });
  if (ctx.chankan) yaku.push({ name: "Chankan", han: 1 });

  // --- Pinfu: tertutup, semua urutan, pasangan bukan yakuhai, tunggu ryanmen ---
  if (menzen && seqs.length === 4 && !isYakuhaiPair(d.pair, ctx) && isRyanmenWait(d, ctx)) {
    yaku.push({ name: "Pinfu", han: 1 });
  }

  // --- Tanyao: tanpa terminal/honor ---
  if (allKinds.every((k) => !isYaochuu(k))) {
    yaku.push({ name: "Tanyao", han: 1 });
  }

  // --- Iipeikou (tertutup): dua urutan identik ---
  if (menzen) {
    const peikou = countIdenticalSequencePairs(seqs);
    if (peikou === 2) yaku.push({ name: "Ryanpeikou", han: 3 });
    else if (peikou === 1) yaku.push({ name: "Iipeikou", han: 1 });
  }

  // --- Yakuhai (triplet naga / angin) ---
  for (const t of triplets) {
    if (DRAGONS.includes(t.kind)) yaku.push({ name: `Yakuhai (${t.kind})`, han: 1 });
    if (t.kind === ctx.roundWind) yaku.push({ name: "Yakuhai (round wind)", han: 1 });
    if (t.kind === ctx.seatWind) yaku.push({ name: "Yakuhai (seat wind)", han: 1 });
  }

  // --- Sanshoku doujun: urutan sama di 3 suit ---
  if (hasSanshokuDoujun(seqs)) yaku.push({ name: "Sanshoku Doujun", han: menzen ? 2 : 1 });
  // --- Sanshoku doukou: triplet sama di 3 suit ---
  if (hasSanshokuDoukou(triplets)) yaku.push({ name: "Sanshoku Doukou", han: 2 });
  // --- Ittsuu: 123-456-789 satu suit ---
  if (hasIttsuu(seqs)) yaku.push({ name: "Ittsuu", han: menzen ? 2 : 1 });

  // --- Toitoi: semua triplet ---
  if (triplets.length === 4) yaku.push({ name: "Toitoi", han: 2 });
  // --- Sanankou: tiga triplet tertutup ---
  if (countConcealedTriplets(d, ctx) >= 3) yaku.push({ name: "Sanankou", han: 2 });

  // --- Chanta / Junchan: tiap set memuat terminal/honor ---
  const chantaKind = chantaType(d);
  if (chantaKind === "junchan") yaku.push({ name: "Junchan", han: menzen ? 3 : 2 });
  else if (chantaKind === "chanta") yaku.push({ name: "Chanta", han: menzen ? 2 : 1 });

  // --- Honroutou: semua terminal/honor (otomatis dengan toitoi/chiitoi) ---
  if (allKinds.every((k) => isYaochuu(k))) yaku.push({ name: "Honroutou", han: 2 });

  // --- Shousangen: 2 triplet naga + pasangan naga ---
  if (isShousangen(d)) yaku.push({ name: "Shousangen", han: 2 });

  // --- Honitsu / Chinitsu ---
  const flush = flushType(allKinds);
  if (flush === "chinitsu") yaku.push({ name: "Chinitsu", han: menzen ? 6 : 5 });
  else if (flush === "honitsu") yaku.push({ name: "Honitsu", han: menzen ? 3 : 2 });

  return yaku;
}

/** Yaku untuk chiitoitsu. */
export function yakuForChiitoitsu(counts: number[], ctx: WinContext): Yaku[] {
  const yaku: Yaku[] = [];
  const kinds: number[] = [];
  counts.forEach((c, k) => {
    if (c === 2) kinds.push(k);
  });

  // tsuuiisou (all honors) = yakuman
  if (kinds.every((k) => isHonor(k))) return [{ name: "Tsuuiisou", han: 13, yakuman: true }];

  if (ctx.doubleRiichi) yaku.push({ name: "Double Riichi", han: 2 });
  else if (ctx.riichi) yaku.push({ name: "Riichi", han: 1 });
  if (ctx.ippatsu) yaku.push({ name: "Ippatsu", han: 1 });
  if (ctx.isTsumo) yaku.push({ name: "Menzen Tsumo", han: 1 });
  if (ctx.haitei) yaku.push({ name: "Haitei", han: 1 });
  if (ctx.houtei) yaku.push({ name: "Houtei", han: 1 });

  yaku.push({ name: "Chiitoitsu", han: 2 });

  if (kinds.every((k) => !isYaochuu(k))) yaku.push({ name: "Tanyao", han: 1 });
  if (kinds.every((k) => isYaochuu(k))) yaku.push({ name: "Honroutou", han: 2 });

  const flush = flushType(kinds);
  if (flush === "chinitsu") yaku.push({ name: "Chinitsu", han: 6 });
  else if (flush === "honitsu") yaku.push({ name: "Honitsu", han: 3 });

  return yaku;
}

/** Yaku untuk kokushi musou (yakuman, double bila menunggu 13-sisi). */
export function yakuForKokushi(counts: number[], ctx: WinContext): Yaku[] {
  const thirteenWait = counts[ctx.winningTile] === 2; // tile penyelesai berpasangan -> 13-wait
  return [
    thirteenWait
      ? { name: "Kokushi Musou Juusanmenmachi", han: 26, yakuman: true }
      : { name: "Kokushi Musou", han: 13, yakuman: true },
  ];
}

// --------------------------------------------------------------------------
// Yakuman untuk dekomposisi standar
// --------------------------------------------------------------------------
function yakumanForStandard(d: Decomposition, ctx: WinContext): Yaku[] {
  const out: Yaku[] = [];
  const triplets = d.melds.filter(isTripletLike);
  const allKinds: number[] = [];
  for (const m of d.melds) {
    if (isSequence(m)) allKinds.push(m.kind, m.kind + 1, m.kind + 2);
    else allKinds.push(m.kind, m.kind, m.kind);
  }
  allKinds.push(d.pair, d.pair);

  // Daisangen: 3 triplet naga
  const dragonTrips = triplets.filter((t) => DRAGONS.includes(t.kind)).length;
  if (dragonTrips === 3) out.push({ name: "Daisangen", han: 13, yakuman: true });

  // Suuankou: 4 triplet tertutup
  if (triplets.length === 4 && countConcealedTriplets(d, ctx) === 4) {
    out.push({ name: "Suuankou", han: 13, yakuman: true });
  }

  // Suushii: angin
  const windTrips = triplets.filter((t) => t.kind >= 27 && t.kind <= 30).length;
  const pairIsWind = d.pair >= 27 && d.pair <= 30;
  if (windTrips === 4) out.push({ name: "Daisuushii", han: 26, yakuman: true });
  else if (windTrips === 3 && pairIsWind) out.push({ name: "Shousuushii", han: 13, yakuman: true });

  // Tsuuiisou: semua honor
  if (allKinds.every((k) => isHonor(k))) out.push({ name: "Tsuuiisou", han: 13, yakuman: true });

  // Chinroutou: semua terminal
  if (allKinds.every((k) => isTerminal(k))) out.push({ name: "Chinroutou", han: 13, yakuman: true });

  // Ryuuiisou: hijau (2,3,4,6,8 sou + hatsu)
  const greens = new Set([19, 20, 21, 23, 25, 32]); // kind: 2s..4s,6s,8s,hatsu
  if (allKinds.every((k) => greens.has(k))) out.push({ name: "Ryuuiisou", han: 13, yakuman: true });

  // Chuuren poutou: chinitsu 1112345678999 + 1
  if (ctx.isMenzen && isChuuren(allKinds)) out.push({ name: "Chuuren Poutou", han: 13, yakuman: true });

  if (ctx.tenhou) out.push({ name: "Tenhou", han: 13, yakuman: true });
  if (ctx.chiihou) out.push({ name: "Chiihou", han: 13, yakuman: true });

  return out;
}

// --------------------------------------------------------------------------
// Helper deteksi
// --------------------------------------------------------------------------
function isYakuhaiPair(pair: number, ctx: WinContext): boolean {
  return DRAGONS.includes(pair) || pair === ctx.roundWind || pair === ctx.seatWind;
}

function isRyanmenWait(d: Decomposition, ctx: WinContext): boolean {
  // tunggu ryanmen: ubin penyelesai berada di ujung terbuka sebuah urutan
  for (const m of d.melds) {
    if (!isSequence(m)) continue;
    const low = m.kind;
    const r = rankOf(low);
    // tile penyelesai = low (tunggu sisi bawah) atau low+2 (sisi atas)
    if (ctx.winningTile === low && r <= 6) return true; // mis. 2-3 menunggu 1/4 -> ambil 1? edge; sederhana
    if (ctx.winningTile === low + 2 && r >= 1) return true;
  }
  return false;
}

function countIdenticalSequencePairs(seqs: Meld[]): number {
  const map = new Map<number, number>();
  for (const s of seqs) map.set(s.kind, (map.get(s.kind) ?? 0) + 1);
  let pairs = 0;
  for (const c of map.values()) pairs += Math.floor(c / 2);
  return pairs;
}

function hasSanshokuDoujun(seqs: Meld[]): boolean {
  for (const s of seqs) {
    if (s.kind >= 27) continue;
    const r = s.kind % 9; // posisi dalam suit
    const m = r; // man base 0
    const p = 9 + r;
    const so = 18 + r;
    const set = new Set(seqs.map((x) => x.kind));
    if (set.has(m) && set.has(p) && set.has(so)) return true;
  }
  return false;
}

function hasSanshokuDoukou(triplets: Meld[]): boolean {
  for (const t of triplets) {
    if (t.kind >= 27) continue;
    const r = t.kind % 9;
    const set = new Set(triplets.map((x) => x.kind));
    if (set.has(r) && set.has(9 + r) && set.has(18 + r)) return true;
  }
  return false;
}

function hasIttsuu(seqs: Meld[]): boolean {
  for (let base = 0; base < 27; base += 9) {
    const set = new Set(seqs.map((x) => x.kind));
    if (set.has(base) && set.has(base + 3) && set.has(base + 6)) return true;
  }
  return false;
}

function countConcealedTriplets(d: Decomposition, ctx: WinContext): number {
  // triplet tertutup; bila menang via ron pada triplet penyelesai, itu dianggap terbuka
  let n = 0;
  for (const m of d.melds) {
    if (!isTripletLike(m) || m.open) continue;
    if (!ctx.isTsumo && m.kind === ctx.winningTile) continue; // ron menyelesaikan triplet -> tidak tertutup
    n++;
  }
  return n;
}

function chantaType(d: Decomposition): "junchan" | "chanta" | null {
  let hasHonor = false;
  const groups: number[][] = [];
  for (const m of d.melds) {
    if (isSequence(m)) groups.push([m.kind, m.kind + 1, m.kind + 2]);
    else groups.push([m.kind]);
  }
  groups.push([d.pair]);
  for (const g of groups) {
    const touches = g.some((k) => isYaochuu(k));
    if (!touches) return null;
    if (g.some((k) => isHonor(k))) hasHonor = true;
  }
  return hasHonor ? "chanta" : "junchan";
}

function isShousangen(d: Decomposition): boolean {
  const trips = d.melds.filter(isTripletLike).filter((t) => DRAGONS.includes(t.kind)).length;
  return trips === 2 && DRAGONS.includes(d.pair);
}

function flushType(kinds: number[]): "chinitsu" | "honitsu" | null {
  const suits = new Set(kinds.filter((k) => k < 27).map((k) => suitOf(k)));
  const hasHonor = kinds.some((k) => k >= 27);
  if (suits.size === 1 && !hasHonor) return "chinitsu";
  if (suits.size === 1 && hasHonor) return "honitsu";
  if (suits.size === 0 && hasHonor) return null; // semua honor -> tsuuiisou (ditangani terpisah)
  return null;
}

function isChuuren(kinds: number[]): boolean {
  const suits = new Set(kinds.filter((k) => k < 27).map((k) => suitOf(k)));
  if (suits.size !== 1 || kinds.some((k) => k >= 27)) return false;
  const base = Math.floor(kinds[0] / 9) * 9;
  const counts = new Array(9).fill(0);
  for (const k of kinds) counts[k - base]++;
  // pola 3-1-1-1-1-1-1-1-3 + satu ekstra
  const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  for (let i = 0; i < 9; i++) {
    if (counts[i] < need[i]) return false;
  }
  return true;
}
