import { scoreHand } from "./score";
import { WinContext } from "./yaku";
import { countsFromKinds } from "./tiles";

const E = 27; // angin Timur

function ctx(partial: Partial<WinContext>): WinContext {
  return {
    seatWind: E,
    roundWind: E,
    winningTile: 0,
    isTsumo: false,
    isMenzen: true,
    ...partial,
  };
}

describe("scoreHand - kasus umum", () => {
  it("Pinfu + Tanyao + Menzen Tsumo = 3 han 20 fu", () => {
    // 234m 567p 345s 678s + 88m, tsumo 4m
    const counts = countsFromKinds([1, 2, 3, 13, 14, 15, 20, 21, 22, 23, 24, 25, 7, 7]);
    const r = scoreHand({
      counts,
      ctx: ctx({ winningTile: 3, isTsumo: true, isMenzen: true }),
      isDealer: false,
    });
    expect(r.agari).toBe(true);
    expect(r.han).toBe(3);
    expect(r.fu).toBe(20);
    const names = r.yaku.map((y) => y.name);
    expect(names).toEqual(expect.arrayContaining(["Pinfu", "Tanyao", "Menzen Tsumo"]));
    // non-dealer tsumo: base 640 -> 1300/700/700 = 2700
    expect(r.payments?.total).toBe(2700);
  });

  it("Yakuhai naga memberi minimal 1 han", () => {
    // 111m 999p 234s haku-haku-haku + 55m, ron 1m
    const counts = countsFromKinds([0, 0, 0, 17, 17, 17, 18, 19, 20, 31, 31, 31, 4, 4]);
    const r = scoreHand({
      counts,
      ctx: ctx({ winningTile: 0, isTsumo: false, isMenzen: true }),
      isDealer: false,
    });
    expect(r.agari).toBe(true);
    expect(r.yaku.some((y) => y.name.startsWith("Yakuhai"))).toBe(true);
    expect(r.han).toBeGreaterThanOrEqual(1);
  });

  it("Chiitoitsu + Riichi terdeteksi", () => {
    const counts = countsFromKinds([1, 1, 3, 3, 5, 5, 13, 13, 15, 15, 20, 20, 24, 24]);
    const r = scoreHand({
      counts,
      ctx: ctx({ winningTile: 1, isTsumo: false, isMenzen: true, riichi: true }),
      isDealer: false,
    });
    expect(r.agari).toBe(true);
    expect(r.yaku.some((y) => y.name === "Chiitoitsu")).toBe(true);
    expect(r.fu).toBe(25);
    expect(r.han).toBeGreaterThanOrEqual(3); // riichi + chiitoi + tanyao
  });

  it("dora menambah han", () => {
    // hand pinfu tanyao + indikator dora 1m -> dora = 2m, tangan punya 2m
    const counts = countsFromKinds([1, 2, 3, 13, 14, 15, 20, 21, 22, 23, 24, 25, 7, 7]);
    const base = scoreHand({
      counts,
      ctx: ctx({ winningTile: 3, isTsumo: true }),
      isDealer: false,
    });
    const withDora = scoreHand({
      counts,
      ctx: ctx({ winningTile: 3, isTsumo: true }),
      isDealer: false,
      doraIndicators: [0], // 1m -> dora 2m (ada 1 di tangan)
    });
    expect(withDora.han).toBe(base.han + 1);
  });
});

describe("scoreHand - yakuman", () => {
  it("Kokushi musou = yakuman", () => {
    const counts = countsFromKinds([0, 0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
    const r = scoreHand({
      counts,
      ctx: ctx({ winningTile: 8, isTsumo: false, isMenzen: true }),
      isDealer: false,
    });
    expect(r.agari).toBe(true);
    expect(r.yakuman).toBe(true);
    expect(r.han).toBeGreaterThanOrEqual(13);
    // non-dealer ron yakuman = 32000
    expect(r.payments?.total).toBe(32000);
  });

  it("Daisangen = yakuman (3 triplet naga)", () => {
    // haku pon, hatsu, chun triplet + 234m + pasangan 5p
    const counts = countsFromKinds([31, 31, 31, 32, 32, 32, 33, 33, 33, 1, 2, 3, 13, 13]);
    const r = scoreHand({
      counts,
      ctx: ctx({ winningTile: 1, isTsumo: false, isMenzen: true }),
      isDealer: false,
    });
    expect(r.yakuman).toBe(true);
    expect(r.yaku.some((y) => y.name === "Daisangen")).toBe(true);
  });
});

describe("scoreHand - tanpa yaku", () => {
  it("tangan valid bentuk tapi tanpa yaku tak bisa menang", () => {
    // 123m 456p 789s 123s + 99m (ada terminal -> bukan tanyao), open, tanpa yaku
    const counts = countsFromKinds([0, 1, 2, 12, 13, 14, 24, 25, 26, 18, 19, 20, 8, 8]);
    const r = scoreHand({
      counts,
      ctx: ctx({ winningTile: 0, isTsumo: false, isMenzen: false }), // terbuka, bukan tsumo
      isDealer: false,
    });
    expect(r.agari).toBe(false);
  });
});
