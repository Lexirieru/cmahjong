import { Wallet } from "ethers";
import { SettlementService } from "./settlement.service";
import { ChainService } from "../chain/chain.service";
import { signResult } from "../chain/signer";

const CONTRACT = "0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4";
const CHAIN_ID = 42220;
const GAME = "1";

function makeChain() {
  return {
    address: CONTRACT,
    chain: CHAIN_ID,
    submitSettle: jest.fn().mockResolvedValue("0xcoop"),
    submitSettleByServer: jest.fn().mockResolvedValue("0xserver"),
    signRanking: jest.fn().mockResolvedValue("0xserversig"),
  } as unknown as ChainService;
}

describe("SettlementService", () => {
  const players = [
    new Wallet("0x" + "01".repeat(32)),
    new Wallet("0x" + "02".repeat(32)),
    new Wallet("0x" + "03".repeat(32)),
    new Wallet("0x" + "04".repeat(32)),
  ];
  const ranking = [players[0].address, players[1].address, players[2].address, players[3].address] as [
    string,
    string,
    string,
    string,
  ];

  const sigOf = (w: Wallet) => signResult(w, CONTRACT, CHAIN_ID, BigInt(GAME), ranking);

  it("collects 4 signatures then submits cooperative settle", async () => {
    const chain = makeChain();
    const svc = new SettlementService(chain);
    svc.open(GAME, ranking, ranking);

    for (let i = 0; i < 3; i++) {
      const s = await svc.addSignature(GAME, await sigOf(players[i]));
      expect(s.status).toBe("collecting");
    }
    const final = await svc.addSignature(GAME, await sigOf(players[3]));
    expect(final.status).toBe("settled");
    expect(final.txHash).toBe("0xcoop");
    expect(chain.submitSettle).toHaveBeenCalledTimes(1);
    expect(chain.submitSettle).toHaveBeenCalledWith(BigInt(GAME), ranking, expect.any(Array));
  });

  it("rejects signature from a non-player", async () => {
    const chain = makeChain();
    const svc = new SettlementService(chain);
    svc.open(GAME, ranking, ranking);
    const outsider = new Wallet("0x" + "09".repeat(32));
    await expect(svc.addSignature(GAME, await sigOf(outsider))).rejects.toThrow();
  });

  it("duplicate signature does not double-count (needs 4 distinct)", async () => {
    const chain = makeChain();
    const svc = new SettlementService(chain);
    svc.open(GAME, ranking, ranking);
    await svc.addSignature(GAME, await sigOf(players[0]));
    await svc.addSignature(GAME, await sigOf(players[0])); // repeat
    const s = svc.get(GAME);
    expect(s.signers).toHaveLength(1);
    expect(s.status).toBe("collecting");
    expect(chain.submitSettle).not.toHaveBeenCalled();
  });

  it("fallback server attest -> submitSettleByServer", async () => {
    const chain = makeChain();
    const svc = new SettlementService(chain);
    svc.open(GAME, ranking, ranking);
    const s = await svc.submitByServer(GAME);
    expect(s.status).toBe("settled");
    expect(s.txHash).toBe("0xserver");
    expect(chain.signRanking).toHaveBeenCalledWith(BigInt(GAME), ranking);
    expect(chain.submitSettleByServer).toHaveBeenCalledWith(BigInt(GAME), ranking, "0xserversig");
  });

  it("status failed when on-chain submit fails", async () => {
    const chain = makeChain();
    (chain.submitSettle as jest.Mock).mockRejectedValueOnce(new Error("revert"));
    const svc = new SettlementService(chain);
    svc.open(GAME, ranking, ranking);
    for (const w of players) await svc.addSignature(GAME, await sigOf(w));
    const s = svc.get(GAME);
    expect(s.status).toBe("failed");
    expect(s.error).toContain("revert");
  });
});
