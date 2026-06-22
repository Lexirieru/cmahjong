import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { HanchanLength } from "../game/hanchan";
import { ReplayMove, replayStates } from "../game/replay";

/** Game history & replay data from Postgres. */
@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public usage + on-chain activity stats (no wallet required). */
  async getStats() {
    const now = Date.now();
    const d7 = new Date(now - 7 * 86_400_000);
    const d30 = new Date(now - 30 * 86_400_000);
    // single transaction = one connection (Supabase pooler has a low concurrent limit)
    const [total, settled, playing, totalMoves, games7, games30, players, players7] =
      await this.prisma.$transaction([
        this.prisma.gameTable.count(),
        this.prisma.gameTable.count({ where: { status: "SETTLED" } }),
        this.prisma.gameTable.count({ where: { status: "PLAYING" } }),
        this.prisma.move.count(),
        this.prisma.gameTable.count({ where: { createdAt: { gte: d7 } } }),
        this.prisma.gameTable.count({ where: { createdAt: { gte: d30 } } }),
        this.prisma.seat.findMany({ distinct: ["address"], select: { address: true } }),
        this.prisma.seat.findMany({
          where: { table: { createdAt: { gte: d7 } } },
          distinct: ["address"],
          select: { address: true },
        }),
      ]);
    return {
      games: { total, settled, playing, last7d: games7, last30d: games30 },
      players: { total: players.length, activeLast7d: players7.length },
      moves: { total: totalMoves, avgPerGame: total ? Math.round(totalMoves / total) : 0 },
      onchainTxEstimate: total * 14, // ~14 txs per full game lifecycle (create/join/reveal/settle)
      updatedAt: new Date(now).toISOString(),
    };
  }

  /** List the most recent games. */
  async listGames(limit = 20) {
    const games = await this.prisma.gameTable.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
      include: { seats: { orderBy: { seatIndex: "asc" } } },
    });
    return games.map((g) => ({
      gameId: g.chainGameId,
      status: g.status,
      token: g.token,
      buyIn: g.buyIn,
      players: g.seats.map((s) => s.address),
      finalRanking: g.finalRanking,
      createdAt: g.createdAt,
    }));
  }

  /**
   * Deterministic replay tape: seed + players + ordered list of actions.
   * Clients/utilities can start the engine from the seed then apply each action.
   */
  async getReplay(chainGameId: string) {
    const game = await this.prisma.gameTable.findUnique({
      where: { chainGameId },
      include: {
        seats: { orderBy: { seatIndex: "asc" } },
        moves: { orderBy: { seq: "asc" } },
      },
    });
    if (!game) throw new NotFoundException(`game ${chainGameId} not found`);
    return {
      gameId: game.chainGameId,
      status: game.status,
      length: game.length,
      seed: game.seed,
      players: game.seats.map((s) => s.address),
      finalRanking: game.finalRanking,
      moves: game.moves.map((m) => ({
        seq: m.seq,
        seat: m.seatIndex,
        kind: m.kind,
        payload: m.payload,
      })),
    };
  }

  /** Board state + hands at each step (for the replay UI). */
  async getReplayStates(chainGameId: string) {
    const tape = await this.getReplay(chainGameId);
    if (!tape.seed) throw new NotFoundException("game has no seed yet (not started)");
    const moves = tape.moves as unknown as ReplayMove[];
    const { frames, result } = replayStates({
      seed: tape.seed,
      length: tape.length as HanchanLength,
      moves,
    });
    return { gameId: tape.gameId, players: tape.players, finalRanking: tape.finalRanking, frames, result };
  }
}
