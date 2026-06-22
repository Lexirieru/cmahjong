<p align="center">
  <img src="cmahjong-frontend/public/logos/cmahjong.webp" width="116" alt="cMahjong logo" />
</p>

<h1 align="center">cMahjong</h1>

<p align="center"><b>Real mahjong, real prizes — on Celo.</b></p>

<p align="center">
  <a href="https://cmahjong.vercel.app"><b>▶ Play</b></a> &nbsp;·&nbsp;
  <a href="https://cmahjong.vercel.app/stats">Stats</a> &nbsp;·&nbsp;
  <a href="https://celoscan.io/address/0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4">Contract</a> &nbsp;·&nbsp;
  <a href="https://cmahjong.vercel.app/?preview=howto">How to play</a>
</p>

---

cMahjong is a four-player mahjong game for MiniPay users who want to play for real money — four people put a stablecoin entry into a prize pool, play a full hand of **riichi mahjong**, and the winners share the pool by final standing. No house cut.

Most "play for money" crypto games are coin-flips with extra steps. Riichi mahjong is the opposite: a deep skill game where the better player wins out over time. The blockchain just holds the money and pays it out — it never decides who won.

**Live app:** https://cmahjong.vercel.app

## How a game works

1. **Create or join a table** — pick the entry amount in USDm, USDC, or USDT. Four players each deposit the same amount into the escrow contract.
2. **Provably fair deal** — each player commits a secret, then reveals it. The four secrets are hashed into one seed that shuffles the wall, so nobody (not even me) can rig the tiles, and anyone can recompute the deal from the public seed.
3. **Play** — a full hand of riichi mahjong: draw, discard, call pon/chi/kan, declare riichi, win by tsumo or ron. The rules engine runs off-chain in real time over WebSocket.
4. **Get paid** — when the game ends, the prize pool is split by rank (50 / 30 / 15 / 5%) and credited in the contract. Winners withdraw to their wallet.

Because MiniPay can't sign typed messages, settlement never asks players to sign anything: the server attests the final ranking on-chain after a deadline (`settleByServer`), and that ranking is exactly what the engine computed.

## Why the blockchain is only the cashier

The mental model is **blockchain = cashier + notary, not the game engine.** Only the money and the proof of the result live on-chain. All the mahjong logic — a complete riichi implementation — runs off-chain where it's fast and free to iterate. Games stay responsive and gas stays cheap, while the escrow and payout stay trustless and verifiable.

```
Player (MiniPay)  ──join / deposit──►  MahjongTable.sol (Celo)  ◄──settle──  Server
       │                                                                       ▲
       └───────────── WebSocket gameplay ──────────►  Riichi engine (off-chain)
```

## Repo layout

| Package | What's inside |
|---------|---------------|
| [`cmahjong-contract`](./cmahjong-contract) | Foundry. `MahjongTable` (UUPS upgradeable): stablecoin escrow, commit–reveal seed, cooperative `settle` (EIP-712) + `settleByServer` fallback, forfeit/timeout. Verified on Celoscan. |
| [`cmahjong-backend`](./cmahjong-backend) | NestJS + Socket.IO + Prisma. Full riichi engine (deterministic deal, pon/chi/kan, chankan, riichi/ippatsu/furiten, yaku + fu/han scoring, hanchan), on-chain integration, auto-settle, replay log, public stats. |
| [`cmahjong-frontend`](./cmahjong-frontend) | Next.js + viem, mobile-first for MiniPay. Create/join, lobby, live board, result, history & step-through replay, public `/stats`. |

## Built with

- **Celo** (L2, chain 42220) — escrow, settlement, and fee abstraction
- **Foundry** + Solidity 0.8.30, OpenZeppelin UUPS proxy
- **NestJS** + Socket.IO + Prisma / Postgres (Supabase) — engine & realtime
- **Next.js** + **viem** — MiniPay frontend (no ethers, legacy txs, no message signing)
- **ethers v6** — server-side chain calls

## Run it locally

```bash
# Contract
cd cmahjong-contract && forge test

# Backend (engine + realtime)
cd cmahjong-backend
cp .env.example .env        # set DATABASE_URL, CELO_RPC, MAHJONG_ADDRESS, SERVER_PRIVATE_KEY
npm install && npm run start:dev      # http://localhost:3001

# Frontend
cd cmahjong-frontend
echo "NEXT_PUBLIC_BACKEND_URL=http://localhost:3001" > .env.local
bun install && bun run dev            # http://localhost:3000
```

## Deployments (Celo Mainnet, chain 42220)

| Item | Address |
|------|---------|
| MahjongTable (proxy) | [`0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4`](https://celoscan.io/address/0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4) |
| Implementation | [`0xb0b902ba7Fa60bc057684E56fAA32D3516ddaE53`](https://celoscan.io/address/0xb0b902ba7Fa60bc057684E56fAA32D3516ddaE53) |
| Frontend | https://cmahjong.vercel.app |
| Backend | Railway (REST + WebSocket) |

Both contracts are verified on Celoscan. Entry tokens: USDm (cUSD) · USDC · USDT. House cut: **0%**. Full details in [`cmahjong-contract/DEPLOYMENTS.md`](./cmahjong-contract/DEPLOYMENTS.md).

## Status

Built solo for Celo **Proof of Ship**. Working end-to-end on mainnet: full riichi engine, on-chain escrow + commit-reveal + settlement, real-time multiplayer, persistence with resume after restart, and step-through replay. A four-player game (one human in MiniPay, three test wallets) has been played and settled on-chain.

Next: encrypted shuffle so the server can't see hidden hands either — the path toward a fully trustless mahjong table.

## License

MIT
