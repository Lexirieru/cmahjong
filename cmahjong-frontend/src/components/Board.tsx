"use client";

import { Tile } from "@/components/Tile";
import type { PublicState, Tile as TileT } from "@/lib/socket";

const WIND = ["E", "S", "W", "N"];

/** Presentational mahjong board: opponents, dora/wall, discard river, and the bottom hand.
 *  Used both for live games and replay (read-only). */
export function Board({
  state,
  hand,
  mySeat,
  onTapTile,
}: {
  state: PublicState;
  hand: TileT[];
  mySeat: number;
  onTapTile?: (t: TileT) => void;
}) {
  const windOf = (s: number) => WIND[(s - state.dealer + 4) % 4];
  const opponents = [(mySeat + 2) % 4, (mySeat + 3) % 4, (mySeat + 1) % 4];

  return (
    <>
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

      <div className="mb-2 flex min-h-[56px] flex-wrap items-end justify-center gap-[2px]">
        {hand.map((t, i) => (
          <div key={t.id} style={{ marginLeft: i === hand.length - 1 ? 6 : 0 }}>
            <Tile kind={t.kind} width={24} onClick={onTapTile ? () => onTapTile(t) : undefined} />
          </div>
        ))}
      </div>
    </>
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
    <div className={`rounded-2xl surface px-2 py-2 text-center ${isTurn ? "ring-1 ring-gold-400" : ""}`}>
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

export { WIND };
