/**
 * E2E REPLAY: play one full game (actions logged to the DB), fetch the tape from
 * the DB, then replayGame() from seed+moves — the result must be IDENTICAL to the
 * original game.
 *
 *   set -a; source .env; set +a; npx ts-node scripts/replay-e2e.ts
 */
import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AppModule } from "../src/app.module";
import { GameService, RoundEnd } from "../src/game/game.service";
import { HistoryService } from "../src/history/history.service";
import { replayGame } from "../src/game/replay";

const GID = "replay-1";
const SEED = "0x" + "ef".repeat(32);
const PLAYERS = [
  "0x00000000000000000000000000000000000000c1",
  "0x00000000000000000000000000000000000000c2",
  "0x00000000000000000000000000000000000000c3",
  "0x00000000000000000000000000000000000000c4",
];

async function main() {
  Logger.overrideLogger(["warn", "error", "log"]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  const gs = app.get(GameService);
  const history = app.get(HistoryService);

  await gs.startRound(GID, { seed: SEED, players: PLAYERS, length: "east" });

  let actual: RoundEnd | undefined;
  for (let guard = 0; guard < 5000 && !actual; guard++) {
    const st = gs.publicState(GID);
    let outcome = null;
    if (st.phase === "awaitingCalls") {
      const seats = [...new Set(st.availableCalls.map((c) => c.seat))];
      for (const s of seats) {
        const res = gs.respond(GID, s, { type: "pass" });
        if (res.resolved && res.outcome) outcome = res.outcome;
      }
    } else if (st.phase === "playing") {
      const seat = st.turn;
      const hand = gs.handOf(GID, seat);
      outcome = gs.discard(GID, seat, hand[hand.length - 1].id);
    } else break;
    if (outcome) {
      const end = await gs.recordOutcome(GID, outcome);
      if (end.finished) actual = end;
    }
  }

  if (!actual) {
    console.error("❌ game did not finish");
    await app.close();
    process.exit(1);
  }

  await gs.flushMoves(GID); // make sure all actions are written
  const tape = await history.getReplay(GID);
  const result = replayGame({
    seed: tape.seed!,
    length: tape.length as "east",
    moves: tape.moves as never,
  });
  await app.close();

  const actualPoints = actual.hanchan.points;
  const pointsMatch = JSON.stringify(actualPoints) === JSON.stringify(result.points);
  const replayRankingAddr = result.ranking.map((seat) => PLAYERS[seat].toLowerCase());
  const actualRankingAddr = actual.settle!.ranking.map((a) => a.toLowerCase());
  const rankingMatch = JSON.stringify(replayRankingAddr) === JSON.stringify(actualRankingAddr);

  console.log("\n──────── RESULT ────────");
  console.log("moves saved:", tape.moves.length);
  console.log("original points:", actualPoints);
  console.log("replay points :", result.points);
  console.log("points match:", pointsMatch, "| ranking match:", rankingMatch);

  if (pointsMatch && rankingMatch && result.finished) {
    console.log("\n✅ REPLAY REPRODUCES THE GAME EXACTLY FROM SEED + MOVES");
    process.exit(0);
  }
  console.error("\n❌ REPLAY DID NOT MATCH");
  process.exit(1);
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
