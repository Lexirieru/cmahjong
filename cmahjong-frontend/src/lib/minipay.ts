"use client";

/** Apakah dApp berjalan di dalam dompet MiniPay? */
export function isMiniPay(): boolean {
  return typeof window !== "undefined" && window.ethereum?.isMiniPay === true;
}

/** Minta akses akun (memunculkan prompt bila perlu). */
export async function requestAccounts(): Promise<string | null> {
  if (typeof window === "undefined" || !window.ethereum) return null;
  const accounts = (await window.ethereum.request({
    method: "eth_requestAccounts",
  })) as string[];
  return accounts?.[0] ?? null;
}

/** Ambil akun yang SUDAH diizinkan tanpa prompt — untuk reconnect saat refresh. */
export async function silentAccounts(): Promise<string | null> {
  if (typeof window === "undefined" || !window.ethereum) return null;
  try {
    const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}
