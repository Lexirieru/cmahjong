/**
 * Continue the settle for a game that is already Playing (e.g. a prior packing failure).
 * Verifies the off-chain digest == on-chain resultDigest BEFORE submitting (saves gas).
 *
 *   PRIVATE_KEY=0x.. CELO_RPC=.. GAME_ID=1 npx ts-node scripts/settle-continue.ts
 */
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  TypedDataEncoder,
  formatEther,
  solidityPackedKeccak256,
} from "ethers";
import { readFileSync } from "fs";

const PROXY = process.env.MAHJONG_ADDRESS ?? "0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4";
const NATIVE = "0x0000000000000000000000000000000000000000";
const CHAIN_ID = 42220;
const GAME_ID = BigInt(process.env.GAME_ID ?? "1");

const ABI = [
  "function settle(uint256 gameId, address[4] ranking, bytes[4] signatures)",
  "function resultDigest(uint256 gameId, address[4] ranking) view returns (bytes32)",
  "function creditOf(address token, address account) view returns (uint256)",
  "function withdraw(address token)",
];

const TYPES = {
  GameResult: [
    { name: "gameId", type: "uint256" },
    { name: "rankingHash", type: "bytes32" },
  ],
};
const domain = { name: "cMahjong", version: "1", chainId: CHAIN_ID, verifyingContract: PROXY };

async function main() {
  const provider = new JsonRpcProvider(process.env.CELO_RPC ?? "https://forno.celo.org");
  const deployer = new Wallet(process.env.PRIVATE_KEY!, provider);
  const keys: { address: string; privateKey: string }[] = JSON.parse(
    readFileSync(`${__dirname}/.e2e-wallets.json`, "utf8"),
  );
  const players = keys.map((k) => new Wallet(k.privateKey, provider));
  const ranking = players.map((p) => p.address) as [string, string, string, string];
  const contract = new Contract(PROXY, ABI, deployer);

  // compare the two rankingHash packing variants against the on-chain digest
  const onchain: string = await contract.resultDigest(GAME_ID, ranking);
  const variants: Record<string, string> = {
    "address[4] (padded 32B)": solidityPackedKeccak256(["address[4]"], [ranking]),
    "4x address (packed 20B)": solidityPackedKeccak256(
      ["address", "address", "address", "address"],
      ranking,
    ),
  };
  let rankingHash: string | null = null;
  for (const [label, rh] of Object.entries(variants)) {
    const local = TypedDataEncoder.hash(domain, TYPES, { gameId: GAME_ID, rankingHash: rh });
    const ok = local.toLowerCase() === onchain.toLowerCase();
    console.log(`  ${label}: ${ok ? "✅ MATCH" : "❌"} (rankingHash ${rh.slice(0, 18)}...)`);
    if (ok) rankingHash = rh;
  }
  if (!rankingHash) {
    console.error("No variant matched the on-chain resultDigest — stopping.");
    process.exit(1);
  }

  // sign the correct digest
  const sigs = (await Promise.all(
    players.map((p) => p.signTypedData(domain, TYPES, { gameId: GAME_ID, rankingHash })),
  )) as [string, string, string, string];

  console.log("\nsettle...");
  const tx = await contract.settle(GAME_ID, ranking, sigs);
  await tx.wait();
  console.log("  settle tx:", tx.hash);

  console.log("\nResulting credit (native):");
  for (let i = 0; i < 4; i++) {
    const c: bigint = await contract.creditOf(NATIVE, players[i].address);
    console.log(`  rank ${i + 1} ${players[i].address}: ${formatEther(c)} CELO`);
  }
  console.log(`  house rake: ${formatEther(await contract.creditOf(NATIVE, deployer.address))} CELO`);

  console.log("\nwithdraw winner (rank 1)...");
  const before = await provider.getBalance(players[0].address);
  const txW = await (contract.connect(players[0]) as Contract).withdraw(NATIVE);
  await txW.wait();
  const after = await provider.getBalance(players[0].address);
  console.log("  rank1 balance:", formatEther(before), "->", formatEther(after), "CELO (tx", txW.hash + ")");

  // sweep remaining player balances -> deployer
  console.log("\nSweep remaining player balances -> deployer...");
  const gp = (await provider.getFeeData()).gasPrice ?? 0n;
  for (const p of players) {
    try {
      const bal = await provider.getBalance(p.address);
      const reserve = gp * 21000n * 2n;
      if (bal > reserve) await (await p.sendTransaction({ to: deployer.address, value: bal - reserve })).wait();
    } catch {
      /* dust */
    }
  }
  console.log("Final deployer balance:", formatEther(await provider.getBalance(deployer.address)), "CELO");
  console.log("\n✅ E2E SETTLE SUCCEEDED");
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
