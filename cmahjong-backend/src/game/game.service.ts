import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ChainService } from "../chain/chain.service";
import { SettlementService } from "../settlement/settlement.service";
import { PrismaService } from "../prisma/prisma.service";
import { CallClaim, CallResolution, Round, RoundOutcome } from "./round";
import { Hanchan, HanchanLength, HanchanSnapshot } from "./hanchan";

interface Room {
  chainGameId: string;
  players: string[]; // address per seat 0..3
  seed: string;
  hanchan: Hanchan;
  length: HanchanLength;
  dbId?: string; // GameTable.id for the Move relation
  moveSeq: number; // sequence number of the next action (for replay)
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
 * In-memory game room manager. The source of truth for fairness is the on-chain seed;
 * here the seed is used to build the deterministic wall and then run the rounds.
 * Metadata can be mirrored to Postgres (TODO: full persistence).
 */
@Injectable()
export class GameService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameService.name);
  private readonly rooms = new Map<string, Room>();
  private readonly snapTimers = new Map<string, NodeJS.Timeout>();
  private readonly moveBuffers = new Map<string, { seq: number; seatIndex: number; kind: string; payload: object }[]>();
  private readonly moveFlushTimers = new Map<string, NodeJS.Timeout>();
  private readonly flushChain = new Map<string, Promise<unknown>>();

  constructor(
    private readonly chain: ChainService,
    private readonly settlement: SettlementService,
    private readonly prisma: PrismaService,
  ) {}

  /** On boot: restore games still PLAYING from the DB so they can be resumed. */
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
        const moveSeq = await this.prisma.move.count({ where: { tableId: r.id } });
        this.rooms.set(r.chainGameId, {
          chainGameId: r.chainGameId,
          players,
          seed: r.seed ?? "",
          hanchan,
          length: (r.length as HanchanLength) ?? "hanchan",
          dbId: r.id,
          moveSeq,
        });
        this.logger.log(`Game ${r.chainGameId} restored from DB (resume, ${moveSeq} moves)`);
      }
    } catch (e) {
      this.logger.warn(`Failed to load active games from DB: ${(e as Error).message}`);
    }
  }

  /** On shutdown: flush all action buffers so nothing is lost. */
  async onModuleDestroy(): Promise<void> {
    for (const t of this.moveFlushTimers.values()) clearTimeout(t);
    this.moveFlushTimers.clear();
    await Promise.all([...this.moveBuffers.keys()].map((id) => this.flushMoves(id)));
  }

  /** Schedule a snapshot save (coalesced: max 1 write / 400ms per game). */
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
      this.logger.warn(`saveSnapshot failed: ${(e as Error).message}`);
    }
  }

  /** Record a single action to the buffer for replay (flushed in batches). */
  private logMove(chainGameId: string, kind: string, seatIndex: number, payload: object = {}) {
    const room = this.rooms.get(chainGameId);
    if (!room) return;
    const seq = room.moveSeq++;
    let buf = this.moveBuffers.get(chainGameId);
    if (!buf) {
      buf = [];
      this.moveBuffers.set(chainGameId, buf);
    }
    buf.push({ seq, seatIndex, kind, payload });
    this.scheduleMoveFlush(chainGameId);
  }

  private scheduleMoveFlush(chainGameId: string) {
    if (this.moveFlushTimers.has(chainGameId)) return;
    const t = setTimeout(() => {
      this.moveFlushTimers.delete(chainGameId);
      void this.flushMoves(chainGameId);
    }, 800);
    if (typeof t.unref === "function") t.unref();
    this.moveFlushTimers.set(chainGameId, t);
  }

  /** Write the action buffer to the DB (batch). Serialized per game to avoid races. */
  flushMoves(chainGameId: string): Promise<unknown> {
    const prev = this.flushChain.get(chainGameId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.doFlush(chainGameId));
    this.flushChain.set(chainGameId, next);
    return next;
  }

  private async doFlush(chainGameId: string): Promise<void> {
    const room = this.rooms.get(chainGameId);
    const buf = this.moveBuffers.get(chainGameId);
    if (!buf || buf.length === 0) return;
    if (!room?.dbId) {
      this.scheduleMoveFlush(chainGameId); // DB row not ready yet — try again
      return;
    }
    const rows = buf.splice(0, buf.length).map((m) => ({
      tableId: room.dbId!,
      seq: m.seq,
      seatIndex: m.seatIndex,
      kind: m.kind,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: m.payload as any,
    }));
    try {
      await this.prisma.move.createMany({ data: rows, skipDuplicates: true });
    } catch (e) {
      this.logger.warn(`flushMoves failed: ${(e as Error).message}`);
    }
  }

  /** Mirror the game lifecycle to Postgres (best-effort; a dead DB does not disrupt gameplay). */
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
          /* offchain/test game */
        }
      }
      const row = await this.prisma.gameTable.upsert({
        where: { chainGameId: room.chainGameId },
        update: { status: "PLAYING", seed: room.seed },
        create: {
          chainGameId: room.chainGameId,
          token,
          buyIn,
          server,
          status: "PLAYING",
          length: room.length,
          seed: room.seed,
          seats: {
            create: room.players.map((address, seatIndex) => ({ seatIndex, address })),
          },
        },
      });
      room.dbId = row.id;
    } catch (e) {
      this.logger.warn(`persistStart failed: ${(e as Error).message}`);
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
      this.logger.warn(`persistSettled failed: ${(e as Error).message}`);
    }
  }

  /**
   * Start a round for a game. The seed is read from on-chain when available,
   * or provided directly (dev/test mode).
   */
  async startRound(
    chainGameId: string,
    opts?: { players?: string[]; seed?: string; length?: HanchanLength },
  ): Promise<Room> {
    // idempotent: if the game is already running, return the existing one (many clients can trigger start)
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
      length: opts?.length ?? "hanchan",
      moveSeq: 0,
    };
    this.rooms.set(chainGameId, room);
    this.logger.log(`Game ${chainGameId} started (${opts?.length ?? "hanchan"})`);
    await this.persistStart(room); // wait so that dbId is ready before actions are logged
    return room;
  }

  private room(chainGameId: string): Room {
    const room = this.rooms.get(chainGameId);
    if (!room) throw new NotFoundException(`game ${chainGameId} not found`);
    return room;
  }

  private round(chainGameId: string): Round {
    return this.room(chainGameId).hanchan.round;
  }

  /** Record the result of one round into the hanchan; if the game is finished, open the settle session + server signature. */
  async recordOutcome(chainGameId: string, outcome: RoundOutcome): Promise<RoundEnd> {
    const room = this.room(chainGameId);
    room.hanchan.recordOutcome(outcome);
    const finished = room.hanchan.finished;
    const end: RoundEnd = { outcome, finished, hanchan: room.hanchan.state() };
    if (finished) {
      end.settle = await this.finalizeAndSign(chainGameId);
      // open the settle session: players can submit signatures for a cooperative `settle`
      this.settlement.open(chainGameId, room.players, end.settle.ranking);
      void this.persistSettled(chainGameId, end.settle.ranking, room.hanchan.points);
      void this.flushMoves(chainGameId); // write the remaining actions before the game is closed
    } else {
      this.queueSnapshot(chainGameId); // new round — save so resume is accurate
    }
    return end;
  }

  hanchanState(chainGameId: string) {
    return this.room(chainGameId).hanchan.state();
  }

  /** Seat from a player's address. */
  seatOf(chainGameId: string, address: string): number {
    const seat = this.room(chainGameId).players.findIndex(
      (p) => p.toLowerCase() === address.toLowerCase(),
    );
    if (seat === -1) throw new NotFoundException("player is not part of this game");
    return seat;
  }

  publicState(chainGameId: string) {
    return this.round(chainGameId).publicState();
  }

  /** Private hand — only send to the seat's owner. */
  handOf(chainGameId: string, seat: number) {
    return this.round(chainGameId).handOf(seat);
  }

  discard(chainGameId: string, seat: number, tileId: number): RoundOutcome | null {
    const out = this.round(chainGameId).discard(seat, tileId);
    this.logMove(chainGameId, "discard", seat, { tileId });
    this.queueSnapshot(chainGameId);
    return out;
  }

  riichi(chainGameId: string, seat: number, tileId: number): void {
    this.round(chainGameId).declareRiichi(seat, tileId);
    this.logMove(chainGameId, "riichi", seat, { tileId });
    this.queueSnapshot(chainGameId);
  }

  tsumo(chainGameId: string, seat: number): RoundOutcome {
    const round = this.round(chainGameId);
    if (round.turn !== seat) throw new Error("not this seat's turn");
    const out = round.declareTsumo();
    this.logMove(chainGameId, "tsumo", seat);
    return out;
  }

  availableCalls(chainGameId: string) {
    return this.round(chainGameId).availableCalls();
  }

  /** A player's call response (pon/chi/kan/ron/pass); automatic priority resolution. */
  respond(chainGameId: string, seat: number, claim: CallClaim): CallResolution {
    const res = this.round(chainGameId).respond(seat, claim);
    this.logMove(chainGameId, claim.type, seat, claim.low !== undefined ? { low: claim.low } : {});
    this.queueSnapshot(chainGameId);
    return res;
  }

  ankan(chainGameId: string, seat: number, kind: number): RoundOutcome | null {
    const out = this.round(chainGameId).ankan(seat, kind);
    this.logMove(chainGameId, "ankan", seat, { kind });
    this.queueSnapshot(chainGameId);
    return out;
  }

  /** Shouminkan (add pon -> kan); can trigger the chankan phase. */
  addedKan(chainGameId: string, seat: number, kind: number): RoundOutcome | null {
    const out = this.round(chainGameId).addedKan(seat, kind);
    this.logMove(chainGameId, "addedkan", seat, { kind });
    this.queueSnapshot(chainGameId);
    return out;
  }

  /**
   * Compute the final ranking (addresses of places 1..4) and sign it as the server
   * for settleByServer in the contract. Uses the final hanchan points.
   */
  async finalizeAndSign(chainGameId: string): Promise<SettlePayload> {
    const room = this.room(chainGameId);
    const order = room.hanchan.finalRanking(); // seats sorted by final points
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
      this.logger.warn(`Failed to sign as server: ${(err as Error).message}`);
    }
    return { ranking, serverSig };
  }
}
