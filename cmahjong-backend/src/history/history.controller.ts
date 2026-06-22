import { Controller, Get, Param, Query } from "@nestjs/common";
import { HistoryService } from "./history.service";

/**
 *   GET /games            -> list of most recent games
 *   GET /games/:id/replay -> replay tape (seed + players + ordered actions)
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

  /** Board state per step for the replay UI. */
  @Get(":gameId/replay/states")
  replayStates(@Param("gameId") gameId: string) {
    return this.history.getReplayStates(gameId);
  }
}

/** Public stats endpoint: GET /stats (no wallet required). */
@Controller()
export class StatsController {
  constructor(private readonly history: HistoryService) {}

  @Get("stats")
  stats() {
    return this.history.getStats();
  }
}
