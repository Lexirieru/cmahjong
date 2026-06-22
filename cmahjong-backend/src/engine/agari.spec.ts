import { checkAgari, isChiitoitsu, isKokushi, waits } from "./agari";
import { countsFromKinds } from "./tiles";

describe("checkAgari - standard", () => {
  it("recognizes 4 sets + a pair", () => {
    // 234m 567p 345s 678s + 8m pair
    const counts = countsFromKinds([1, 2, 3, 13, 14, 15, 20, 21, 22, 23, 24, 25, 7, 7]);
    const r = checkAgari(counts);
    expect(r.win).toBe(true);
    expect(r.standard.length).toBeGreaterThan(0);
    expect(r.standard[0].melds).toHaveLength(4);
  });

  it("rejects an incomplete hand", () => {
    const counts = countsFromKinds([1, 2, 3, 13, 14, 15, 20, 21, 22, 23, 24, 25, 7]);
    expect(checkAgari(counts).win).toBe(false);
  });
});

describe("chiitoitsu & kokushi", () => {
  it("recognizes 7 pairs", () => {
    const counts = countsFromKinds([1, 1, 3, 3, 5, 5, 13, 13, 15, 15, 20, 20, 24, 24]);
    expect(isChiitoitsu(counts)).toBe(true);
    expect(checkAgari(counts).chiitoitsu).toBe(true);
  });

  it("rejects a fake chiitoitsu (has a quad)", () => {
    const counts = countsFromKinds([1, 1, 1, 1, 5, 5, 13, 13, 15, 15, 20, 20, 24, 24]);
    expect(isChiitoitsu(counts)).toBe(false);
  });

  it("recognizes kokushi musou", () => {
    // 13 orphans + a duplicate 1m
    const counts = countsFromKinds([0, 0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
    expect(isKokushi(counts)).toBe(true);
    expect(checkAgari(counts).kokushi).toBe(true);
  });
});

describe("waits (tenpai)", () => {
  it("ryanmen 23m waits on 1m & 4m", () => {
    // 23m + 567p 345s 678s 88m  (13 tiles), waiting on 1m/4m
    const counts = countsFromKinds([1, 2, 13, 14, 15, 20, 21, 22, 23, 24, 25, 7, 7]);
    const w = waits(counts);
    expect(w).toContain(0); // 1m
    expect(w).toContain(3); // 4m
  });

  it("tanki (pair wait)", () => {
    // 234m 567p 345s 678s + a single 8m -> waits on 8m
    const counts = countsFromKinds([1, 2, 3, 13, 14, 15, 20, 21, 22, 23, 24, 25, 7]);
    expect(waits(counts)).toContain(7);
  });
});
