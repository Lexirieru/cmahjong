import { Round, START_POINTS } from "./round";
import { Tile } from "../engine/tiles";

const SEED = "0x" + "ab".repeat(32);

let idc = 0;
function tiles(kinds: number[]): Tile[] {
  return kinds.map((k) => ({ id: idc++, kind: k }));
}
const HONORS = [27, 28, 29, 30, 31, 32, 33, 27, 28, 29, 30, 31, 32]; // 13 honor (catatan: tenpai tsuuiisou!)
const JUNK = [0, 9, 18, 27, 1, 10, 19, 28, 2, 11, 20, 29, 3]; // 13 single acak, noten, tak bisa call

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

  it("respond tak valid saat fase playing", () => {
    const r = new Round(SEED, 0);
    expect(() => r.respond(1, { type: "pass" })).toThrow();
  });
});

describe("Round - call pon/chi (via respond)", () => {
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
    expect(r.availableCalls().some((c) => c.seat === 2 && c.type === "pon")).toBe(true);

    const res = r.respond(2, { type: "pon" });
    expect(res.resolved).toBe(true);
    expect(res.action).toBe("pon");
    expect(r.turn).toBe(2);
    expect(r.handOf(2)).toHaveLength(11);
    expect(r.publicState().melds[2]).toEqual([{ type: "triplet", kind: 13, open: true }]);
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
    expect(chi!.chiOptions).toContain(12);

    r.respond(1, { type: "chi", low: 12 });
    expect(r.turn).toBe(1);
    expect(r.publicState().melds[1]).toEqual([{ type: "sequence", kind: 12, open: true }]);
  });
});

describe("Round - ron", () => {
  it("ron atas buangan menyelesaikan tangan tenpai + bayar", () => {
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

    const res = r.respond(2, { type: "ron" });
    expect(res.resolved).toBe(true);
    const out = res.outcome!;
    expect(out.type).toBe("ron");
    expect(out.winner).toBe(2);
    expect(out.loser).toBe(0);
    expect(out.points[2]).toBeGreaterThan(START_POINTS);
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
    r.respond(2, { type: "kan" });
    expect(r.turn).toBe(2);
    expect(r.publicState().melds[2][0]).toEqual({ type: "kan", kind: 13, open: true });
    expect(r.publicState().doraIndicators.length).toBe(doraBefore + 1);
    expect(r.handOf(2)).toHaveLength(11);
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

describe("Round - snapshot/restore (resume)", () => {
  it("round-trip lewat JSON mempertahankan state & bisa dilanjut", () => {
    const r = new Round(SEED, 0);
    const before = r.publicState();
    const handsBefore = [0, 1, 2, 3].map((s) => r.handOf(s));

    // simulasi simpan->muat dari DB (JSON)
    const snap = JSON.parse(JSON.stringify(r.snapshot()));
    const r2 = Round.restore(snap);

    expect(r2.publicState()).toEqual(before);
    [0, 1, 2, 3].forEach((s) => expect(r2.handOf(s)).toEqual(handsBefore[s]));

    // lanjut bermain pada instance yang dipulihkan
    const drawn = r2.handOf(0)[r2.handOf(0).length - 1].id;
    expect(() => r2.discard(0, drawn)).not.toThrow();
  });

  it("mempertahankan state di tengah ronde (setelah beberapa aksi)", () => {
    const r = injected({
      hands: [
        [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 33, 33, 13],
        HONORS,
        [13, 13, 1, 2, 4, 5, 7, 8, 19, 20, 22, 23, 25],
        HONORS,
      ],
    });
    r.discard(0, -1); // masuk fase call (seat2 bisa pon 5p)
    const snap = JSON.parse(JSON.stringify(r.snapshot()));
    const r2 = Round.restore(snap);
    expect(r2.publicState()).toEqual(r.publicState());
    // pon masih bisa dieksekusi pada instance pulihan
    const res = r2.respond(2, { type: "pon" });
    expect(res.resolved).toBe(true);
    expect(r2.turn).toBe(2);
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

// tangan tenpai menunggu 5p (kind13) dengan pinfu/tanyao
const RON_5P = [1, 2, 3, 19, 20, 21, 23, 24, 25, 11, 12, 6, 6];

describe("Round - prioritas call (ron > pon/kan > chi)", () => {
  it("pon mengalahkan chi atas buangan yang sama", () => {
    const r = injected({
      hands: [
        [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 33, 33, 13], // buang 5p
        [12, 14, 1, 2, 4, 5, 7, 8, 19, 20, 22, 23, 25], // seat1 bisa chi
        [13, 13, 1, 2, 4, 5, 7, 8, 19, 20, 22, 23, 25], // seat2 bisa pon
        HONORS,
      ],
    });
    r.discard(0, -1);
    expect(r.respond(1, { type: "chi", low: 12 }).resolved).toBe(false);
    const res = r.respond(2, { type: "pon" });
    expect(res.resolved).toBe(true);
    expect(res.action).toBe("pon");
    expect(r.turn).toBe(2);
    expect(r.publicState().melds[1]).toEqual([]); // chi kalah, tak terbentuk
  });

  it("ron mengalahkan pon", () => {
    const r = injected({
      hands: [
        [27, 27, 27, 28, 28, 28, 29, 29, 30, 30, 31, 31, 33, 13], // buang 5p
        HONORS,
        RON_5P, // seat2 bisa ron
        [13, 13, 1, 2, 4, 5, 7, 8, 19, 20, 22, 23, 25], // seat3 bisa pon
      ],
    });
    r.discard(0, -1);
    expect(r.respond(3, { type: "pon" }).resolved).toBe(false);
    const res = r.respond(2, { type: "ron" });
    expect(res.resolved).toBe(true);
    expect(res.action).toBe("ron");
    expect(res.outcome!.winner).toBe(2);
  });
});

describe("Round - furiten", () => {
  it("tak bisa ron bila tunggu ada di buangan sendiri (furiten permanen)", () => {
    const r = injected({
      hands: [
        [27, 27, 27, 28, 28, 28, 29, 29, 30, 30, 31, 31, 33, 13], // buang 5p
        HONORS,
        RON_5P, // tenpai 5p
        HONORS,
      ],
    });
    r.discards[2].push(13); // seat2 pernah membuang 5p -> furiten
    r.discard(0, -1);
    expect(r.availableCalls().some((c) => c.seat === 2 && c.type === "ron")).toBe(false);
    expect(r.isFuriten(2)).toBe(true);
  });

  it("furiten sementara setelah melewatkan ron", () => {
    const r = injected({
      hands: [
        [27, 27, 27, 28, 28, 28, 29, 29, 30, 30, 31, 31, 33, 13], // buang 5p
        HONORS,
        RON_5P,
        HONORS,
      ],
      liveWall: [0, 1, 2],
    });
    r.discard(0, -1);
    expect(r.availableCalls().some((c) => c.seat === 2 && c.type === "ron")).toBe(true);
    r.respond(2, { type: "pass" }); // lewatkan ron
    expect(r.isFuriten(2)).toBe(true); // jadi furiten sementara
  });
});

describe("Round - chankan (rob the kan)", () => {
  it("shouminkan dirampok oleh penunggu (ron + yaku Chankan)", () => {
    const r = injected({
      // seat0 punya pon 5p + 1 ubin 5p untuk shouminkan
      hands: [[13, 27, 28, 29, 30, 31, 32, 0, 9, 18], JUNK, RON_5P, JUNK],
    });
    r.melds[0].push({ type: "triplet", kind: 13, open: true });

    const out = r.addedKan(0, 13); // tawarkan chankan
    expect(out).toBeNull();
    expect(r.availableCalls().some((c) => c.seat === 2 && c.type === "ron")).toBe(true);

    const res = r.respond(2, { type: "ron" });
    expect(res.resolved).toBe(true);
    expect(res.outcome!.winner).toBe(2);
    expect(res.outcome!.loser).toBe(0);
    expect(res.outcome!.score!.yaku.some((y) => y.name === "Chankan")).toBe(true);
  });

  it("bila tak dirampok, kan selesai terbentuk", () => {
    const r = injected({
      hands: [[13, 27, 28, 29, 30, 31, 32, 0, 9, 18], JUNK, JUNK, JUNK], // seat2 tak tenpai
    });
    r.melds[0].push({ type: "triplet", kind: 13, open: true });
    const out = r.addedKan(0, 13);
    // tak ada robber -> kan langsung terbentuk
    expect(out).toBeNull();
    expect(r.publicState().melds[0][0]).toEqual({ type: "kan", kind: 13, open: true });
    expect(r.turn).toBe(0);
  });
});

describe("Round - multi-ron (double ron)", () => {
  it("dua pemain ron buangan yang sama, keduanya dibayar", () => {
    const r = injected({
      hands: [
        [27, 27, 28, 28, 29, 29, 30, 30, 31, 31, 32, 32, 33, 13], // seat0 buang 5p
        RON_5P, // seat1 tenpai 5p
        RON_5P, // seat2 tenpai 5p
        JUNK,
      ],
    });
    r.discard(0, -1);
    expect(r.respond(1, { type: "ron" }).resolved).toBe(false); // tunggu seat2
    const res = r.respond(2, { type: "ron" });
    expect(res.resolved).toBe(true);
    const out = res.outcome!;
    expect(out.winners).toEqual([1, 2]); // head-bump: seat1 lebih dekat
    expect(out.points[1]).toBeGreaterThan(START_POINTS);
    expect(out.points[2]).toBeGreaterThan(START_POINTS);
    expect(out.points[0]).toBeLessThan(START_POINTS); // pembuang bayar keduanya
  });
});

describe("Round - ippatsu & double riichi", () => {
  it("riichi pada buangan pertama + ron seputaran = Double Riichi + Ippatsu", () => {
    const r = injected({
      hands: [[...RON_5P, 33], JUNK, JUNK, JUNK],
      liveWall: [13, 27], // seat1 menarik 5p lalu buang
    });
    r.declareRiichi(0, -1); // buangan pertama -> double riichi, ippatsu terbuka
    expect(r.turn).toBe(1);
    r.discard(1, -1); // seat1 buang 5p
    const res = r.respond(0, { type: "ron" });
    const names = res.outcome!.score!.yaku.map((y) => y.name);
    expect(names).toEqual(expect.arrayContaining(["Double Riichi", "Ippatsu"]));
  });

  it("riichi biasa (bukan buangan pertama) + ippatsu", () => {
    const r = injected({
      hands: [[...RON_5P, 33], JUNK, JUNK, JUNK],
      liveWall: [13, 27],
    });
    r.discards[0].push(33); // seat0 sudah pernah buang -> bukan double riichi
    r.declareRiichi(0, -1);
    r.discard(1, -1);
    const res = r.respond(0, { type: "ron" });
    const names = res.outcome!.score!.yaku.map((y) => y.name);
    expect(names).toContain("Riichi");
    expect(names).toContain("Ippatsu");
    expect(names).not.toContain("Double Riichi");
  });
});
