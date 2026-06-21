/**
 * E2E REPLAY: main satu game penuh (aksi ter-log ke DB), ambil tape dari DB,
 * lalu replayGame() dari seed+moves — hasilnya harus IDENTIK dengan game asli.
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
    console.error("❌ game tidak selesai");
    await app.close();
    process.exit(1);
  }

  await gs.flushMoves(GID); // pastikan seluruh aksi tertulis
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

  console.log("\n──────── HASIL ────────");
  console.log("moves tersimpan:", tape.moves.length);
  console.log("poin asli  :", actualPoints);
  console.log("poin replay:", result.points);
  console.log("poin cocok:", pointsMatch, "| ranking cocok:", rankingMatch);

  if (pointsMatch && rankingMatch && result.finished) {
    console.log("\n✅ REPLAY MEREPRODUKSI GAME PERSIS DARI SEED + MOVES");
    process.exit(0);
  }
  console.error("\n❌ REPLAY TIDAK COCOK");
  process.exit(1);
}

main().catch((e) => {
  console.error("❌ GAGAL:", e);
  process.exit(1);
});
