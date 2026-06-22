import { Module } from "@nestjs/common";
import { HistoryService } from "./history.service";
import { HistoryController, StatsController } from "./history.controller";

@Module({
  controllers: [HistoryController, StatsController],
  providers: [HistoryService],
})
export class HistoryModule {}
