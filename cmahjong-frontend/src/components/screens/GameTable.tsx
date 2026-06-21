"use client";

import { useMemo, useState } from "react";
import type { Address } from "viem";
import { Tile } from "@/components/Tile";
import { Button } from "@/components/Button";
import { useGameSocket } from "@/hooks/useGameSocket";
import type { PublicState, Tile as TileT } from "@/lib/socket";

const WIND = ["E", "S", "W", "N"];

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
  // urutan tampil: lawan seberang, kiri, kanan (relatif aku)
  const opponents = useMemo(
    () => [(mySeat + 2) % 4, (mySeat + 3) % 4, (mySeat + 1) % 4],
    [mySeat],
  );

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
      {/* header meja */}
      <div className="flex items-center justify-between px-2 py-2 text-xs text-ivory/55">
        <button onClick={onExit} className="surface rounded-full px-3 py-1">
          Leave
        </button>
        <span>
          Table #{gameId.toString()} · {windOf(state.dealer)} round
        </span>
        <span>{isDemo ? "preview" : live.connected ? "live" : "…"}</span>
      </div>

      {/* lawan */}
      <div className="grid grid-cols-3 gap-2">
        {opponents.map((s) => (
          <Opponent
            key={s}
            wind={windOf(s)}
            points={state.points[s]}
            riichi={state.riichi[s]}
            melds={state.melds[s].length}
            isTurn={state.turn === s}
          />
        ))}
      </div>

      {/* meja: center + rivers */}
      <div className="my-3 flex-1 rounded-3xl border border-white/10 bg-felt-700/40 p-3">
        <div className="mb-3 flex items-center justify-center gap-4 text-center">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-ivory/50">dora</span>
            {state.doraIndicators.map((k, i) => (
              <Tile key={i} kind={k} width={26} />
            ))}
          </div>
          <div className="text-[11px] text-ivory/50">
            wall <span className="font-semibold text-ivory">{state.wallRemaining}</span>
          </div>
        </div>

        <div className="space-y-2">
          {[0, 1, 2, 3].map((s) => (
            <River key={s} wind={windOf(s)} mine={s === mySeat} kinds={state.discards[s]} />
          ))}
        </div>
      </div>

      {/* tangan saya */}
      <div className="pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mb-2 flex min-h-[56px] flex-wrap items-end justify-center gap-[2px]">
          {hand.map((t, i) => (
            <div key={t.id} style={{ marginLeft: i === hand.length - 1 ? 6 : 0 }}>
              <Tile kind={t.kind} width={24} onClick={myTurn ? () => tapTile(t) : undefined} />
            </div>
          ))}
        </div>

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

function Opponent({
  wind,
  points,
  riichi,
  melds,
  isTurn,
}: {
  wind: string;
  points: number;
  riichi: boolean;
  melds: number;
  isTurn: boolean;
}) {
  return (
    <div
      className={`rounded-2xl surface px-2 py-2 text-center ${
        isTurn ? "ring-1 ring-gold-400" : ""
      }`}
    >
      <div className="flex items-center justify-center gap-1">
        <span className="text-xs font-semibold text-gold-400">{wind}</span>
        {riichi && <span className="h-1.5 w-1.5 rounded-full bg-red-400" />}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{points.toLocaleString()}</div>
      <div className="mt-1 flex justify-center gap-[1px]">
        {Array.from({ length: Math.max(0, 13 - melds * 3) }).map((_, i) => (
          <span key={i} className="h-3 w-[5px] rounded-sm bg-emerald-900/70" />
        ))}
      </div>
    </div>
  );
}

function River({ wind, mine, kinds }: { wind: string; mine: boolean; kinds: number[] }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-1 w-4 text-[11px] ${mine ? "text-gold-400" : "text-ivory/40"}`}>{wind}</span>
      <div className="flex flex-wrap gap-[2px]">
        {kinds.length === 0 && <span className="text-[11px] text-ivory/25">—</span>}
        {kinds.map((k, i) => (
          <Tile key={i} kind={k} width={18} />
        ))}
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
