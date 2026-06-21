/**
 * Model ubin Riichi Mahjong — 136 ubin, 34 jenis (kind), 4 kopi tiap jenis.
 *
 * Encoding `kind` (0..33):
 *   0..8   man (karakter) 1..9
 *   9..17  pin (lingkaran) 1..9
 *   18..26 sou (bambu) 1..9
 *   27..30 angin: Timur(E), Selatan(S), Barat(W), Utara(N)
 *   31..33 naga: Putih(haku), Hijau(hatsu), Merah(chun)
 *
 * `Tile` membawa `id` 0..135 unik (untuk membedakan kopi & red-five), dan `kind`.
 */

export type Suit = "m" | "p" | "s" | "z"; // z = honor (angin/naga)

export const NUM_KINDS = 34;
export const NUM_TILES = 136;

export interface Tile {
  /** id unik 0..135 (urutan kanonik di tembok sebelum dikocok) */
  id: number;
  /** jenis 0..33 */
  kind: number;
  /** apakah red five (aka dora) — opsional, default false */
  red?: boolean;
}

/** Apakah kind termasuk honor (angin/naga)? */
export function isHonor(kind: number): boolean {
  return kind >= 27;
}

/** Apakah kind termasuk terminal (1 atau 9 pada suit angka)? */
export function isTerminal(kind: number): boolean {
  if (kind >= 27) return false;
  const n = kind % 9;
  return n === 0 || n === 8;
}

/** Terminal atau honor (yaochuu) — dipakai banyak yaku (chanta, kokushi, dll). */
export function isYaochuu(kind: number): boolean {
  return isHonor(kind) || isTerminal(kind);
}

/** Suit dari kind. */
export function suitOf(kind: number): Suit {
  if (kind < 9) return "m";
  if (kind < 18) return "p";
  if (kind < 27) return "s";
  return "z";
}

/** Nomor 1..9 untuk suit angka; 1..7 untuk honor (E..chun). */
export function rankOf(kind: number): number {
  if (kind < 27) return (kind % 9) + 1;
  return kind - 27 + 1;
}

/** Notasi ringkas, mis. kind 0 -> "1m", 27 -> "E", 33 -> "chun". */
const HONOR_NAMES = ["E", "S", "W", "N", "haku", "hatsu", "chun"];
export function kindToString(kind: number): string {
  if (kind >= 27) return HONOR_NAMES[kind - 27];
  return `${rankOf(kind)}${suitOf(kind)}`;
}

/** Parse notasi "1m".."9s" / "E".."chun" menjadi kind. */
export function kindFromString(s: string): number {
  const honor = HONOR_NAMES.indexOf(s);
  if (honor >= 0) return 27 + honor;
  const m = /^([1-9])([mps])$/.exec(s);
  if (!m) throw new Error(`notasi ubin tidak valid: ${s}`);
  const n = parseInt(m[1], 10) - 1;
  const base = { m: 0, p: 9, s: 18 }[m[2] as "m" | "p" | "s"];
  return base + n;
}

/** Tembok kanonik 136 ubin (urutan sebelum dikocok): 4 kopi tiap kind. */
export function buildWall(): Tile[] {
  const tiles: Tile[] = [];
  let id = 0;
  for (let kind = 0; kind < NUM_KINDS; kind++) {
    for (let c = 0; c < 4; c++) {
      tiles.push({ id, kind });
      id++;
    }
  }
  return tiles;
}

/** Konversi daftar Tile -> array hitung 34-elemen (jumlah per kind). */
export function toCounts(tiles: Tile[]): number[] {
  const counts = new Array(NUM_KINDS).fill(0);
  for (const t of tiles) counts[t.kind]++;
  return counts;
}

/** Konversi daftar kind -> array hitung 34-elemen. */
export function countsFromKinds(kinds: number[]): number[] {
  const counts = new Array(NUM_KINDS).fill(0);
  for (const k of kinds) counts[k]++;
  return counts;
}
