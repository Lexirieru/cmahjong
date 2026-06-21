# cMahjong — Frontend (MiniPay)

Mobile-first Mini App for [MiniPay](https://www.opera.com/products/minipay): connect,
stake a stablecoin, play 4-player mahjong, and withdraw winnings — all on Celo.

Built with **Next.js 16 + viem + Socket.IO**. No ethers.js, legacy transactions only
(MiniPay constraints).

## Screens

```
Home ──► Create table ──► Lobby ──► Table ──► Result
     └──► Join a table ──┘         (live board)  (withdraw)
```

- **Home** — connect (auto in MiniPay), start or join a table.
- **Create** — pick currency (cUSD / USDC / USDT / CELO), set the buy-in, create on-chain.
- **Lobby** — join (approve + stake + commit), reveal, watch players fill up.
- **Table** — the live board: opponents, dora, discard rivers, your hand, calls.
- **Result** — your winnings, withdraw to wallet.

## Stack notes

- **viem** for reads + writes; provider injected by MiniPay (`window.ethereum`).
- **Legacy gas** forced on every tx — MiniPay does not support EIP-1559.
- Settlement is **server-attested** (`settleByServer`): MiniPay can't sign messages,
  so players never sign — the backend settles, players just withdraw.
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
URL via MiniPay → compass → Test page. Enable Developer Mode + Celo Sepolia first.

Contract: `0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4` (Celo mainnet).
