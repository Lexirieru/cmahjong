/**
 * Initial Riichi deal from a shuffled wall.
 *
 * Wall convention (deterministic from the seed):
 *   - last 14 tiles = dead wall. Dora indicator = dead wall[?]
 *   - the rest (122) = live wall, drawn during play.
 *
 * Dealing ritual: dealer = East (seat 0). 3 rounds @ 4 tiles per player,
 * then 1 tile per player → 13 tiles/player. East draws the 14th tile on
 * its first turn (first tsumo), handled outside this function.
 */
import { Tile } from "./tiles";

export const HAND_SIZE = 13;
export const SEATS = 4;
export const DEAD_WALL_SIZE = 14;

export interface DealResult {
  /** initial hand of each player (13 tiles), seat index 0..3 (E,S,W,N) */
  hands: Tile[][];
  /** remaining draw stack (live wall), taken from the front (index 0 = next) */
  liveWall: Tile[];
  /** dead wall (14 tiles) */
  deadWall: Tile[];
  /** first dora indicator (revealed at the start) */
  doraIndicator: Tile;
}

/**
 * Deal from the shuffled 136-tile wall.
 * @param wall result of shuffledWall(seed) — length 136
 */
export function dealFromWall(wall: Tile[]): DealResult {
  if (wall.length !== 136) {
    throw new Error(`wall must be 136 tiles, got ${wall.length}`);
  }

  // dead wall = last 14 tiles
  const deadWall = wall.slice(wall.length - DEAD_WALL_SIZE);
  const live = wall.slice(0, wall.length - DEAD_WALL_SIZE); // 122 tiles

  const hands: Tile[][] = [[], [], [], []];
  let ptr = 0;

  // 3 rounds @ 4 tiles per player
  for (let round = 0; round < 3; round++) {
    for (let seat = 0; seat < SEATS; seat++) {
      for (let k = 0; k < 4; k++) {
        hands[seat].push(live[ptr++]);
      }
    }
  }
  // last 1 tile per player
  for (let seat = 0; seat < SEATS; seat++) {
    hands[seat].push(live[ptr++]);
  }

  const liveWall = live.slice(ptr); // remainder for draws

  // Dora indicator: riichi convention is the 3rd tile from the back of the dead wall.
  // For MVP simplicity & determinism, take the first tile of the dead wall.
  const doraIndicator = deadWall[0];

  return { hands, liveWall, deadWall, doraIndicator };
}

/**
 * The kind that becomes the "dora" given the indicator kind.
 * Rule: numbers cycle within the suit (9 -> 1), winds E->S->W->N->E,
 * dragons haku->hatsu->chun->haku.
 */
export function doraFromIndicator(indicatorKind: number): number {
  if (indicatorKind < 27) {
    // numbered suits 0..26, cycle within each block of 9
    const suitBase = Math.floor(indicatorKind / 9) * 9;
    const n = indicatorKind % 9;
    return suitBase + ((n + 1) % 9);
  }
  if (indicatorKind <= 30) {
    // winds 27..30
    return 27 + ((indicatorKind - 27 + 1) % 4);
  }
  // dragons 31..33
  return 31 + ((indicatorKind - 31 + 1) % 3);
}
