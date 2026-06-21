import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ChainService } from "../chain/chain.service";
import { CallClaim, CallResolution, Round, RoundOutcome } from "./round";
import { Hanchan, HanchanLength } from "./hanchan";

interface Room {
  chainGameId: string;
  players: string[]; // alamat per seat 0..3
  seed: string;
  hanchan: Hanchan;
}

export interface SettlePayload {
  ranking: [string, string, string, string];
  serverSig?: string;
}

export interface RoundEnd {
  outcome: RoundOutcome;
  finished: boolean;
  hanchan: ReturnType<Hanchan["state"]>;
  settle?: SettlePayload;
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
    opts?: { players?: string[]; seed?: string; length?: HanchanLength },
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
      hanchan: new Hanchan(seed, opts?.length ?? "hanchan"),
    };
    this.rooms.set(chainGameId, room);
    this.logger.log(`Game ${chainGameId} dimulai (${opts?.length ?? "hanchan"})`);
    return room;
  }

  private room(chainGameId: string): Room {
    const room = this.rooms.get(chainGameId);
    if (!room) throw new NotFoundException(`game ${chainGameId} tidak ditemukan`);
    return room;
  }

  private round(chainGameId: string): Round {
    return this.room(chainGameId).hanchan.round;
  }

  /** Catat hasil 1 ronde ke hanchan; bila game selesai, hitung & tandatangani ranking final. */
  async recordOutcome(chainGameId: string, outcome: RoundOutcome): Promise<RoundEnd> {
    const room = this.room(chainGameId);
    room.hanchan.recordOutcome(outcome);
    const finished = room.hanchan.finished;
    const end: RoundEnd = { outcome, finished, hanchan: room.hanchan.state() };
    if (finished) end.settle = await this.finalizeAndSign(chainGameId);
    return end;
  }

  hanchanState(chainGameId: string) {
    return this.room(chainGameId).hanchan.state();
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
    return this.round(chainGameId).publicState();
  }

  /** Tangan privat — hanya kirim ke pemilik seat. */
  handOf(chainGameId: string, seat: number) {
    return this.round(chainGameId).handOf(seat);
  }

  discard(chainGameId: string, seat: number, tileId: number): RoundOutcome | null {
    return this.round(chainGameId).discard(seat, tileId);
  }

  riichi(chainGameId: string, seat: number, tileId: number): void {
    this.round(chainGameId).declareRiichi(seat, tileId);
  }

  tsumo(chainGameId: string, seat: number): RoundOutcome {
    const round = this.round(chainGameId);
    if (round.turn !== seat) throw new Error("bukan giliran seat ini");
    return round.declareTsumo();
  }

  availableCalls(chainGameId: string) {
    return this.round(chainGameId).availableCalls();
  }

  /** Respons call seorang pemain (pon/chi/kan/ron/pass); resolusi prioritas otomatis. */
  respond(chainGameId: string, seat: number, claim: CallClaim): CallResolution {
    return this.round(chainGameId).respond(seat, claim);
  }

  ankan(chainGameId: string, seat: number, kind: number): RoundOutcome | null {
    return this.round(chainGameId).ankan(seat, kind);
  }

  /**
   * Hitung ranking final (alamat juara 1..4) dan tandatangani sebagai server
   * untuk settleByServer di kontrak. Memakai poin akhir hanchan.
   */
  async finalizeAndSign(chainGameId: string): Promise<SettlePayload> {
    const room = this.room(chainGameId);
    const order = room.hanchan.finalRanking(); // seat terurut poin akhir
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
