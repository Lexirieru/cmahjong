// App-specific aliases so we never show a raw 0x… address as the primary identifier
// (MiniPay requirement). Deterministic, friendly two-word handle derived from the address.

const ADJ = [
  "Swift", "Clever", "Lucky", "Bold", "Calm", "Sharp", "Jade", "Golden",
  "Quiet", "Brave", "Wise", "Nimble", "Royal", "Lunar", "Solar", "Crimson",
];
const NOUN = [
  "Panda", "Dragon", "Crane", "Tiger", "Koi", "Fox", "Heron", "Tortoise",
  "Sparrow", "Phoenix", "Bamboo", "Lotus", "Maple", "Falcon", "Otter", "Orchid",
];

/** Friendly deterministic alias for an address (e.g. "Jade Crane"). */
export function aliasOf(addr?: string | null): string {
  if (!addr) return "Player";
  const h = addr.toLowerCase().replace(/^0x/, "");
  const a = parseInt(h.slice(0, 4) || "0", 16) % ADJ.length;
  const n = parseInt(h.slice(4, 8) || "0", 16) % NOUN.length;
  return `${ADJ[a]} ${NOUN[n]}`;
}
