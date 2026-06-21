import { Module } from "@nestjs/common";
import { ChainModule } from "../chain/chain.module";
import { SettlementService } from "./settlement.service";
import { SettlementController } from "./settlement.controller";

@Module({
  imports: [ChainModule],
  controllers: [SettlementController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
