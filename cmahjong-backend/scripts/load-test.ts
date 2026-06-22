/**
 * Load test: simulate many concurrent games (4 players each) against a backend
 * to see how it behaves with N+ simultaneous users over WebSocket.
 *
 *   GAMES=30 BACKEND=http://localhost:3001 npx ts-node scripts/load-test.ts
 *
 * Reports: connection success, game-start latency, moves throughput, errors.
 * Uses unique offchain gameIds ("load-*") + unique addresses per simulated user.
 */
import { io, type Socket } from "socket.io-client";

const URL = process.env.BACKEND ?? "http://localhost:3001";
const GAMES = Number(process.env.GAMES ?? 30);
const LENGTH = (process.env.LENGTH ?? "east") as "east" | "hanchan";
const IDLE_MS = 3000; // a game is "done" if no move for this long
const HARD_MS = 180000; // safety cap per game

interface Tile {
  id: number;
}
interface State {
  phase: string;
  turn: number;
  availableCalls: { seat: number }[];
}

const addr = (g: number, seat: number) =>
  "0x" + (g * 4 + seat + 1).toString(16).padStart(40, "0");
const seedFor = (g: number) => "0x" + (g + 1).toString(16).padStart(64, "0");
const now = () => Number(process.hrtime.bigint() / 1000000n);

interface GameResult {
  game: number;
  connectMs: number;
  startLatencyMs: number;
  moves: number;
  finished: boolean;
  errors: number;
}

function runGame(g: number): Promise<GameResult> {
  return new Promise((resolve) => {
    const gid = `load-${g}`;
    const players = [0, 1, 2, 3].map((s) => addr(g, s));
    const t0 = now();
    const sockets = players.map(() => io(URL, { transports: ["websocket"], forceNew: true }));
    const hands: Record<number, Tile[]> = {};
    const passed = [false, false, false, false];
    const lastDiscard = [-1, -1, -1, -1];
    let moves = 0;
    let errors = 0;
    let connectMs = 0;
    let startLatencyMs = 0;
    let finished = false;
    let done = false;
    let idle: NodeJS.Timeout;
    let startedAt = 0;

    const finish = (fin: boolean) => {
      if (done) return;
      done = true;
      finished = fin;
      clearTimeout(idle);
      clearTimeout(hard);
      sockets.forEach((s) => s.disconnect());
      resolve({ game: g, connectMs, startLatencyMs, moves, finished, errors });
    };
    const bump = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(true), IDLE_MS);
    };
    const hard = setTimeout(() => finish(false), HARD_MS);

    function step(seat: number, c: Socket, st: State) {
      if (done) return;
      if (st.phase === "awaitingCalls") {
        if (st.availableCalls.some((x) => x.seat === seat) && !passed[seat]) {
          passed[seat] = true;
          c.emit("call", { gameId: gid, address: players[seat], action: "pass" });
        }
        return;
      }
      passed[seat] = false;
      if (st.phase === "playing" && st.turn === seat) {
        const hand = hands[seat];
        if (hand && hand.length >= 14) {
          const tileId = hand[hand.length - 1].id;
          if (lastDiscard[seat] === tileId) return;
          lastDiscard[seat] = tileId;
          moves++;
          bump();
          c.emit("discard", { gameId: gid, address: players[seat], tileId });
        }
      }
    }

    let connected = 0;
    let lastState: State | undefined;
    sockets.forEach((c, seat) => {
      c.on("connect", () => {
        connected++;
        if (connected === 4) {
          connectMs = now() - t0;
          for (let i = 0; i < 4; i++)
            sockets[i].emit("join", { gameId: gid, address: players[i] });
          startedAt = now();
          sockets[0].emit("start", { gameId: gid, seed: seedFor(g), players, length: LENGTH });
        }
      });
      c.on("connect_error", () => {
        errors++;
        if (!done && errors >= 4) finish(false);
      });
      c.on("hand", (h: { seat: number; tiles: Tile[] }) => {
        if (h.seat === seat) {
          hands[seat] = h.tiles;
          if (lastState) step(seat, c, lastState);
        }
      });
      c.on("state", (st: State) => {
        if (!startLatencyMs && startedAt) startLatencyMs = now() - startedAt;
        lastState = st;
        bump();
        step(seat, c, st);
      });
      c.on("exception", () => {
        errors++;
      });
    });
  });
}

function pct(arr: number[], p: number) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function main() {
  console.log(
    `Load test → ${URL}\n${GAMES} games × 4 = ${GAMES * 4} concurrent users (${LENGTH})\n`,
  );
  const wall0 = now();
  const results = await Promise.all(Array.from({ length: GAMES }, (_, g) => runGame(g)));
  const wallMs = now() - wall0;

  const totalMoves = results.reduce((a, r) => a + r.moves, 0);
  const finished = results.filter((r) => r.finished).length;
  const errs = results.reduce((a, r) => a + r.errors, 0);
  const connOk = results.filter((r) => r.connectMs > 0).length;
  const startLat = results.map((r) => r.startLatencyMs).filter((x) => x > 0);
  const connLat = results.map((r) => r.connectMs).filter((x) => x > 0);

  console.log("──────── RESULT ────────");
  console.log(`wall clock          : ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`users connected     : ${connOk * 4}/${GAMES * 4}`);
  console.log(`games completed     : ${finished}/${GAMES}`);
  console.log(`total moves played  : ${totalMoves}`);
  console.log(`throughput          : ${(totalMoves / (wallMs / 1000)).toFixed(0)} moves/s`);
  console.log(`connect latency     : p50 ${pct(connLat, 50)}ms · p95 ${pct(connLat, 95)}ms`);
  console.log(`game-start latency  : p50 ${pct(startLat, 50)}ms · p95 ${pct(startLat, 95)}ms`);
  console.log(`errors              : ${errs}`);
  console.log(finished === GAMES && errs === 0 ? "\n✅ HELD UP under load" : "\n⚠️  see numbers above");
  process.exit(0);
}

main().catch((e) => {
  console.error("load-test failed:", e);
  process.exit(1);
});
