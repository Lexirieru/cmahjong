"use client";

import { useEffect, useState } from "react";
import { BackTitle } from "./CreateTable";
import { listGames, type GameSummary } from "@/lib/api";
import { aliasOf } from "@/lib/identity";

export function History({
  onBack,
  onReplay,
}: {
  onBack: () => void;
  onReplay: (gameId: string) => void;
}) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGames()
      .then(setGames)
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div className="flex flex-1 flex-col px-5">
      <BackTitle title="History" onBack={onBack} />

      <div className="flex-1 space-y-2 pt-2">
        {error && <p className="text-sm text-red-300">{error}</p>}
        {!games && !error && <p className="text-sm text-ivory/45">Loading…</p>}
        {games && games.length === 0 && (
          <p className="pt-8 text-center text-sm text-ivory/45">No games yet.</p>
        )}
        {games?.map((g) => {
          const winner = g.finalRanking?.[0];
          return (
            <button
              key={g.gameId}
              onClick={() => onReplay(g.gameId)}
              className="w-full rounded-2xl surface p-4 text-left transition-colors hover:bg-white/8"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">Table #{g.gameId}</span>
                <span
                  className={`text-xs ${g.status === "SETTLED" ? "text-jade-400" : "text-ivory/50"}`}
                >
                  {g.status.toLowerCase()}
                </span>
              </div>
              <div className="mt-1 text-xs text-ivory/50">
                {g.players.length} players
                {winner && <> · winner {aliasOf(winner)}</>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
