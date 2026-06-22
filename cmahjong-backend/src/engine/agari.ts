/**
 * Riichi winning hand (agari) detection.
 *
 * Three winning shapes:
 *   1. Standard : 4 sets (sequence/triplet) + 1 pair.
 *   2. Chiitoitsu : 7 distinct pairs.
 *   3. Kokushi musou : all 13 terminal/honor kinds + 1 duplicate.
 *
 * Returns ALL possible standard decompositions (important because one hand
 * can be interpreted multiple ways; scoring picks the highest).
 */
import { NUM_KINDS, isYaochuu } from "./tiles";

export type MeldType = "sequence" | "triplet" | "pair" | "kan";

export interface Meld {
  type: MeldType;
  /** for sequence: the lowest kind; otherwise the tile kind */
  kind: number;
  /** whether the meld is open (result of a pon/chi/kan call) */
  open?: boolean;
}

export interface Decomposition {
  melds: Meld[]; // length = neededMelds (does not include the pair)
  pair: number; // pair kind
}

/** Enumerate all ways to break `counts` into sets (without the pair). */
function decomposeMelds(counts: number[]): Meld[][] {
  const i = counts.findIndex((c) => c > 0);
  if (i === -1) return [[]]; // exhausted -> one way (empty)

  const results: Meld[][] = [];

  // triplet
  if (counts[i] >= 3) {
    counts[i] -= 3;
    for (const rest of decomposeMelds(counts)) {
      results.push([{ type: "triplet", kind: i }, ...rest]);
    }
    counts[i] += 3;
  }

  // sequence (numbered suits only, and i is not the last two kinds within the suit)
  if (i < 27 && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    for (const rest of decomposeMelds(counts)) {
      results.push([{ type: "sequence", kind: i }, ...rest]);
    }
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
  }

  return results;
}

/** All standard decompositions (4 sets + pair) for the concealed hand `counts`. */
export function standardDecompositions(counts: number[]): Decomposition[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total % 3 !== 2) return [];
  const neededMelds = (total - 2) / 3;

  const work = counts.slice();
  const out: Decomposition[] = [];

  for (let k = 0; k < NUM_KINDS; k++) {
    if (work[k] >= 2) {
      work[k] -= 2;
      for (const melds of decomposeMelds(work)) {
        if (melds.length === neededMelds) out.push({ melds, pair: k });
      }
      work[k] += 2;
    }
  }
  return out;
}

/** Is `counts` = 7 distinct pairs (chiitoitsu)? */
export function isChiitoitsu(counts: number[]): boolean {
  let pairs = 0;
  for (const c of counts) {
    if (c === 2) pairs++;
    else if (c !== 0) return false; // chiitoi cannot contain a triplet/single
  }
  return pairs === 7;
}

/** Is `counts` = kokushi musou (thirteen orphans)? */
export function isKokushi(counts: number[]): boolean {
  let hasPair = false;
  let kinds = 0;
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] === 0) continue;
    if (!isYaochuu(k)) return false; // terminals/honors only
    kinds++;
    if (counts[k] === 2) hasPair = true;
    else if (counts[k] !== 1) return false;
  }
  return kinds === 13 && hasPair;
}

/** Expand a meld into the list of its tile kinds. */
export function expandMeld(m: Meld): number[] {
  if (m.type === "sequence") return [m.kind, m.kind + 1, m.kind + 2];
  if (m.type === "kan") return [m.kind, m.kind, m.kind, m.kind];
  return [m.kind, m.kind, m.kind]; // triplet
}

/**
 * All winning decompositions with the fixed melds (call/kan results) merged in.
 * `concealed` = counts of concealed tiles (including the winning tile). Each kan/meld
 * fills one "slot" of the 4 sets; the rest are broken out of the concealed hand.
 */
export function winningDecompositions(concealed: number[], fixedMelds: Meld[]): Decomposition[] {
  const needed = 4 - fixedMelds.length;
  if (needed < 0) return [];
  const total = concealed.reduce((a, b) => a + b, 0);
  if (total !== needed * 3 + 2) return [];

  const work = concealed.slice();
  const out: Decomposition[] = [];
  for (let k = 0; k < NUM_KINDS; k++) {
    if (work[k] >= 2) {
      work[k] -= 2;
      for (const melds of decomposeMelds(work)) {
        if (melds.length === needed) out.push({ melds: [...fixedMelds, ...melds], pair: k });
      }
      work[k] += 2;
    }
  }
  return out;
}

/** List of waiting kinds (waits) for the concealed hand + fixed melds. Empty = not tenpai. */
export function tenpaiWaits(concealed: number[], fixedMelds: Meld[]): number[] {
  const needed = 4 - fixedMelds.length;
  const total = concealed.reduce((a, b) => a + b, 0);
  const result: number[] = [];

  if (total === needed * 3 + 1) {
    for (let k = 0; k < NUM_KINDS; k++) {
      if (concealed[k] >= 4) continue;
      concealed[k]++;
      if (winningDecompositions(concealed, fixedMelds).length > 0) result.push(k);
      concealed[k]--;
    }
  }

  // chiitoi/kokushi only apply to hands without open melds
  if (fixedMelds.length === 0 && total === 13) {
    for (let k = 0; k < NUM_KINDS; k++) {
      if (concealed[k] >= 4 || result.includes(k)) continue;
      concealed[k]++;
      const r = checkAgari(concealed);
      if (r.chiitoitsu || r.kokushi) result.push(k);
      concealed[k]--;
    }
  }
  return result;
}

export interface AgariResult {
  win: boolean;
  standard: Decomposition[];
  chiitoitsu: boolean;
  kokushi: boolean;
}

/** Check for a win on a concealed 14-tile hand (as 34-element counts). */
export function checkAgari(counts: number[]): AgariResult {
  const standard = standardDecompositions(counts);
  const chiitoitsu = isChiitoitsu(counts);
  const kokushi = isKokushi(counts);
  return {
    win: standard.length > 0 || chiitoitsu || kokushi,
    standard,
    chiitoitsu,
    kokushi,
  };
}

/**
 * Is `counts` (13 tiles) in tenpai (ready to win)?
 * Returns the list of waiting tile kinds (waits). Empty = not tenpai.
 */
export function waits(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total % 3 !== 1) return [];
  const result: number[] = [];
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    if (checkAgari(counts).win) result.push(k);
    counts[k]--;
  }
  return result;
}
