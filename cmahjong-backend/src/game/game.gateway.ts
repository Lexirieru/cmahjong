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
    @MessageBody() body: { gameId: string; seed?: string; players?: string[]; dealer?: number },
  ) {
    await this.games.startRound(body.gameId, {
      seed: body.seed,
      players: body.players,
      dealer: body.dealer,
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

  @SubscribeMessage("tsumo")
  async onTsumo(@MessageBody() body: { gameId: string; address: string }) {
    const seat = this.games.seatOf(body.gameId, body.address);
    const outcome = this.games.tsumo(body.gameId, seat);
    await this.emitOutcome(body.gameId, outcome);
    return { ok: true };
  }

  @SubscribeMessage("ron")
  async onRon(@MessageBody() body: { gameId: string; address: string }) {
    const seat = this.games.seatOf(body.gameId, body.address);
    const outcome = this.games.ron(body.gameId, seat);
    await this.emitOutcome(body.gameId, outcome);
    return { ok: true };
  }

  private async emitOutcome(gameId: string, outcome: RoundOutcome) {
    const settle = await this.games.finalizeAndSign(gameId);
    this.server.to(gameId).emit("outcome", { outcome, settle });
    this.broadcastState(gameId);
  }
}
