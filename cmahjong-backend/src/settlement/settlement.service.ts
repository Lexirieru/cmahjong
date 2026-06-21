import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ChainService } from "../chain/chain.service";
import { recoverResultSigner } from "../chain/signer";

export type SettlementStatus = "collecting" | "settled" | "failed";

export interface Settlement {
  gameId: string;
  ranking: [string, string, string, string]; // alamat juara 1..4
  players: string[]; // keempat pemain (untuk validasi keanggotaan)
  signers: string[]; // alamat yang sudah menandatangani
  status: SettlementStatus;
  txHash?: string;
  error?: string;
}

type Ranking4 = [string, string, string, string];

/**
 * Orkestrasi pencairan on-chain setelah hanchan selesai.
 *
 * Jalur kooperatif (utama): kumpulkan tanda tangan EIP-712 keempat pemain atas
 * ranking final → submit `settle`. Jalur fallback: `settleByServer` (server attest)
 * setelah settleDeadline lewat (ditegakkan kontrak).
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);
  private readonly pending = new Map<string, Settlement & { sigs: Map<string, string> }>();

  constructor(private readonly chain: ChainService) {}

  /** Buka sesi settle untuk sebuah game (dipanggil saat game selesai). */
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
    this.logger.log(`Settle dibuka untuk game ${gameId}`);
    return this.view(s);
  }

  /**
   * Terima tanda tangan pemain atas ranking final. Tanda tangan diverifikasi &
   * dipulihkan; bila keempat terkumpul, `settle` kooperatif otomatis di-submit.
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
    if (!s.players.includes(signer)) throw new Error("penanda tangan bukan pemain game ini");

    s.sigs.set(signer, signature);
    if (s.sigs.size === 4) await this.submitCooperative(gameId);
    return this.view(this.require(gameId));
  }

  /** Submit settle kooperatif (semua tanda tangan terkumpul). */
  async submitCooperative(gameId: string): Promise<Settlement> {
    const s = this.require(gameId);
    if (s.sigs.size < 4) throw new Error("tanda tangan belum lengkap (butuh 4)");
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

  /** Fallback: server attest ranking (hanya valid on-chain setelah settleDeadline). */
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

  private require(gameId: string) {
    const s = this.pending.get(gameId);
    if (!s) throw new NotFoundException(`settle untuk game ${gameId} belum dibuka`);
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
