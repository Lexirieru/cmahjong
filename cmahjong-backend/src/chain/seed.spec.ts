import { commitmentOf, computeSeed, verifyReveal, randomSecret } from "./seed";

describe("commit-reveal (mirror kontrak)", () => {
  const player = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E";
  const secret = "0x" + "11".repeat(32);

  it("commitment deterministik & verifiable", () => {
    const c = commitmentOf(1, player, secret);
    expect(c).toMatch(/^0x[0-9a-f]{64}$/);
    expect(verifyReveal(1, player, secret, c)).toBe(true);
  });

  it("commitment terikat ke gameId & player", () => {
    const c1 = commitmentOf(1, player, secret);
    const c2 = commitmentOf(2, player, secret);
    expect(c1).not.toBe(c2);
    expect(verifyReveal(2, player, secret, c1)).toBe(false);
  });

  it("seed bergantung pada keempat secret & urutannya", () => {
    const s: [string, string, string, string] = [
      "0x" + "01".repeat(32),
      "0x" + "02".repeat(32),
      "0x" + "03".repeat(32),
      "0x" + "04".repeat(32),
    ];
    const seed = computeSeed(s);
    expect(seed).toMatch(/^0x[0-9a-f]{64}$/);
    // tukar urutan -> seed berubah
    const swapped: [string, string, string, string] = [s[1], s[0], s[2], s[3]];
    expect(computeSeed(swapped)).not.toBe(seed);
  });

  it("randomSecret menghasilkan 32-byte hex", () => {
    expect(randomSecret()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
