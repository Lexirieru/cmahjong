/**
 * Mechanics of a single Riichi round (turn state machine) on top of the engine.
 *
 * Supports: dealing from a seed, draw/discard, the CALL phase with PRIORITY
 * (ron > pon/kan > chi) via collecting player responses, ankan & shouminkan
 * (+ rinshan/kan-dora), riichi + double riichi, IPPATSU, FURITEN (permanent,
 * temporary, & riichi-furiten), tsumo, ron, exhaustive draw + noten payment.
 * TODO: chankan (rob the kan), multi-ron, uradora.
 */
import { Tile, toCounts } from "../engine/tiles";
import { shuffledWall } from "../engine/wall";
import { dealFromWall } from "../engine/deal";
import { Meld, tenpaiWaits } from "../engine/agari";
import { scoreHand, ScoreResult } from "../engine/score";
import { WinContext } from "../engine/yaku";

export const START_POINTS = 25000;
export const SEATS = 4;
const EAST = 27;

export type Phase = "playing" | "awaitingCalls" | "ended";
export type CallType = "pon" | "chi" | "kan" | "ron";
export type ClaimType = CallType | "pass";

export interface Call {
  seat: number;
  type: CallType;
  chiOptions?: number[];
}

export interface CallClaim {
  type: ClaimType;
  /** for chi: the lowest kind of the chosen sequence */
  low?: number;
}

export interface CallResolution {
  resolved: boolean;
  /** the action that won priority (when resolved) */
  action?: ClaimType;
  /** the round outcome if the resolution ends the round (ron / draw) */
  outcome?: RoundOutcome | null;
}

export interface RoundOutcome {
  type: "tsumo" | "ron" | "draw";
  winner?: number; // primary winner (head-bump for multiple ron)
  winners?: number[]; // all winners (multi-ron)
  loser?: number;
  score?: ScoreResult; // score of the primary winner
  scores?: ScoreResult[]; // score of each winner (multi-ron, aligned with winners)
  points: number[];
  tenpai?: boolean[];
}

export interface PublicState {
  phase: Phase;
  dealer: number;
  roundWind: number;
  turn: number;
  doraIndicators: number[];
  wallRemaining: number;
  discards: number[][];
  melds: { type: string; kind: number; open: boolean }[][];
  riichi: boolean[];
  furiten: boolean[];
  points: number[];
  lastDiscard: { seat: number; kind: number } | null;
  availableCalls: Call[];
}

export class Round {
  phase: Phase = "playing";
  readonly dealer: number;
  readonly roundWind: number;
  private hands: Tile[][];
  private liveWall: Tile[];
  private deadWall: Tile[];
  private kansDone = 0;
  melds: Meld[][] = [[], [], [], []];
  discards: number[][] = [[], [], [], []];
  doraIndicators: number[] = [];
  private uraIndicators: number[] = []; // revealed only on a riichi win (not in publicState)
  private chankan: { seat: number; kind: number } | null = null;
  riichi: boolean[] = [false, false, false, false];
  private riichiDouble: boolean[] = [false, false, false, false];
  private ippatsu: boolean[] = [false, false, false, false];
  private furitenPerm: boolean[] = [false, false, false, false];
  private furitenTemp: boolean[] = [false, false, false, false];
  private anyCall = false;
  points: number[];
  turn: number;
  private lastDiscard: { seat: number; kind: number } | null = null;
  private awaitingDiscard = false;
  private drewFromWall = false;
  private rinshanPending = false;
  private pendingCalls: Call[] = [];
  private responses = new Map<number, CallClaim>();

  constructor(
    seed: string,
    dealer = 0,
    roundWind = EAST,
    points?: number[],
    inject?: {
      hands: Tile[][];
      liveWall: Tile[];
      deadWall?: Tile[];
      doraIndicator?: number;
      uraIndicator?: number;
      turn?: number;
      skipInitialDraw?: boolean;
    },
  ) {
    this.dealer = dealer;
    this.roundWind = roundWind;
    this.points = points ?? new Array(SEATS).fill(START_POINTS);

    if (inject) {
      this.hands = inject.hands;
      this.liveWall = inject.liveWall;
      this.deadWall = inject.deadWall ?? [];
      this.doraIndicators = [inject.doraIndicator ?? 0];
      this.uraIndicators = [inject.uraIndicator ?? this.deadWall[1]?.kind ?? 1];
      this.turn = inject.turn ?? dealer;
      if (inject.skipInitialDraw) {
        this.awaitingDiscard = true;
        this.drewFromWall = true;
      } else {
        this.drawForCurrent();
      }
      return;
    }

    const wall = shuffledWall(seed);
    const dealt = dealFromWall(wall);
    this.hands = dealt.hands;
    this.liveWall = dealt.liveWall;
    this.deadWall = dealt.deadWall;
    // dead wall layout: dora indicator at even indices, ura at odd indices (interleaved)
    this.doraIndicators = [this.deadWall[0].kind];
    this.uraIndicators = [this.deadWall[1].kind];

    this.turn = dealer;
    this.drawForCurrent();
  }

  seatWind(seat: number): number {
    return EAST + ((seat - this.dealer + SEATS) % SEATS);
  }

  handOf(seat: number): Tile[] {
    return this.hands[seat].slice();
  }

  private isMenzen(seat: number): boolean {
    return this.melds[seat].every((m) => !m.open);
  }

  /** Furiten: ron is not allowed. Permanent / temporary / a wait sits in one's own discards. */
  isFuriten(seat: number): boolean {
    if (this.furitenPerm[seat] || this.furitenTemp[seat]) return true;
    const w = tenpaiWaits(toCounts(this.hands[seat]), this.melds[seat]);
    return w.some((k) => this.discards[seat].includes(k));
  }

  private drawForCurrent(rinshan = false): Tile | null {
    let tile: Tile | undefined;
    if (rinshan) {
      // rinshan is drawn from the back of the dead wall; new dora/ura indicators from the front
      tile = this.deadWall[this.deadWall.length - 1 - this.kansDone];
      this.kansDone++;
      const dIdx = 2 * this.kansDone;
      if (this.deadWall[dIdx]) this.doraIndicators.push(this.deadWall[dIdx].kind);
      if (this.deadWall[dIdx + 1]) this.uraIndicators.push(this.deadWall[dIdx + 1].kind);
    } else {
      if (this.liveWall.length === 0) return null;
      tile = this.liveWall.shift();
    }
    if (!tile) return null;
    this.hands[this.turn].push(tile);
    this.awaitingDiscard = true;
    this.drewFromWall = true;
    this.rinshanPending = rinshan;
    this.furitenTemp[this.turn] = false; // a new turn clears temporary furiten
    return tile;
  }

  // ---------------------------------------------------------------- scoring
  private buildScore(
    seat: number,
    isTsumo: boolean,
    winningTile: number,
    opts?: { chankan?: boolean },
  ): ScoreResult {
    const counts = toCounts(this.hands[seat]);
    const ctx: WinContext = {
      seatWind: this.seatWind(seat),
      roundWind: this.roundWind,
      winningTile,
      isTsumo,
      isMenzen: this.isMenzen(seat),
      riichi: this.riichi[seat],
      doubleRiichi: this.riichiDouble[seat],
      ippatsu: this.ippatsu[seat],
      rinshan: isTsumo && this.rinshanPending,
      chankan: opts?.chankan,
      haitei: isTsumo && this.liveWall.length === 0,
      houtei: !isTsumo && this.liveWall.length === 0,
    };
    return scoreHand({
      counts,
      openMelds: this.melds[seat],
      ctx,
      doraIndicators: this.doraIndicators,
      uraIndicators: this.uraIndicators, // only counted if riichi (in score.ts)
      aka: 0,
      isDealer: seat === this.dealer,
    });
  }

  canTsumo(): boolean {
    if (!this.drewFromWall || this.phase !== "playing") return false;
    const seat = this.turn;
    const winTile = this.hands[seat][this.hands[seat].length - 1].kind;
    return this.buildScore(seat, true, winTile).agari;
  }

  // ---------------------------------------------------------------- on-turn actions
  declareTsumo(): RoundOutcome {
    this.ensure("playing");
    const seat = this.turn;
    const winTile = this.hands[seat][this.hands[seat].length - 1].kind;
    const result = this.buildScore(seat, true, winTile);
    if (!result.agari) throw new Error("not a winning hand (tsumo)");

    const p = result.payments!;
    if ("tsumo" in p && p.tsumo) {
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

  declareRiichi(seat: number, tileId: number): void {
    if (seat !== this.turn || !this.awaitingDiscard) throw new Error("not this seat's turn");
    if (!this.isMenzen(seat)) throw new Error("riichi is only for a closed hand");
    if (this.points[seat] < 1000) throw new Error("not enough points for riichi");
    const hand = this.hands[seat];
    const idx = tileId >= 0 ? hand.findIndex((t) => t.id === tileId) : hand.length - 1;
    if (idx === -1) throw new Error("tile is not in hand");
    const after = toCounts(hand.filter((_, i) => i !== idx));
    if (tenpaiWaits(after, this.melds[seat]).length === 0) throw new Error("riichi must be tenpai");

    // double riichi: declared on the first discard, with no prior call
    const isDouble = !this.anyCall && this.discards[seat].length === 0;
    this.riichi[seat] = true;
    this.riichiDouble[seat] = isDouble;
    this.points[seat] -= 1000;
    this.discard(seat, tileId);
    this.ippatsu[seat] = true; // the ippatsu window opens after discarding
  }

  discard(seat: number, tileId: number): RoundOutcome | null {
    this.ensure("playing");
    if (seat !== this.turn || !this.awaitingDiscard) throw new Error("not this seat's turn");
    this.ippatsu[seat] = false; // the next discard closes the ippatsu window
    const hand = this.hands[seat];
    const idx = tileId >= 0 ? hand.findIndex((t) => t.id === tileId) : hand.length - 1;
    if (idx === -1) throw new Error("tile is not in hand");
    const [tile] = hand.splice(idx, 1);
    this.discards[seat].push(tile.kind);
    this.lastDiscard = { seat, kind: tile.kind };
    this.awaitingDiscard = false;
    this.drewFromWall = false;
    this.rinshanPending = false;

    this.pendingCalls = this.computeCalls();
    this.responses.clear();
    if (this.pendingCalls.length > 0) {
      this.phase = "awaitingCalls";
      return null;
    }
    return this.advance();
  }

  ankan(seat: number, kind: number): RoundOutcome | null {
    this.ensure("playing");
    if (seat !== this.turn || !this.awaitingDiscard) throw new Error("not this seat's turn");
    if (toCounts(this.hands[seat])[kind] < 4) throw new Error("do not have 4 tiles for ankan");
    this.clearIppatsu();
    this.removeFromHand(seat, kind, 4);
    this.melds[seat].push({ type: "kan", kind, open: false });
    const drawn = this.drawForCurrent(true);
    if (drawn === null) return this.exhaustiveDraw();
    return null;
  }

  /** Shouminkan (add to a pon). Can be robbed (chankan) by anyone waiting on that tile. */
  addedKan(seat: number, kind: number): RoundOutcome | null {
    this.ensure("playing");
    if (seat !== this.turn || !this.awaitingDiscard) throw new Error("not this seat's turn");
    const meld = this.melds[seat].find((m) => m.type === "triplet" && m.kind === kind && m.open);
    if (!meld) throw new Error("no pon to add to");
    if (toCounts(this.hands[seat])[kind] < 1) throw new Error("do not have the 4th tile");

    // offer chankan (rob the kan) before the kan completes
    const robbers = this.computeChankanRobbers(seat, kind);
    if (robbers.length) {
      this.chankan = { seat, kind };
      this.pendingCalls = robbers.map((s) => ({ seat: s, type: "ron" as const }));
      this.responses.clear();
      this.phase = "awaitingCalls";
      return null;
    }
    return this.completeAddedKan(seat, kind);
  }

  private completeAddedKan(seat: number, kind: number): RoundOutcome | null {
    this.clearIppatsu();
    const meld = this.melds[seat].find((m) => m.type === "triplet" && m.kind === kind && m.open)!;
    this.removeFromHand(seat, kind, 1);
    meld.type = "kan";
    this.phase = "playing";
    this.pendingCalls = [];
    this.turn = seat;
    const drawn = this.drawForCurrent(true);
    if (drawn === null) return this.exhaustiveDraw();
    return null;
  }

  /** Waiters who can rob a shouminkan (tenpai, not furiten, has a yaku). */
  private computeChankanRobbers(kanSeat: number, kind: number): number[] {
    const out: number[] = [];
    for (let seat = 0; seat < SEATS; seat++) {
      if (seat === kanSeat || this.isFuriten(seat)) continue;
      const temp = toCounts(this.hands[seat]);
      temp[kind]++;
      const ctx: WinContext = {
        seatWind: this.seatWind(seat),
        roundWind: this.roundWind,
        winningTile: kind,
        isTsumo: false,
        isMenzen: this.isMenzen(seat),
        riichi: this.riichi[seat],
        doubleRiichi: this.riichiDouble[seat],
        ippatsu: this.ippatsu[seat],
        chankan: true,
      };
      if (
        scoreHand({
          counts: temp,
          openMelds: this.melds[seat],
          ctx,
          doraIndicators: this.doraIndicators,
          uraIndicators: this.uraIndicators,
          isDealer: seat === this.dealer,
        }).agari
      ) {
        out.push(seat);
      }
    }
    return out;
  }

  private advance(): RoundOutcome | null {
    this.turn = (this.turn + 1) % SEATS;
    const drawn = this.drawForCurrent();
    if (drawn === null) return this.exhaustiveDraw();
    return null;
  }

  // ---------------------------------------------------------------- calls
  private computeCalls(): Call[] {
    const calls: Call[] = [];
    if (!this.lastDiscard) return calls;
    const d = this.lastDiscard.kind;
    const from = this.lastDiscard.seat;

    for (let seat = 0; seat < SEATS; seat++) {
      if (seat === from) continue;
      const counts = toCounts(this.hands[seat]);

      // ron (except furiten)
      if (!this.isFuriten(seat)) {
        const temp = counts.slice();
        temp[d]++;
        const probe: WinContext = {
          seatWind: this.seatWind(seat),
          roundWind: this.roundWind,
          winningTile: d,
          isTsumo: false,
          isMenzen: this.isMenzen(seat),
          riichi: this.riichi[seat],
          doubleRiichi: this.riichiDouble[seat],
          ippatsu: this.ippatsu[seat],
          houtei: this.liveWall.length === 0,
        };
        if (
          scoreHand({
            counts: temp,
            openMelds: this.melds[seat],
            ctx: probe,
            doraIndicators: this.doraIndicators,
            isDealer: seat === this.dealer,
          }).agari
        ) {
          calls.push({ seat, type: "ron" });
        }
      }

      if (this.riichi[seat]) continue; // after riichi, only ron is allowed

      if (counts[d] >= 2) calls.push({ seat, type: "pon" });
      if (counts[d] >= 3) calls.push({ seat, type: "kan" });
      if (seat === (from + 1) % SEATS && d < 27) {
        const opts = this.chiOptions(counts, d);
        if (opts.length) calls.push({ seat, type: "chi", chiOptions: opts });
      }
    }
    return calls;
  }

  private chiOptions(counts: number[], d: number): number[] {
    const r = d % 9;
    const lows: number[] = [];
    if (r >= 2 && counts[d - 2] > 0 && counts[d - 1] > 0) lows.push(d - 2);
    if (r >= 1 && r <= 7 && counts[d - 1] > 0 && counts[d + 1] > 0) lows.push(d - 1);
    if (r <= 6 && counts[d + 1] > 0 && counts[d + 2] > 0) lows.push(d);
    return lows;
  }

  availableCalls(): Call[] {
    return this.pendingCalls.slice();
  }

  private eligibleSeats(): number[] {
    return [...new Set(this.pendingCalls.map((c) => c.seat))];
  }

  /**
   * Record a player's response during the call phase. Once all eligible players
   * have responded, priority resolution runs automatically.
   */
  respond(seat: number, claim: CallClaim): CallResolution {
    this.ensure("awaitingCalls");
    const eligible = this.eligibleSeats();
    if (!eligible.includes(seat)) {
      if (claim.type === "pass") return { resolved: false };
      throw new Error("this seat has no available call");
    }
    if (claim.type !== "pass" && !this.pendingCalls.some((c) => c.seat === seat && c.type === claim.type)) {
      throw new Error(`call ${claim.type} is not available for this seat`);
    }
    this.responses.set(seat, claim);

    if (eligible.every((s) => this.responses.has(s))) return this.resolveCalls();
    return { resolved: false };
  }

  /** Force resolution (e.g. timeout): seats without a response are treated as pass. */
  resolveCalls(): CallResolution {
    this.ensure("awaitingCalls");
    const claimOf = (s: number): ClaimType =>
      (this.responses.get(s)?.type ?? "pass") as ClaimType;

    // temporary furiten for those who could ron but did not
    for (const c of this.pendingCalls) {
      if (c.type === "ron" && claimOf(c.seat) !== "ron") {
        this.furitenTemp[c.seat] = true;
        if (this.riichi[c.seat]) this.furitenPerm[c.seat] = true; // riichi-furiten is permanent
      }
    }

    // chankan (rob the kan): only ron is possible
    if (this.chankan) return this.resolveChankan(claimOf);

    const from = this.lastDiscard!.seat;
    const order = (s: number) => (s - from + SEATS) % SEATS; // proximity in turn order

    // priority: ron (can be multiple) > pon/kan > chi
    const rons = this.pendingCalls
      .filter((c) => c.type === "ron" && claimOf(c.seat) === "ron")
      .map((c) => c.seat)
      .sort((a, b) => order(a) - order(b));
    if (rons.length) {
      const outcome = this.applyRons(rons, this.lastDiscard!.kind, from);
      return { resolved: true, action: "ron", outcome };
    }

    const ponKan = this.pendingCalls
      .filter((c) => (c.type === "pon" || c.type === "kan") && claimOf(c.seat) === c.type)
      .sort((a, b) => order(a.seat) - order(b.seat));
    if (ponKan.length) {
      const c = ponKan[0];
      if (c.type === "kan") return { resolved: true, action: "kan", outcome: this.applyKan(c.seat) };
      this.applyPon(c.seat);
      return { resolved: true, action: "pon", outcome: null };
    }

    const chi = this.pendingCalls.find((c) => c.type === "chi" && claimOf(c.seat) === "chi");
    if (chi) {
      const low = this.responses.get(chi.seat)!.low ?? chi.chiOptions![0];
      this.applyChi(chi.seat, low);
      return { resolved: true, action: "chi", outcome: null };
    }

    // all pass
    this.phase = "playing";
    this.pendingCalls = [];
    this.responses.clear();
    return { resolved: true, action: "pass", outcome: this.advance() };
  }

  private resolveChankan(claimOf: (s: number) => ClaimType): CallResolution {
    const { seat: kanSeat, kind } = this.chankan!;
    const robbers = this.pendingCalls
      .filter((c) => claimOf(c.seat) === "ron")
      .map((c) => c.seat)
      .sort((a, b) => ((a - kanSeat + SEATS) % SEATS) - ((b - kanSeat + SEATS) % SEATS));
    if (robbers.length) {
      this.chankan = null;
      const outcome = this.applyRons(robbers, kind, kanSeat, { chankan: true });
      return { resolved: true, action: "ron", outcome };
    }
    // nobody robs -> complete the kan
    this.chankan = null;
    this.responses.clear();
    const outcome = this.completeAddedKan(kanSeat, kind);
    return { resolved: true, action: "pass", outcome };
  }

  private clearIppatsu(): void {
    this.ippatsu = [false, false, false, false];
    this.anyCall = true;
  }

  /** Apply one or more ron (multi-ron). Primary winner = closest to the discarder. */
  private applyRons(
    seats: number[],
    winTile: number,
    loser: number,
    opts?: { chankan?: boolean },
  ): RoundOutcome {
    const scores: ScoreResult[] = [];
    for (const seat of seats) {
      this.hands[seat].push({ id: -1, kind: winTile });
      const result = this.buildScore(seat, false, winTile, opts);
      if (!result.agari) {
        this.hands[seat].pop();
        throw new Error("not a winning hand (ron)");
      }
      const pay = result.payments!.ron!;
      this.points[loser] -= pay;
      this.points[seat] += pay;
      scores.push(result);
    }
    this.phase = "ended";
    return {
      type: "ron",
      winner: seats[0],
      winners: seats,
      loser,
      score: scores[0],
      scores,
      points: this.points.slice(),
    };
  }

  private takeDiscardForMeld(): number {
    const kind = this.lastDiscard!.kind;
    const from = this.lastDiscard!.seat;
    this.discards[from].pop();
    this.lastDiscard = null;
    return kind;
  }

  private applyPon(seat: number): void {
    this.clearIppatsu();
    const kind = this.takeDiscardForMeld();
    this.removeFromHand(seat, kind, 2);
    this.melds[seat].push({ type: "triplet", kind, open: true });
    this.beginCalledTurn(seat);
  }

  private applyChi(seat: number, low: number): void {
    this.clearIppatsu();
    const kind = this.takeDiscardForMeld();
    for (let k = low; k < low + 3; k++) {
      if (k !== kind) this.removeFromHand(seat, k, 1);
    }
    this.melds[seat].push({ type: "sequence", kind: low, open: true });
    this.beginCalledTurn(seat);
  }

  private applyKan(seat: number): RoundOutcome | null {
    this.clearIppatsu();
    const kind = this.takeDiscardForMeld();
    this.removeFromHand(seat, kind, 3);
    this.melds[seat].push({ type: "kan", kind, open: true });
    this.phase = "playing";
    this.pendingCalls = [];
    this.responses.clear();
    this.turn = seat;
    const drawn = this.drawForCurrent(true);
    if (drawn === null) return this.exhaustiveDraw();
    return null;
  }

  private beginCalledTurn(seat: number): void {
    this.phase = "playing";
    this.pendingCalls = [];
    this.responses.clear();
    this.turn = seat;
    this.awaitingDiscard = true;
    this.drewFromWall = false;
  }

  private removeFromHand(seat: number, kind: number, n: number): void {
    const hand = this.hands[seat];
    let removed = 0;
    for (let i = hand.length - 1; i >= 0 && removed < n; i--) {
      if (hand[i].kind === kind) {
        hand.splice(i, 1);
        removed++;
      }
    }
    if (removed < n) throw new Error("not enough tiles in hand");
  }

  private exhaustiveDraw(): RoundOutcome {
    this.phase = "ended";
    const tenpai = [0, 1, 2, 3].map(
      (s) => tenpaiWaits(toCounts(this.hands[s]), this.melds[s]).length > 0,
    );
    const t = tenpai.filter(Boolean).length;
    if (t !== 0 && t !== 4) {
      const noten = SEATS - t;
      const perTenpai = 3000 / t;
      const perNoten = 3000 / noten;
      for (let s = 0; s < SEATS; s++) this.points[s] += tenpai[s] ? perTenpai : -perNoten;
    }
    return { type: "draw", points: this.points.slice(), tenpai };
  }

  ranking(): number[] {
    const seats = [0, 1, 2, 3];
    seats.sort((a, b) => {
      if (this.points[b] !== this.points[a]) return this.points[b] - this.points[a];
      const da = (a - this.dealer + SEATS) % SEATS;
      const db = (b - this.dealer + SEATS) % SEATS;
      return da - db;
    });
    return seats;
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
      melds: this.melds.map((ms) => ms.map((m) => ({ type: m.type, kind: m.kind, open: !!m.open }))),
      riichi: this.riichi.slice(),
      furiten: [0, 1, 2, 3].map((s) => this.isFuriten(s)),
      points: this.points.slice(),
      lastDiscard: this.lastDiscard ? { ...this.lastDiscard } : null,
      availableCalls: this.pendingCalls.slice(),
    };
  }

  private ensure(phase: Phase) {
    if (this.phase !== phase) throw new Error(`invalid action in phase ${this.phase}`);
  }

  // ---------------------------------------------------------------- persist
  /** Serialize the entire round state (JSON-safe) to be saved to the DB. */
  snapshot(): RoundSnapshot {
    return {
      dealer: this.dealer,
      roundWind: this.roundWind,
      phase: this.phase,
      hands: this.hands,
      liveWall: this.liveWall,
      deadWall: this.deadWall,
      kansDone: this.kansDone,
      melds: this.melds,
      discards: this.discards,
      doraIndicators: this.doraIndicators,
      uraIndicators: this.uraIndicators,
      chankan: this.chankan,
      riichi: this.riichi,
      riichiDouble: this.riichiDouble,
      ippatsu: this.ippatsu,
      furitenPerm: this.furitenPerm,
      furitenTemp: this.furitenTemp,
      anyCall: this.anyCall,
      points: this.points,
      turn: this.turn,
      lastDiscard: this.lastDiscard,
      awaitingDiscard: this.awaitingDiscard,
      drewFromWall: this.drewFromWall,
      rinshanPending: this.rinshanPending,
      pendingCalls: this.pendingCalls,
      responses: [...this.responses.entries()],
    };
  }

  /** Reconstruct a Round from a snapshot. */
  static restore(s: RoundSnapshot): Round {
    const r = new Round("0x" + "00".repeat(32), s.dealer, s.roundWind, s.points.slice(), {
      hands: s.hands,
      liveWall: s.liveWall,
      deadWall: s.deadWall,
      turn: s.turn,
      skipInitialDraw: true,
    });
    r.phase = s.phase;
    r.kansDone = s.kansDone;
    r.melds = s.melds;
    r.discards = s.discards;
    r.doraIndicators = s.doraIndicators;
    r.uraIndicators = s.uraIndicators;
    r.chankan = s.chankan;
    r.riichi = s.riichi;
    r.riichiDouble = s.riichiDouble;
    r.ippatsu = s.ippatsu;
    r.furitenPerm = s.furitenPerm;
    r.furitenTemp = s.furitenTemp;
    r.anyCall = s.anyCall;
    r.points = s.points;
    r.lastDiscard = s.lastDiscard;
    r.awaitingDiscard = s.awaitingDiscard;
    r.drewFromWall = s.drewFromWall;
    r.rinshanPending = s.rinshanPending;
    r.pendingCalls = s.pendingCalls;
    r.responses = new Map(s.responses);
    return r;
  }
}

export interface RoundSnapshot {
  dealer: number;
  roundWind: number;
  phase: Phase;
  hands: Tile[][];
  liveWall: Tile[];
  deadWall: Tile[];
  kansDone: number;
  melds: Meld[][];
  discards: number[][];
  doraIndicators: number[];
  uraIndicators: number[];
  chankan: { seat: number; kind: number } | null;
  riichi: boolean[];
  riichiDouble: boolean[];
  ippatsu: boolean[];
  furitenPerm: boolean[];
  furitenTemp: boolean[];
  anyCall: boolean;
  points: number[];
  turn: number;
  lastDiscard: { seat: number; kind: number } | null;
  awaitingDiscard: boolean;
  drewFromWall: boolean;
  rinshanPending: boolean;
  pendingCalls: Call[];
  responses: [number, CallClaim][];
}
