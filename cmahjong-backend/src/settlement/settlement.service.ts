import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ChainService } from "../chain/chain.service";
import { recoverResultSigner, resultTypedData } from "../chain/signer";

export type SettlementStatus = "collecting" | "settled" | "failed";

export interface Settlement {
  gameId: string;
  ranking: [string, string, string, string]; // addresses of 1st..4th place
  players: string[]; // all four players (for membership validation)
  signers: string[]; // addresses that have already signed
  status: SettlementStatus;
  txHash?: string;
  error?: string;
}

type Ranking4 = [string, string, string, string];

/**
 * Orchestrates on-chain settlement after the hanchan finishes.
 *
 * Cooperative path (primary): collect EIP-712 signatures from all four players over
 * the final ranking → submit `settle`. Fallback path: `settleByServer` (server attest)
 * after settleDeadline has passed (enforced by the contract).
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);
  private readonly pending = new Map<string, Settlement & { sigs: Map<string, string> }>();

  constructor(private readonly chain: ChainService) {}

  /** Open a settle session for a game (called when the game finishes). */
  open(gameId: string, players: string[], ranking: Ranking4): Settlement {
    const existing = this.pending.get(gameId);
    if (existing) return this.view(existing);
    const s = {
      gameId,
      ranking,
      players: players.map((p) => p.toLowerCase()),
      signers: [],
      status: "collecting" as SettlementStatus,
      sigs: new Map<string, string>(),
    };
    this.pending.set(gameId, s);
    this.logger.log(`Settle opened for game ${gameId}`);
    return this.view(s);
  }

  /**
   * Accept a player's signature over the final ranking. The signature is verified &
   * recovered; once all four are collected, the cooperative `settle` is auto-submitted.
   */
  async addSignature(gameId: string, signature: string): Promise<Settlement> {
    const s = this.require(gameId);
    if (s.status !== "collecting") return this.view(s);

    const signer = recoverResultSigner(
      this.chain.address,
      this.chain.chain,
      BigInt(gameId),
      s.ranking,
      signature,
    ).toLowerCase();
    if (!s.players.includes(signer)) throw new Error("signer is not a player in this game");

    s.sigs.set(signer, signature);
    if (s.sigs.size === 4) await this.submitCooperative(gameId);
    return this.view(this.require(gameId));
  }

  /** Submit the cooperative settle (all signatures collected). */
  async submitCooperative(gameId: string): Promise<Settlement> {
    const s = this.require(gameId);
    if (s.sigs.size < 4) throw new Error("signatures incomplete (need 4)");
    const sigList = s.ranking.map((addr) => s.sigs.get(addr.toLowerCase())!) as Ranking4;
    try {
      s.txHash = await this.chain.submitSettle(BigInt(gameId), s.ranking, sigList);
      s.status = "settled";
    } catch (err) {
      s.status = "failed";
      s.error = (err as Error).message;
    }
    return this.view(s);
  }

  /** Fallback: server attests the ranking (only valid on-chain after settleDeadline). */
  async submitByServer(gameId: string): Promise<Settlement> {
    const s = this.require(gameId);
    try {
      const sig = await this.chain.signRanking(BigInt(gameId), s.ranking);
      s.txHash = await this.chain.submitSettleByServer(BigInt(gameId), s.ranking, sig);
      s.status = "settled";
    } catch (err) {
      s.status = "failed";
      s.error = (err as Error).message;
    }
    return this.view(s);
  }

  get(gameId: string): Settlement {
    return this.view(this.require(gameId));
  }

  /** EIP-712 payload that the player must sign for this game. */
  typedData(gameId: string) {
    const s = this.require(gameId);
    return resultTypedData(this.chain.address, this.chain.chain, BigInt(gameId), s.ranking);
  }

  private require(gameId: string) {
    const s = this.pending.get(gameId);
    if (!s) throw new NotFoundException(`settle for game ${gameId} not opened`);
    return s;
  }

  private view(s: Settlement & { sigs: Map<string, string> }): Settlement {
    return {
      gameId: s.gameId,
      ranking: s.ranking,
      players: s.players,
      signers: [...s.sigs.keys()],
      status: s.status,
      txHash: s.txHash,
      error: s.error,
    };
  }
}
