"use client";

import { useEffect, useRef, useState } from "react";
import { BackTitle } from "./CreateTable";
import { Board, WIND } from "@/components/Board";
import { fetchReplayStates, type ReplayStates } from "@/lib/api";

const KIND_LABEL: Record<string, string> = {
  deal: "deal",
  discard: "discards",
  riichi: "declares riichi",
  tsumo: "tsumo",
  ron: "ron",
  pon: "pon",
  chi: "chi",
  kan: "kan",
  ankan: "closed kan",
  addedkan: "added kan",
  pass: "passes",
};

export function Replay({ gameId, onBack }: { gameId: string; onBack: () => void }) {
  const [data, setData] = useState<ReplayStates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchReplayStates(gameId)
      .then((d) => {
        setData(d);
        setI(0);
      })
      .catch((e) => setError((e as Error).message));
  }, [gameId]);

  useEffect(() => {
    if (!playing || !data) return;
    timer.current = setInterval(() => {
      setI((prev) => {
        if (prev >= data.frames.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 650);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, data]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col px-5">
        <BackTitle title={`Replay #${gameId}`} onBack={onBack} />
        <p className="pt-8 text-center text-sm text-red-300">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-1 flex-col px-5">
        <BackTitle title={`Replay #${gameId}`} onBack={onBack} />
        <p className="pt-8 text-center text-sm text-ivory/45">Loading replay…</p>
      </div>
    );
  }

  const frame = data.frames[i];
  const windOf = (s: number) => WIND[(s - frame.state.dealer + 4) % 4];
  const caption =
    frame.seat < 0 ? "New hand dealt" : `${windOf(frame.seat)} ${KIND_LABEL[frame.kind] ?? frame.kind}`;
  const atEnd = i === data.frames.length - 1;

  return (
    <div className="flex flex-1 flex-col px-3">
      <div className="flex items-center justify-between px-2 py-2 text-xs text-ivory/55">
        <button onClick={onBack} className="surface rounded-full px-3 py-1">
          Back
        </button>
        <span>Replay · Table #{gameId}</span>
        <span>
          {i + 1}/{data.frames.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Board state={frame.state} hand={frame.hands[0]} mySeat={0} allHands={frame.hands} />
      </div>

      <div className="pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p className="mb-2 text-center text-sm text-ivory/70">{caption}</p>

        <input
          type="range"
          min={0}
          max={data.frames.length - 1}
          value={i}
          onChange={(e) => {
            setPlaying(false);
            setI(Number(e.target.value));
          }}
          className="mb-3 w-full accent-gold-400"
        />

        <div className="flex items-center justify-center gap-3">
          <CtrlButton onClick={() => setI((v) => Math.max(0, v - 1))}>‹</CtrlButton>
          <button
            onClick={() => (atEnd ? (setI(0), setPlaying(true)) : setPlaying((p) => !p))}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-400 text-ink"
          >
            {playing ? "❚❚" : atEnd ? "↺" : "▶"}
          </button>
          <CtrlButton onClick={() => setI((v) => Math.min(data.frames.length - 1, v + 1))}>›</CtrlButton>
        </div>
      </div>
    </div>
  );
}

function CtrlButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="surface flex h-11 w-11 items-center justify-center rounded-full text-lg"
    >
      {children}
    </button>
  );
}
