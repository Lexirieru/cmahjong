/**
 * Join a table created via MiniPay with 3 test wallets (fill seats), then reveal.
 * Native CELO buy-in only (the test wallets hold CELO, not stablecoins).
 *
 *   set -a; source ../cmahjong-contract/.env; set +a
 *   GAME=42 npx ts-node scripts/join-table.ts
 *
 * Flow: joins N wallets -> waits until the table is full (you join via MiniPay)
 *       -> reveals the N wallets. You reveal your own seat in the app.
 */
import { Contract, JsonRpcProvider, Wallet, formatEther, randomBytes, hexlify, solidityPackedKeccak256 } from "ethers";

const RPC = process.env.CELO_RPC ?? "https://forno.celo.org";
const CHAIN_ID = 42220;
const ADDR = process.env.MAHJONG_ADDRESS ?? "0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4";
const NATIVE = "0x0000000000000000000000000000000000000000";
const GAME = BigInt(process.env.GAME ?? "0");
const N = Number(process.env.N ?? 3);

const ABI = [
  "function getGame(uint256) view returns (tuple(address token,uint256 buyIn,address server,uint8 status,uint8 joined,uint8 revealedCount,uint64 commitDeadline,uint64 revealWindow,uint64 settleWindow,uint64 revealDeadline,uint64 settleDeadline,bytes32 seed,uint16[4] payoutBps,address[4] players,bytes32[4] commitments,bytes32[4] secrets,bool[4] revealed))",
  "function joinGame(uint256 gameId, bytes32 commitment) payable",
  "function revealSeed(uint256 gameId, bytes32 secret)",
];

const provider = new JsonRpcProvider(RPC, CHAIN_ID);
const env = (k: string) => process.env[k] as string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (GAME === 0n) throw new Error("set GAME=<gameId>");
  let GP = (await provider.getFeeData()).gasPrice ?? 25000000000n;
  const read = new Contract(ADDR, ABI, provider);
  const g = await read.getGame(GAME);
  console.log(`Table #${GAME}: token ${g.token === NATIVE ? "CELO (native)" : g.token}, buy-in ${formatEther(g.buyIn)} CELO, status ${g.status}, joined ${g.joined}/4`);
  if (g.token !== NATIVE) throw new Error("buy-in is not native CELO — test wallets only hold CELO. Recreate the table with CELO.");
  if (g.status > 2n) throw new Error("table already past revealing");

  const players = Array.from({ length: N }, (_, i) => new Wallet(env(`TEST_PK_${i + 1}`), provider));
  const secrets: string[] = [];

  // 1. join the N wallets
  for (let i = 0; i < N; i++) {
    const p = players[i];
    const secret = hexlify(randomBytes(32));
    secrets.push(secret);
    const commitment = solidityPackedKeccak256(["uint256", "address", "bytes32"], [GAME, p.address, secret]);
    const tx = await new Contract(ADDR, ABI, p).getFunction("joinGame")(GAME, commitment, { value: g.buyIn, gasLimit: 130000, gasPrice: GP });
    const rc = await tx.wait();
    console.log(`  join ${p.address.slice(0, 8)} (seat?) gas ${rc.gasUsed} ${rc.hash.slice(0, 12)}…`);
  }

  // 2. wait until the table is full (you join via MiniPay)
  console.log(`\nWaiting for the table to fill (join via MiniPay if you haven't)…`);
  for (let i = 0; i < 120; i++) {
    const gg = await read.getGame(GAME);
    if (gg.joined >= 4n && gg.status === 2n) { console.log(`Table full → status Revealing.`); break; }
    if (i % 5 === 0) console.log(`  joined ${gg.joined}/4 …`);
    await sleep(5000);
  }

  // 3. reveal the N wallets
  console.log(`\nRevealing ${N} wallets…`);
  GP = (await provider.getFeeData()).gasPrice ?? GP;
  for (let i = 0; i < N; i++) {
    const p = players[i];
    const tx = await new Contract(ADDR, ABI, p).getFunction("revealSeed")(GAME, secrets[i], { gasLimit: 140000, gasPrice: GP });
    const rc = await tx.wait();
    console.log(`  reveal ${p.address.slice(0, 8)} gas ${rc.gasUsed} ${rc.hash.slice(0, 12)}…`);
  }

  const fin = await read.getGame(GAME);
  console.log(`\nTable #${GAME}: status ${fin.status} (3=Playing), revealed ${fin.revealedCount}/4`);
  console.log(fin.status === 3n ? "✅ Seed ready — game on-chain is live" : "ℹ️ Reveal your own seat in MiniPay to finish (seed needs all 4)");
  process.exit(0);
}

main().catch((e) => { console.error("join-table failed:", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
