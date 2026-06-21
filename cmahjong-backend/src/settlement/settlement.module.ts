import { Module } from "@nestjs/common";
import { ChainModule } from "../chain/chain.module";
import { SettlementService } from "./settlement.service";

@Module({
  imports: [ChainModule],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
