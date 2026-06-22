"use client";

import { Button } from "@/components/Button";
import { Tile } from "@/components/Tile";
import { BackTitle } from "./CreateTable";

const STEPS: { title: string; body: string; tiles?: number[] }[] = [
  {
    title: "The goal",
    body: "Be first to build a winning hand: four sets and one pair (14 tiles).",
    tiles: [1, 2, 3, 13, 13],
  },
  {
    title: "The tiles",
    body: "136 tiles: numbers 1–9 in three suits (characters, circles, bamboo), plus winds and dragons.",
    tiles: [0, 9, 18, 27, 31],
  },
  {
    title: "A turn",
    body: "On your turn you draw a tile, then discard one. A set is three of a kind or three in a row.",
  },
  {
    title: "Calls",
    body: "Claim another player's discard to complete a set: pon (triplet), chi (run from the left player), or kan (four).",
  },
  {
    title: "Riichi & winning",
    body: "One tile away? Declare riichi. Win by self-draw (tsumo) or off someone's discard (ron). More valuable hands (yaku) score more.",
  },
  {
    title: "The stakes",
    body: "Each of the four players puts in a buy-in. Play a full game; the pot is paid out by final standing — 50 / 30 / 15 / 5%. The shuffle is provably fair and everything settles on Celo.",
  },
];

export function HowToPlay({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col px-5">
      <BackTitle title="How to play" onBack={onBack} />

      <div className="flex-1 space-y-3 overflow-y-auto pt-1">
        {STEPS.map((s, i) => (
          <div key={i} className="rounded-2xl surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">{s.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ivory/65">{s.body}</p>
              </div>
              {s.tiles && (
                <div className="flex shrink-0 -space-x-1.5">
                  {s.tiles.map((k, j) => (
                    <Tile key={j} kind={k} width={20} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="py-[max(1.25rem,env(safe-area-inset-bottom))]">
        <Button onClick={onBack}>Got it</Button>
      </div>
    </div>
  );
}
