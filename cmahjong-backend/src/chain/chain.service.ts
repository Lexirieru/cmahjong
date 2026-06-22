import { Injectable, Logger } from "@nestjs/common";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { signResult } from "./signer";

/** Minimal MahjongTable ABI needed by the backend. */
const MAHJONG_ABI = [
  "function getGame(uint256) view returns (tuple(address token,uint256 buyIn,address server,uint8 status,uint8 joined,uint8 revealedCount,uint64 commitDeadline,uint64 revealWindow,uint64 settleWindow,uint64 revealDeadline,uint64 settleDeadline,bytes32 seed,uint16[4] payoutBps,address[4] players,bytes32[4] commitments,bytes32[4] secrets,bool[4] revealed))",
  "function getSeed(uint256) view returns (bytes32)",
  "function getPlayers(uint256) view returns (address[4])",
  "function gameCount() view returns (uint256)",
  "function settle(uint256 gameId, address[4] ranking, bytes[4] signatures)",
  "function settleByServer(uint256 gameId, address[4] ranking, bytes serverSig)",
];

/** On-chain game status (aligned with the Status enum in the contract). */
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
 * Bridge to the MahjongTable contract on Celo: read game state & sign
 * results for `settleByServer` (fallback).
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
      this.logger.warn("MAHJONG_ADDRESS not set — on-chain interactions disabled");
    }
  }

  /** Server address used to attest (must = game.server on-chain). */
  get serverAddress(): string | undefined {
    return this.serverWallet?.address;
  }

  /** MahjongTable contract address. */
  get address(): string {
    return this.contractAddress;
  }

  /** Chain id (Celo mainnet 42220). */
  get chain(): number {
    return this.chainId;
  }

  /** Whether on-chain reads are active (contract address configured). */
  get configured(): boolean {
    return !!this.contract;
  }

  /** Read a summary of on-chain game state. */
  async readGame(chainGameId: bigint): Promise<ChainGame> {
    if (!this.contract) throw new Error("contract not configured");
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

  /** Read the collective seed on-chain (source of truth for the shuffle). */
  async readSeed(chainGameId: bigint): Promise<string> {
    if (!this.contract) throw new Error("contract not configured");
    return this.contract.getSeed(chainGameId);
  }

  /** Read the player list (seat order) on-chain. */
  async readPlayers(chainGameId: bigint): Promise<string[]> {
    if (!this.contract) throw new Error("contract not configured");
    return this.contract.getPlayers(chainGameId);
  }

  /**
   * Sign the final ranking as the server for settleByServer.
   * @param ranking addresses of 1st..4th place
   */
  async signRanking(
    chainGameId: bigint,
    ranking: [string, string, string, string],
  ): Promise<string> {
    if (!this.serverWallet) throw new Error("SERVER_PRIVATE_KEY not set");
    return signResult(this.serverWallet, this.contractAddress, this.chainId, chainGameId, ranking);
  }

  /**
   * Submit a COOPERATIVE settle (4 player signatures). Anyone may call it;
   * the server pays gas. Returns the tx hash after confirmation.
   */
  async submitSettle(
    chainGameId: bigint,
    ranking: [string, string, string, string],
    signatures: [string, string, string, string],
  ): Promise<string> {
    if (!this.writeContract) throw new Error("server wallet/contract not configured");
    const tx = await this.writeContract.settle(chainGameId, ranking, signatures);
    const receipt = await tx.wait();
    this.logger.log(`settle game ${chainGameId} -> ${receipt.hash}`);
    return receipt.hash;
  }

  /**
   * Submit settleByServer (fallback). Only valid on-chain after settleDeadline;
   * the contract enforces it.
   */
  async submitSettleByServer(
    chainGameId: bigint,
    ranking: [string, string, string, string],
    serverSig: string,
  ): Promise<string> {
    if (!this.writeContract) throw new Error("server wallet/contract not configured");
    const tx = await this.writeContract.settleByServer(chainGameId, ranking, serverSig);
    const receipt = await tx.wait();
    this.logger.log(`settleByServer game ${chainGameId} -> ${receipt.hash}`);
    return receipt.hash;
  }
}
