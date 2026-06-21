"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import { erc20Abi } from "@/lib/erc20";
import { TOKENS } from "@/lib/tokens";

export type Balances = Record<string, string>; // symbol -> formatted

/** Saldo semua token allowlist untuk satu alamat. */
export function useBalances(address: Address | null) {
  const [balances, setBalances] = useState<Balances>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const entries = await Promise.all(
        TOKENS.map(async (t) => {
          const raw = t.native
            ? await publicClient.getBalance({ address })
            : await publicClient.readContract({
                address: t.address,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [address],
              });
          return [t.symbol, formatUnits(raw, t.decimals)] as const;
        }),
      );
      setBalances(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { balances, loading, refresh };
}
