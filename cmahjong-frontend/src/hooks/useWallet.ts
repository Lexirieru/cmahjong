"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { isMiniPay, requestAccounts, silentAccounts } from "@/lib/minipay";
import { ensureCeloChain } from "@/lib/chain";

/** Reject if the promise hasn't settled within `ms` (so the UI never hangs forever). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ]);
}

/**
 * Wallet connection. In MiniPay the connection is automatic (the connect button is hidden);
 * outside MiniPay, the user presses connect.
 */
export function useWallet() {
  const [address, setAddress] = useState<Address | null>(null);
  const [inMiniPay, setInMiniPay] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    if (typeof window === "undefined" || !window.ethereum) {
      setError("No wallet found. Open this in MiniPay, or install a Celo-compatible wallet.");
      return;
    }
    setConnecting(true);
    try {
      // wallet popups can hang (no response / blocked) — cap the wait so the button recovers
      const acc = await withTimeout(requestAccounts(), 120000, "request");
      if (!acc) {
        setError("No account returned. Unlock your wallet and try again.");
        return;
      }
      setAddress(acc as Address);
      // point the wallet to Celo (best-effort, also timed so a stuck switch can't block)
      await withTimeout(ensureCeloChain(), 30000, "chain").catch(() => {});
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setError(
        msg.startsWith("timeout")
          ? "Wallet didn't respond — check for a pending popup, then try again."
          : msg.includes("rejected")
            ? "Connection request was rejected."
            : "Could not connect wallet. Try again.",
      );
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    const mp = isMiniPay();
    setInMiniPay(mp);
    if (mp) void connect();
    // outside MiniPay: restore the connection without a prompt on refresh
    else void silentAccounts().then((a) => a && setAddress(a as Address));

    const eth = window.ethereum;
    if (!eth?.on) return;
    const onAccounts = (accs: string[]) => setAddress((accs?.[0] as Address) ?? null);
    eth.on("accountsChanged", onAccounts as never);
    return () => eth.removeListener?.("accountsChanged", onAccounts as never);
  }, [connect]);

  return { address, inMiniPay, connecting, error, connect };
}
