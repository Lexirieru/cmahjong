import { encodePacked, keccak256, toHex, type Address } from "viem";

/** Secret acak 32-byte untuk commit–reveal. */
export function randomSecret(): `0x${string}` {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b);
}

/** commitment = keccak256(abi.encodePacked(gameId, player, secret)) — mirror kontrak. */
export function commitmentOf(gameId: bigint, player: Address, secret: `0x${string}`) {
  return keccak256(encodePacked(["uint256", "address", "bytes32"], [gameId, player, secret]));
}

const key = (gameId: bigint, addr: Address) => `cm:secret:${gameId}:${addr.toLowerCase()}`;

export function saveSecret(gameId: bigint, addr: Address, secret: `0x${string}`) {
  try {
    localStorage.setItem(key(gameId, addr), secret);
  } catch {
    /* ignore */
  }
}

export function loadSecret(gameId: bigint, addr: Address): `0x${string}` | null {
  try {
    return localStorage.getItem(key(gameId, addr)) as `0x${string}` | null;
  } catch {
    return null;
  }
}
