/**
 * Deterministic replay of a game from a tape (seed + length + list of actions).
 * Starts the engine from the seed then applies each action in order — reproducing
 * the exact course of the game (because the wall is deterministic from the same seed).
 */
import { Hanchan, HanchanLength } from "./hanchan";
import { PublicState, RoundOutcome } from "./round";
import { Tile } from "../engine/tiles";

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

/** Apply a single action to the active round; return the outcome if the action ends the round. */
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

export interface ReplayFrame {
  seq: number;
  seat: number; // seat performing the action (-1 for the initial frame)
  kind: string; // "deal" for the initial frame
  state: PublicState;
  hands: Tile[][]; // all four seats' hands (replay = open)
}

/** Replay that captures the board state + hands at each step (for the UI). */
export function replayStates(tape: ReplayTape): { frames: ReplayFrame[]; result: ReplayResult } {
  const hanchan = new Hanchan(tape.seed, tape.length);
  const frames: ReplayFrame[] = [];
  const capture = (seq: number, seat: number, kind: string) => {
    const r = hanchan.round;
    frames.push({
      seq,
      seat,
      kind,
      state: r.publicState(),
      hands: [0, 1, 2, 3].map((s) => r.handOf(s)),
    });
  };

  capture(-1, -1, "deal");
  for (const m of [...tape.moves].sort((a, b) => a.seq - b.seq)) {
    if (hanchan.finished) break;
    const outcome = applyMove(hanchan, m);
    if (outcome) hanchan.recordOutcome(outcome);
    if (!hanchan.finished) capture(m.seq, m.seat, m.kind);
  }

  return {
    frames,
    result: { finished: hanchan.finished, points: hanchan.points, ranking: hanchan.finalRanking() },
  };
}
