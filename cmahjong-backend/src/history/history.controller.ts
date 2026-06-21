import { Controller, Get, Param, Query } from "@nestjs/common";
import { HistoryService } from "./history.service";

/**
 *   GET /games            -> daftar game terbaru
 *   GET /games/:id/replay -> tape replay (seed + pemain + aksi terurut)
 */
@Controller("games")
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  list(@Query("limit") limit?: string) {
    return this.history.listGames(limit ? Number(limit) : 20);
  }

  @Get(":gameId/replay")
  replay(@Param("gameId") gameId: string) {
    return this.history.getReplay(gameId);
  }

  /** Board state per langkah untuk UI replay. */
  @Get(":gameId/replay/states")
  replayStates(@Param("gameId") gameId: string) {
    return this.history.getReplayStates(gameId);
  }
}
