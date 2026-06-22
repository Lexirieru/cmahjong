import type { PublicState, Tile } from "./socket";

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export interface GameSummary {
  gameId: string;
  status: string;
  token: string;
  buyIn: string;
  players: string[];
  finalRanking: string[];
  createdAt: string;
}

export interface ReplayFrame {
  seq: number;
  seat: number; // -1 for the "deal" frame
  kind: string;
  state: PublicState;
  hands: Tile[][];
}

export interface ReplayStates {
  gameId: string;
  players: string[];
  finalRanking: string[];
  frames: ReplayFrame[];
  result: { points: number[]; ranking: number[] };
}

export async function listGames(): Promise<GameSummary[]> {
  const res = await fetch(`${BASE}/games`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load games");
  return res.json();
}

export async function fetchReplayStates(gameId: string): Promise<ReplayStates> {
  const res = await fetch(`${BASE}/games/${gameId}/replay/states`, { cache: "no-store" });
  if (!res.ok) throw new Error("Replay not available for this game");
  return res.json();
}
