/**
 * Commit–reveal utilities that MUST match the MahjongTable contract exactly.
 *
 * Contract:
 *   commitment = keccak256(abi.encodePacked(uint256 gameId, address player, bytes32 secret))
 *   seed       = keccak256(abi.encodePacked(bytes32 s0, bytes32 s1, bytes32 s2, bytes32 s3))
 *
 * Secrets are ordered by SEAT (join order) 0..3, just like the contract.
 */
import { randomBytes, solidityPackedKeccak256, hexlify } from "ethers";

/** Generate a random 32-byte secret (hex 0x...). */
export function randomSecret(): string {
  return hexlify(randomBytes(32));
}

/** Compute the commitment for join (mirrors the contract). */
export function commitmentOf(gameId: bigint | number, player: string, secret: string): string {
  return solidityPackedKeccak256(["uint256", "address", "bytes32"], [gameId, player, secret]);
}

/** Compute the collective seed from 4 seat-ordered secrets (mirrors the contract). */
export function computeSeed(secrets: [string, string, string, string]): string {
  return solidityPackedKeccak256(
    ["bytes32", "bytes32", "bytes32", "bytes32"],
    secrets,
  );
}

/** Verify that a reveal matches the stored commitment. */
export function verifyReveal(
  gameId: bigint | number,
  player: string,
  secret: string,
  commitment: string,
): boolean {
  return commitmentOf(gameId, player, secret).toLowerCase() === commitment.toLowerCase();
}
