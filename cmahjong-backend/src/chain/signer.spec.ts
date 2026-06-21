import { Wallet } from "ethers";
import { recoverResultSigner, signResult, verifyResult, rankingHash } from "./signer";

const CONTRACT = "0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4";
const CHAIN_ID = 42220;

describe("signer EIP-712 GameResult", () => {
  const wallet = new Wallet("0x" + "11".repeat(32));
  const ranking: [string, string, string, string] = [
    "0x0000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000003",
    "0x0000000000000000000000000000000000000004",
  ];

  it("sign lalu recover menghasilkan alamat penanda tangan", async () => {
    const sig = await signResult(wallet, CONTRACT, CHAIN_ID, 1n, ranking);
    expect(recoverResultSigner(CONTRACT, CHAIN_ID, 1n, ranking, sig)).toBe(wallet.address);
    expect(verifyResult(CONTRACT, CHAIN_ID, 1n, ranking, sig, wallet.address)).toBe(true);
  });

  it("verify gagal bila ranking berbeda (anti-tamper)", async () => {
    const sig = await signResult(wallet, CONTRACT, CHAIN_ID, 1n, ranking);
    const tampered: [string, string, string, string] = [ranking[1], ranking[0], ranking[2], ranking[3]];
    expect(verifyResult(CONTRACT, CHAIN_ID, 1n, tampered, sig, wallet.address)).toBe(false);
  });

  it("verify gagal bila gameId / signature ngawur", async () => {
    const sig = await signResult(wallet, CONTRACT, CHAIN_ID, 1n, ranking);
    expect(verifyResult(CONTRACT, CHAIN_ID, 2n, ranking, sig, wallet.address)).toBe(false);
    expect(verifyResult(CONTRACT, CHAIN_ID, 1n, ranking, "0xdeadbeef", wallet.address)).toBe(false);
  });

  it("rankingHash konsisten (packed keccak)", () => {
    expect(rankingHash(ranking)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
