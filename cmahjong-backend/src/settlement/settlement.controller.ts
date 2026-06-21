import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Settlement, SettlementService } from "./settlement.service";

/**
 * Endpoint HTTP untuk pencairan:
 *   GET  /settlement/:gameId                  -> status sesi settle
 *   POST /settlement/:gameId/signature        -> kirim tanda tangan EIP-712 pemain
 *   POST /settlement/:gameId/server-fallback  -> picu settleByServer (server attest)
 */
@Controller("settlement")
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Get(":gameId")
  get(@Param("gameId") gameId: string): Settlement {
    return this.settlement.get(gameId);
  }

  @Post(":gameId/signature")
  async submitSignature(
    @Param("gameId") gameId: string,
    @Body("signature") signature: string,
  ): Promise<Settlement> {
    return this.settlement.addSignature(gameId, signature);
  }

  @Post(":gameId/server-fallback")
  async serverFallback(@Param("gameId") gameId: string): Promise<Settlement> {
    return this.settlement.submitByServer(gameId);
  }
}
