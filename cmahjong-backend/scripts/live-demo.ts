/**
 * Live demo bot: connect 4 socket clients to a running backend, start a game,
 * play a handful of turns, then idle (keep the game mid-round) so a frontend can
 * spectate the live board over WebSocket.
 *
 *   BACKEND=https://cmahjong-production.up.railway.app GAME=777001 npx ts-node scripts/live-demo.ts
 */
import { io, type Socket } from "socket.io-client";

const URL = process.env.BACKEND ?? "http://localhost:3001";
const GID = process.env.GAME ?? "777001";
const MOVES = Number(process.env.MOVES ?? 16);
const SEED = "0x" + "7a".repeat(32);
const PLAYERS = [
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000002",
  "0x0000000000000000000000000000000000000003",
  "0x0000000000000000000000000000000000000004",
];

interface Tile {
  id: number;
  kind: number;
}
interface State {
  phase: string;
  turn: number;
  availableCalls: { seat: number }[];
  discards: number[][];
}

async function main() {
  const clients = PLAYERS.map(() => io(URL, { transports: ["websocket"], forceNew: true }));
  await Promise.all(clients.map((c) => new Promise<void>((r) => c.on("connect", () => r()))));
  console.log("connected 4 clients to", URL);

  const hands: Record<number, Tile[]> = {};
  const lastState: { st?: State } = {};
  const lastDiscardId = [-1, -1, -1, -1];
  const passed = [false, false, false, false];
  let moves = 0;
  let stopped = false;

  const emit = (c: Socket, ev: string, body: object) => c.emit(ev, body);

  function step(seat: number, c: Socket, st: State) {
    if (stopped || moves >= MOVES) return;
    if (st.phase === "awaitingCalls") {
      if (st.availableCalls.some((x) => x.seat === seat) && !passed[seat]) {
        passed[seat] = true;
        emit(c, "call", { gameId: GID, address: PLAYERS[seat], action: "pass" });
      }
      return;
    }
    passed[seat] = false;
    if (st.phase === "playing" && st.turn === seat) {
      const hand = hands[seat];
      if (hand && hand.length >= 14) {
        const tileId = hand[hand.length - 1].id;
        if (lastDiscardId[seat] === tileId) return;
        lastDiscardId[seat] = tileId;
        moves++;
        emit(c, "discard", { gameId: GID, address: PLAYERS[seat], tileId });
        if (moves >= MOVES) {
          stopped = true;
          console.log(`played ${moves} moves — now idling so the FE can spectate`);
        }
      }
    }
  }

  clients.forEach((c, seat) => {
    c.on("hand", (h: { seat: number; tiles: Tile[] }) => {
      if (h.seat === seat) {
        hands[seat] = h.tiles;
        if (lastState.st) step(seat, c, lastState.st);
      }
    });
    c.on("state", (st: State) => {
      lastState.st = st;
      step(seat, c, st);
    });
    c.on("exception", () => {});
  });

  for (let i = 0; i < 4; i++) emit(clients[i], "join", { gameId: GID, address: PLAYERS[i] });
  emit(clients[0], "start", { gameId: GID, seed: SEED, players: PLAYERS, length: "hanchan" });

  // idle: keep sockets open so the game stays live and mid-round
  await new Promise((r) => setTimeout(r, 180000));
  clients.forEach((c) => c.disconnect());
}

main().catch((e) => {
  console.error("live-demo failed:", e);
  process.exit(1);
});
