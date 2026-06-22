/**
 * Riichi Mahjong tile model — 136 tiles, 34 kinds, 4 copies per kind.
 *
 * `kind` encoding (0..33):
 *   0..8   man (characters) 1..9
 *   9..17  pin (circles) 1..9
 *   18..26 sou (bamboo) 1..9
 *   27..30 winds: East(E), South(S), West(W), North(N)
 *   31..33 dragons: White(haku), Green(hatsu), Red(chun)
 *
 * `Tile` carries a unique `id` 0..135 (to distinguish copies & red-five), and `kind`.
 */

export type Suit = "m" | "p" | "s" | "z"; // z = honor (wind/dragon)

export const NUM_KINDS = 34;
export const NUM_TILES = 136;

export interface Tile {
  /** unique id 0..135 (canonical order in the wall before shuffling) */
  id: number;
  /** kind 0..33 */
  kind: number;
  /** whether it is a red five (aka dora) — optional, default false */
  red?: boolean;
}

/** Is the kind a honor (wind/dragon)? */
export function isHonor(kind: number): boolean {
  return kind >= 27;
}

/** Is the kind a terminal (1 or 9 in a numbered suit)? */
export function isTerminal(kind: number): boolean {
  if (kind >= 27) return false;
  const n = kind % 9;
  return n === 0 || n === 8;
}

/** Terminal or honor (yaochuu) — used by many yaku (chanta, kokushi, etc.). */
export function isYaochuu(kind: number): boolean {
  return isHonor(kind) || isTerminal(kind);
}

/** Suit of the kind. */
export function suitOf(kind: number): Suit {
  if (kind < 9) return "m";
  if (kind < 18) return "p";
  if (kind < 27) return "s";
  return "z";
}

/** Number 1..9 for numbered suits; 1..7 for honors (E..chun). */
export function rankOf(kind: number): number {
  if (kind < 27) return (kind % 9) + 1;
  return kind - 27 + 1;
}

/** Short notation, e.g. kind 0 -> "1m", 27 -> "E", 33 -> "chun". */
const HONOR_NAMES = ["E", "S", "W", "N", "haku", "hatsu", "chun"];
export function kindToString(kind: number): string {
  if (kind >= 27) return HONOR_NAMES[kind - 27];
  return `${rankOf(kind)}${suitOf(kind)}`;
}

/** Parse notation "1m".."9s" / "E".."chun" into a kind. */
export function kindFromString(s: string): number {
  const honor = HONOR_NAMES.indexOf(s);
  if (honor >= 0) return 27 + honor;
  const m = /^([1-9])([mps])$/.exec(s);
  if (!m) throw new Error(`invalid tile notation: ${s}`);
  const n = parseInt(m[1], 10) - 1;
  const base = { m: 0, p: 9, s: 18 }[m[2] as "m" | "p" | "s"];
  return base + n;
}

/** Canonical 136-tile wall (order before shuffling): 4 copies per kind. */
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

/** Convert a list of Tile -> 34-element count array (count per kind). */
export function toCounts(tiles: Tile[]): number[] {
  const counts = new Array(NUM_KINDS).fill(0);
  for (const t of tiles) counts[t.kind]++;
  return counts;
}

/** Convert a list of kinds -> 34-element count array. */
export function countsFromKinds(kinds: number[]): number[] {
  const counts = new Array(NUM_KINDS).fill(0);
  for (const k of kinds) counts[k]++;
  return counts;
}
