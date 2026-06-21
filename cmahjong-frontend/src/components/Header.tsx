"use client";

import type { Address } from "viem";
import { shortAddr, fmt } from "@/lib/format";
import type { Balances } from "@/hooks/useBalances";

export function Header({ address, balances }: { address: Address | null; balances: Balances }) {
  return (
    <header className="flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-bold tracking-tight">cMahjong</span>
        <span className="text-gold-400">·</span>
        <span className="text-xs text-ivory/55">Celo</span>
      </div>
      {address && (
        <div className="flex items-center gap-2 rounded-full surface px-3 py-1.5 text-xs">
          <span className="text-ivory/60">{fmt(balances.cUSD ?? "0", 2)} cUSD</span>
          <span className="h-3 w-px bg-white/15" />
          <span className="font-medium">{shortAddr(address)}</span>
        </div>
      )}
    </header>
  );
}
