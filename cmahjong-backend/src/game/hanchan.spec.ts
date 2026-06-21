import { Hanchan } from "./hanchan";
import { RoundOutcome } from "./round";

const SEED = "0x" + "ab".repeat(32);

function ron(points: number[], winner: number, loser: number): RoundOutcome {
  return { type: "ron", winner, loser, points };
}
function tsumo(points: number[], winner: number): RoundOutcome {
  return { type: "tsumo", winner, points };
}
function draw(points: number[], tenpai: boolean[]): RoundOutcome {
  return { type: "draw", points, tenpai };
}

describe("Hanchan - rotasi dealer & wind", () => {
  it("mulai di East-1 dealer seat 0", () => {
    const h = new Hanchan(SEED);
    const s = h.state();
    expect(s.roundWind).toBe(27);
    expect(s.kyokuNum).toBe(1);
    expect(s.dealer).toBe(0);
  });

  it("non-dealer menang -> dealer rotasi, honba reset", () => {
    const h = new Hanchan(SEED);
    h.honba = 2;
    h.advance(ron([24000, 28000, 25000, 23000], 1, 3), 0);
    expect(h.dealer).toBe(1);
    expect(h.kyokuNum).toBe(2);
    expect(h.honba).toBe(0);
  });

  it("dealer menang -> renchan, dealer tetap, honba++", () => {
    const h = new Hanchan(SEED);
    h.advance(tsumo([34000, 22000, 22000, 22000], 0), 0);
    expect(h.dealer).toBe(0);
    expect(h.kyokuNum).toBe(1);
    expect(h.honba).toBe(1);
  });

  it("draw: dealer tenpai -> renchan; honba++ & sticks carry", () => {
    const h = new Hanchan(SEED);
    h.riichiSticks = 0;
    h.advance(draw([26500, 26500, 23500, 23500], [true, true, false, false]), 2);
    expect(h.dealer).toBe(0); // dealer (seat0) tenpai -> tetap
    expect(h.honba).toBe(1);
    expect(h.riichiSticks).toBe(2); // 2 riichi carry
  });

  it("draw: dealer noten -> rotasi", () => {
    const h = new Hanchan(SEED);
    h.advance(draw([23500, 26500, 26500, 23500], [false, true, true, false]), 0);
    expect(h.dealer).toBe(1);
  });

  // pemenang selalu non-dealer agar dealer selalu rotasi
  function rotateOnce(h: Hanchan) {
    const winner = (h.dealer + 1) % 4;
    h.advance(ron([25000, 25000, 25000, 25000], winner, h.dealer), 0);
  }

  it("progres East-4 -> South-1 -> selesai setelah South-4", () => {
    const h = new Hanchan(SEED, "hanchan");
    for (let i = 0; i < 4; i++) rotateOnce(h); // habiskan East
    expect(h.state().roundWind).toBe(28); // South
    expect(h.state().kyokuNum).toBe(1);
    expect(h.finished).toBe(false);
    for (let i = 0; i < 4; i++) rotateOnce(h); // habiskan South
    expect(h.finished).toBe(true);
  });

  it("east-only selesai setelah East-4", () => {
    const h = new Hanchan(SEED, "east");
    for (let i = 0; i < 4; i++) rotateOnce(h);
    expect(h.finished).toBe(true);
  });
});

describe("Hanchan - honba & riichi sticks", () => {
  it("ron: honba menambah 300/honba ke pemenang dari pembuang", () => {
    const h = new Hanchan(SEED);
    h.honba = 2; // 600 bonus
    h.advance(ron([23000, 27000, 25000, 25000], 1, 0), 0);
    // base sudah di points; bonus 600 dari seat0 ke seat1
    expect(h.points[1]).toBe(27000 + 600);
    expect(h.points[0]).toBe(23000 - 600);
  });

  it("pemenang mengumpulkan riichi sticks (carry + ronde ini)", () => {
    const h = new Hanchan(SEED);
    h.riichiSticks = 1; // 1 carry
    // ronde ini 1 riichi -> pot 2 = 2000
    h.advance(tsumo([28000, 24000, 24000, 24000], 0), 1);
    expect(h.points[0]).toBe(28000 + 2000);
    expect(h.riichiSticks).toBe(0);
  });

  it("ranking final: poin desc, seri pecah urutan seat", () => {
    const h = new Hanchan(SEED);
    h.points = [25000, 25000, 30000, 20000];
    const rank = h.finalRanking();
    expect(rank[0]).toBe(2);
    expect(rank[3]).toBe(3);
    expect(rank.indexOf(0)).toBeLessThan(rank.indexOf(1)); // seri -> seat0 dulu
  });
});
