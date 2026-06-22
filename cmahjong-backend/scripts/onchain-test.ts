/**
 * On-chain escrow test on Celo mainnet using the TEST_PK_* wallets, staking
 * native CELO. Runs the full lifecycle per game and reports gas, cost & timing:
 *
 *   createGame -> 4x joinGame(stake) -> 4x revealSeed -> settle(4 sigs) -> withdraw
 *
 *   set -a; source ../cmahjong-contract/.env; set +a
 *   GAMES=1 BUYIN_CELO=0.001 npx ts-node scripts/onchain-test.ts
 *
 * Real money. Keep BUYIN tiny. Private keys are read from env, never printed.
 */
import { Contract, JsonRpcProvider, Wallet, parseEther, formatEther, randomBytes, hexlify, solidityPackedKeccak256, Log } from "ethers";
import { domain, RESULT_TYPES, rankingHash } from "../src/chain/signer";

const RPC = process.env.CELO_RPC ?? "https://forno.celo.org";
const CHAIN_ID = 42220;
const ADDR = process.env.MAHJONG_ADDRESS ?? "0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4";
const NATIVE = "0x0000000000000000000000000000000000000000";
const GAMES = Number(process.env.GAMES ?? 1);
const BUYIN = parseEther(process.env.BUYIN_CELO ?? "0.001");
const WITHDRAW = process.env.WITHDRAW !== "0";

const ABI = [
  "function createGame(address token,uint256 buyIn,address server,uint16[4] payoutBps,uint64 commitWindow,uint64 revealWindow,uint64 settleWindow) returns (uint256)",
  "function joinGame(uint256 gameId, bytes32 commitment) payable",
  "function revealSeed(uint256 gameId, bytes32 secret)",
  "function settle(uint256 gameId, address[4] ranking, bytes[4] signatures)",
  "function withdraw(address token)",
  "function credits(address,address) view returns (uint256)",
  "event GameCreated(uint256 indexed gameId, address indexed creator, address token, uint256 buyIn, address server)",
];

const provider = new JsonRpcProvider(RPC, CHAIN_ID);
const env = (k: string) => process.env[k] as string;

let gasSpent = 0n;
let GP = 0n; // legacy gas price (set in main) — halves the upfront reserve vs EIP-1559
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const track = async (label: string, txPromise: Promise<any>): Promise<any> => {
  const t = now();
  const tx = await txPromise;
  const rc = await tx.wait();
  const cost = BigInt(rc.gasUsed) * BigInt(rc.gasPrice ?? 0n);
  gasSpent += cost;
  console.log(`  ${label.padEnd(16)} gas ${rc.gasUsed.toString().padStart(7)}  ${rc.hash.slice(0, 12)}…  ${now() - t}ms`);
  return rc;
};
const now = () => Number(process.hrtime.bigint() / 1000000n);

async function playGame(g: number) {
  const deployer = new Wallet(env("PRIVATE_KEY"), provider);
  const players = [0, 1, 2, 3].map((s) => new Wallet(env(`TEST_PK_${g * 4 + s + 1}`), provider));
  const addrs = players.map((p) => p.address) as [string, string, string, string];
  console.log(`\n── Game ${g + 1} · players ${addrs.map((a) => a.slice(0, 8)).join(" ")} · stake ${formatEther(BUYIN)} CELO each`);

  const ct = new Contract(ADDR, ABI, deployer);

  // 1. create
  const rc = await track("createGame", ct.createGame(NATIVE, BUYIN, deployer.address, [5000, 3000, 1500, 500], 3600, 3600, 3600, { gasPrice: GP, gasLimit: 250000 }));
  const ev = rc.logs
    .map((l: Log) => { try { return ct.interface.parseLog(l); } catch { return null; } })
    .find((p: { name: string } | null) => p?.name === "GameCreated");
  const gameId: bigint = ev!.args[0];

  // 2. join + stake (sequential: the 4th join changes status -> avoids gas-estimate races)
  const secrets = players.map(() => hexlify(randomBytes(32)));
  for (let i = 0; i < 4; i++) {
    const commitment = solidityPackedKeccak256(["uint256", "address", "bytes32"], [gameId, players[i].address, secrets[i]]);
    await track(`join p${i}`, ct.connect(players[i]).getFunction("joinGame")(gameId, commitment, { value: BUYIN, gasLimit: 200000, gasPrice: GP }));
  }

  // 3. reveal (sequential: the 4th reveal builds the seed)
  for (let i = 0; i < 4; i++) {
    await track(`reveal p${i}`, ct.connect(players[i]).getFunction("revealSeed")(gameId, secrets[i], { gasLimit: 220000, gasPrice: GP }));
  }

  // 4. settle — 4 EIP-712 signatures on the same ranking
  const ranking = addrs; // p0=1st .. p3=4th (any permutation of players is valid)
  const dom = domain(ADDR, CHAIN_ID);
  const msg = { gameId: gameId.toString(), rankingHash: rankingHash(ranking) };
  const sigs = (await Promise.all(players.map((p) => p.signTypedData(dom, RESULT_TYPES as never, msg)))) as [string, string, string, string];
  await track("settle", ct.settle(gameId, ranking, sigs, { gasLimit: 400000, gasPrice: GP }));

  // verify credits
  const credited = await Promise.all(addrs.map((a) => ct.credits(NATIVE, a)));
  console.log(`  credited: ${credited.map((c) => formatEther(c)).join(" / ")} CELO  (rank 1→4)`);

  // 5. withdraw winners (recover funds)
  if (WITHDRAW) {
    for (let i = 0; i < 4; i++) {
      if (credited[i] > 0n) await track(`withdraw p${i}`, ct.connect(players[i]).getFunction("withdraw")(NATIVE, { gasLimit: 120000, gasPrice: GP }));
    }
  }
  return { gameId, ranking };
}

async function main() {
  const net = await provider.getNetwork();
  console.log(`On-chain test → ${ADDR} on chain ${net.chainId}\n${GAMES} game(s), buy-in ${formatEther(BUYIN)} CELO, withdraw=${WITHDRAW}`);
  GP = (await provider.getFeeData()).gasPrice ?? 25000000000n;
  console.log(`gas price: ${Number(GP) / 1e9} gwei (legacy)`);
  const t0 = now();
  for (let g = 0; g < GAMES; g++) await playGame(g);
  console.log(`\n──────── DONE ────────`);
  console.log(`games settled : ${GAMES}`);
  console.log(`total gas cost: ${formatEther(gasSpent)} CELO`);
  console.log(`wall clock    : ${((now() - t0) / 1000).toFixed(1)}s`);
  console.log(`\n✅ Full escrow lifecycle executed on Celo mainnet`);
  process.exit(0);
}

main().catch((e) => {
  console.error("onchain-test failed:", e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
