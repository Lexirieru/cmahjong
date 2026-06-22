/**
 * E2E RESUME: prove a game can be continued after the backend "restarts".
 *
 *   1. Boot app A, start a game, play several turns (snapshot saved to the DB).
 *   2. Close app A (simulate a crash/restart).
 *   3. Boot app B (same DB) → onModuleInit loads the PLAYING game from the DB.
 *   4. Compare app B's state with app A's state before the restart → must be identical.
 *   5. Continue playing in app B.
 *
 *   set -a; source .env; set +a; npx ts-node scripts/resume-e2e.ts
 */
import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AppModule } from "../src/app.module";
import { GameService } from "../src/game/game.service";

const GID = "resume-1";
const SEED = "0x" + "cd".repeat(32);
const PLAYERS = [
  "0x00000000000000000000000000000000000000b1",
  "0x00000000000000000000000000000000000000b2",
  "0x00000000000000000000000000000000000000b3",
  "0x00000000000000000000000000000000000000b4",
];

async function boot() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, gs: app.get(GameService) };
}

/** Play one turn: discard the last tile; if there is a call phase, pass on all of them. */
function step(gs: GameService): "discarded" | "passed" | "ended" {
  const st = gs.publicState(GID);
  if (st.phase === "ended") return "ended";
  if (st.phase === "awaitingCalls") {
    const seats = [...new Set(st.availableCalls.map((c) => c.seat))];
    for (const s of seats) gs.respond(GID, s, { type: "pass" });
    return "passed";
  }
  const seat = st.turn;
  const hand = gs.handOf(GID, seat);
  gs.discard(GID, seat, hand[hand.length - 1].id);
  return "discarded";
}

async function main() {
  Logger.overrideLogger(["warn", "error", "log"]);

  // ── App A: start + play 6 turns ──
  const A = await boot();
  await A.gs.startRound(GID, { seed: SEED, players: PLAYERS, length: "east" });
  let discards = 0;
  while (discards < 6) {
    if (step(A.gs) === "discarded") discards++;
  }
  const stateA = A.gs.publicState(GID);
  console.log("App A  → discards/seat:", stateA.discards.map((d) => d.length), "| turn:", stateA.turn);

  // wait for the snapshot to be saved (coalesced 400ms + DB write), then "restart"
  await new Promise((r) => setTimeout(r, 1500));
  await A.app.close();
  console.log("— app A closed (simulated restart) —");

  // ── App B: boot from the same DB → should resume the game ──
  const B = await boot();
  let stateB;
  try {
    stateB = B.gs.publicState(GID);
  } catch {
    console.error("❌ Game was NOT restored in app B");
    await B.app.close();
    process.exit(1);
  }
  console.log("App B  → discards/seat:", stateB.discards.map((d) => d.length), "| turn:", stateB.turn);

  const match =
    JSON.stringify(stateA.discards) === JSON.stringify(stateB.discards) &&
    stateA.turn === stateB.turn &&
    JSON.stringify(stateA.points) === JSON.stringify(stateB.points);

  // keep playing in app B to prove the game is really alive
  const before = B.gs.publicState(GID).discards.reduce((a, d) => a + d.length, 0);
  for (let i = 0; i < 3; i++) step(B.gs);
  const after = B.gs.publicState(GID).discards.reduce((a, d) => a + d.length, 0);
  await B.app.close();

  console.log("\n──────── RESULT ────────");
  console.log("state matches before/after restart:", match);
  console.log("can continue playing in app B:", after > before, `(${before} → ${after} discards)`);
  if (match && after > before) {
    console.log("\n✅ RESUME AFTER RESTART SUCCEEDED");
  } else {
    console.error("\n❌ RESUME FAILED");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
