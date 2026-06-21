/**
 * Mekanik satu ronde Riichi (state machine giliran) di atas engine.
 *
 * Cakupan MVP: deal dari seed, draw/discard, riichi, tsumo, ron, exhaustive draw
 * (ryuukyoku), skor & transfer poin, perhitungan ranking akhir.
 * TODO (lanjutan): call pon/chi/kan, furiten, ippatsu/ura, multi-ronde hanchan.
 */
import { Tile, toCounts } from "../engine/tiles";
import { shuffledWall } from "../engine/wall";
import { dealFromWall, doraFromIndicator } from "../engine/deal";
import { Meld } from "../engine/agari";
import { scoreHand, ScoreResult } from "../engine/score";
import { WinContext } from "../engine/yaku";

export const START_POINTS = 25000;
export const SEATS = 4;
const EAST = 27; // kind angin Timur

export type Phase = "playing" | "ended";

export interface RoundOutcome {
  type: "tsumo" | "ron" | "draw";
  winner?: number; // seat
  loser?: number; // seat pembuang (ron)
  score?: ScoreResult;
  /** poin tiap seat setelah ronde */
  points: number[];
}

export interface PublicState {
  phase: Phase;
  dealer: number;
  roundWind: number;
  turn: number;
  doraIndicators: number[];
  wallRemaining: number;
  discards: number[][]; // kind buangan per seat
  riichi: boolean[];
  points: number[];
  lastDiscard: { seat: number; kind: number } | null;
}

export class Round {
  phase: Phase = "playing";
  readonly dealer: number;
  readonly roundWind: number;
  private hands: Tile[][];
  private liveWall: Tile[];
  private melds: Meld[][] = [[], [], [], []];
  discards: number[][] = [[], [], [], []];
  doraIndicators: number[] = [];
  riichi: boolean[] = [false, false, false, false];
  points: number[];
  turn: number;
  private lastDiscard: { seat: number; kind: number } | null = null;
  private justDrew = false;

  constructor(seed: string, dealer = 0, roundWind = EAST, points?: number[]) {
    this.dealer = dealer;
    this.roundWind = roundWind;
    this.points = points ?? new Array(SEATS).fill(START_POINTS);

    const wall = shuffledWall(seed);
    const dealt = dealFromWall(wall);
    this.hands = dealt.hands;
    this.liveWall = dealt.liveWall;
    this.doraIndicators = [dealt.doraIndicator.kind];

    // dealer mengambil ubin pertama
    this.turn = dealer;
    this.drawForCurrent();
  }

  /** Seat wind untuk sebuah seat (relatif dealer). */
  seatWind(seat: number): number {
    return EAST + ((seat - this.dealer + SEATS) % SEATS);
  }

  /** Tangan privat seorang pemain (hanya untuk dikirim ke pemilik). */
  handOf(seat: number): Tile[] {
    return this.hands[seat].slice();
  }

  private drawForCurrent(): Tile | null {
    if (this.liveWall.length === 0) return null;
    const tile = this.liveWall.shift()!;
    this.hands[this.turn].push(tile);
    this.justDrew = true;
    return tile;
  }

  /** Apakah seat saat ini bisa tsumo? */
  canTsumo(): boolean {
    if (!this.justDrew) return false;
    return this.score(this.turn, true, this.lastWinTile(this.turn)).agari;
  }

  private lastWinTile(seat: number): number {
    return this.hands[seat][this.hands[seat].length - 1].kind;
  }

  private isMenzen(seat: number): boolean {
    return this.melds[seat].every((m) => !m.open);
  }

  private score(seat: number, isTsumo: boolean, winningTile: number): ScoreResult {
    const counts = toCounts(this.hands[seat]);
    const ctx: WinContext = {
      seatWind: this.seatWind(seat),
      roundWind: this.roundWind,
      winningTile,
      isTsumo,
      isMenzen: this.isMenzen(seat),
      riichi: this.riichi[seat],
    };
    return scoreHand({
      counts,
      openMelds: this.melds[seat],
      ctx,
      doraIndicators: this.doraIndicators,
      aka: 0,
      isDealer: seat === this.dealer,
    });
  }

  /** Deklarasi tsumo oleh seat saat ini. */
  declareTsumo(): RoundOutcome {
    this.ensurePlaying();
    const seat = this.turn;
    const result = this.score(seat, true, this.lastWinTile(seat));
    if (!result.agari) throw new Error("bukan tangan menang (tsumo)");

    // transfer poin tsumo
    const p = result.payments!;
    if (result.payments && "tsumo" in p && p.tsumo) {
      const t = p.tsumo as { fromDealer?: number; fromEach: number };
      for (let s = 0; s < SEATS; s++) {
        if (s === seat) continue;
        const pay = s === this.dealer && t.fromDealer !== undefined ? t.fromDealer : t.fromEach;
        this.points[s] -= pay;
        this.points[seat] += pay;
      }
    }
    this.phase = "ended";
    return { type: "tsumo", winner: seat, score: result, points: this.points.slice() };
  }

  /** Deklarasi ron oleh `seat` atas buangan terakhir. */
  declareRon(seat: number): RoundOutcome {
    this.ensurePlaying();
    if (!this.lastDiscard) throw new Error("tidak ada buangan untuk di-ron");
    const winTile = this.lastDiscard.kind;
    // tambahkan ubin buangan ke tangan untuk dinilai
    this.hands[seat].push({ id: -1, kind: winTile });
    const result = this.score(seat, false, winTile);
    if (!result.agari) {
      this.hands[seat].pop();
      throw new Error("bukan tangan menang (ron)");
    }
    const loser = this.lastDiscard.seat;
    const pay = result.payments!.ron!;
    this.points[loser] -= pay;
    this.points[seat] += pay;
    this.phase = "ended";
    return { type: "ron", winner: seat, loser, score: result, points: this.points.slice() };
  }

  /** Deklarasi riichi lalu buang ubin. Hanya bila menzen, poin >= 1000. */
  declareRiichi(seat: number, tileId: number): void {
    if (!this.isMenzen(seat)) throw new Error("riichi hanya untuk tangan tertutup");
    if (this.points[seat] < 1000) throw new Error("poin tak cukup untuk riichi");
    this.riichi[seat] = true;
    this.points[seat] -= 1000;
    this.discard(seat, tileId);
  }

  /** Buang ubin (akhiri giliran), lalu majukan ke pemain berikutnya yang menarik. */
  discard(seat: number, tileId: number): RoundOutcome | null {
    this.ensurePlaying();
    if (seat !== this.turn) throw new Error("bukan giliran seat ini");
    const hand = this.hands[seat];
    const idx = tileId >= 0 ? hand.findIndex((t) => t.id === tileId) : hand.length - 1;
    if (idx === -1) throw new Error("ubin tidak ada di tangan");
    const [tile] = hand.splice(idx, 1);
    this.discards[seat].push(tile.kind);
    this.lastDiscard = { seat, kind: tile.kind };
    this.justDrew = false;

    // majukan giliran
    this.turn = (this.turn + 1) % SEATS;
    const drawn = this.drawForCurrent();
    if (drawn === null) {
      return this.exhaustiveDraw();
    }
    return null;
  }

  /** Ryuukyoku: bayar tenpai (disederhanakan: tanpa transfer noten untuk MVP). */
  private exhaustiveDraw(): RoundOutcome {
    this.phase = "ended";
    return { type: "draw", points: this.points.slice() };
  }

  /** Ranking akhir: urut poin desc, seri dipecah oleh kedekatan ke dealer (seat kecil). */
  ranking(): number[] {
    const seats = [0, 1, 2, 3];
    seats.sort((a, b) => {
      if (this.points[b] !== this.points[a]) return this.points[b] - this.points[a];
      // seri: lebih dekat dealer (urutan giliran) menang
      const da = (a - this.dealer + SEATS) % SEATS;
      const db = (b - this.dealer + SEATS) % SEATS;
      return da - db;
    });
    return seats; // seats[0] = juara 1
  }

  publicState(): PublicState {
    return {
      phase: this.phase,
      dealer: this.dealer,
      roundWind: this.roundWind,
      turn: this.turn,
      doraIndicators: this.doraIndicators.slice(),
      wallRemaining: this.liveWall.length,
      discards: this.discards.map((d) => d.slice()),
      riichi: this.riichi.slice(),
      points: this.points.slice(),
      lastDiscard: this.lastDiscard ? { ...this.lastDiscard } : null,
    };
  }

  private ensurePlaying() {
    if (this.phase !== "playing") throw new Error("ronde sudah berakhir");
  }
}
