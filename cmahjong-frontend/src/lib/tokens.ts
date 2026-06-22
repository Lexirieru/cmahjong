import type { Address } from "viem";
import { NATIVE } from "./chain";

export interface TokenInfo {
  symbol: string;
  address: Address;
  decimals: number;
  native?: boolean;
}

/** Buy-in tokens allowlisted by the contract (Celo mainnet). */
export const TOKENS: TokenInfo[] = [
  { symbol: "cUSD", address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 },
  { symbol: "USDC", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6 },
  { symbol: "USDT", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6 },
  { symbol: "CELO", address: NATIVE, decimals: 18, native: true },
];

export function tokenByAddress(addr: string): TokenInfo | undefined {
  return TOKENS.find((t) => t.address.toLowerCase() === addr.toLowerCase());
}
