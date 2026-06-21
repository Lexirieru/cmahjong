/**
 * Pengocokan tembok yang DETERMINISTIK & dapat diverifikasi siapa pun dari seed
 * kolektif on-chain.
 *
 * Seed berasal dari commit–reveal di kontrak MahjongTable:
 *   seed = keccak256(abi.encodePacked(secret0, secret1, secret2, secret3))
 *
 * Pengocokan memakai Fisher–Yates dengan PRNG berbasis keccak256, sehingga hasil
 * tembok 100% reproducible: siapa pun yang tahu seed bisa menghitung ulang urutan
 * tembok yang sama persis dan memastikan server tidak curang. Algoritma:
 *
 *   untuk i dari n-1 turun ke 1:
 *     j = keccak256(abi.encodePacked(seed, uint256(i))) mod (i + 1)
 *     tukar wall[i] dan wall[j]
 *
 * Karena memakai keccak256 + abi.encodePacked (sama seperti Solidity), algoritma ini
 * dapat ditulis ulang di bahasa/onchain apa pun untuk audit.
 */
import { solidityPackedKeccak256 } from "ethers";
import { Tile, buildWall } from "./tiles";

/** PRNG: kembalikan bilangan acak deterministik ke-`counter` dari seed (sebagai bigint 256-bit). */
export function keccakRandom(seed: string, counter: number | bigint): bigint {
  const h = solidityPackedKeccak256(["bytes32", "uint256"], [seed, counter]);
  return BigInt(h);
}

/** Fisher–Yates deterministik dari seed. Mengembalikan array baru (tidak mengubah input). */
export function deterministicShuffle<T>(seed: string, input: T[]): T[] {
  const arr = input.slice();
  for (let i = arr.length - 1; i >= 1; i--) {
    const j = Number(keccakRandom(seed, i) % BigInt(i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Bangun tembok kanonik lalu kocok dengan seed. */
export function shuffledWall(seed: string): Tile[] {
  return deterministicShuffle(seed, buildWall());
}
