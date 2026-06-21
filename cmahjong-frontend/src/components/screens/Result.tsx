"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { Button } from "@/components/Button";
import { getWalletClient } from "@/lib/chain";
import {
  MAHJONG_ADDRESS,
  legacyGas,
  mahjongAbi,
  readCredit,
  readGame,
  sendLegacy,
} from "@/lib/contract";
import { tokenByAddress, type TokenInfo } from "@/lib/tokens";
import { fmt } from "@/lib/format";

export function Result({
  gameId,
  address,
  onHome,
}: {
  gameId: bigint;
  address: Address;
  onHome: () => void;
}) {
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [credit, setCredit] = useState<bigint>(0n);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const g = await readGame(gameId);
    const t = tokenByAddress(g.token) ?? null;
    setToken(t);
    if (t) setCredit(await readCredit(t.address, address));
  }, [gameId, address]);

  useEffect(() => {
    void load();
  }, [load]);

  async function withdraw() {
    const wallet = getWalletClient();
    if (!wallet || !token) return;
    setBusy(true);
    setError(null);
    try {
      const gas = await legacyGas();
      await sendLegacy(
        wallet.writeContract({
          address: MAHJONG_ADDRESS,
          abi: mahjongAbi,
          functionName: "withdraw",
          args: [token.address],
          account: address,
          ...gas,
        }),
      );
      setDone(true);
      setCredit(0n);
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  const amount = token ? fmt(formatUnits(credit, token.decimals)) : "0";
  const hasWinnings = credit > 0n;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
      <div className="rise w-full max-w-xs rounded-3xl surface p-8">
        <p className="text-sm uppercase tracking-wide text-ivory/45">Table #{gameId.toString()}</p>
        <h2 className="mt-2 text-2xl font-bold">{done ? "Withdrawn" : "Game settled"}</h2>

        <div className="my-6">
          <p className="text-sm text-ivory/55">Your winnings</p>
          <p className="mt-1 text-4xl font-bold tabular-nums">
            {amount}
            <span className="ml-1 text-lg text-ivory/50">{token?.symbol}</span>
          </p>
        </div>

        {error && <p className="mb-3 text-sm text-red-300">{error}</p>}

        {hasWinnings ? (
          <Button onClick={withdraw} loading={busy}>
            Withdraw to wallet
          </Button>
        ) : (
          <Button variant="ghost" onClick={onHome}>
            {done ? "Done" : "Back home"}
          </Button>
        )}
      </div>

      {hasWinnings && (
        <button onClick={onHome} className="mt-6 text-sm text-ivory/50">
          Back home
        </button>
      )}
    </div>
  );
}
