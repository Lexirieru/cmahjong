import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ChainService } from "../chain/chain.service";
import { Round, RoundOutcome } from "./round";

interface Room {
  chainGameId: string;
  players: string[]; // alamat per seat 0..3
  seed: string;
  round: Round;
}

export interface SettlePayload {
  ranking: [string, string, string, string];
  serverSig?: string;
}

/**
 * Manajer ruang game (in-memory). Sumber kebenaran fairness adalah seed on-chain;
 * di sini seed dipakai untuk membentuk tembok deterministik lalu menjalankan ronde.
 * Metadata bisa di-mirror ke Postgres (TODO: persist penuh).
 */
@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly chain: ChainService) {}

  /**
   * Mulai ronde untuk sebuah game. Seed diambil dari on-chain bila tersedia,
   * atau diberikan langsung (mode dev/test).
   */
  async startRound(
    chainGameId: string,
    opts?: { players?: string[]; seed?: string; dealer?: number },
  ): Promise<Room> {
    let players = opts?.players;
    let seed = opts?.seed;

    if (!seed || !players) {
      const id = BigInt(chainGameId);
      seed = seed ?? (await this.chain.readSeed(id));
      players = players ?? (await this.chain.readPlayers(id));
    }

    const room: Room = {
      chainGameId,
      players,
      seed,
      round: new Round(seed, opts?.dealer ?? 0),
    };
    this.rooms.set(chainGameId, room);
    this.logger.log(`Ronde dimulai untuk game ${chainGameId}`);
    return room;
  }

  private room(chainGameId: string): Room {
    const room = this.rooms.get(chainGameId);
    if (!room) throw new NotFoundException(`game ${chainGameId} tidak ditemukan`);
    return room;
  }

  /** Seat dari alamat pemain. */
  seatOf(chainGameId: string, address: string): number {
    const seat = this.room(chainGameId).players.findIndex(
      (p) => p.toLowerCase() === address.toLowerCase(),
    );
    if (seat === -1) throw new NotFoundException("pemain bukan bagian dari game ini");
    return seat;
  }

  publicState(chainGameId: string) {
    return this.room(chainGameId).round.publicState();
  }

  /** Tangan privat — hanya kirim ke pemilik seat. */
  handOf(chainGameId: string, seat: number) {
    return this.room(chainGameId).round.handOf(seat);
  }

  discard(chainGameId: string, seat: number, tileId: number): RoundOutcome | null {
    return this.room(chainGameId).round.discard(seat, tileId);
  }

  riichi(chainGameId: string, seat: number, tileId: number): void {
    this.room(chainGameId).round.declareRiichi(seat, tileId);
  }

  tsumo(chainGameId: string, seat: number): RoundOutcome {
    const room = this.room(chainGameId);
    if (room.round.turn !== seat) throw new Error("bukan giliran seat ini");
    return room.round.declareTsumo();
  }

  ron(chainGameId: string, seat: number): RoundOutcome {
    return this.room(chainGameId).round.declareRon(seat);
  }

  /**
   * Hitung ranking final (alamat juara 1..4) dan tandatangani sebagai server
   * untuk settleByServer di kontrak.
   */
  async finalizeAndSign(chainGameId: string): Promise<SettlePayload> {
    const room = this.room(chainGameId);
    const order = room.round.ranking(); // seat terurut
    const ranking = order.map((seat) => room.players[seat]) as [
      string,
      string,
      string,
      string,
    ];
    let serverSig: string | undefined;
    try {
      serverSig = await this.chain.signRanking(BigInt(chainGameId), ranking);
    } catch (err) {
      this.logger.warn(`Gagal tandatangan server: ${(err as Error).message}`);
    }
    return { ranking, serverSig };
  }
}
