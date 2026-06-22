export function shortAddr(a?: string | null): string {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Trim long decimal numbers for readability (e.g. 12.340000 -> 12.34). */
export function fmt(value: string | number, maxDp = 4): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!isFinite(n)) return "0";
  if (n === 0) return "0";
  const fixed = n.toFixed(maxDp);
  return fixed.replace(/\.?0+$/, "");
}
