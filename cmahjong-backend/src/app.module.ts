import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { ChainModule } from "./chain/chain.module";
import { GameModule } from "./game/game.module";
import { SettlementModule } from "./settlement/settlement.module";

@Module({
  imports: [PrismaModule, ChainModule, GameModule, SettlementModule],
})
export class AppModule {}
