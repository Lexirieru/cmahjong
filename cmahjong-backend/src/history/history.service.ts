import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { HanchanLength } from "../game/hanchan";
import { ReplayMove, replayStates } from "../game/replay";

/** Riwayat & data replay game dari Postgres. */
@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Daftar game terbaru. */
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
   * Tape replay deterministik: seed + pemain + daftar aksi terurut.
   * Klien/util dapat memulai engine dari seed lalu menerapkan tiap aksi.
   */
  async getReplay(chainGameId: string) {
    const game = await this.prisma.gameTable.findUnique({
      where: { chainGameId },
      include: {
        seats: { orderBy: { seatIndex: "asc" } },
        moves: { orderBy: { seq: "asc" } },
      },
    });
    if (!game) throw new NotFoundException(`game ${chainGameId} tidak ditemukan`);
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

  /** Board state + tangan di tiap langkah (untuk UI replay). */
  async getReplayStates(chainGameId: string) {
    const tape = await this.getReplay(chainGameId);
    if (!tape.seed) throw new NotFoundException("game belum punya seed (belum dimulai)");
    const moves = tape.moves as unknown as ReplayMove[];
    const { frames, result } = replayStates({
      seed: tape.seed,
      length: tape.length as HanchanLength,
      moves,
    });
    return { gameId: tape.gameId, players: tape.players, finalRanking: tape.finalRanking, frames, result };
  }
}
