"use client";

import { useState } from "react";
import { Header } from "@/components/Header";
import { Home } from "@/components/screens/Home";
import { CreateTable } from "@/components/screens/CreateTable";
import { JoinTable } from "@/components/screens/JoinTable";
import { Lobby } from "@/components/screens/Lobby";
import { GameTable } from "@/components/screens/GameTable";
import { Result } from "@/components/screens/Result";
import { useWallet } from "@/hooks/useWallet";
import { useBalances } from "@/hooks/useBalances";

type Screen = "home" | "create" | "join" | "lobby" | "game" | "result";

export default function Page() {
  const { address, inMiniPay, connecting, connect } = useWallet();
  const { balances } = useBalances(address);
  const [screen, setScreen] = useState<Screen>("home");
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [seat, setSeat] = useState(0);

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

      {screen === "game" && gameId !== null && address && (
        <GameTable gameId={gameId} address={address} seat={seat} onExit={() => setScreen("result")} />
      )}

      {screen === "result" && gameId !== null && address && (
        <Result gameId={gameId} address={address} onHome={home} />
      )}
    </>
  );
}
