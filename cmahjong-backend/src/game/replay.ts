/**
 * Replay deterministik sebuah game dari tape (seed + length + daftar aksi).
 * Memulai engine dari seed lalu menerapkan tiap aksi berurutan — mereproduksi
 * jalannya game persis (karena tembok deterministik dari seed yang sama).
 */
import { Hanchan, HanchanLength } from "./hanchan";
import { RoundOutcome } from "./round";

export interface ReplayMove {
  seq: number;
  seat: number;
  kind: string;
  payload?: { tileId?: number; kind?: number; low?: number } | null;
}

export interface ReplayTape {
  seed: string;
  length: HanchanLength;
  moves: ReplayMove[];
}

export interface ReplayResult {
  finished: boolean;
  points: number[];
  ranking: number[];
}

/** Terapkan satu aksi ke ronde aktif; kembalikan outcome bila aksi mengakhiri ronde. */
function applyMove(hanchan: Hanchan, m: ReplayMove): RoundOutcome | null {
  const r = hanchan.round;
  const p = m.payload ?? {};
  switch (m.kind) {
    case "discard":
      return r.discard(m.seat, p.tileId ?? -1);
    case "riichi":
      r.declareRiichi(m.seat, p.tileId ?? -1);
      return null;
    case "tsumo":
      return r.declareTsumo();
    case "ankan":
      return r.ankan(m.seat, p.kind ?? -1);
    case "addedkan":
      return r.addedKan(m.seat, p.kind ?? -1);
    case "pon":
    case "chi":
    case "kan":
    case "ron":
    case "pass":
      return r.respond(m.seat, { type: m.kind, low: p.low }).outcome ?? null;
    default:
      return null;
  }
}

export function replayGame(tape: ReplayTape): ReplayResult {
  const hanchan = new Hanchan(tape.seed, tape.length);
  const moves = [...tape.moves].sort((a, b) => a.seq - b.seq);
  for (const m of moves) {
    if (hanchan.finished) break;
    const outcome = applyMove(hanchan, m);
    if (outcome) hanchan.recordOutcome(outcome);
  }
  return {
    finished: hanchan.finished,
    points: hanchan.points,
    ranking: hanchan.finalRanking(),
  };
}
