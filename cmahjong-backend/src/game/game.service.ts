import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ChainService } from "../chain/chain.service";
import { SettlementService } from "../settlement/settlement.service";
import { PrismaService } from "../prisma/prisma.service";
import { CallClaim, CallResolution, Round, RoundOutcome } from "./round";
import { Hanchan, HanchanLength, HanchanSnapshot } from "./hanchan";

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
export class GameService implements OnModuleInit {
  private readonly logger = new Logger(GameService.name);
  private readonly rooms = new Map<string, Room>();
  private readonly snapTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly chain: ChainService,
    private readonly settlement: SettlementService,
    private readonly prisma: PrismaService,
  ) {}

  /** Saat boot: pulihkan game yang masih PLAYING dari DB agar bisa di-resume. */
  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.prisma.gameTable.findMany({
        where: { status: "PLAYING" },
        include: { seats: true },
      });
      for (const r of rows) {
        if (!r.liveState) continue;
        const hanchan = Hanchan.restore(r.liveState as unknown as HanchanSnapshot);
        const players = [...r.seats]
          .sort((a, b) => a.seatIndex - b.seatIndex)
          .map((s) => s.address);
        this.rooms.set(r.chainGameId, { chainGameId: r.chainGameId, players, seed: r.seed ?? "", hanchan });
        this.logger.log(`Game ${r.chainGameId} dipulihkan dari DB (resume)`);
      }
    } catch (e) {
      this.logger.warn(`Gagal memuat game aktif dari DB: ${(e as Error).message}`);
    }
  }

  /** Jadwalkan simpan snapshot (coalesced: maks 1 tulis / 400ms per game). */
  private queueSnapshot(chainGameId: string): void {
    if (this.snapTimers.has(chainGameId)) return;
    const t = setTimeout(() => {
      this.snapTimers.delete(chainGameId);
      void this.saveSnapshot(chainGameId);
    }, 400);
    if (typeof t.unref === "function") t.unref();
    this.snapTimers.set(chainGameId, t);
  }

  private async saveSnapshot(chainGameId: string): Promise<void> {
    const room = this.rooms.get(chainGameId);
    if (!room || room.hanchan.finished) return;
    try {
      await this.prisma.gameTable.update({
        where: { chainGameId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { liveState: room.hanchan.snapshot() as any },
      });
    } catch (e) {
      this.logger.warn(`saveSnapshot gagal: ${(e as Error).message}`);
    }
  }

  /** Mirror lifecycle game ke Postgres (best-effort; DB mati tak mengganggu gameplay). */
  private async persistStart(room: Room) {
    try {
      let token = "";
      let buyIn = "0";
      let server = "";
      if (this.chain.configured) {
        try {
          const g = await this.chain.readGame(BigInt(room.chainGameId));
          token = g.token;
          buyIn = g.buyIn.toString();
          server = g.server;
        } catch {
          /* game offchain/test */
        }
      }
      await this.prisma.gameTable.upsert({
        where: { chainGameId: room.chainGameId },
        update: { status: "PLAYING", seed: room.seed },
        create: {
          chainGameId: room.chainGameId,
          token,
          buyIn,
          server,
          status: "PLAYING",
          seed: room.seed,
          seats: {
            create: room.players.map((address, seatIndex) => ({ seatIndex, address })),
          },
        },
      });
    } catch (e) {
      this.logger.warn(`persistStart gagal: ${(e as Error).message}`);
    }
  }

  private async persistSettled(chainGameId: string, ranking: string[], points: number[]) {
    try {
      await this.prisma.gameTable.update({
        where: { chainGameId },
        data: { status: "SETTLED", finalRanking: ranking },
      });
      await Promise.all(
        points.map((p, seatIndex) =>
          this.prisma.seat.updateMany({
            where: { table: { chainGameId }, seatIndex },
            data: { finalPoints: p },
          }),
        ),
      );
    } catch (e) {
      this.logger.warn(`persistSettled gagal: ${(e as Error).message}`);
    }
  }

  /**
   * Mulai ronde untuk sebuah game. Seed diambil dari on-chain bila tersedia,
   * atau diberikan langsung (mode dev/test).
   */
  async startRound(
    chainGameId: string,
    opts?: { players?: string[]; seed?: string; length?: HanchanLength },
  ): Promise<Room> {
    // idempoten: bila game sudah berjalan, kembalikan yang ada (banyak klien bisa memicu start)
    const existing = this.rooms.get(chainGameId);
    if (existing) return existing;

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
    void this.persistStart(room);
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

  /** Catat hasil 1 ronde ke hanchan; bila game selesai, buka sesi settle + tanda tangan server. */
  async recordOutcome(chainGameId: string, outcome: RoundOutcome): Promise<RoundEnd> {
    const room = this.room(chainGameId);
    room.hanchan.recordOutcome(outcome);
    const finished = room.hanchan.finished;
    const end: RoundEnd = { outcome, finished, hanchan: room.hanchan.state() };
    if (finished) {
      end.settle = await this.finalizeAndSign(chainGameId);
      // buka sesi settle: pemain dapat submit tanda tangan untuk `settle` kooperatif
      this.settlement.open(chainGameId, room.players, end.settle.ranking);
      void this.persistSettled(chainGameId, end.settle.ranking, room.hanchan.points);
    } else {
      this.queueSnapshot(chainGameId); // ronde baru — simpan agar resume akurat
    }
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
    const out = this.round(chainGameId).discard(seat, tileId);
    this.queueSnapshot(chainGameId);
    return out;
  }

  riichi(chainGameId: string, seat: number, tileId: number): void {
    this.round(chainGameId).declareRiichi(seat, tileId);
    this.queueSnapshot(chainGameId);
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
    const res = this.round(chainGameId).respond(seat, claim);
    this.queueSnapshot(chainGameId);
    return res;
  }

  ankan(chainGameId: string, seat: number, kind: number): RoundOutcome | null {
    const out = this.round(chainGameId).ankan(seat, kind);
    this.queueSnapshot(chainGameId);
    return out;
  }

  /** Shouminkan (tambah pon -> kan); bisa memicu fase chankan. */
  addedKan(chainGameId: string, seat: number, kind: number): RoundOutcome | null {
    const out = this.round(chainGameId).addedKan(seat, kind);
    this.queueSnapshot(chainGameId);
    return out;
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
