/**
 * Util commit–reveal yang HARUS sama persis dengan kontrak MahjongTable.
 *
 * Kontrak:
 *   commitment = keccak256(abi.encodePacked(uint256 gameId, address player, bytes32 secret))
 *   seed       = keccak256(abi.encodePacked(bytes32 s0, bytes32 s1, bytes32 s2, bytes32 s3))
 *
 * Secret diurutkan berdasarkan SEAT (urutan join) 0..3, sama seperti kontrak.
 */
import { randomBytes, solidityPackedKeccak256, hexlify } from "ethers";

/** Hasilkan secret acak 32-byte (hex 0x...). */
export function randomSecret(): string {
  return hexlify(randomBytes(32));
}

/** Hitung commitment untuk join (mirror kontrak). */
export function commitmentOf(gameId: bigint | number, player: string, secret: string): string {
  return solidityPackedKeccak256(["uint256", "address", "bytes32"], [gameId, player, secret]);
}

/** Hitung seed kolektif dari 4 secret terurut seat (mirror kontrak). */
export function computeSeed(secrets: [string, string, string, string]): string {
  return solidityPackedKeccak256(
    ["bytes32", "bytes32", "bytes32", "bytes32"],
    secrets,
  );
}

/** Verifikasi sebuah reveal cocok dengan commitment yang tersimpan. */
export function verifyReveal(
  gameId: bigint | number,
  player: string,
  secret: string,
  commitment: string,
): boolean {
  return commitmentOf(gameId, player, secret).toLowerCase() === commitment.toLowerCase();
}
