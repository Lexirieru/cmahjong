/**
 * E2E: boot backend NestJS, sambungkan 4 klien socket, dan auto-main SATU GAME
 * penuh (hanchan East) sampai selesai, lalu cek ranking final + settle payload.
 *
 * Strategi auto-player: di giliran sendiri buang ubin yang baru ditarik; setiap
 * tawaran call dijawab pass. Ronde berakhir exhaustive draw, hanchan maju via
 * rotasi dealer hingga selesai.
 *
 *   npx ts-node scripts/play-game-e2e.ts
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { io, type Socket } from "socket.io-client";
import { AppModule } from "../src/app.module";

const PORT = 3199;
const GID = "e2e-1";
const SEED = "0x" + "ab".repeat(32);
const PLAYERS = [
  "0x0000000000000000000000000000000000000a01",
  "0x0000000000000000000000000000000000000a02",
  "0x0000000000000000000000000000000000000a03",
  "0x0000000000000000000000000000000000000a04",
];

interface Tile {
  id: number;
  kind: number;
}
interface State {
  phase: string;
  turn: number;
  points: number[];
  availableCalls: { seat: number; type: string }[];
}

async function main() {
  Logger.overrideLogger(["warn", "error"]);
  const app = await NestFactory.create(AppModule, { logger: ["warn", "error"] });
  await app.listen(PORT);

  const url = `http://localhost:${PORT}`;
  const clients = PLAYERS.map(() => io(url, { transports: ["websocket"], forceNew: true }));
  await Promise.all(
    clients.map((c) => new Promise<void>((r) => c.on("connect", () => r()))),
  );

  const hands: Record<number, Tile[]> = {};
  const passedWindow: boolean[] = [false, false, false, false];
  const lastDiscardId: number[] = [-1, -1, -1, -1];
  let rounds = 0;
  let moves = 0;
  let stateCount = 0;
  let handCount = 0;
  let firstState = "";
  let finished = false;
  let settle: { ranking?: string[] } | undefined;
  let lastPoints: number[] = [];

  const emit = (c: Socket, ev: string, body: object) =>
    new Promise<void>((r) => c.emit(ev, body, () => r()));

  function autoPlay(seat: number, c: Socket, st: State) {
    lastPoints = st.points;
    if (st.phase === "awaitingCalls") {
      const mine = st.availableCalls.some((x) => x.seat === seat);
      if (mine && !passedWindow[seat]) {
        passedWindow[seat] = true;
        void emit(c, "call", { gameId: GID, address: PLAYERS[seat], action: "pass" });
      }
      return;
    }
    passedWindow[seat] = false;
    if (st.phase === "playing" && st.turn === seat) {
      const hand = hands[seat];
      if (hand && hand.length >= 14) {
        const tileId = hand[hand.length - 1].id;
        if (lastDiscardId[seat] === tileId) return; // sudah dibuang (hindari dobel)
        lastDiscardId[seat] = tileId;
        moves++;
        void emit(c, "discard", { gameId: GID, address: PLAYERS[seat], tileId });
      }
    }
  }

  clients.forEach((c, seat) => {
    const lastState: { st?: State } = {};
    c.on("hand", (h: { seat: number; tiles: Tile[] }) => {
      handCount++;
      if (h.seat === seat) {
        hands[seat] = h.tiles;
        if (lastState.st) autoPlay(seat, c, lastState.st); // re-evaluasi bila hand tiba setelah state
      }
    });
    c.on("state", (st: State) => {
      stateCount++;
      lastState.st = st;
      if (!firstState) firstState = `phase=${st.phase} turn=${st.turn}`;
      autoPlay(seat, c, st);
    });
    c.on("roundEnd", (e: { finished: boolean; settle?: { ranking?: string[] } }) => {
      if (e.finished) {
        finished = true;
        settle = e.settle;
      } else {
        rounds++;
        passedWindow.fill(false);
      }
    });
    // tangani error ack stale (mis. pass terlambat) tanpa crash
    c.on("exception", () => {});
  });

  // semua join, lalu mulai game
  for (let i = 0; i < 4; i++) await emit(clients[i], "join", { gameId: GID, address: PLAYERS[i] });
  await emit(clients[0], "start", { gameId: GID, seed: SEED, players: PLAYERS, length: "east" });

  // tunggu selesai (log progres tiap 3s)
  const start = Date.now();
  let tick = 0;
  while (!finished && Date.now() - start < 30000) {
    await new Promise((r) => setTimeout(r, 200));
    if (Date.now() - start > tick * 3000) {
      tick++;
      console.log(
        `[t+${tick * 3}s] states=${stateCount} hands=${handCount} discards=${moves} rounds=${rounds + 1}`,
      );
    }
  }

  console.log("\n──────── HASIL ────────");
  console.log("diagnostik: state events:", stateCount, "| hand events:", handCount, "| first:", firstState);
  console.log("hand sizes:", [0, 1, 2, 3].map((s) => hands[s]?.length ?? 0));
  console.log("selesai:", finished);
  console.log("ronde dimainkan:", rounds + 1);
  console.log("total discard:", moves);
  console.log("poin akhir:", lastPoints);
  console.log("ranking final (juara 1..4):", settle?.ranking);

  clients.forEach((c) => c.disconnect());
  await app.close();

  if (!finished) {
    console.error("❌ Game tidak selesai dalam waktu yang ditentukan");
    process.exit(1);
  }
  console.log("\n✅ SATU GAME PENUH SELESAI END-TO-END");
}

main().catch((e) => {
  console.error("❌ GAGAL:", e);
  process.exit(1);
});
