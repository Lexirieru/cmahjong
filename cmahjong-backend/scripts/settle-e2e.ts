/**
 * End-to-end test of the settle flow on Celo mainnet (tiny amount, native CELO).
 *
 *   createGame -> 4x joinGame+commit -> 4x revealSeed -> settle (4 player signatures)
 *   -> check credit -> withdraw winner.
 *
 * Uses src/chain/signer.ts directly (proving the backend's signatures match the
 * contract). Run:
 *   PRIVATE_KEY=0x.. CELO_RPC=https://forno.celo.org \
 *   npx ts-node scripts/settle-e2e.ts
 */
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  parseEther,
  solidityPackedKeccak256,
  hexlify,
  randomBytes,
} from "ethers";
import { writeFileSync } from "fs";
import { signResult } from "../src/chain/signer";

const PROXY = process.env.MAHJONG_ADDRESS ?? "0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4";
const NATIVE = "0x0000000000000000000000000000000000000000";
const CHAIN_ID = 42220;
const BUY_IN = parseEther("0.001"); // tiny
const FUND = parseEther("0.09"); // buyIn + gas for each player

const ABI = [
  "function createGame(address token,uint256 buyIn,address server,uint16[4] payoutBps,uint64 commitWindow,uint64 revealWindow,uint64 settleWindow) returns (uint256)",
  "function gameCount() view returns (uint256)",
  "function joinGame(uint256 gameId, bytes32 commitment) payable",
  "function revealSeed(uint256 gameId, bytes32 secret)",
  "function getSeed(uint256) view returns (bytes32)",
  "function settle(uint256 gameId, address[4] ranking, bytes[4] signatures)",
  "function creditOf(address token, address account) view returns (uint256)",
  "function withdraw(address token)",
  "function getGame(uint256) view returns (tuple(address token,uint256 buyIn,address server,uint8 status,uint8 joined,uint8 revealedCount,uint64 commitDeadline,uint64 revealWindow,uint64 settleWindow,uint64 revealDeadline,uint64 settleDeadline,bytes32 seed,uint16[4] payoutBps,address[4] players,bytes32[4] commitments,bytes32[4] secrets,bool[4] revealed))",
];

function commitmentOf(gameId: bigint, player: string, secret: string): string {
  return solidityPackedKeccak256(["uint256", "address", "bytes32"], [gameId, player, secret]);
}

async function main() {
  const rpc = process.env.CELO_RPC ?? "https://forno.celo.org";
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY is not set");

  const provider = new JsonRpcProvider(rpc);
  const deployer = new Wallet(pk, provider);
  console.log("Deployer/server:", deployer.address);
  console.log("Initial balance:", formatEther(await provider.getBalance(deployer.address)), "CELO\n");

  const contract = new Contract(PROXY, ABI, deployer);

  // 1) create 4 player wallets & fund them
  const players = [0, 1, 2, 3].map(() => Wallet.createRandom().connect(provider));
  // SAVE the keys before funding — so funds can be recovered if the script crashes
  const keyFile = `${__dirname}/.e2e-wallets.json`;
  writeFileSync(
    keyFile,
    JSON.stringify(
      players.map((p) => ({ address: p.address, privateKey: p.privateKey })),
      null,
      2,
    ),
  );
  console.log("Player keys saved to", keyFile, "(recovery)\n");
  console.log("Funding 4 players...");
  for (const p of players) {
    const tx = await deployer.sendTransaction({ to: p.address, value: FUND });
    await tx.wait();
  }
  console.log("  done.\n");

  // 2) createGame (native, tiny buy-in)
  console.log("createGame...");
  const payout: [number, number, number, number] = [5000, 3000, 1500, 500];
  const txC = await contract.createGame(NATIVE, BUY_IN, deployer.address, payout, 3600, 3600, 3600);
  await txC.wait();
  const gameId: bigint = await contract.gameCount();
  console.log("  gameId =", gameId.toString(), "tx", txC.hash, "\n");

  // 3) join + commit
  const secrets = players.map(() => hexlify(randomBytes(32)));
  console.log("joinGame + commit (4 players)...");
  for (let i = 0; i < 4; i++) {
    const c = commitmentOf(gameId, players[i].address, secrets[i]);
    const tx = await (contract.connect(players[i]) as Contract).joinGame(gameId, c, { value: BUY_IN });
    await tx.wait();
    console.log(`  seat ${i} join: ${players[i].address}`);
  }

  // 4) reveal
  console.log("\nrevealSeed (4 players)...");
  for (let i = 0; i < 4; i++) {
    const tx = await (contract.connect(players[i]) as Contract).revealSeed(gameId, secrets[i]);
    await tx.wait();
  }
  const seed: string = await contract.getSeed(gameId);
  console.log("  seed on-chain:", seed, "\n");

  // 5) final ranking + 4 EIP-712 signatures (using the backend signer)
  const ranking = players.map((p) => p.address) as [string, string, string, string];
  console.log("Signing ranking (1st..4th):", ranking);
  const sigs = (await Promise.all(
    players.map((p) => signResult(p as unknown as Wallet, PROXY, CHAIN_ID, gameId, ranking)),
  )) as [string, string, string, string];

  // 6) cooperative settle (deployer submits, pays the gas)
  console.log("\nsettle (cooperative, 4 sigs)...");
  const txS = await contract.settle(gameId, ranking, sigs);
  await txS.wait();
  console.log("  settle tx:", txS.hash, "\n");

  // 7) check the resulting payout credit
  console.log("Resulting credit (native):");
  for (let i = 0; i < 4; i++) {
    const c: bigint = await contract.creditOf(NATIVE, players[i].address);
    console.log(`  seat ${i} (rank ${i + 1}): ${formatEther(c)} CELO`);
  }
  const houseCredit: bigint = await contract.creditOf(NATIVE, deployer.address);
  console.log(`  house (rake): ${formatEther(houseCredit)} CELO`);

  // 8) withdraw winner
  console.log("\nwithdraw winner (seat 0)...");
  const balBefore = await provider.getBalance(players[0].address);
  const txW = await (contract.connect(players[0]) as Contract).withdraw(NATIVE);
  const rcptW = await txW.wait();
  const balAfter = await provider.getBalance(players[0].address);
  console.log("  withdraw tx:", txW.hash);
  console.log("  seat0 balance:", formatEther(balBefore), "->", formatEther(balAfter), "CELO");

  // 9) sweep remaining player balances back to the deployer (best-effort)
  console.log("\nSweep remaining player balances -> deployer...");
  const feeData = await provider.getFeeData();
  const gasP = feeData.gasPrice ?? 0n;
  for (const p of players) {
    try {
      const bal = await provider.getBalance(p.address);
      const reserve = gasP * 21000n * 2n;
      if (bal > reserve) {
        const tx = await p.sendTransaction({ to: deployer.address, value: bal - reserve });
        await tx.wait();
      }
    } catch {
      /* ignore dust */
    }
  }

  console.log("\nFinal deployer balance:", formatEther(await provider.getBalance(deployer.address)), "CELO");
  console.log("\n✅ E2E SETTLE SUCCEEDED");
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
