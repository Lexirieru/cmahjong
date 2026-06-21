/**
 * Penandatangan EIP-712 untuk hasil game — dipakai server saat `settleByServer`
 * (fallback anti rage-quit) dan untuk membantu klien membentuk digest `settle`.
 *
 * Harus cocok dengan domain & typehash di kontrak:
 *   domain  = EIP712("cMahjong", "1") di alamat kontrak, chainId Celo
 *   struct  = GameResult(uint256 gameId, bytes32 rankingHash)
 *   rankingHash = keccak256(abi.encodePacked(address[4] ranking))
 */
import { solidityPackedKeccak256, Wallet, TypedDataDomain } from "ethers";

export const RESULT_TYPES = {
  GameResult: [
    { name: "gameId", type: "uint256" },
    { name: "rankingHash", type: "bytes32" },
  ],
} as const;

export function domain(contract: string, chainId: number): TypedDataDomain {
  return { name: "cMahjong", version: "1", chainId, verifyingContract: contract };
}

/** rankingHash = keccak256(abi.encodePacked(ranking[0..3])). */
export function rankingHash(ranking: [string, string, string, string]): string {
  return solidityPackedKeccak256(["address", "address", "address", "address"], ranking);
}

/**
 * Tanda tangani hasil game sebagai server (untuk settleByServer).
 * @returns signature 65-byte (0x...)
 */
export async function signResult(
  serverWallet: Wallet,
  contract: string,
  chainId: number,
  gameId: bigint | number,
  ranking: [string, string, string, string],
): Promise<string> {
  return serverWallet.signTypedData(domain(contract, chainId), RESULT_TYPES as never, {
    gameId,
    rankingHash: rankingHash(ranking),
  });
}
