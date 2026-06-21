/**
 * Orkestrasi hanchan / tonpuusen (multi-ronde) Riichi.
 *
 * Mengelola: rotasi dealer, progres angin ronde (East→South), honba (counter),
 * riichi sticks (pot carryover), renchan (dealer menang / tenpai saat draw),
 * dan penentuan akhir game + ranking final.
 *
 * Seed tiap ronde diturunkan deterministik dari seed kolektif on-chain:
 *   roundSeed = keccak256(abi.encodePacked(baseSeed, uint256 handIndex))
 * sehingga seluruh game tetap provably fair dari satu seed publik.
 */
import { solidityPackedKeccak256 } from "ethers";
import { Round, RoundOutcome, SEATS, START_POINTS } from "./round";

const EAST = 27;
const SOUTH = 28;

export type HanchanLength = "east" | "hanchan";

export interface HanchanState {
  roundWind: number;
  kyokuNum: number; // 1..4
  dealer: number;
  honba: number;
  riichiSticks: number;
  points: number[];
  finished: boolean;
}

export class Hanchan {
  points: number[] = new Array(SEATS).fill(START_POINTS);
  dealer = 0;
  roundWind = EAST;
  kyokuNum = 1;
  honba = 0;
  riichiSticks = 0;
  finished = false;
  round!: Round;
  private handIndex = 0;

  constructor(
    private readonly baseSeed: string,
    private readonly length: HanchanLength = "hanchan",
  ) {
    this.startRound();
  }

  private roundSeed(): string {
    return solidityPackedKeccak256(["bytes32", "uint256"], [this.baseSeed, this.handIndex]);
  }

  private startRound(): void {
    this.round = new Round(this.roundSeed(), this.dealer, this.roundWind, this.points.slice());
    this.handIndex++;
  }

  /** Catat hasil ronde, perbarui meta game, lalu mulai ronde berikut (bila belum selesai). */
  recordOutcome(out: RoundOutcome): void {
    const riichiCount = this.round.riichi.filter(Boolean).length;
    this.advance(out, riichiCount);
    if (!this.finished) this.startRound();
  }

  /**
   * Logika murni transisi meta game (dipisah agar mudah diuji).
   * @param riichiCount jumlah deklarasi riichi pada ronde tsb
   */
  advance(out: RoundOutcome, riichiCount: number): void {
    const pot = this.riichiSticks + riichiCount;
    this.points = out.points.slice();

    if (out.type === "draw") {
      this.riichiSticks = pot; // sticks carry ke ronde berikut
      this.honba++; // draw selalu menambah honba
      const dealerTenpai = out.tenpai?.[this.dealer] ?? false;
      if (!dealerTenpai) this.rotateDealer();
      return;
    }

    // tsumo / ron
    const winner = out.winner!;
    if (out.type === "ron") {
      const bonus = 300 * this.honba;
      this.points[out.loser!] -= bonus;
      this.points[winner] += bonus;
    } else {
      for (let s = 0; s < SEATS; s++) {
        if (s === winner) continue;
        this.points[s] -= 100 * this.honba;
        this.points[winner] += 100 * this.honba;
      }
    }
    this.points[winner] += pot * 1000; // kumpulkan semua riichi sticks
    this.riichiSticks = 0;

    if (winner === this.dealer) {
      this.honba++; // renchan: dealer tetap
    } else {
      this.honba = 0;
      this.rotateDealer();
    }
  }

  private rotateDealer(): void {
    this.dealer = (this.dealer + 1) % SEATS;
    this.kyokuNum++;
    if (this.kyokuNum > 4) {
      if (this.length === "east") {
        this.finished = true;
      } else if (this.roundWind === EAST) {
        this.roundWind = SOUTH;
        this.kyokuNum = 1;
      } else {
        this.finished = true; // selesai setelah South-4
      }
    }
  }

  state(): HanchanState {
    return {
      roundWind: this.roundWind,
      kyokuNum: this.kyokuNum,
      dealer: this.dealer,
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      points: this.points.slice(),
      finished: this.finished,
    };
  }

  /** Ranking final seat 1..4 (poin desc; seri dipecah urutan seat awal E>S>W>N). */
  finalRanking(): number[] {
    const seats = [0, 1, 2, 3];
    seats.sort((a, b) => (this.points[b] !== this.points[a] ? this.points[b] - this.points[a] : a - b));
    return seats;
  }
}
