/**
 * Mekanik satu ronde Riichi (state machine giliran) di atas engine.
 *
 * Mendukung: deal dari seed, draw/discard, fase CALL dengan PRIORITAS
 * (ron > pon/kan > chi) via pengumpulan respons pemain, ankan & shouminkan
 * (+ rinshan/kan-dora), riichi + double riichi, IPPATSU, FURITEN (permanen,
 * sementara, & riichi-furiten), tsumo, ron, exhaustive draw + noten payment.
 * TODO: chankan (rob kan), multi-ron, uradora.
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
  /** untuk chi: kind terendah dari urutan yang dipilih */
  low?: number;
}

export interface CallResolution {
  resolved: boolean;
  /** aksi yang menang prioritas (saat resolved) */
  action?: ClaimType;
  /** outcome ronde bila resolusi mengakhiri ronde (ron / draw) */
  outcome?: RoundOutcome | null;
}

export interface RoundOutcome {
  type: "tsumo" | "ron" | "draw";
  winner?: number;
  loser?: number;
  score?: ScoreResult;
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
  private kanCount = 0;
  melds: Meld[][] = [[], [], [], []];
  discards: number[][] = [[], [], [], []];
  doraIndicators: number[] = [];
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
    this.doraIndicators = [dealt.doraIndicator.kind];

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

  /** Furiten: tak boleh ron. Permanen / sementara / tunggu ada di buangan sendiri. */
  isFuriten(seat: number): boolean {
    if (this.furitenPerm[seat] || this.furitenTemp[seat]) return true;
    const w = tenpaiWaits(toCounts(this.hands[seat]), this.melds[seat]);
    return w.some((k) => this.discards[seat].includes(k));
  }

  private drawForCurrent(rinshan = false): Tile | null {
    let tile: Tile | undefined;
    if (rinshan) {
      tile = this.deadWall[this.kanCount];
      this.kanCount++;
      const di = this.deadWall[this.kanCount];
      if (di) this.doraIndicators.push(di.kind);
    } else {
      if (this.liveWall.length === 0) return null;
      tile = this.liveWall.shift();
    }
    if (!tile) return null;
    this.hands[this.turn].push(tile);
    this.awaitingDiscard = true;
    this.drewFromWall = true;
    this.rinshanPending = rinshan;
    this.furitenTemp[this.turn] = false; // giliran baru menghapus furiten sementara
    return tile;
  }

  // ---------------------------------------------------------------- scoring
  private buildScore(seat: number, isTsumo: boolean, winningTile: number): ScoreResult {
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
      haitei: isTsumo && this.liveWall.length === 0,
      houtei: !isTsumo && this.liveWall.length === 0,
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
    if (!result.agari) throw new Error("bukan tangan menang (tsumo)");

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
    if (seat !== this.turn || !this.awaitingDiscard) throw new Error("bukan giliran seat ini");
    if (!this.isMenzen(seat)) throw new Error("riichi hanya untuk tangan tertutup");
    if (this.points[seat] < 1000) throw new Error("poin tak cukup untuk riichi");
    const hand = this.hands[seat];
    const idx = tileId >= 0 ? hand.findIndex((t) => t.id === tileId) : hand.length - 1;
    if (idx === -1) throw new Error("ubin tidak ada di tangan");
    const after = toCounts(hand.filter((_, i) => i !== idx));
    if (tenpaiWaits(after, this.melds[seat]).length === 0) throw new Error("riichi harus tenpai");

    // double riichi: deklarasi pada buangan pertama, tanpa call sebelumnya
    const isDouble = !this.anyCall && this.discards[seat].length === 0;
    this.riichi[seat] = true;
    this.riichiDouble[seat] = isDouble;
    this.points[seat] -= 1000;
    this.discard(seat, tileId);
    this.ippatsu[seat] = true; // jendela ippatsu dibuka setelah buang
  }

  discard(seat: number, tileId: number): RoundOutcome | null {
    this.ensure("playing");
    if (seat !== this.turn || !this.awaitingDiscard) throw new Error("bukan giliran seat ini");
    this.ippatsu[seat] = false; // buang berikutnya menutup jendela ippatsu
    const hand = this.hands[seat];
    const idx = tileId >= 0 ? hand.findIndex((t) => t.id === tileId) : hand.length - 1;
    if (idx === -1) throw new Error("ubin tidak ada di tangan");
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
    if (seat !== this.turn || !this.awaitingDiscard) throw new Error("bukan giliran seat ini");
    if (toCounts(this.hands[seat])[kind] < 4) throw new Error("tidak punya 4 ubin untuk ankan");
    this.clearIppatsu();
    this.removeFromHand(seat, kind, 4);
    this.melds[seat].push({ type: "kan", kind, open: false });
    const drawn = this.drawForCurrent(true);
    if (drawn === null) return this.exhaustiveDraw();
    return null;
  }

  addedKan(seat: number, kind: number): RoundOutcome | null {
    this.ensure("playing");
    if (seat !== this.turn || !this.awaitingDiscard) throw new Error("bukan giliran seat ini");
    const meld = this.melds[seat].find((m) => m.type === "triplet" && m.kind === kind && m.open);
    if (!meld) throw new Error("tidak ada pon untuk ditambah");
    if (toCounts(this.hands[seat])[kind] < 1) throw new Error("tidak punya ubin ke-4");
    this.clearIppatsu();
    this.removeFromHand(seat, kind, 1);
    meld.type = "kan";
    const drawn = this.drawForCurrent(true);
    if (drawn === null) return this.exhaustiveDraw();
    return null;
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

      // ron (kecuali furiten)
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

      if (this.riichi[seat]) continue; // setelah riichi hanya boleh ron

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
   * Catat respons seorang pemain pada fase call. Begitu semua pemain yang berhak
   * merespons, resolusi prioritas dijalankan otomatis.
   */
  respond(seat: number, claim: CallClaim): CallResolution {
    this.ensure("awaitingCalls");
    const eligible = this.eligibleSeats();
    if (!eligible.includes(seat)) {
      if (claim.type === "pass") return { resolved: false };
      throw new Error("seat ini tak punya call tersedia");
    }
    if (claim.type !== "pass" && !this.pendingCalls.some((c) => c.seat === seat && c.type === claim.type)) {
      throw new Error(`call ${claim.type} tak tersedia untuk seat ini`);
    }
    this.responses.set(seat, claim);

    if (eligible.every((s) => this.responses.has(s))) return this.resolveCalls();
    return { resolved: false };
  }

  /** Paksa resolusi (mis. timeout): seat tanpa respons dianggap pass. */
  resolveCalls(): CallResolution {
    this.ensure("awaitingCalls");
    const from = this.lastDiscard!.seat;
    const order = (s: number) => (s - from + SEATS) % SEATS; // kedekatan searah giliran

    const claimOf = (s: number): ClaimType =>
      (this.responses.get(s)?.type ?? "pass") as ClaimType;

    // furiten sementara untuk yang bisa ron tapi tidak ron
    for (const c of this.pendingCalls) {
      if (c.type === "ron" && claimOf(c.seat) !== "ron") {
        this.furitenTemp[c.seat] = true;
        if (this.riichi[c.seat]) this.furitenPerm[c.seat] = true; // riichi-furiten permanen
      }
    }

    // prioritas: ron > pon/kan > chi
    const rons = this.pendingCalls
      .filter((c) => c.type === "ron" && claimOf(c.seat) === "ron")
      .map((c) => c.seat)
      .sort((a, b) => order(a) - order(b));
    if (rons.length) {
      const outcome = this.applyRon(rons[0]); // head bump: terdekat dari pembuang
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

    // semua pass
    this.phase = "playing";
    this.pendingCalls = [];
    this.responses.clear();
    return { resolved: true, action: "pass", outcome: this.advance() };
  }

  private clearIppatsu(): void {
    this.ippatsu = [false, false, false, false];
    this.anyCall = true;
  }

  private applyRon(seat: number): RoundOutcome {
    const winTile = this.lastDiscard!.kind;
    this.hands[seat].push({ id: -1, kind: winTile });
    const result = this.buildScore(seat, false, winTile);
    if (!result.agari) {
      this.hands[seat].pop();
      throw new Error("bukan tangan menang (ron)");
    }
    const loser = this.lastDiscard!.seat;
    const pay = result.payments!.ron!;
    this.points[loser] -= pay;
    this.points[seat] += pay;
    this.phase = "ended";
    return { type: "ron", winner: seat, loser, score: result, points: this.points.slice() };
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
    if (removed < n) throw new Error("ubin tak cukup di tangan");
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
    if (this.phase !== phase) throw new Error(`aksi tak valid pada fase ${this.phase}`);
  }
}
