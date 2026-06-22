import { shuffledWall, deterministicShuffle } from "./wall";
import { dealFromWall, doraFromIndicator } from "./deal";
import { toCounts } from "./tiles";

const SEED = "0x" + "ab".repeat(32);
const SEED2 = "0x" + "cd".repeat(32);

describe("deterministic wall", () => {
  it("produces the same wall for the same seed", () => {
    const a = shuffledWall(SEED).map((t) => t.id);
    const b = shuffledWall(SEED).map((t) => t.id);
    expect(a).toEqual(b);
  });

  it("different seed -> different order", () => {
    const a = shuffledWall(SEED).map((t) => t.id);
    const b = shuffledWall(SEED2).map((t) => t.id);
    expect(a).not.toEqual(b);
  });

  it("still contains 136 tiles, 4 of each kind", () => {
    const wall = shuffledWall(SEED);
    expect(wall.length).toBe(136);
    const counts = toCounts(wall);
    expect(counts.every((c) => c === 4)).toBe(true);
    // all ids 0..135 unique
    const ids = new Set(wall.map((t) => t.id));
    expect(ids.size).toBe(136);
  });

  it("shuffle is a permutation (no elements lost)", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = deterministicShuffle(SEED, arr);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(arr);
  });
});

describe("deal", () => {
  it("deals 13 tiles to each player + the remaining live wall is correct", () => {
    const wall = shuffledWall(SEED);
    const { hands, liveWall, deadWall, doraIndicator } = dealFromWall(wall);
    expect(hands).toHaveLength(4);
    hands.forEach((h) => expect(h).toHaveLength(13));
    expect(deadWall).toHaveLength(14);
    // 136 - 14 dead - 52 dealt = 70 remaining
    expect(liveWall).toHaveLength(70);
    expect(doraIndicator).toBeDefined();
  });

  it("doraFromIndicator cycles correctly", () => {
    expect(doraFromIndicator(0)).toBe(1); // 1m -> 2m
    expect(doraFromIndicator(8)).toBe(0); // 9m -> 1m
    expect(doraFromIndicator(30)).toBe(27); // N -> E
    expect(doraFromIndicator(33)).toBe(31); // chun -> haku
  });
});
