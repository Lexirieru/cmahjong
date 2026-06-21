/**
 * Lanjutkan settle untuk game yang sudah Playing (mis. gagal packing sebelumnya).
 * Memverifikasi digest off-chain == on-chain resultDigest SEBELUM submit (hemat gas).
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

  // bandingkan dua varian packing rankingHash terhadap digest on-chain
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
    console.log(`  ${label}: ${ok ? "✅ COCOK" : "❌"} (rankingHash ${rh.slice(0, 18)}...)`);
    if (ok) rankingHash = rh;
  }
  if (!rankingHash) {
    console.error("Tidak ada varian yang cocok dengan resultDigest on-chain — stop.");
    process.exit(1);
  }

  // tanda tangani digest yang benar
  const sigs = (await Promise.all(
    players.map((p) => p.signTypedData(domain, TYPES, { gameId: GAME_ID, rankingHash })),
  )) as [string, string, string, string];

  console.log("\nsettle...");
  const tx = await contract.settle(GAME_ID, ranking, sigs);
  await tx.wait();
  console.log("  settle tx:", tx.hash);

  console.log("\nCredit hasil (native):");
  for (let i = 0; i < 4; i++) {
    const c: bigint = await contract.creditOf(NATIVE, players[i].address);
    console.log(`  rank ${i + 1} ${players[i].address}: ${formatEther(c)} CELO`);
  }
  console.log(`  house rake: ${formatEther(await contract.creditOf(NATIVE, deployer.address))} CELO`);

  console.log("\nwithdraw pemenang (rank 1)...");
  const before = await provider.getBalance(players[0].address);
  const txW = await (contract.connect(players[0]) as Contract).withdraw(NATIVE);
  await txW.wait();
  const after = await provider.getBalance(players[0].address);
  console.log("  saldo rank1:", formatEther(before), "->", formatEther(after), "CELO (tx", txW.hash + ")");

  // sweep sisa pemain -> deployer
  console.log("\nSweep sisa pemain -> deployer...");
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
  console.log("Saldo deployer akhir:", formatEther(await provider.getBalance(deployer.address)), "CELO");
  console.log("\n✅ E2E SETTLE BERHASIL");
}

main().catch((e) => {
  console.error("❌ GAGAL:", e);
  process.exit(1);
});
