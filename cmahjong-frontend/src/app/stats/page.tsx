"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchStats, type Stats } from "@/lib/api";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl surface p-4">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-ivory/55">{label}</div>
    </div>
  );
}

export default function StatsPage() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchStats()
      .then(setS)
      .catch((e) => setErr((e as Error).message));
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">
      <Link href="/" className="text-sm text-gold-400">
        ‹ Back to cMahjong
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">Stats</h1>
      <p className="mt-1 text-sm text-ivory/55">Live usage &amp; on-chain activity on Celo.</p>

      {err && <p className="mt-6 text-sm text-red-300">{err}</p>}
      {!s && !err && <p className="mt-6 text-sm text-ivory/45">Loading…</p>}

      {s && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Games played" value={s.games.total} />
            <Stat label="Settled" value={s.games.settled} />
            <Stat label="Live now" value={s.games.playing} />
            <Stat label="Players" value={s.players.total} />
            <Stat label="Active (7d)" value={s.players.activeLast7d} />
            <Stat label="Games (7d)" value={s.games.last7d} />
            <Stat label="Games (30d)" value={s.games.last30d} />
            <Stat label="Moves played" value={s.moves.total.toLocaleString()} />
            <Stat label="On-chain txs" value={`~${s.onchainTxEstimate.toLocaleString()}`} />
          </div>
          <p className="mt-5 text-xs text-ivory/35">
            Avg {s.moves.avgPerGame} moves/game · updated {new Date(s.updatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}
