/**
 * Deteksi tangan menang (agari) Riichi.
 *
 * Tiga bentuk kemenangan:
 *   1. Standar : 4 set (urutan/triplet) + 1 pasangan.
 *   2. Chiitoitsu : 7 pasangan berbeda.
 *   3. Kokushi musou : ke-13 jenis terminal/honor + 1 duplikat.
 *
 * Mengembalikan SEMUA dekomposisi standar yang mungkin (penting karena satu tangan
 * bisa ditafsir beberapa cara; scoring memilih yang paling tinggi).
 */
import { NUM_KINDS, isYaochuu } from "./tiles";

export type MeldType = "sequence" | "triplet" | "pair" | "kan";

export interface Meld {
  type: MeldType;
  /** untuk sequence: kind terendah; selain itu kind ubin */
  kind: number;
  /** apakah meld terbuka (hasil call pon/chi/kan) */
  open?: boolean;
}

export interface Decomposition {
  melds: Meld[]; // panjang = neededMelds (tidak termasuk pasangan)
  pair: number; // kind pasangan
}

/** Enumerasi semua cara memecah `counts` menjadi set (tanpa pasangan). */
function decomposeMelds(counts: number[]): Meld[][] {
  const i = counts.findIndex((c) => c > 0);
  if (i === -1) return [[]]; // habis -> satu cara (kosong)

  const results: Meld[][] = [];

  // triplet
  if (counts[i] >= 3) {
    counts[i] -= 3;
    for (const rest of decomposeMelds(counts)) {
      results.push([{ type: "triplet", kind: i }, ...rest]);
    }
    counts[i] += 3;
  }

  // sequence (hanya suit angka, dan i bukan dua kind terakhir dalam suit)
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

/** Semua dekomposisi standar (4 set + pasangan) untuk tangan tertutup `counts`. */
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

/** Apakah `counts` = 7 pasangan berbeda (chiitoitsu)? */
export function isChiitoitsu(counts: number[]): boolean {
  let pairs = 0;
  for (const c of counts) {
    if (c === 2) pairs++;
    else if (c !== 0) return false; // chiitoi tidak boleh ada triplet/single
  }
  return pairs === 7;
}

/** Apakah `counts` = kokushi musou (13 yatim)? */
export function isKokushi(counts: number[]): boolean {
  let hasPair = false;
  let kinds = 0;
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] === 0) continue;
    if (!isYaochuu(k)) return false; // hanya terminal/honor
    kinds++;
    if (counts[k] === 2) hasPair = true;
    else if (counts[k] !== 1) return false;
  }
  return kinds === 13 && hasPair;
}

export interface AgariResult {
  win: boolean;
  standard: Decomposition[];
  chiitoitsu: boolean;
  kokushi: boolean;
}

/** Cek kemenangan untuk tangan tertutup 14-ubin (sebagai counts 34-elemen). */
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
 * Apakah `counts` (13 ubin) dalam keadaan tenpai (siap menang)?
 * Mengembalikan daftar kind ubin penunggu (waits). Kosong = bukan tenpai.
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
