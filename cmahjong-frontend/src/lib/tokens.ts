import type { Address } from "viem";

export interface TokenInfo {
  symbol: string;
  address: Address;
  decimals: number;
  native?: boolean;
}

/** Entry tokens — stablecoins only (MiniPay supports USDm / USDC / USDT, never CELO). */
export const TOKENS: TokenInfo[] = [
  { symbol: "USDm", address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 },
  { symbol: "USDC", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6 },
  { symbol: "USDT", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6 },
];

export function tokenByAddress(addr: string): TokenInfo | undefined {
  return TOKENS.find((t) => t.address.toLowerCase() === addr.toLowerCase());
}
