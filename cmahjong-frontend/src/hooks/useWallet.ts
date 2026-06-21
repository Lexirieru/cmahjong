"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { isMiniPay, requestAccounts } from "@/lib/minipay";
import { ensureCeloChain } from "@/lib/chain";

/**
 * Koneksi dompet. Di MiniPay koneksi otomatis (tombol connect disembunyikan);
 * di luar MiniPay, pengguna menekan connect.
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
      // langsung arahkan wallet ke Celo begitu terhubung (no-op di MiniPay)
      if (acc) await ensureCeloChain().catch(() => {});
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    const mp = isMiniPay();
    setInMiniPay(mp);
    if (mp) void connect();

    const eth = window.ethereum;
    if (!eth?.on) return;
    const onAccounts = (accs: string[]) => setAddress((accs?.[0] as Address) ?? null);
    eth.on("accountsChanged", onAccounts as never);
    return () => eth.removeListener?.("accountsChanged", onAccounts as never);
  }, [connect]);

  return { address, inMiniPay, connecting, connect };
}
