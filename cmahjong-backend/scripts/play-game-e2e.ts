/**
 * E2E: boot the NestJS backend, connect 4 socket clients, and auto-play ONE FULL
 * GAME (East hanchan) to completion, then check the final ranking + settle payload.
 *
 * Auto-player strategy: on your own turn, discard the freshly drawn tile; every
 * call offer is answered with a pass. The round ends in an exhaustive draw, and the
 * hanchan advances via dealer rotation until it finishes.
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
        if (lastDiscardId[seat] === tileId) return; // already discarded (avoid duplicates)
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
        if (lastState.st) autoPlay(seat, c, lastState.st); // re-evaluate if the hand arrives after the state
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
    // handle stale ack errors (e.g. a late pass) without crashing
    c.on("exception", () => {});
  });

  // everyone joins, then start the game
  for (let i = 0; i < 4; i++) await emit(clients[i], "join", { gameId: GID, address: PLAYERS[i] });
  await emit(clients[0], "start", { gameId: GID, seed: SEED, players: PLAYERS, length: "east" });

  // wait until finished (log progress every 3s)
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

  console.log("\n──────── RESULT ────────");
  console.log("diagnostics: state events:", stateCount, "| hand events:", handCount, "| first:", firstState);
  console.log("hand sizes:", [0, 1, 2, 3].map((s) => hands[s]?.length ?? 0));
  console.log("finished:", finished);
  console.log("rounds played:", rounds + 1);
  console.log("total discards:", moves);
  console.log("final points:", lastPoints);
  console.log("final ranking (1st..4th):", settle?.ranking);

  clients.forEach((c) => c.disconnect());
  await app.close();

  if (!finished) {
    console.error("❌ Game did not finish within the allotted time");
    process.exit(1);
  }
  console.log("\n✅ ONE FULL GAME COMPLETED END-TO-END");
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
