import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { GameService } from "./game.service";
import { SettlementService } from "../settlement/settlement.service";
import { RoundOutcome } from "./round";

/**
 * Gateway realtime (Socket.IO) untuk meja cMahjong.
 *
 * Masuk:  join · start · discard · riichi · call · ankan · addedkan · tsumo · submitSignature
 * Keluar: state (publik, broadcast) · hand (privat per pemain) · roundEnd · newRound · settleReady
 *
 * Setiap perubahan state memanggil `sync`: broadcast state publik + kirim ke tiap
 * socket HANYA tangannya sendiri (hidden hands terjaga, tangan selalu terkini).
 */
@WebSocketGateway({ cors: { origin: "*" } })
export class GameGateway implements OnGatewayConnection {
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly games: GameService,
    private readonly settlement: SettlementService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.debug(`klien terhubung: ${client.id}`);
  }

  /** Kirim tiap socket tangannya sendiri DULU, lalu broadcast state publik
   *  (urutan ini memastikan klien sudah pegang tangan terkini saat memproses state). */
  private async sync(gameId: string) {
    let state;
    try {
      state = this.games.publicState(gameId);
    } catch {
      return; // ronde belum mulai
    }

    const sockets = await this.server.in(gameId).fetchSockets();
    for (const s of sockets) {
      const address = (s.data as { address?: string })?.address;
      if (!address) continue;
      try {
        const seat = this.games.seatOf(gameId, address);
        s.emit("hand", { seat, tiles: this.games.handOf(gameId, seat) });
      } catch {
        /* socket ini bukan pemain */
      }
    }

    this.server.to(gameId).emit("state", state);
  }

  @SubscribeMessage("join")
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { gameId: string; address: string }) {
    client.data = { gameId: body.gameId, address: body.address };
    await client.join(body.gameId);
    await this.sync(body.gameId);
    return { ok: true };
  }

  @SubscribeMessage("start")
  async onStart(
    @MessageBody()
    body: { gameId: string; seed?: string; players?: string[]; length?: "east" | "hanchan" },
  ) {
    await this.games.startRound(body.gameId, {
      seed: body.seed,
      players: body.players,
      length: body.length,
    });
    await this.sync(body.gameId);
    return { ok: true };
  }

  @SubscribeMessage("discard")
  async onDiscard(@MessageBody() body: { gameId: string; address: string; tileId: number }) {
    const seat = this.games.seatOf(body.gameId, body.address);
    const outcome = this.games.discard(body.gameId, seat, body.tileId);
    await this.sync(body.gameId);
    if (outcome) await this.emitOutcome(body.gameId, outcome);
    return { ok: true };
  }

  @SubscribeMessage("riichi")
  async onRiichi(@MessageBody() body: { gameId: string; address: string; tileId: number }) {
    const seat = this.games.seatOf(body.gameId, body.address);
    this.games.riichi(body.gameId, seat, body.tileId);
    await this.sync(body.gameId);
    return { ok: true };
  }

  @SubscribeMessage("call")
  async onCall(
    @MessageBody()
    body: { gameId: string; address: string; action: "pon" | "chi" | "kan" | "ron" | "pass"; low?: number },
  ) {
    const seat = this.games.seatOf(body.gameId, body.address);
    const res = this.games.respond(body.gameId, seat, { type: body.action, low: body.low });
    await this.sync(body.gameId);
    if (res.resolved && res.outcome) await this.emitOutcome(body.gameId, res.outcome);
    return { ok: true, resolved: res.resolved, action: res.action };
  }

  @SubscribeMessage("ankan")
  async onAnkan(@MessageBody() body: { gameId: string; address: string; kind: number }) {
    const seat = this.games.seatOf(body.gameId, body.address);
    const outcome = this.games.ankan(body.gameId, seat, body.kind);
    await this.sync(body.gameId);
    if (outcome) await this.emitOutcome(body.gameId, outcome);
    return { ok: true };
  }

  @SubscribeMessage("addedkan")
  async onAddedKan(@MessageBody() body: { gameId: string; address: string; kind: number }) {
    const seat = this.games.seatOf(body.gameId, body.address);
    const outcome = this.games.addedKan(body.gameId, seat, body.kind);
    await this.sync(body.gameId);
    if (outcome) await this.emitOutcome(body.gameId, outcome);
    return { ok: true };
  }

  @SubscribeMessage("tsumo")
  async onTsumo(@MessageBody() body: { gameId: string; address: string }) {
    const seat = this.games.seatOf(body.gameId, body.address);
    const outcome = this.games.tsumo(body.gameId, seat);
    await this.emitOutcome(body.gameId, outcome);
    return { ok: true };
  }

  /** Pemain mengirim tanda tangan EIP-712 atas ranking final (settle kooperatif). */
  @SubscribeMessage("submitSignature")
  async onSubmitSignature(@MessageBody() body: { gameId: string; signature: string }) {
    const settle = await this.settlement.addSignature(body.gameId, body.signature);
    this.server.to(body.gameId).emit("settleUpdate", settle);
    return { ok: true, status: settle.status };
  }

  private async emitOutcome(gameId: string, outcome: RoundOutcome) {
    const end = await this.games.recordOutcome(gameId, outcome);
    this.server.to(gameId).emit("roundEnd", end);
    if (end.finished) {
      this.server.to(gameId).emit("settleReady", end.settle);
    } else {
      // ronde baru sudah dimulai — dorong state + tangan baru otomatis
      await this.sync(gameId);
      this.server.to(gameId).emit("newRound", this.games.hanchanState(gameId));
    }
  }
}
