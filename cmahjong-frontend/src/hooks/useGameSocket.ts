"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { getSocket, type PublicState, type Tile } from "@/lib/socket";

export interface RoundEnd {
  outcome: { type: "tsumo" | "ron" | "draw"; winner?: number; points: number[] };
  finished: boolean;
  settle?: { ranking: string[] };
}

/** Berlangganan state game realtime + tangan privat, dan expose aksi.
 *  `autoStart`: kirim "start" agar backend memulai ronde (membaca seed/pemain on-chain). */
export function useGameSocket(gameId: string, address: Address, seat: number, autoStart = false) {
  const [state, setState] = useState<PublicState | null>(null);
  const [hand, setHand] = useState<Tile[]>([]);
  const [end, setEnd] = useState<RoundEnd | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = getSocket();
    const onConnect = () => {
      setConnected(true);
      s.emit("join", { gameId, address });
      if (autoStart) s.emit("start", { gameId }); // idempoten di backend
    };
    const onState = (st: PublicState) => setState(st);
    const onHand = (h: { seat: number; tiles: Tile[] }) => {
      if (h.seat === seat) setHand(h.tiles);
    };
    const onRoundEnd = (e: RoundEnd) => setEnd(e);
    const onDisconnect = () => setConnected(false);

    s.on("connect", onConnect);
    s.on("state", onState);
    s.on("hand", onHand);
    s.on("roundEnd", onRoundEnd);
    s.on("disconnect", onDisconnect);
    if (s.connected) onConnect();

    return () => {
      s.off("connect", onConnect);
      s.off("state", onState);
      s.off("hand", onHand);
      s.off("roundEnd", onRoundEnd);
      s.off("disconnect", onDisconnect);
    };
  }, [gameId, address, seat, autoStart]);

  const discard = useCallback(
    (tileId: number) => getSocket().emit("discard", { gameId, address, tileId }),
    [gameId, address],
  );
  const riichi = useCallback(
    (tileId: number) => getSocket().emit("riichi", { gameId, address, tileId }),
    [gameId, address],
  );
  const tsumo = useCallback(() => getSocket().emit("tsumo", { gameId, address }), [gameId, address]);
  const call = useCallback(
    (action: "pon" | "chi" | "kan" | "ron" | "pass", low?: number) =>
      getSocket().emit("call", { gameId, address, action, low }),
    [gameId, address],
  );

  return { state, hand, end, connected, actions: { discard, riichi, tsumo, call } };
}
