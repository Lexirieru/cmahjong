# cMahjong — Frontend (MiniPay)

Mobile-first Mini App for [MiniPay](https://www.opera.com/products/minipay): connect,
join a stablecoin prize pool, play 4-player riichi mahjong, and withdraw your prize —
all on Celo. No house cut.

Built with **Next.js 16 + viem + Socket.IO**. No ethers.js, legacy transactions only
(MiniPay constraints).

## Screens

```
Home ──► Create table ──► Lobby ──► Table ──► Result
     └──► Join a table ──┘         (live board)  (withdraw)
```

- **Home** — connect (auto in MiniPay), create or join a table, plus how-to-play,
  history, and stats.
- **Create** — pick the prize currency (USDm / USDC / USDT), set the entry, create on-chain.
- **Lobby** — join (approve + deposit + commit), reveal, watch the table fill up.
- **Table** — the live board: opponents, dora, discard rivers, your hand, calls.
- **Result** — your prize, withdraw to wallet.
- **History / Replay** — past games + step-through replay (board reconstructed
  from the move log via `GET /games/:id/replay/states`).
- **Stats** (`/stats`), **How to play**, **Terms** & **Privacy** — public, no wallet needed.

Preview without wallet/backend: `/?preview=table`, `/?preview=history`,
`/?preview=replay&game=<id>`, `/?preview=howto`.

## Stack notes

- **viem** for reads + writes; provider injected by MiniPay (`window.ethereum`).
- **Legacy gas** forced on every tx — MiniPay does not support EIP-1559.
- **No message signing**: MiniPay can't sign typed data, so players never sign.
  Settlement is server-attested (`settleByServer`); players only deposit and withdraw.
- **Stablecoins only** (USDm / USDC / USDT) — never CELO, per MiniPay rules.
- **Phone-first identity** — players are shown as friendly aliases, never a raw `0x…`.
- Tile artwork: vendored SVGs in `public/tiles` (FluffyStuff, CC0).

## Develop

```bash
bun install
bun run dev          # http://localhost:3000
# preview the board without wallet/backend:  /?preview=table
```

Env (`.env.local`, see `.env.example`):

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001     # game engine (Socket.IO)
NEXT_PUBLIC_SERVER_ADDRESS=0x56A2950d…            # operator (= game server)
```

### Test in MiniPay
MiniPay can't reach localhost — expose with `ngrok http 3000`, then open the HTTPS
URL via MiniPay → compass → Test page. Enable Developer Mode first.

Live: https://cmahjong.vercel.app · Contract: `0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4` (Celo mainnet).
