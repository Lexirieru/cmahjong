/**
 * Play bots for a live on-chain table: connects the seat 1-3 wallets to the
 * backend and plays their turns, so a human (seat 0, via MiniPay) can play a real
 * game against them. Seat/seed/players are resolved on-chain by the backend.
 *
 *   set -a; source ../cmahjong-contract/.env; set +a
 *   BACKEND=https://cmahjong-production.up.railway.app GAME=33 npx ts-node scripts/play-table.ts
 */
import { io, type Socket } from "socket.io-client";
import { Wallet } from "ethers";

const URL = process.env.BACKEND ?? "https://cmahjong-production.up.railway.app";
const GID = process.env.GAME ?? "";
const PKS = (process.env.BOT_PKS ?? "TEST_PK_1,TEST_PK_2,TEST_PK_3").split(",");
const RUN_MS = Number(process.env.RUN_MS ?? 1800000); // keep bots alive (default 30 min)

interface Tile { id: number; kind: number }
interface State { phase: string; turn: number; availableCalls: { seat: number }[] }

async function main() {
  if (!GID) throw new Error("set GAME=<gameId>");
  const addrs = PKS.map((k) => new Wallet(process.env[k] as string).address);
  console.log(`Bots for table #${GID} → ${URL}`);
  console.log(`bot wallets: ${addrs.map((a) => a.slice(0, 8)).join(", ")} (seats assigned on-chain)\n`);

  const sockets = addrs.map(() => io(URL, { transports: ["websocket"], forceNew: true }));
  let started = false;

  sockets.forEach((c, i) => {
    const me = { seat: -1, hand: [] as Tile[], lastDiscard: -1, passedTurn: -1 };

    const act = (st: State) => {
      if (me.seat < 0) return;
      if (st.phase === "awaitingCalls") {
        if (st.availableCalls.some((x) => x.seat === me.seat) && me.passedTurn !== st.turn) {
          me.passedTurn = st.turn;
          c.emit("call", { gameId: GID, address: addrs[i], action: "pass" });
        }
        return;
      }
      if (st.phase === "playing" && st.turn === me.seat && me.hand.length >= 14) {
        const tileId = me.hand[me.hand.length - 1].id;
        if (me.lastDiscard === tileId) return;
        me.lastDiscard = tileId;
        c.emit("discard", { gameId: GID, address: addrs[i], tileId });
      }
    };

    c.on("connect", () => {
      c.emit("join", { gameId: GID, address: addrs[i] });
      if (!started) { started = true; c.emit("start", { gameId: GID }); } // backend reads seed/players on-chain
    });
    c.on("hand", (h: { seat: number; tiles: Tile[] }) => {
      me.seat = h.seat;
      me.hand = h.tiles;
    });
    let lastState: State | undefined;
    c.on("state", (st: State) => { lastState = st; act(st); });
    c.on("hand", () => { if (lastState) act(lastState); });
    c.on("roundEnd", (e: { finished?: boolean }) => {
      if (i === 0) console.log(`round ended${e?.finished ? " — game finished" : ""}`);
    });
    c.on("exception", (e: unknown) => console.log(`  seat ${me.seat} exception:`, e));
  });

  console.log("Bots online. Open table in MiniPay and play seat 0. Bots play 1-3.\n");
  await new Promise((r) => setTimeout(r, RUN_MS));
  sockets.forEach((s: Socket) => s.disconnect());
  console.log("bots stopped (time limit).");
  process.exit(0);
}

main().catch((e) => { console.error("play-table failed:", e?.message ?? e); process.exit(1); });
