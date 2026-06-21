"use client";

import type { Address } from "viem";
import { Button } from "@/components/Button";

interface Props {
  address: Address | null;
  inMiniPay: boolean;
  connecting: boolean;
  connect: () => void;
  onCreate: () => void;
  onJoin: () => void;
  onHistory: () => void;
}

export function Home({ address, inMiniPay, connecting, connect, onCreate, onJoin, onHistory }: Props) {
  return (
    <div className="flex flex-1 flex-col px-5">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="rise mb-7 relative">
          <div className="absolute inset-0 -z-10 rounded-full bg-gold-400/20 blur-2xl" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logos/cmahjong.png"
            alt="cMahjong"
            width={132}
            height={132}
            className="drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          />
        </div>

        <h1 className="max-w-[15rem] text-[28px] font-bold leading-[1.1] tracking-tight">
          Real mahjong, real stakes
        </h1>
        <p className="mt-3 max-w-[17rem] text-[15px] leading-relaxed text-ivory/65">
          Four players each put in a buy-in. Play a full hand of riichi mahjong, and the pot is
          paid out by final standing.
        </p>
      </div>

      <div className="space-y-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {!address ? (
          <Button onClick={connect} loading={connecting}>
            {inMiniPay ? "Connecting…" : "Connect to play"}
          </Button>
        ) : (
          <>
            <Button onClick={onCreate}>New table</Button>
            <Button variant="ghost" onClick={onJoin}>
              Join a table
            </Button>
          </>
        )}
        <button onClick={onHistory} className="w-full pt-1 text-center text-xs text-ivory/45">
          History &amp; replays
        </button>
        <p className="pt-1 text-center text-xs text-ivory/40">
          Provably fair shuffle · settled on Celo
        </p>
      </div>
    </div>
  );
}
