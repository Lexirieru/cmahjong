"use client";

import { Tile } from "@/components/Tile";
import type { Meld, PublicState, Tile as TileT } from "@/lib/socket";

const WIND = ["E", "S", "W", "N"];

/** Presentational mahjong board: opponents, dora/wall, discard rivers, and the bottom hand.
 *  Used both for live play and replay (read-only).
 *  When `allHands` is provided (replay), every seat's hand is shown face-up. */
export function Board({
  state,
  hand,
  mySeat,
  onTapTile,
  allHands,
}: {
  state: PublicState;
  hand: TileT[];
  mySeat: number;
  onTapTile?: (t: TileT) => void;
  allHands?: TileT[][];
}) {
  const windOf = (s: number) => WIND[(s - state.dealer + 4) % 4];
  const opponents = [(mySeat + 2) % 4, (mySeat + 3) % 4, (mySeat + 1) % 4];
  const reveal = !!allHands;

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
            showBacks={!reveal}
          />
        ))}
      </div>

      <div
        className={`my-3 rounded-3xl border border-white/10 bg-felt-700/40 p-3 ${reveal ? "" : "flex-1"}`}
      >
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

      {reveal ? (
        <AllHands hands={allHands!} melds={state.melds} turn={state.turn} windOf={windOf} />
      ) : (
        <div className="mb-2 flex min-h-[56px] flex-wrap items-end justify-center gap-[2px]">
          {hand.map((t, i) => (
            <div key={t.id} style={{ marginLeft: i === hand.length - 1 ? 6 : 0 }}>
              <Tile kind={t.kind} width={24} onClick={onTapTile ? () => onTapTile(t) : undefined} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function meldKinds(m: Meld): number[] {
  if (m.type === "sequence") return [m.kind, m.kind + 1, m.kind + 2];
  if (m.type === "kan") return [m.kind, m.kind, m.kind, m.kind];
  return [m.kind, m.kind, m.kind];
}

/** All four hands face-up (replay), each row: wind, concealed tiles, open melds. */
function AllHands({
  hands,
  melds,
  turn,
  windOf,
}: {
  hands: TileT[][];
  melds: Meld[][];
  turn: number;
  windOf: (s: number) => string;
}) {
  return (
    <div className="mb-2 space-y-1">
      {[0, 1, 2, 3].map((seat) => (
        <div key={seat} className="flex items-center gap-1.5">
          <span
            className={`w-4 shrink-0 text-[11px] ${turn === seat ? "text-gold-400" : "text-ivory/40"}`}
          >
            {windOf(seat)}
          </span>
          <div className="flex flex-wrap items-center gap-[2px]">
            {hands[seat].map((t, i) => (
              <Tile key={i} kind={t.kind} width={16} />
            ))}
            {melds[seat].map((m, mi) => (
              <div key={`m${mi}`} className="ml-1 flex gap-[1px] opacity-90">
                {meldKinds(m).map((k, ki) => (
                  <Tile key={ki} kind={k} width={16} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Opponent({
  wind,
  points,
  riichi,
  melds,
  isTurn,
  showBacks,
}: {
  wind: string;
  points: number;
  riichi: boolean;
  melds: number;
  isTurn: boolean;
  showBacks: boolean;
}) {
  return (
    <div className={`rounded-2xl surface px-2 py-2 text-center ${isTurn ? "ring-1 ring-gold-400" : ""}`}>
      <div className="flex items-center justify-center gap-1">
        <span className="text-xs font-semibold text-gold-400">{wind}</span>
        {riichi && <span className="h-1.5 w-1.5 rounded-full bg-red-400" />}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{points.toLocaleString()}</div>
      {showBacks && (
        <div className="mt-1 flex justify-center gap-[1px]">
          {Array.from({ length: Math.max(0, 13 - melds * 3) }).map((_, i) => (
            <span key={i} className="h-3 w-[5px] rounded-sm bg-emerald-900/70" />
          ))}
        </div>
      )}
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
