"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { Home } from "@/components/screens/Home";
import { CreateTable } from "@/components/screens/CreateTable";
import { JoinTable } from "@/components/screens/JoinTable";
import { Lobby } from "@/components/screens/Lobby";
import { GameTable } from "@/components/screens/GameTable";
import { Result } from "@/components/screens/Result";
import { useWallet } from "@/hooks/useWallet";
import { useBalances } from "@/hooks/useBalances";
import type { Address } from "viem";

type Screen = "home" | "create" | "join" | "lobby" | "game" | "result";

const PREVIEW_ADDR = "0x0000000000000000000000000000000000000000" as Address;

export default function Page() {
  const { address, inMiniPay, connecting, connect } = useWallet();
  const { balances } = useBalances(address);
  const [screen, setScreen] = useState<Screen>("home");
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [seat, setSeat] = useState(0);
  const [preview, setPreview] = useState(false);

  // Pratinjau board tanpa wallet/backend (demo & QA): ?preview=table — di-effect agar tak bentrok hydration
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("preview") === "table") {
      setPreview(true);
      setGameId(0n);
      setScreen("game");
    }
  }, []);

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
        />
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
