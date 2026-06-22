"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/** Single connection to the game engine backend (Socket.IO). */
export function getSocket(): Socket {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
    socket = io(url, { transports: ["websocket"], autoConnect: true });
  }
  return socket;
}

export interface Tile {
  id: number;
  kind: number;
  red?: boolean;
}

export interface Meld {
  type: string;
  kind: number;
  open: boolean;
}

export interface Call {
  seat: number;
  type: "pon" | "chi" | "kan" | "ron";
  chiOptions?: number[];
}

export interface PublicState {
  phase: "playing" | "awaitingCalls" | "ended";
  dealer: number;
  roundWind: number;
  turn: number;
  doraIndicators: number[];
  wallRemaining: number;
  discards: number[][];
  melds: Meld[][];
  riichi: boolean[];
  furiten: boolean[];
  points: number[];
  lastDiscard: { seat: number; kind: number } | null;
  availableCalls: Call[];
}
