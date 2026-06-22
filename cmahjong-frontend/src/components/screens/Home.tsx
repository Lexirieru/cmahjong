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
  onHowTo: () => void;
  error?: string | null;
}

export function Home({
  address,
  inMiniPay,
  connecting,
  connect,
  onCreate,
  onJoin,
  onHistory,
  onHowTo,
  error,
}: Props) {
  return (
    <div className="flex flex-1 flex-col px-5 lg:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 py-10 lg:flex-row lg:gap-20 lg:py-0">
        {/* logo — top on mobile, right on desktop */}
        <div className="rise relative shrink-0 lg:order-2 lg:flex-1">
          <div className="absolute inset-0 -z-10 rounded-full bg-gold-400/25 blur-3xl" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logos/cmahjong.png"
            alt="cMahjong"
            width={288}
            height={288}
            className="mx-auto h-32 w-32 drop-shadow-[0_12px_30px_rgba(0,0,0,0.5)] lg:h-72 lg:w-72"
          />
        </div>

        {/* copy + actions — center on mobile, left on desktop */}
        <div className="flex w-full flex-col text-center lg:order-1 lg:flex-1 lg:text-left">
          <h1 className="mx-auto max-w-[16rem] text-[28px] font-bold leading-[1.1] tracking-tight lg:mx-0 lg:max-w-none lg:text-5xl">
            Real mahjong, real stakes
          </h1>
          <p className="mx-auto mt-3 max-w-[17rem] text-[15px] leading-relaxed text-ivory/65 lg:mx-0 lg:max-w-md lg:text-lg">
            Four players each put in a buy-in. Play a full hand of riichi mahjong, and the pot is
            paid out by final standing.
          </p>

          <div className="mt-8 w-full space-y-3 lg:max-w-xs">
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
            {error && (
              <p className="text-center text-sm leading-snug text-red-300 lg:text-left">{error}</p>
            )}
            <div className="flex items-center justify-center gap-4 pt-1 text-xs text-ivory/45 lg:justify-start">
              <button onClick={onHowTo}>How to play</button>
              <span className="text-ivory/20">·</span>
              <button onClick={onHistory}>History &amp; replays</button>
            </div>
            <p className="pt-1 text-center text-xs text-ivory/40 lg:text-left">
              Provably fair shuffle · settled on Celo
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
