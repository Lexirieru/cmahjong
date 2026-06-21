/**
 * Pembagian awal Riichi dari tembok yang sudah dikocok.
 *
 * Konvensi tembok (deterministik dari seed):
 *   - 14 ubin terakhir = dead wall (tembok mati). Dora indicator = dead wall[?]
 *   - sisanya (122) = live wall, diambil saat draw.
 *
 * Ritual pembagian: dealer = East (seat 0). 3 putaran @ 4 ubin per pemain,
 * lalu 1 ubin per pemain → 13 ubin/pemain. East mengambil ubin ke-14 saat
 * gilirannya yang pertama (tsumo pertama), ditangani di luar fungsi ini.
 */
import { Tile } from "./tiles";

export const HAND_SIZE = 13;
export const SEATS = 4;
export const DEAD_WALL_SIZE = 14;

export interface DealResult {
  /** tangan awal tiap pemain (13 ubin), index seat 0..3 (E,S,W,N) */
  hands: Tile[][];
  /** tumpukan draw (live wall) tersisa, diambil dari depan (index 0 = berikutnya) */
  liveWall: Tile[];
  /** dead wall (14 ubin) */
  deadWall: Tile[];
  /** indikator dora pertama (dibuka di awal) */
  doraIndicator: Tile;
}

/**
 * Bagikan dari tembok 136-ubin yang sudah dikocok.
 * @param wall hasil shuffledWall(seed) — panjang 136
 */
export function dealFromWall(wall: Tile[]): DealResult {
  if (wall.length !== 136) {
    throw new Error(`tembok harus 136 ubin, dapat ${wall.length}`);
  }

  // dead wall = 14 ubin terakhir
  const deadWall = wall.slice(wall.length - DEAD_WALL_SIZE);
  const live = wall.slice(0, wall.length - DEAD_WALL_SIZE); // 122 ubin

  const hands: Tile[][] = [[], [], [], []];
  let ptr = 0;

  // 3 putaran @ 4 ubin per pemain
  for (let round = 0; round < 3; round++) {
    for (let seat = 0; seat < SEATS; seat++) {
      for (let k = 0; k < 4; k++) {
        hands[seat].push(live[ptr++]);
      }
    }
  }
  // 1 ubin terakhir per pemain
  for (let seat = 0; seat < SEATS; seat++) {
    hands[seat].push(live[ptr++]);
  }

  const liveWall = live.slice(ptr); // sisa untuk draw

  // Dora indicator: konvensi riichi indikator ke-3 dari belakang dead wall.
  // Untuk kesederhanaan & determinisme MVP, ambil ubin pertama dead wall.
  const doraIndicator = deadWall[0];

  return { hands, liveWall, deadWall, doraIndicator };
}

/**
 * Kind yang menjadi "dora" diberikan kind indikator.
 * Aturan: angka berputar dalam suit (9 -> 1), angin E->S->W->N->E,
 * naga haku->hatsu->chun->haku.
 */
export function doraFromIndicator(indicatorKind: number): number {
  if (indicatorKind < 27) {
    // suit angka 0..26, putar tiap blok 9
    const suitBase = Math.floor(indicatorKind / 9) * 9;
    const n = indicatorKind % 9;
    return suitBase + ((n + 1) % 9);
  }
  if (indicatorKind <= 30) {
    // angin 27..30
    return 27 + ((indicatorKind - 27 + 1) % 4);
  }
  // naga 31..33
  return 31 + ((indicatorKind - 31 + 1) % 3);
}
