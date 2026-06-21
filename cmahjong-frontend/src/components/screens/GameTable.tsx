"use client";

import { useState } from "react";
import type { Address } from "viem";
import { Board, WIND } from "@/components/Board";
import { Button } from "@/components/Button";
import { useGameSocket } from "@/hooks/useGameSocket";
import type { PublicState, Tile as TileT } from "@/lib/socket";

// State contoh agar meja tetap tampil utuh sebelum backend live.
const DEMO_STATE: PublicState = {
  phase: "playing",
  dealer: 0,
  roundWind: 27,
  turn: 0,
  doraIndicators: [4],
  wallRemaining: 70,
  discards: [
    [27, 13, 8],
    [30, 22],
    [31, 17, 2, 9],
    [28, 5],
  ],
  melds: [[], [], [{ type: "triplet", kind: 32, open: true }], []],
  riichi: [false, true, false, false],
  furiten: [false, false, false, false],
  points: [25000, 24000, 27000, 24000],
  lastDiscard: { seat: 3, kind: 5 },
  availableCalls: [],
};
const DEMO_HAND: TileT[] = [1, 2, 3, 11, 12, 13, 19, 20, 21, 24, 25, 6, 6, 14].map((kind, id) => ({
  id,
  kind,
}));

export function GameTable({
  gameId,
  address,
  seat,
  onExit,
}: {
  gameId: bigint;
  address: Address;
  seat: number;
  onExit: () => void;
}) {
  const live = useGameSocket(gameId.toString(), address, seat, gameId > 0n);
  const state = live.state ?? DEMO_STATE;
  const hand = live.hand.length ? live.hand : DEMO_HAND;
  const isDemo = !live.state;

  const [riichiArmed, setRiichiArmed] = useState(false);
  const mySeat = live.state ? seat : 0;
  const myTurn = state.phase === "playing" && state.turn === mySeat;
  const myCalls = state.availableCalls.filter((c) => c.seat === mySeat);
  const windOf = (s: number) => WIND[(s - state.dealer + 4) % 4];

  function tapTile(t: TileT) {
    if (!myTurn) return;
    if (riichiArmed) {
      live.actions.riichi(t.id);
      setRiichiArmed(false);
    } else {
      live.actions.discard(t.id);
    }
  }

  return (
    <div className="flex flex-1 flex-col px-3">
      <div className="flex items-center justify-between px-2 py-2 text-xs text-ivory/55">
        <button onClick={onExit} className="surface rounded-full px-3 py-1">
          Leave
        </button>
        <span>
          Table #{gameId.toString()} · {windOf(state.dealer)} round
        </span>
        <span>{isDemo ? "preview" : live.connected ? "live" : "…"}</span>
      </div>

      <Board state={state} hand={hand} mySeat={mySeat} onTapTile={myTurn ? tapTile : undefined} />

      <div className="pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <ActionBar
          myTurn={myTurn}
          turnWind={windOf(state.turn)}
          riichiArmed={riichiArmed}
          calls={myCalls}
          onRiichi={() => setRiichiArmed((v) => !v)}
          onTsumo={live.actions.tsumo}
          onCall={live.actions.call}
        />
      </div>
    </div>
  );
}

function ActionBar({
  myTurn,
  turnWind,
  riichiArmed,
  calls,
  onRiichi,
  onTsumo,
  onCall,
}: {
  myTurn: boolean;
  turnWind: string;
  riichiArmed: boolean;
  calls: { type: string; chiOptions?: number[] }[];
  onRiichi: () => void;
  onTsumo: () => void;
  onCall: (a: "pon" | "chi" | "kan" | "ron" | "pass", low?: number) => void;
}) {
  if (calls.length > 0) {
    return (
      <div className="flex gap-2">
        {calls.map((c) => (
          <Button
            key={c.type}
            variant={c.type === "ron" ? "primary" : "subtle"}
            onClick={() => onCall(c.type as never, c.chiOptions?.[0])}
          >
            {c.type.toUpperCase()}
          </Button>
        ))}
        <Button variant="ghost" onClick={() => onCall("pass")}>
          Pass
        </Button>
      </div>
    );
  }
  if (myTurn) {
    return (
      <div className="flex items-center gap-2">
        <Button variant={riichiArmed ? "primary" : "subtle"} onClick={onRiichi} className="flex-1">
          {riichiArmed ? "Pick a tile" : "Riichi"}
        </Button>
        <Button variant="ghost" onClick={onTsumo} className="flex-1">
          Tsumo
        </Button>
      </div>
    );
  }
  return (
    <div className="flex h-12 items-center justify-center text-sm text-ivory/45">
      {turnWind}&apos;s turn
    </div>
  );
}
