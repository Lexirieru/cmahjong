/**
 * Orchestration of a Riichi hanchan / tonpuusen (multi-round) game.
 *
 * Manages: dealer rotation, round wind progression (East→South), honba (counter),
 * riichi sticks (pot carryover), renchan (dealer wins / is tenpai at draw),
 * and game-end determination + final ranking.
 *
 * The seed for each round is derived deterministically from the collective on-chain seed:
 *   roundSeed = keccak256(abi.encodePacked(baseSeed, uint256 handIndex))
 * so that the entire game remains provably fair from a single public seed.
 */
import { solidityPackedKeccak256 } from "ethers";
import { Round, RoundOutcome, RoundSnapshot, SEATS, START_POINTS } from "./round";

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
    private baseSeed: string,
    private length: HanchanLength = "hanchan",
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

  /** Record the round result, update game meta, then start the next round (if not yet finished). */
  recordOutcome(out: RoundOutcome): void {
    const riichiCount = this.round.riichi.filter(Boolean).length;
    this.advance(out, riichiCount);
    if (!this.finished) this.startRound();
  }

  /**
   * Pure game-meta transition logic (separated so it is easy to test).
   * @param riichiCount number of riichi declarations in that round
   */
  advance(out: RoundOutcome, riichiCount: number): void {
    const pot = this.riichiSticks + riichiCount;
    this.points = out.points.slice();

    if (out.type === "draw") {
      this.riichiSticks = pot; // sticks carry over to the next round
      this.honba++; // a draw always increments honba
      const dealerTenpai = out.tenpai?.[this.dealer] ?? false;
      if (!dealerTenpai) this.rotateDealer();
      return;
    }

    // tsumo / ron (ron can be multiple)
    const head = out.winner!; // primary winner (head-bump): receives honba + sticks
    const winners = out.winners ?? [head];
    if (out.type === "ron") {
      const bonus = 300 * this.honba;
      this.points[out.loser!] -= bonus;
      this.points[head] += bonus;
    } else {
      for (let s = 0; s < SEATS; s++) {
        if (s === head) continue;
        this.points[s] -= 100 * this.honba;
        this.points[head] += 100 * this.honba;
      }
    }
    this.points[head] += pot * 1000; // collect all riichi sticks
    this.riichiSticks = 0;

    if (winners.includes(this.dealer)) {
      this.honba++; // renchan: dealer is among the winners
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
        this.finished = true; // finished after South-4
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

  /** Final ranking of seats 1..4 (points desc; ties broken by initial seat order E>S>W>N). */
  finalRanking(): number[] {
    const seats = [0, 1, 2, 3];
    seats.sort((a, b) => (this.points[b] !== this.points[a] ? this.points[b] - this.points[a] : a - b));
    return seats;
  }

  /** Serialize the entire game state (meta + live round) to be saved to the DB. */
  snapshot(): HanchanSnapshot {
    return {
      points: this.points,
      dealer: this.dealer,
      roundWind: this.roundWind,
      kyokuNum: this.kyokuNum,
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      finished: this.finished,
      handIndex: this.handIndex,
      baseSeed: this.baseSeed,
      length: this.length,
      round: this.round.snapshot(),
    };
  }

  /** Reconstruct a Hanchan from a snapshot (without calling the constructor). */
  static restore(s: HanchanSnapshot): Hanchan {
    const h = Object.create(Hanchan.prototype) as Hanchan;
    h.points = s.points;
    h.dealer = s.dealer;
    h.roundWind = s.roundWind;
    h.kyokuNum = s.kyokuNum;
    h.honba = s.honba;
    h.riichiSticks = s.riichiSticks;
    h.finished = s.finished;
    h.handIndex = s.handIndex;
    h.baseSeed = s.baseSeed;
    h.length = s.length;
    h.round = Round.restore(s.round);
    return h;
  }
}

export interface HanchanSnapshot {
  points: number[];
  dealer: number;
  roundWind: number;
  kyokuNum: number;
  honba: number;
  riichiSticks: number;
  finished: boolean;
  handIndex: number;
  baseSeed: string;
  length: HanchanLength;
  round: RoundSnapshot;
}
