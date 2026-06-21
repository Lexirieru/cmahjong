"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { Button } from "@/components/Button";
import { BackTitle } from "./CreateTable";
import { getWalletClient } from "@/lib/chain";
import {
  GameView,
  MAHJONG_ADDRESS,
  legacyGas,
  mahjongAbi,
  readGame,
  sendLegacy,
} from "@/lib/contract";
import { publicClient } from "@/lib/chain";
import { erc20Abi } from "@/lib/erc20";
import { tokenByAddress } from "@/lib/tokens";
import { commitmentOf, loadSecret, randomSecret, saveSecret } from "@/lib/game";
import { fmt, shortAddr } from "@/lib/format";

export function Lobby({
  gameId,
  address,
  onBack,
  onEnter,
}: {
  gameId: bigint;
  address: Address;
  onBack: () => void;
  onEnter: (gameId: bigint, seat: number) => void;
}) {
  const [game, setGame] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setGame(await readGame(gameId));
    } catch {
      /* keep last */
    }
  }, [gameId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const token = game && tokenByAddress(game.token);
  const mySeat = game?.players.findIndex((p) => p.toLowerCase() === address.toLowerCase()) ?? -1;
  const iAmIn = mySeat >= 0 && mySeat < (game?.joined ?? 0);
  const iRevealed = iAmIn && !!game?.revealed[mySeat];

  async function join() {
    const wallet = getWalletClient();
    if (!wallet || !game || !token) return;
    setBusy(true);
    setError(null);
    try {
      const secret = randomSecret();
      saveSecret(gameId, address, secret);
      const commitment = commitmentOf(gameId, address, secret);

      if (!token.native) {
        const allowance = await publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, MAHJONG_ADDRESS],
        });
        if (allowance < game.buyIn) {
          const gas = await legacyGas();
          await sendLegacy(
            wallet.writeContract({
              address: token.address,
              abi: erc20Abi,
              functionName: "approve",
              args: [MAHJONG_ADDRESS, game.buyIn],
              account: address,
              ...gas,
            }),
          );
        }
      }

      const gas = await legacyGas();
      await sendLegacy(
        wallet.writeContract({
          address: MAHJONG_ADDRESS,
          abi: mahjongAbi,
          functionName: "joinGame",
          args: [gameId, commitment],
          account: address,
          value: token.native ? game.buyIn : 0n,
          ...gas,
        }),
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    const wallet = getWalletClient();
    const secret = loadSecret(gameId, address);
    if (!wallet || !secret) {
      setError("Secret not found on this device");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const gas = await legacyGas();
      await sendLegacy(
        wallet.writeContract({
          address: MAHJONG_ADDRESS,
          abi: mahjongAbi,
          functionName: "revealSeed",
          args: [gameId, secret],
          account: address,
          ...gas,
        }),
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col px-5">
      <BackTitle title={`Table #${gameId}`} onBack={onBack} />

      <div className="flex-1 space-y-4 pt-2">
        {token && game && (
          <div className="rounded-2xl surface p-4 text-sm">
            <Row label="Buy-in" value={`${fmt(formatUnits(game.buyIn, token.decimals))} ${token.symbol}`} />
            <Row
              label="Pot"
              value={`${fmt(Number(formatUnits(game.buyIn, token.decimals)) * 4)} ${token.symbol}`}
            />
            <Row label="Status" value={game.status} last />
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-ivory/45">Players ({game?.joined ?? 0}/4)</p>
          {[0, 1, 2, 3].map((seat) => {
            const p = game?.players[seat];
            const filled = !!p && seat < (game?.joined ?? 0);
            const revealed = !!game?.revealed[seat];
            const me = filled && p!.toLowerCase() === address.toLowerCase();
            return (
              <div
                key={seat}
                className="flex items-center justify-between rounded-xl surface px-4 py-3"
              >
                <span className={filled ? "font-medium" : "text-ivory/35"}>
                  {filled ? `${shortAddr(p)}${me ? " · you" : ""}` : "Waiting…"}
                </span>
                {filled &&
                  (revealed ? (
                    <span className="text-xs text-jade-400">ready</span>
                  ) : (
                    <span className="text-xs text-ivory/40">joined</span>
                  ))}
              </div>
            );
          })}
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>

      <div className="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {game?.status === "Playing" ? (
          <Button onClick={() => onEnter(gameId, mySeat)}>Enter table</Button>
        ) : game?.status === "Revealing" && iAmIn && !iRevealed ? (
          <Button onClick={reveal} loading={busy}>
            Reveal &amp; lock in
          </Button>
        ) : game?.status === "Open" && !iAmIn && token ? (
          <Button onClick={join} loading={busy}>
            Join · stake {fmt(formatUnits(game.buyIn, token.decimals))} {token.symbol}
          </Button>
        ) : (
          <Button variant="subtle" disabled>
            {iRevealed ? "Waiting for other players…" : "Waiting for players…"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 ${last ? "" : "border-b border-white/8"}`}>
      <span className="text-ivory/55">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
