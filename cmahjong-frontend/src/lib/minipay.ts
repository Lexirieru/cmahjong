"use client";

/** Is the dApp running inside the MiniPay wallet? */
export function isMiniPay(): boolean {
  return typeof window !== "undefined" && window.ethereum?.isMiniPay === true;
}

/** Request account access (shows a prompt if needed). */
export async function requestAccounts(): Promise<string | null> {
  if (typeof window === "undefined" || !window.ethereum) return null;
  const accounts = (await window.ethereum.request({
    method: "eth_requestAccounts",
  })) as string[];
  return accounts?.[0] ?? null;
}

/** Open MiniPay's Add Cash (deposit) screen — used when the user's balance is too low. */
export function openAddCash(tokens = "USDm,USDC,USDT"): void {
  if (typeof window === "undefined") return;
  window.location.href = `https://link.minipay.xyz/add_cash?tokens=${encodeURIComponent(tokens)}`;
}

/** Get already-authorized accounts without a prompt — for reconnecting on refresh. */
export async function silentAccounts(): Promise<string | null> {
  if (typeof window === "undefined" || !window.ethereum) return null;
  try {
    const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}
