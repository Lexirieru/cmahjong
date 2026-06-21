import { Injectable, Logger } from "@nestjs/common";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { signResult } from "./signer";

/** ABI minimal MahjongTable yang dibutuhkan backend. */
const MAHJONG_ABI = [
  "function getGame(uint256) view returns (tuple(address token,uint256 buyIn,address server,uint8 status,uint8 joined,uint8 revealedCount,uint64 commitDeadline,uint64 revealWindow,uint64 settleWindow,uint64 revealDeadline,uint64 settleDeadline,bytes32 seed,uint16[4] payoutBps,address[4] players,bytes32[4] commitments,bytes32[4] secrets,bool[4] revealed))",
  "function getSeed(uint256) view returns (bytes32)",
  "function getPlayers(uint256) view returns (address[4])",
  "function gameCount() view returns (uint256)",
  "function settle(uint256 gameId, address[4] ranking, bytes[4] signatures)",
  "function settleByServer(uint256 gameId, address[4] ranking, bytes serverSig)",
];

/** Status game on-chain (selaras enum Status di kontrak). */
export enum ChainStatus {
  None,
  Open,
  Revealing,
  Playing,
  Settled,
  Cancelled,
}

export interface ChainGame {
  token: string;
  buyIn: bigint;
  server: string;
  status: ChainStatus;
  seed: string;
  players: string[];
  settleDeadline: number;
}

/**
 * Jembatan ke kontrak MahjongTable di Celo: baca state game & tandatangani
 * hasil untuk `settleByServer` (fallback).
 */
@Injectable()
export class ChainService {
  private readonly logger = new Logger(ChainService.name);
  private readonly provider: JsonRpcProvider;
  private readonly contractAddress: string;
  private readonly chainId: number;
  private readonly serverWallet?: Wallet;
  private readonly contract?: Contract;
  private readonly writeContract?: Contract;

  constructor() {
    const rpc = process.env.CELO_RPC ?? "https://forno.celo.org";
    this.contractAddress = process.env.MAHJONG_ADDRESS ?? "";
    this.chainId = Number(process.env.CHAIN_ID ?? 42220);
    this.provider = new JsonRpcProvider(rpc);

    if (process.env.SERVER_PRIVATE_KEY) {
      this.serverWallet = new Wallet(process.env.SERVER_PRIVATE_KEY, this.provider);
    }
    if (this.contractAddress) {
      this.contract = new Contract(this.contractAddress, MAHJONG_ABI, this.provider);
      if (this.serverWallet) {
        this.writeContract = new Contract(this.contractAddress, MAHJONG_ABI, this.serverWallet);
      }
    } else {
      this.logger.warn("MAHJONG_ADDRESS belum diset — interaksi on-chain dinonaktifkan");
    }
  }

  /** Alamat server yang dipakai untuk attest (harus = game.server on-chain). */
  get serverAddress(): string | undefined {
    return this.serverWallet?.address;
  }

  /** Alamat kontrak MahjongTable. */
  get address(): string {
    return this.contractAddress;
  }

  /** Chain id (Celo mainnet 42220). */
  get chain(): number {
    return this.chainId;
  }

  /** Apakah pembacaan on-chain aktif (alamat kontrak terkonfigurasi). */
  get configured(): boolean {
    return !!this.contract;
  }

  /** Baca ringkasan state game on-chain. */
  async readGame(chainGameId: bigint): Promise<ChainGame> {
    if (!this.contract) throw new Error("kontrak belum dikonfigurasi");
    const g = await this.contract.getGame(chainGameId);
    return {
      token: g.token,
      buyIn: g.buyIn,
      server: g.server,
      status: Number(g.status) as ChainStatus,
      seed: g.seed,
      players: [...g.players],
      settleDeadline: Number(g.settleDeadline),
    };
  }

  /** Baca seed kolektif on-chain (sumber kebenaran untuk shuffle). */
  async readSeed(chainGameId: bigint): Promise<string> {
    if (!this.contract) throw new Error("kontrak belum dikonfigurasi");
    return this.contract.getSeed(chainGameId);
  }

  /** Baca daftar pemain (urutan seat) on-chain. */
  async readPlayers(chainGameId: bigint): Promise<string[]> {
    if (!this.contract) throw new Error("kontrak belum dikonfigurasi");
    return this.contract.getPlayers(chainGameId);
  }

  /**
   * Tandatangani ranking final sebagai server untuk settleByServer.
   * @param ranking alamat juara 1..4
   */
  async signRanking(
    chainGameId: bigint,
    ranking: [string, string, string, string],
  ): Promise<string> {
    if (!this.serverWallet) throw new Error("SERVER_PRIVATE_KEY belum diset");
    return signResult(this.serverWallet, this.contractAddress, this.chainId, chainGameId, ranking);
  }

  /**
   * Submit settle KOOPERATIF (4 tanda tangan pemain). Siapa pun boleh memanggil;
   * server membayar gas. Mengembalikan tx hash setelah dikonfirmasi.
   */
  async submitSettle(
    chainGameId: bigint,
    ranking: [string, string, string, string],
    signatures: [string, string, string, string],
  ): Promise<string> {
    if (!this.writeContract) throw new Error("server wallet/kontrak belum dikonfigurasi");
    const tx = await this.writeContract.settle(chainGameId, ranking, signatures);
    const receipt = await tx.wait();
    this.logger.log(`settle game ${chainGameId} -> ${receipt.hash}`);
    return receipt.hash;
  }

  /**
   * Submit settleByServer (fallback). Hanya valid on-chain setelah settleDeadline;
   * kontrak yang menegakkannya.
   */
  async submitSettleByServer(
    chainGameId: bigint,
    ranking: [string, string, string, string],
    serverSig: string,
  ): Promise<string> {
    if (!this.writeContract) throw new Error("server wallet/kontrak belum dikonfigurasi");
    const tx = await this.writeContract.settleByServer(chainGameId, ranking, serverSig);
    const receipt = await tx.wait();
    this.logger.log(`settleByServer game ${chainGameId} -> ${receipt.hash}`);
    return receipt.hash;
  }
}
