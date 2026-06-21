# cMahjong — Contracts

Smart contract escrow & settlement untuk **cMahjong**, mahjong 4 pemain di **Celo**
(buy-in stablecoin via MiniPay). Blockchain di sini hanya berperan sebagai
**kasir + notaris**: menahan buy-in, meng-anchor fairness, dan mencairkan hadiah.
Logika permainan (tiles, giliran, validasi move) berjalan **offchain**.

## `MahjongTable.sol`

Satu kontrak mengelola banyak game (`gameId => Game`). Alur 1 game:

1. **`createGame`** — organizer set buy-in, `server` (operator engine), bobot payout
   (uma/oka, rank 1..4, sum = 10000 bps), dan deadline (commit/reveal/settle).
2. **`joinGame`** — 4 pemain deposit buy-in (perlu `approve` dulu) + submit
   `commitment = keccak256(gameId, player, secret)` untuk fairness.
3. **`revealSeed`** — tiap pemain buka secret; saat keempat terbuka,
   `seed = keccak256(secret0..3)` di-anchor onchain (provably fair, tak ada satu
   pihak pun yang bisa predetermine urutan tiles).
4. **(offchain)** — game dimainkan, server menghitung ranking 1st..4th.
5. **`settle`** — keempat pemain menandatangani ranking (EIP-712) → payout dicairkan
   sekali di akhir (bukan tiap ronde, agar hemat fee).
   **`settleByServer`** — fallback setelah `settleDeadline`: server meng-attest
   ranking (anti rage-quit / pemain menolak tanda tangan).

### Anti-griefing / timeout
- **`cancelUnfilled`** — meja tak penuh sampai `commitDeadline` → refund para joiner.
- **`cancelUnrevealed`** — ada yang menahan reveal sampai `revealDeadline` → pemain
  yang menahan **forfeit** stake-nya, dibagi rata ke yang sudah reveal.

### Trust model (MVP)
Server tidak bisa me-rig urutan tiles (seed patungan commit–reveal), tapi pemain
percaya server tidak membocorkan tangan lawan. Jujur & cukup untuk hackathon.
North star: encrypted shuffle (mental poker) → zkMahjong.

## Development

```shell
forge build
forge test            # banyak test: happy path, edge case, & revert path
forge test -vvv       # verbose
forge fmt
forge coverage
```

## Deploy

Isi `.env` (lihat `.env.example`), lalu:

```shell
# Testnet Alfajores (disarankan dulu)
forge script script/DeployMahjongTable.s.sol --rpc-url alfajores --broadcast --verify

# Mainnet Celo
forge script script/DeployMahjongTable.s.sol --rpc-url celo --broadcast --verify
```

cUSD: mainnet `0x765DE816845861e75A25fCA122bb6898B8B1282a`,
Alfajores `0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1`.
