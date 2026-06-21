"use client";

/** Apakah dApp berjalan di dalam dompet MiniPay? */
export function isMiniPay(): boolean {
  return typeof window !== "undefined" && window.ethereum?.isMiniPay === true;
}

/** Minta akses akun. Di MiniPay koneksi bersifat implisit. */
export async function requestAccounts(): Promise<string | null> {
  if (typeof window === "undefined" || !window.ethereum) return null;
  const accounts = (await window.ethereum.request({
    method: "eth_requestAccounts",
  })) as string[];
  return accounts?.[0] ?? null;
}
