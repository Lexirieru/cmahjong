import { Round, START_POINTS } from "./round";
import { Tile } from "../engine/tiles";

const SEED = "0x" + "ab".repeat(32);

let idc = 0;
function tiles(kinds: number[]): Tile[] {
  return kinds.map((k) => ({ id: idc++, kind: k }));
}
const HONORS = [27, 28, 29, 30, 31, 32, 33, 27, 28, 29, 30, 31, 32]; // 13 honor, tak bisa chi 5p

/** Round dengan state disuntik; seat aktif dianggap sudah memegang ubin (siap buang). */
function injected(opts: {
  hands: number[][];
  turn?: number;
  liveWall?: number[];
  deadWall?: number[];
}): Round {
  return new Round(SEED, 0, 27, undefined, {
    hands: opts.hands.map(tiles),
    liveWall: tiles(opts.liveWall ?? [0]),
    deadWall: tiles(opts.deadWall ?? [1, 2, 3, 4]),
    doraIndicator: 0,
    turn: opts.turn ?? 0,
    skipInitialDraw: true,
  });
}

describe("Round - mekanik dasar", () => {
  it("inisialisasi seed: dealer menarik ubin pertama (14 ubin)", () => {
    const r = new Round(SEED, 0);
    expect(r.handOf(0)).toHaveLength(14);
    expect(r.handOf(1)).toHaveLength(13);
    expect(r.points).toEqual([START_POINTS, START_POINTS, START_POINTS, START_POINTS]);
  });

  it("seat wind relatif dealer", () => {
    const r = new Round(SEED, 1);
    expect(r.seatWind(1)).toBe(27);
    expect(r.seatWind(2)).toBe(28);
    expect(r.seatWind(0)).toBe(30);
  });

  it("discard tanpa call memajukan giliran & pemain berikut menarik", () => {
    // seat0 buang 5p; seat1..3 honor (tak bisa call) -> maju ke seat1, draw
    const r = injected({
      hands: [
        [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 33, 33, 13],
        HONORS,
        HONORS,
        HONORS,
      ],
      liveWall: [5],
    });
    const out = r.discard(0, -1); // buang 5p (terakhir)
    expect(out).toBeNull();
    expect(r.turn).toBe(1);
    expect(r.handOf(1)).toHaveLength(14);
    expect(r.publicState().discards[0]).toEqual([13]);
  });

  it("state publik tak membocorkan tangan", () => {
    const r = new Round(SEED, 0);
    expect(r.publicState() as object).not.toHaveProperty("hands");
  });

  it("ranking: poin tertinggi juara 1, seri dipecah kedekatan dealer", () => {
    const r = new Round(SEED, 0);
    r.points = [25000, 30000, 25000, 20000];
    const rank = r.ranking();
    expect(rank[0]).toBe(1);
    expect(rank[3]).toBe(3);
    expect(rank.indexOf(0)).toBeLessThan(rank.indexOf(2));
  });

  it("pass tak valid saat fase playing", () => {
    const r = new Round(SEED, 0);
    expect(() => r.pass()).toThrow();
  });
});

describe("Round - call pon/chi", () => {
  it("pon tersedia & dieksekusi (out of turn)", () => {
    const r = injected({
      hands: [
        [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 33, 33, 13], // seat0 buang 5p
        HONORS,
        [13, 13, 1, 2, 4, 5, 7, 8, 19, 20, 22, 23, 25], // seat2 punya dua 5p
        HONORS,
      ],
    });
    r.discard(0, -1);
    const calls = r.availableCalls();
    expect(calls.some((c) => c.seat === 2 && c.type === "pon")).toBe(true);

    r.callPon(2);
    expect(r.turn).toBe(2);
    expect(r.handOf(2)).toHaveLength(11); // dua ubin pindah ke meld
    const melds = r.publicState().melds[2];
    expect(melds).toEqual([{ type: "triplet", kind: 13, open: true }]);
  });

  it("chi hanya dari pemain berikutnya & membentuk urutan", () => {
    const r = injected({
      hands: [
        [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 33, 33, 13], // buang 5p (kind13)
        [12, 14, 1, 2, 4, 5, 7, 8, 19, 20, 22, 23, 25], // seat1 punya 4p(12) & 6p(14)
        HONORS,
        HONORS,
      ],
    });
    r.discard(0, -1);
    const chi = r.availableCalls().find((c) => c.seat === 1 && c.type === "chi");
    expect(chi).toBeDefined();
    expect(chi!.chiOptions).toContain(12); // urutan 4-5-6p, low=4p

    r.callChi(1, 12);
    expect(r.turn).toBe(1);
    expect(r.publicState().melds[1]).toEqual([{ type: "sequence", kind: 12, open: true }]);
  });
});

describe("Round - ron", () => {
  it("ron atas buangan menyelesaikan tangan tenpai + bayar", () => {
    // seat2 tenpai tanyao/pinfu menunggu 5p (kind13)
    const r = injected({
      hands: [
        [27, 27, 27, 28, 28, 28, 29, 29, 30, 30, 31, 31, 33, 13], // seat0 buang 5p
        HONORS,
        [1, 2, 3, 19, 20, 21, 23, 24, 25, 11, 12, 6, 6], // 234m 234s 678s 34p + 77m
        HONORS,
      ],
    });
    r.discard(0, -1);
    expect(r.availableCalls().some((c) => c.seat === 2 && c.type === "ron")).toBe(true);

    const out = r.callRon(2);
    expect(out.type).toBe("ron");
    expect(out.winner).toBe(2);
    expect(out.loser).toBe(0);
    expect(out.points[2]).toBeGreaterThan(START_POINTS);
    expect(out.points[0]).toBeLessThan(START_POINTS);
  });
});

describe("Round - kan", () => {
  it("daiminkan dari buangan menarik rinshan & membuka dora baru", () => {
    const r = injected({
      hands: [
        [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 33, 33, 13], // buang 5p
        HONORS,
        [13, 13, 13, 1, 2, 4, 5, 7, 8, 19, 20, 22, 23], // seat2 punya tiga 5p
        HONORS,
      ],
      deadWall: [10, 11, 12, 13],
    });
    r.discard(0, -1);
    expect(r.availableCalls().some((c) => c.seat === 2 && c.type === "kan")).toBe(true);

    const doraBefore = r.publicState().doraIndicators.length;
    r.callKan(2);
    expect(r.turn).toBe(2);
    expect(r.publicState().melds[2][0]).toEqual({ type: "kan", kind: 13, open: true });
    // rinshan ditarik + indikator dora baru terbuka
    expect(r.publicState().doraIndicators.length).toBe(doraBefore + 1);
    expect(r.handOf(2)).toHaveLength(11); // 13 - 3 (ke meld) + 1 (rinshan)
  });

  it("ankan saat giliran sendiri", () => {
    const r = injected({
      hands: [
        [13, 13, 13, 13, 1, 2, 3, 19, 20, 21, 23, 24, 25, 6], // seat0 punya empat 5p
        HONORS,
        HONORS,
        HONORS,
      ],
      deadWall: [10, 11, 12, 13],
    });
    r.ankan(0, 13);
    expect(r.publicState().melds[0][0]).toEqual({ type: "kan", kind: 13, open: false });
    expect(r.handOf(0)).toHaveLength(11); // 14 - 4 + 1 rinshan
  });
});

describe("Round - riichi", () => {
  it("menolak riichi bila tidak tenpai", () => {
    const r = injected({
      hands: [
        [27, 28, 29, 30, 31, 32, 33, 1, 3, 5, 7, 13, 19, 25], // acak, jelas bukan tenpai
        HONORS,
        HONORS,
        HONORS,
      ],
    });
    expect(() => r.declareRiichi(0, -1)).toThrow();
  });
});
