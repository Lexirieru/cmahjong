/**
 * Bulk on-chain test: fund N test wallets then run N/4 full games (createGame ->
 * 4x join+stake -> 4x reveal -> settle) on Celo mainnet. Skips withdraw (winnings
 * stay credited, claimable later). Just-in-time funding, per-tx retry, balance guard.
 *
 *   set -a; source ../cmahjong-contract/.env; set +a
 *   N_WALLETS=100 START=0 npx ts-node scripts/onchain-bulk.ts
 */
import { Contract, JsonRpcProvider, Wallet, parseEther, formatEther, randomBytes, hexlify, solidityPackedKeccak256, Log } from "ethers";
import { domain, RESULT_TYPES, rankingHash } from "../src/chain/signer";

const RPC = process.env.CELO_RPC ?? "https://forno.celo.org";
const CHAIN_ID = 42220;
const ADDR = process.env.MAHJONG_ADDRESS ?? "0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4";
const NATIVE = "0x0000000000000000000000000000000000000000";
const N_WALLETS = Number(process.env.N_WALLETS ?? 100);
const GAMES = Math.floor(N_WALLETS / 4);
const START = Number(process.env.START ?? 0);
const BUYIN = parseEther(process.env.BUYIN_CELO ?? "0.001");
const MIN_DEPLOYER = parseEther("0.4"); // stop if the funding wallet drops below this

const ABI = [
  "function createGame(address token,uint256 buyIn,address server,uint16[4] payoutBps,uint64 commitWindow,uint64 revealWindow,uint64 settleWindow) returns (uint256)",
  "function joinGame(uint256 gameId, bytes32 commitment) payable",
  "function revealSeed(uint256 gameId, bytes32 secret)",
  "function settle(uint256 gameId, address[4] ranking, bytes[4] signatures)",
  "event GameCreated(uint256 indexed gameId, address indexed creator, address token, uint256 buyIn, address server)",
];

const provider = new JsonRpcProvider(RPC, CHAIN_ID);
const env = (k: string) => process.env[k] as string;
const now = () => Number(process.hrtime.bigint() / 1000000n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let GP = 0n;
let gasSpent = 0n;
let FUND_TO = 0n;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function retry<T>(label: string, fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? String(e);
      if (/insufficient funds|reverted|already joined|already revealed/i.test(m) || i >= tries) {
        throw new Error(`${label}: ${m}`);
      }
      console.log(`    retry ${label} (${i}/${tries}): ${m.slice(0, 60)}`);
      await sleep(3000);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendTx(label: string, fn: () => Promise<any>): Promise<void> {
  const t = now();
  const rc = await retry(label, async () => {
    const tx = await fn();
    return tx.wait();
  });
  gasSpent += BigInt(rc.gasUsed) * BigInt(rc.gasPrice ?? GP);
  console.log(`    ${label.padEnd(14)} gas ${rc.gasUsed.toString().padStart(7)}  ${rc.hash.slice(0, 10)}…  ${now() - t}ms`);
}

async function fund(deployer: Wallet, to: string) {
  const bal = await provider.getBalance(to);
  if (bal >= FUND_TO) return;
  const amount = FUND_TO - bal;
  await sendTx(`fund ${to.slice(0, 8)}`, () => deployer.sendTransaction({ to, value: amount, gasPrice: GP, gasLimit: 21000 }));
}

async function playGame(g: number, deployer: Wallet): Promise<boolean> {
  const players = [0, 1, 2, 3].map((s) => new Wallet(env(`TEST_PK_${g * 4 + s + 1}`), provider));
  const addrs = players.map((p) => p.address) as [string, string, string, string];
  const ct = new Contract(ADDR, ABI, deployer);
  console.log(`\n── Game ${g + 1}/${GAMES}  wallets ${g * 4 + 1}-${g * 4 + 4}`);

  // fund the 4 players just-in-time
  for (const p of players) await fund(deployer, p.address);

  // createGame
  let gameId = 0n;
  await sendTx("createGame", async () => {
    const tx = await ct.createGame(NATIVE, BUYIN, deployer.address, [5000, 3000, 1500, 500], 3600, 3600, 3600, { gasPrice: GP, gasLimit: 160000 });
    const rc = await tx.wait();
    const ev = rc.logs.map((l: Log) => { try { return ct.interface.parseLog(l); } catch { return null; } }).find((p: { name: string } | null) => p?.name === "GameCreated");
    gameId = ev!.args[0];
    return { wait: async () => rc };
  });

  const secrets = players.map(() => hexlify(randomBytes(32)));
  for (let i = 0; i < 4; i++) {
    const commitment = solidityPackedKeccak256(["uint256", "address", "bytes32"], [gameId, addrs[i], secrets[i]]);
    await sendTx(`join p${i}`, () => ct.connect(players[i]).getFunction("joinGame")(gameId, commitment, { value: BUYIN, gasLimit: 120000, gasPrice: GP }));
  }
  for (let i = 0; i < 4; i++) {
    await sendTx(`reveal p${i}`, () => ct.connect(players[i]).getFunction("revealSeed")(gameId, secrets[i], { gasLimit: 140000, gasPrice: GP }));
  }

  const dom = domain(ADDR, CHAIN_ID);
  const msg = { gameId: gameId.toString(), rankingHash: rankingHash(addrs) };
  const sigs = (await Promise.all(players.map((p) => p.signTypedData(dom, RESULT_TYPES as never, msg)))) as [string, string, string, string];
  await sendTx("settle", () => ct.settle(gameId, addrs, sigs, { gasLimit: 260000, gasPrice: GP }));
  return true;
}

async function main() {
  const deployer = new Wallet(env("PRIVATE_KEY"), provider);
  GP = (await provider.getFeeData()).gasPrice ?? 25000000000n;
  FUND_TO = 250000n * GP + BUYIN + parseEther("0.003"); // join+reveal reserve + stake + buffer
  console.log(`Bulk on-chain test → ${ADDR}`);
  console.log(`${GAMES} games (${N_WALLETS} wallets) from game ${START + 1} · gas ${Number(GP) / 1e9} gwei · fund-to ${formatEther(FUND_TO)} CELO/wallet`);
  console.log(`deployer ${deployer.address} = ${formatEther(await provider.getBalance(deployer.address))} CELO\n`);

  const t0 = now();
  let ok = 0;
  const failed: number[] = [];
  for (let g = START; g < GAMES; g++) {
    const bal = await provider.getBalance(deployer.address);
    if (bal < MIN_DEPLOYER) {
      console.log(`\n⛔ deployer low (${formatEther(bal)} CELO) — stopping at game ${g + 1}. Top up & resume with START=${g}`);
      break;
    }
    try {
      await playGame(g, deployer);
      ok++;
    } catch (e) {
      console.log(`  ❌ game ${g + 1} failed: ${(e as Error).message}`);
      failed.push(g + 1);
    }
  }

  const balEnd = await provider.getBalance(deployer.address);
  console.log(`\n──────── BULK DONE ────────`);
  console.log(`games settled : ${ok}/${GAMES}   (${ok * 4} wallets played)`);
  if (failed.length) console.log(`failed games  : ${failed.join(", ")}`);
  console.log(`gas burned    : ${formatEther(gasSpent)} CELO`);
  console.log(`deployer left : ${formatEther(balEnd)} CELO`);
  console.log(`wall clock    : ${((now() - t0) / 1000 / 60).toFixed(1)} min`);
  process.exit(0);
}

main().catch((e) => {
  console.error("bulk failed:", (e as Error).message);
  process.exit(1);
});
