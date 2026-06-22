import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Settlement, SettlementService } from "./settlement.service";

/**
 * HTTP endpoints for settlement:
 *   GET  /settlement/:gameId                  -> settle session status
 *   POST /settlement/:gameId/signature        -> submit a player's EIP-712 signature
 *   POST /settlement/:gameId/server-fallback  -> trigger settleByServer (server attest)
 */
@Controller("settlement")
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Get(":gameId")
  get(@Param("gameId") gameId: string): Settlement {
    return this.settlement.get(gameId);
  }

  /** EIP-712 payload that the player must sign (for signTypedData on the client). */
  @Get(":gameId/typed-data")
  typedData(@Param("gameId") gameId: string) {
    return this.settlement.typedData(gameId);
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
