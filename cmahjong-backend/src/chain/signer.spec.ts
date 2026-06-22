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

  it("sign then recover produces the signer address", async () => {
    const sig = await signResult(wallet, CONTRACT, CHAIN_ID, 1n, ranking);
    expect(recoverResultSigner(CONTRACT, CHAIN_ID, 1n, ranking, sig)).toBe(wallet.address);
    expect(verifyResult(CONTRACT, CHAIN_ID, 1n, ranking, sig, wallet.address)).toBe(true);
  });

  it("verify fails when ranking differs (anti-tamper)", async () => {
    const sig = await signResult(wallet, CONTRACT, CHAIN_ID, 1n, ranking);
    const tampered: [string, string, string, string] = [ranking[1], ranking[0], ranking[2], ranking[3]];
    expect(verifyResult(CONTRACT, CHAIN_ID, 1n, tampered, sig, wallet.address)).toBe(false);
  });

  it("verify fails when gameId / signature is bogus", async () => {
    const sig = await signResult(wallet, CONTRACT, CHAIN_ID, 1n, ranking);
    expect(verifyResult(CONTRACT, CHAIN_ID, 2n, ranking, sig, wallet.address)).toBe(false);
    expect(verifyResult(CONTRACT, CHAIN_ID, 1n, ranking, "0xdeadbeef", wallet.address)).toBe(false);
  });

  it("rankingHash is consistent (packed keccak)", () => {
    expect(rankingHash(ranking)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  // REGRESSION: packing address[4] MUST match abi.encodePacked in the contract
  // (32B pad). This value was verified to match the on-chain resultDigest during the
  // mainnet settle e2e (tx 0x33fca72...). If it changes -> settle will revert NotAPlayer.
  it("rankingHash matches on-chain abi.encodePacked(address[4])", () => {
    const onchainRanking: [string, string, string, string] = [
      "0xE75223EA0e0aB0C126398f3fAa43148d4D3C8EF2",
      "0x318aEac898507A338835751Bd1E23aa44400Fdd5",
      "0x75C7Ba8Ee6BfCbf874ABB76e38532949E593908D",
      "0x0FE7095397D26369B7b4B8c7c0202C340748b2f6",
    ];
    expect(rankingHash(onchainRanking)).toBe(
      "0xeb38fc41e814b7780ac03367f58f6e8606bd4766116aeb13993d5a170669edd0",
    );
  });
});
