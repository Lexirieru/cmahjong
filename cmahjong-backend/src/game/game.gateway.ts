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
import { RoundOutcome } from "./round";

/**
 * Gateway realtime (Socket.IO) untuk meja cMahjong.
 *
 * Event masuk:
 *   join        { gameId, address }           -> gabung room, terima tangan privat
 *   start       { gameId, seed?, players? }    -> mulai ronde (seed dari chain bila kosong)
 *   discard     { gameId, address, tileId }
 *   riichi      { gameId, address, tileId }
 *   tsumo       { gameId, address }
 *   ron         { gameId, address }
 *
 * Event keluar (broadcast ke room `gameId`):
 *   state       PublicState
 *   hand        Tile[]   (privat, hanya ke pengirim)
 *   outcome     RoundOutcome + settle payload
 */
@WebSocketGateway({ cors: { origin: "*" } })
export class GameGateway implements OnGatewayConnection {
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly games: GameService) {}

  handleConnection(client: Socket) {
    this.logger.debug(`klien terhubung: ${client.id}`);
  }

  private broadcastState(gameId: string) {
    this.server.to(gameId).emit("state", this.games.publicState(gameId));
  }

  private sendHand(client: Socket, gameId: string, address: string) {
    const seat = this.games.seatOf(gameId, address);
    client.emit("hand", { seat, tiles: this.games.handOf(gameId, seat) });
  }

  @SubscribeMessage("join")
  onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { gameId: string; address: string }) {
    client.join(body.gameId);
    try {
      this.sendHand(client, body.gameId, body.address);
      client.emit("state", this.games.publicState(body.gameId));
    } catch {
      // ronde belum mulai — abaikan
    }
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
    this.broadcastState(body.gameId);
    return { ok: true };
  }

  @SubscribeMessage("discard")
  async onDiscard(
    @MessageBody() body: { gameId: string; address: string; tileId: number },
  ) {
    const seat = this.games.seatOf(body.gameId, body.address);
    const outcome = this.games.discard(body.gameId, seat, body.tileId);
    this.broadcastState(body.gameId);
    if (outcome) await this.emitOutcome(body.gameId, outcome);
    return { ok: true };
  }

  @SubscribeMessage("riichi")
  onRiichi(@MessageBody() body: { gameId: string; address: string; tileId: number }) {
    const seat = this.games.seatOf(body.gameId, body.address);
    this.games.riichi(body.gameId, seat, body.tileId);
    this.broadcastState(body.gameId);
    return { ok: true };
  }

  @SubscribeMessage("call")
  async onCall(
    @MessageBody()
    body: { gameId: string; address: string; action: "pon" | "chi" | "kan" | "ron" | "pass"; low?: number },
  ) {
    const seat = this.games.seatOf(body.gameId, body.address);
    const res = this.games.respond(body.gameId, seat, { type: body.action, low: body.low });
    this.broadcastState(body.gameId);
    if (res.resolved && res.outcome) await this.emitOutcome(body.gameId, res.outcome);
    return { ok: true, resolved: res.resolved, action: res.action };
  }

  @SubscribeMessage("ankan")
  async onAnkan(@MessageBody() body: { gameId: string; address: string; kind: number }) {
    const seat = this.games.seatOf(body.gameId, body.address);
    const outcome = this.games.ankan(body.gameId, seat, body.kind);
    this.broadcastState(body.gameId);
    if (outcome) await this.emitOutcome(body.gameId, outcome);
    return { ok: true };
  }

  @SubscribeMessage("addedkan")
  async onAddedKan(@MessageBody() body: { gameId: string; address: string; kind: number }) {
    const seat = this.games.seatOf(body.gameId, body.address);
    // bisa membuka fase chankan (robbers merespons via "call"), atau langsung selesai
    const outcome = this.games.addedKan(body.gameId, seat, body.kind);
    this.broadcastState(body.gameId);
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

  private async emitOutcome(gameId: string, outcome: RoundOutcome) {
    // catat ke hanchan: lanjut ronde berikut, atau selesai + settle payload
    const end = await this.games.recordOutcome(gameId, outcome);
    this.server.to(gameId).emit("roundEnd", end);
    if (!end.finished) {
      // ronde baru dimulai — klien me-refresh tangan via "join"
      this.broadcastState(gameId);
      this.server.to(gameId).emit("newRound", this.games.hanchanState(gameId));
    }
  }
}
