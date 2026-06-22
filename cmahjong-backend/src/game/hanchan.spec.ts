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

describe("Hanchan - dealer rotation & wind", () => {
  it("starts at East-1 with dealer at seat 0", () => {
    const h = new Hanchan(SEED);
    const s = h.state();
    expect(s.roundWind).toBe(27);
    expect(s.kyokuNum).toBe(1);
    expect(s.dealer).toBe(0);
  });

  it("non-dealer wins -> dealer rotates, honba resets", () => {
    const h = new Hanchan(SEED);
    h.honba = 2;
    h.advance(ron([24000, 28000, 25000, 23000], 1, 3), 0);
    expect(h.dealer).toBe(1);
    expect(h.kyokuNum).toBe(2);
    expect(h.honba).toBe(0);
  });

  it("dealer wins -> renchan, dealer stays, honba++", () => {
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
    expect(h.dealer).toBe(0); // dealer (seat0) tenpai -> stays
    expect(h.honba).toBe(1);
    expect(h.riichiSticks).toBe(2); // 2 riichi carry
  });

  it("draw: dealer noten -> rotates", () => {
    const h = new Hanchan(SEED);
    h.advance(draw([23500, 26500, 26500, 23500], [false, true, true, false]), 0);
    expect(h.dealer).toBe(1);
  });

  // the winner is always a non-dealer so the dealer always rotates
  function rotateOnce(h: Hanchan) {
    const winner = (h.dealer + 1) % 4;
    h.advance(ron([25000, 25000, 25000, 25000], winner, h.dealer), 0);
  }

  it("progresses East-4 -> South-1 -> finishes after South-4", () => {
    const h = new Hanchan(SEED, "hanchan");
    for (let i = 0; i < 4; i++) rotateOnce(h); // exhaust East
    expect(h.state().roundWind).toBe(28); // South
    expect(h.state().kyokuNum).toBe(1);
    expect(h.finished).toBe(false);
    for (let i = 0; i < 4; i++) rotateOnce(h); // exhaust South
    expect(h.finished).toBe(true);
  });

  it("east-only finishes after East-4", () => {
    const h = new Hanchan(SEED, "east");
    for (let i = 0; i < 4; i++) rotateOnce(h);
    expect(h.finished).toBe(true);
  });
});

describe("Hanchan - snapshot/restore (resume)", () => {
  it("round-trip through JSON preserves meta + the live round", () => {
    const h = new Hanchan(SEED, "east");
    h.honba = 1;
    h.riichiSticks = 2;
    const snap = JSON.parse(JSON.stringify(h.snapshot()));
    const h2 = Hanchan.restore(snap);

    expect(h2.state()).toEqual(h.state());
    expect(h2.round.publicState()).toEqual(h.round.publicState());

    // identical advance on both -> meta stays in sync
    const out = draw([25000, 25000, 25000, 25000], [true, true, true, true]);
    h.advance(out, 0);
    h2.advance(out, 0);
    expect(h2.state()).toEqual(h.state());
  });
});

describe("Hanchan - honba & riichi sticks", () => {
  it("ron: honba adds 300/honba to the winner from the discarder", () => {
    const h = new Hanchan(SEED);
    h.honba = 2; // 600 bonus
    h.advance(ron([23000, 27000, 25000, 25000], 1, 0), 0);
    // base is already in points; 600 bonus from seat0 to seat1
    expect(h.points[1]).toBe(27000 + 600);
    expect(h.points[0]).toBe(23000 - 600);
  });

  it("the winner collects riichi sticks (carry + this round)", () => {
    const h = new Hanchan(SEED);
    h.riichiSticks = 1; // 1 carry
    // this round 1 riichi -> pot of 2 = 2000
    h.advance(tsumo([28000, 24000, 24000, 24000], 0), 1);
    expect(h.points[0]).toBe(28000 + 2000);
    expect(h.riichiSticks).toBe(0);
  });

  it("final ranking: points desc, ties broken by seat order", () => {
    const h = new Hanchan(SEED);
    h.points = [25000, 25000, 30000, 20000];
    const rank = h.finalRanking();
    expect(rank[0]).toBe(2);
    expect(rank[3]).toBe(3);
    expect(rank.indexOf(0)).toBeLessThan(rank.indexOf(1)); // tie -> seat0 first
  });
});
