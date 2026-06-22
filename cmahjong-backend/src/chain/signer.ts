/**
 * EIP-712 signer for game results — used by the server during `settleByServer`
 * (anti rage-quit fallback) and to help the client build the `settle` digest.
 *
 * Must match the domain & typehash in the contract:
 *   domain  = EIP712("cMahjong", "1") at the contract address, Celo chainId
 *   struct  = GameResult(uint256 gameId, bytes32 rankingHash)
 *   rankingHash = keccak256(abi.encodePacked(address[4] ranking))
 */
import { solidityPackedKeccak256, verifyTypedData, Wallet, TypedDataDomain } from "ethers";

export const RESULT_TYPES = {
  GameResult: [
    { name: "gameId", type: "uint256" },
    { name: "rankingHash", type: "bytes32" },
  ],
} as const;

export function domain(contract: string, chainId: number): TypedDataDomain {
  return { name: "cMahjong", version: "1", chainId, verifyingContract: contract };
}

/**
 * rankingHash = keccak256(abi.encodePacked(address[4] ranking)).
 *
 * IMPORTANT: in Solidity, `abi.encodePacked` on a fixed array (address[4]) PADS
 * each element to 32 bytes — NOT 20 bytes like a single address. So the correct
 * type here is "address[4]" (verified to match the on-chain resultDigest), not four
 * separate "address" values. Getting this wrong causes a NotAPlayer revert.
 */
export function rankingHash(ranking: [string, string, string, string]): string {
  return solidityPackedKeccak256(["address[4]"], [ranking]);
}

/**
 * Complete EIP-712 payload (domain + types + value) that the client must sign
 * (e.g. via `wallet.signTypedData` / wagmi `signTypedData`).
 */
export function resultTypedData(
  contract: string,
  chainId: number,
  gameId: bigint | number,
  ranking: [string, string, string, string],
) {
  return {
    domain: domain(contract, chainId),
    types: RESULT_TYPES,
    primaryType: "GameResult" as const,
    message: { gameId: gameId.toString(), rankingHash: rankingHash(ranking) },
  };
}

/**
 * Sign the game result as the server (for settleByServer).
 * @returns 65-byte signature (0x...)
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

/**
 * Recover the signer address from a game-result signature (EIP-712).
 * Used by the backend to verify a player's signature before submitting `settle`.
 */
export function recoverResultSigner(
  contract: string,
  chainId: number,
  gameId: bigint | number,
  ranking: [string, string, string, string],
  signature: string,
): string {
  return verifyTypedData(
    domain(contract, chainId),
    RESULT_TYPES as never,
    { gameId, rankingHash: rankingHash(ranking) },
    signature,
  );
}

/** Is `signature` truly from `expected` over this game result? */
export function verifyResult(
  contract: string,
  chainId: number,
  gameId: bigint | number,
  ranking: [string, string, string, string],
  signature: string,
  expected: string,
): boolean {
  try {
    return recoverResultSigner(contract, chainId, gameId, ranking, signature).toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}
