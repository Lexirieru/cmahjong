/**
 * End a table via settleByServer (server attests the ranking) once settleDeadline
 * passes. Used when a player is on MiniPay (can't sign EIP-712 for cooperative settle).
 *
 *   set -a; source ../cmahjong-contract/.env; set +a
 *   GAME=33 WINNER=0xUSER npx ts-node scripts/settle-server.ts
 *
 * Ranking = [WINNER (if a player), then the rest in seat order]. WINNER gets 1st place.
 */
import { Contract, JsonRpcProvider, Wallet, formatEther } from "ethers";
import { domain, RESULT_TYPES, rankingHash } from "../src/chain/signer";

const RPC = process.env.CELO_RPC ?? "https://forno.celo.org";
const CHAIN_ID = 42220;
const ADDR = process.env.MAHJONG_ADDRESS ?? "0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4";
const NATIVE = "0x0000000000000000000000000000000000000000";
const GAME = BigInt(process.env.GAME ?? "0");
const WINNER = (process.env.WINNER ?? "").toLowerCase();

const ABI = [
  "function getGame(uint256) view returns (tuple(address token,uint256 buyIn,address server,uint8 status,uint8 joined,uint8 revealedCount,uint64 commitDeadline,uint64 revealWindow,uint64 settleWindow,uint64 revealDeadline,uint64 settleDeadline,bytes32 seed,uint16[4] payoutBps,address[4] players,bytes32[4] commitments,bytes32[4] secrets,bool[4] revealed))",
  "function settleByServer(uint256 gameId, address[4] ranking, bytes serverSig)",
  "function credits(address,address) view returns (uint256)",
];

const provider = new JsonRpcProvider(RPC, CHAIN_ID);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (GAME === 0n) throw new Error("set GAME=<gameId>");
  const server = new Wallet(process.env.PRIVATE_KEY as string, provider);
  const ct = new Contract(ADDR, ABI, server);
  const g = await ct.getGame(GAME);
  if (Number(g.status) !== 3) throw new Error(`game ${GAME} not Playing (status ${g.status})`);

  // build ranking: winner first, then the other players in seat order
  const players: string[] = [...g.players];
  const ranking = WINNER
    ? [players.find((p) => p.toLowerCase() === WINNER)!, ...players.filter((p) => p.toLowerCase() !== WINNER)]
    : players;
  if (ranking.some((x) => !x)) throw new Error("WINNER is not a player in this game");
  console.log(`Settle game ${GAME} · ranking(1→4): ${ranking.map((a) => a.slice(0, 8)).join(" ")}`);

  // server signs the result (EIP-712)
  const sig = await server.signTypedData(domain(ADDR, CHAIN_ID), RESULT_TYPES as never, {
    gameId: GAME.toString(),
    rankingHash: rankingHash(ranking as [string, string, string, string]),
  });

  // wait until settleDeadline passes
  const deadline = Number(g.settleDeadline);
  for (;;) {
    const blk = await provider.getBlock("latest");
    const ts = blk!.timestamp;
    if (ts > deadline) break;
    console.log(`  waiting settleDeadline: ${deadline - ts}s left…`);
    await sleep(30000);
  }

  const GP = (await provider.getFeeData()).gasPrice ?? 25000000000n;
  const tx = await ct.settleByServer(GAME, ranking, sig, { gasLimit: 300000, gasPrice: GP });
  const rc = await tx.wait();
  console.log(`✅ settled · tx ${rc.hash} · gas ${rc.gasUsed}`);

  const credited = await Promise.all((ranking as string[]).map((a) => ct.credits(NATIVE, a)));
  console.log(`credited (1→4): ${credited.map((c) => formatEther(c)).join(" / ")} CELO`);
  console.log(`\nWinner ${ranking[0].slice(0, 10)}… can withdraw in MiniPay (Result screen).`);
  process.exit(0);
}

main().catch((e) => { console.error("settle-server failed:", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
