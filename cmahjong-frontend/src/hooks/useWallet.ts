"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { isMiniPay, requestAccounts, silentAccounts } from "@/lib/minipay";
import { ensureCeloChain } from "@/lib/chain";

/**
 * Wallet connection. In MiniPay the connection is automatic (the connect button is hidden);
 * outside MiniPay, the user presses connect.
 */
export function useWallet() {
  const [address, setAddress] = useState<Address | null>(null);
  const [inMiniPay, setInMiniPay] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const acc = await requestAccounts();
      setAddress((acc as Address) ?? null);
      // immediately point the wallet to Celo once connected (no-op in MiniPay)
      if (acc) await ensureCeloChain().catch(() => {});
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

  return { address, inMiniPay, connecting, connect };
}
