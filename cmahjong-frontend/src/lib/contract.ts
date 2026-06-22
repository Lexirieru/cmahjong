import { parseAbi, parseEventLogs, type Address } from "viem";
import { MAHJONG_ADDRESS, legacyGas, publicClient } from "./chain";

export const mahjongAbi = parseAbi([
  "function createGame(address token,uint256 buyIn,address server,uint16[4] payoutBps,uint64 commitWindow,uint64 revealWindow,uint64 settleWindow) returns (uint256)",
  "event GameCreated(uint256 indexed gameId, address indexed creator, address token, uint256 buyIn, address server)",
  "function joinGame(uint256 gameId, bytes32 commitment) payable",
  "function revealSeed(uint256 gameId, bytes32 secret)",
  "function withdraw(address token)",
  "function creditOf(address token, address account) view returns (uint256)",
  "function gameCount() view returns (uint256)",
  "function tokenAllowed(address) view returns (bool)",
  "function getPlayers(uint256) view returns (address[4])",
  "function getGame(uint256) view returns ((address token,uint256 buyIn,address server,uint8 status,uint8 joined,uint8 revealedCount,uint64 commitDeadline,uint64 revealWindow,uint64 settleWindow,uint64 revealDeadline,uint64 settleDeadline,bytes32 seed,uint16[4] payoutBps,address[4] players,bytes32[4] commitments,bytes32[4] secrets,bool[4] revealed))",
]);

export const STATUS = ["None", "Open", "Revealing", "Playing", "Settled", "Cancelled"] as const;
export type GameStatus = (typeof STATUS)[number];

export interface GameView {
  token: Address;
  buyIn: bigint;
  server: Address;
  status: GameStatus;
  joined: number;
  players: Address[];
  revealed: boolean[];
  seed: `0x${string}`;
}

export async function readGame(gameId: bigint): Promise<GameView> {
  const g = await publicClient.readContract({
    address: MAHJONG_ADDRESS,
    abi: mahjongAbi,
    functionName: "getGame",
    args: [gameId],
  });
  return {
    token: g.token,
    buyIn: g.buyIn,
    server: g.server,
    status: STATUS[g.status] ?? "None",
    joined: g.joined,
    players: [...g.players],
    revealed: [...g.revealed],
    seed: g.seed,
  };
}

export async function readCredit(token: Address, account: Address): Promise<bigint> {
  return publicClient.readContract({
    address: MAHJONG_ADDRESS,
    abi: mahjongAbi,
    functionName: "creditOf",
    args: [token, account],
  });
}

export async function readGameCount(): Promise<bigint> {
  return publicClient.readContract({
    address: MAHJONG_ADDRESS,
    abi: mahjongAbi,
    functionName: "gameCount",
  });
}

/** Transaction-send wrapper (legacy gas for MiniPay) + wait for confirmation. */
export async function sendLegacy(
  hashPromise: Promise<`0x${string}`>,
): Promise<`0x${string}`> {
  const hash = await hashPromise;
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Create a game and read the new gameId from the GameCreated event (robust to RPC
 *  read lag — never relies on a possibly-stale gameCount). */
export async function sendCreateGame(
  hashPromise: Promise<`0x${string}`>,
): Promise<bigint> {
  const hash = await hashPromise;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const logs = parseEventLogs({ abi: mahjongAbi, eventName: "GameCreated", logs: receipt.logs });
  if (!logs.length) throw new Error("GameCreated event not found in receipt");
  return logs[0].args.gameId;
}

export { MAHJONG_ADDRESS, legacyGas };
