# cMahjong

Mahjong **Riichi** 4 pemain on-chain di **Celo**, untuk **MiniPay** — buy-in stablecoin,
shuffle *provably fair*, dan pencairan transparan via escrow on-chain.
Dibangun untuk hackathon **Proof of Ship** (Celo).

> Mental model: **blockchain = kasir + notaris**, bukan game engine. Hanya uang &
> bukti hasil yang on-chain; logika permainan berjalan offchain.

## Monorepo

| Paket | Isi |
|-------|-----|
| [`cmahjong-contract`](./cmahjong-contract) | Foundry. `MahjongTable` (UUPS upgradeable): escrow multi-token (cUSD/USDC/USDT/CELO), commit–reveal seed, settle (EIP-712) + `settleByServer`, forfeit/timeout. |
| [`cmahjong-backend`](./cmahjong-backend) | NestJS. Engine Riichi lengkap (deal deterministik, call/kan/chankan, riichi/ippatsu/furiten, yaku + fu/han, hanchan) + integrasi chain + settle. |
| [`cmahjong-frontend`](./cmahjong-frontend) | Next.js (mobile-first MiniPay). *Menyusul.* |

## Deployment (Celo Mainnet, chain 42220)

| | Address |
|---|---|
| **MahjongTable (proxy)** | [`0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4`](https://celoscan.io/address/0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4) |
| Implementation | [`0xb0b902ba7Fa60bc057684E56fAA32D3516ddaE53`](https://celoscan.io/address/0xb0b902ba7Fa60bc057684E56fAA32D3516ddaE53) |

Keduanya **verified**. Allowlist buy-in: cUSD, USDC, USDT, CELO native. Detail di
[`cmahjong-contract/DEPLOYMENTS.md`](./cmahjong-contract/DEPLOYMENTS.md).

## Alur 1 game

```
createGame ──► joinGame (deposit + commit) ──► revealSeed (seed kolektif)
     │                                               │
   (on-chain escrow)                          (provably fair)
                                                     ▼
                            ◄── offchain: deal 13 ubin/pemain, hanchan main ──►
                                                     │
                ranking final ──► settle (4 TTD pemain) / settleByServer (fallback)
                                                     ▼
                                  hadiah dikreditkan ──► withdraw
```

## Trust model (MVP)
Server tidak bisa me-rig urutan tiles (seed patungan commit–reveal), tapi pemain
percaya server tidak membocorkan tangan lawan. North star: encrypted shuffle → zkMahjong.
