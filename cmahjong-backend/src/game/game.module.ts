import { Module } from "@nestjs/common";
import { ChainModule } from "../chain/chain.module";
import { SettlementModule } from "../settlement/settlement.module";
import { GameService } from "./game.service";
import { GameGateway } from "./game.gateway";

@Module({
  imports: [ChainModule, SettlementModule],
  providers: [GameService, GameGateway],
  exports: [GameService],
})
export class GameModule {}
