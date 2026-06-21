"use client";

import type { Address } from "viem";
import { Button } from "@/components/Button";
import { Tile } from "@/components/Tile";

interface Props {
  address: Address | null;
  inMiniPay: boolean;
  connecting: boolean;
  connect: () => void;
  onCreate: () => void;
  onJoin: () => void;
}

export function Home({ address, inMiniPay, connecting, connect, onCreate, onJoin }: Props) {
  // tata letak kipas ubin dekoratif (naga + terminal)
  const decor = [31, 33, 0, 8, 32];

  return (
    <div className="flex flex-1 flex-col px-5">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-8 flex items-end justify-center">
          {decor.map((k, i) => (
            <div
              key={i}
              className="rise"
              style={{
                marginLeft: i ? -10 : 0,
                transform: `rotate(${(i - 2) * 7}deg) translateY(${Math.abs(i - 2) * 6}px)`,
                animationDelay: `${i * 60}ms`,
                zIndex: i,
              }}
            >
              <Tile kind={k} width={48} />
            </div>
          ))}
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
        <p className="pt-1 text-center text-xs text-ivory/40">
          Provably fair shuffle · settled on Celo
        </p>
      </div>
    </div>
  );
}
