/**
 * DETERMINISTIC wall shuffle, verifiable by anyone from the collective on-chain
 * seed.
 *
 * The seed comes from the commit–reveal in the MahjongTable contract:
 *   seed = keccak256(abi.encodePacked(secret0, secret1, secret2, secret3))
 *
 * The shuffle uses Fisher–Yates with a keccak256-based PRNG, so the resulting
 * wall is 100% reproducible: anyone who knows the seed can recompute the exact
 * same wall order and verify the server is not cheating. Algorithm:
 *
 *   for i from n-1 down to 1:
 *     j = keccak256(abi.encodePacked(seed, uint256(i))) mod (i + 1)
 *     swap wall[i] and wall[j]
 *
 * Because it uses keccak256 + abi.encodePacked (just like Solidity), this algorithm
 * can be rewritten in any language/onchain for auditing.
 */
import { solidityPackedKeccak256 } from "ethers";
import { Tile, buildWall } from "./tiles";

/** PRNG: return the `counter`-th deterministic random number from the seed (as a 256-bit bigint). */
export function keccakRandom(seed: string, counter: number | bigint): bigint {
  const h = solidityPackedKeccak256(["bytes32", "uint256"], [seed, counter]);
  return BigInt(h);
}

/** Deterministic Fisher–Yates from a seed. Returns a new array (does not mutate the input). */
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

/** Build the canonical wall then shuffle it with the seed. */
export function shuffledWall(seed: string): Tile[] {
  return deterministicShuffle(seed, buildWall());
}
