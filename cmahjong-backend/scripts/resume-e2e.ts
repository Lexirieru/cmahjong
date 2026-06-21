/**
 * E2E RESUME: buktikan game bisa dilanjut setelah backend "restart".
 *
 *   1. Boot app A, mulai game, main beberapa giliran (snapshot tersimpan ke DB).
 *   2. Tutup app A (simulasi crash/restart).
 *   3. Boot app B (DB sama) → onModuleInit memuat game PLAYING dari DB.
 *   4. Bandingkan state app B dengan state app A sebelum restart → harus identik.
 *   5. Lanjutkan bermain di app B.
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

/** Mainkan satu giliran: buang ubin terakhir; bila ada fase call, pass semua. */
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

  // ── App A: mulai + main 6 giliran ──
  const A = await boot();
  await A.gs.startRound(GID, { seed: SEED, players: PLAYERS, length: "east" });
  let discards = 0;
  while (discards < 6) {
    if (step(A.gs) === "discarded") discards++;
  }
  const stateA = A.gs.publicState(GID);
  console.log("App A  → discards/seat:", stateA.discards.map((d) => d.length), "| turn:", stateA.turn);

  // tunggu snapshot tersimpan (coalesced 400ms + tulis DB), lalu "restart"
  await new Promise((r) => setTimeout(r, 1500));
  await A.app.close();
  console.log("— app A ditutup (simulasi restart) —");

  // ── App B: boot dari DB yang sama → harus me-resume game ──
  const B = await boot();
  let stateB;
  try {
    stateB = B.gs.publicState(GID);
  } catch {
    console.error("❌ Game TIDAK dipulihkan di app B");
    await B.app.close();
    process.exit(1);
  }
  console.log("App B  → discards/seat:", stateB.discards.map((d) => d.length), "| turn:", stateB.turn);

  const match =
    JSON.stringify(stateA.discards) === JSON.stringify(stateB.discards) &&
    stateA.turn === stateB.turn &&
    JSON.stringify(stateA.points) === JSON.stringify(stateB.points);

  // lanjut bermain di app B untuk membuktikan game benar-benar hidup
  const before = B.gs.publicState(GID).discards.reduce((a, d) => a + d.length, 0);
  for (let i = 0; i < 3; i++) step(B.gs);
  const after = B.gs.publicState(GID).discards.reduce((a, d) => a + d.length, 0);
  await B.app.close();

  console.log("\n──────── HASIL ────────");
  console.log("state cocok sebelum/sesudah restart:", match);
  console.log("bisa lanjut main di app B:", after > before, `(${before} → ${after} buangan)`);
  if (match && after > before) {
    console.log("\n✅ RESUME SETELAH RESTART BERHASIL");
  } else {
    console.error("\n❌ RESUME GAGAL");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ GAGAL:", e);
  process.exit(1);
});
