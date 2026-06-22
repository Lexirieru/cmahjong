"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { Home } from "@/components/screens/Home";
import { CreateTable } from "@/components/screens/CreateTable";
import { JoinTable } from "@/components/screens/JoinTable";
import { Lobby } from "@/components/screens/Lobby";
import { GameTable } from "@/components/screens/GameTable";
import { Result } from "@/components/screens/Result";
import { History } from "@/components/screens/History";
import { Replay } from "@/components/screens/Replay";
import { HowToPlay } from "@/components/screens/HowToPlay";
import { useWallet } from "@/hooks/useWallet";
import { useBalances } from "@/hooks/useBalances";
import type { Address } from "viem";

type Screen =
  | "home"
  | "create"
  | "join"
  | "lobby"
  | "game"
  | "result"
  | "history"
  | "replay"
  | "howto";

const PREVIEW_ADDR = "0x0000000000000000000000000000000000000000" as Address;

export default function Page() {
  const { address, inMiniPay, connecting, connect } = useWallet();
  const { balances } = useBalances(address);
  const [screen, setScreen] = useState<Screen>("home");
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [seat, setSeat] = useState(0);
  const [preview, setPreview] = useState(false);
  const [replayId, setReplayId] = useState<string | null>(null);

  // Restore navigation on refresh + support preview (?preview=table) — in an effect so it doesn't clash with hydration
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const pv = q.get("preview");
    if (pv === "table") {
      setPreview(true);
      setGameId(0n);
      setScreen("game");
      return;
    }
    if (pv === "history") {
      setScreen("history");
      return;
    }
    if (pv === "howto") {
      setScreen("howto");
      return;
    }
    if (pv === "replay" && q.get("game")) {
      setReplayId(q.get("game"));
      setScreen("replay");
      return;
    }
    try {
      const raw = localStorage.getItem("cm:nav");
      if (raw) {
        const n = JSON.parse(raw) as { screen?: Screen; gameId?: string | null; seat?: number };
        if (n.screen) setScreen(n.screen);
        if (n.gameId) setGameId(BigInt(n.gameId));
        if (typeof n.seat === "number") setSeat(n.seat);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Persist navigation position so a refresh doesn't return to the start
  useEffect(() => {
    try {
      localStorage.setItem(
        "cm:nav",
        JSON.stringify({ screen, gameId: gameId?.toString() ?? null, seat }),
      );
    } catch {
      /* ignore */
    }
  }, [screen, gameId, seat]);

  const acct = address ?? (preview ? PREVIEW_ADDR : null);

  const home = () => setScreen("home");
  const hideHeader = screen === "game";

  return (
    <>
      {!hideHeader && <Header address={address} balances={balances} />}

      {screen === "home" && (
        <Home
          address={address}
          inMiniPay={inMiniPay}
          connecting={connecting}
          connect={connect}
          onCreate={() => setScreen("create")}
          onJoin={() => setScreen("join")}
          onHistory={() => setScreen("history")}
          onHowTo={() => setScreen("howto")}
        />
      )}

      {screen === "howto" && <HowToPlay onBack={home} />}

      {screen === "history" && (
        <History
          onBack={home}
          onReplay={(id) => {
            setReplayId(id);
            setScreen("replay");
          }}
        />
      )}

      {screen === "replay" && replayId && (
        <Replay gameId={replayId} onBack={() => setScreen("history")} />
      )}

      {screen === "create" && address && (
        <CreateTable
          address={address}
          onBack={home}
          onCreated={(id) => {
            setGameId(id);
            setScreen("lobby");
          }}
        />
      )}

      {screen === "join" && (
        <JoinTable
          onBack={home}
          onJoin={(id) => {
            setGameId(id);
            setScreen("lobby");
          }}
        />
      )}

      {screen === "lobby" && gameId !== null && address && (
        <Lobby
          gameId={gameId}
          address={address}
          onBack={home}
          onEnter={(_id, s) => {
            setSeat(s < 0 ? 0 : s);
            setScreen("game");
          }}
          onResult={(id) => {
            setGameId(id);
            setScreen("result");
          }}
        />
      )}

      {screen === "game" && gameId !== null && acct && (
        <GameTable gameId={gameId} address={acct} seat={seat} onExit={() => setScreen("result")} />
      )}

      {screen === "result" && gameId !== null && address && (
        <Result gameId={gameId} address={address} onHome={home} />
      )}
    </>
  );
}
