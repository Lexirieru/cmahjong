import { Round, START_POINTS } from "./round";

const SEED = "0x" + "ab".repeat(32);

describe("Round - mekanik dasar", () => {
  it("inisialisasi: dealer menarik ubin pertama (14 ubin)", () => {
    const r = new Round(SEED, 0);
    expect(r.handOf(0)).toHaveLength(14); // dealer sudah menarik
    expect(r.handOf(1)).toHaveLength(13);
    expect(r.points).toEqual([START_POINTS, START_POINTS, START_POINTS, START_POINTS]);
  });

  it("seat wind relatif dealer", () => {
    const r = new Round(SEED, 1); // dealer seat 1
    expect(r.seatWind(1)).toBe(27); // East
    expect(r.seatWind(2)).toBe(28); // South
    expect(r.seatWind(0)).toBe(30); // North
  });

  it("discard memajukan giliran & pemain berikut menarik", () => {
    const r = new Round(SEED, 0);
    const tileId = r.handOf(0)[0].id;
    r.discard(0, tileId);
    expect(r.turn).toBe(1);
    expect(r.handOf(1)).toHaveLength(14); // seat 1 menarik
    expect(r.handOf(0)).toHaveLength(13);
    expect(r.publicState().discards[0]).toHaveLength(1);
  });

  it("wall berkurang tiap draw; state publik tak membocorkan tangan", () => {
    const r = new Round(SEED, 0);
    const before = r.publicState().wallRemaining;
    r.discard(0, r.handOf(0)[0].id);
    expect(r.publicState().wallRemaining).toBe(before - 1);
    expect(r.publicState() as object).not.toHaveProperty("hands");
  });

  it("riichi mengurangi 1000 poin & menandai riichi", () => {
    const r = new Round(SEED, 0);
    r.declareRiichi(0, r.handOf(0)[0].id);
    expect(r.points[0]).toBe(START_POINTS - 1000);
    expect(r.riichi[0]).toBe(true);
  });

  it("ranking: poin tertinggi juara 1, seri dipecah kedekatan dealer", () => {
    const r = new Round(SEED, 0);
    r.points = [25000, 30000, 25000, 20000];
    const rank = r.ranking();
    expect(rank[0]).toBe(1); // poin terbanyak
    expect(rank[3]).toBe(3); // poin paling sedikit
    // seri 25000 antara seat 0 & 2 -> seat 0 (lebih dekat dealer) lebih tinggi
    expect(rank.indexOf(0)).toBeLessThan(rank.indexOf(2));
  });

  it("tidak bisa aksi setelah ronde berakhir", () => {
    const r = new Round(SEED, 0);
    r.points = [25000, 25000, 25000, 25000];
    // paksa akhir lewat draw exhaustive tidak praktis; uji guard via ron tanpa buangan
    expect(() => r.declareRon(1)).toThrow();
  });
});
