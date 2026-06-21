# cMahjong — Backend (Game Engine Riichi)

Engine Mahjong **Riichi** offchain + jembatan ke kontrak escrow Celo. Blockchain
hanya kasir + notaris (escrow, seed fairness, settlement); seluruh logika permainan
ada di sini.

Stack: **NestJS + Socket.IO + Prisma/Postgres + ethers v6**.

## Arsitektur

```
src/
  engine/        Engine Riichi murni (framework-agnostic, teruji)
    tiles.ts       136 ubin, 34 kind, util
    wall.ts        shuffle DETERMINISTIK dari seed on-chain (provably fair)
    deal.ts        pembagian 13×4 + dead wall + dora
    agari.ts       deteksi menang: standar / chiitoitsu / kokushi + tenpai/waits
    yaku.ts        deteksi yaku (umum + yakuman utama)
    score.ts       fu/han -> poin (tabel mangan+), pilih interpretasi terbaik
  chain/         Integrasi Celo
    seed.ts        commit/seed mirror kontrak (keccak256 abi.encodePacked)
    signer.ts      EIP-712 GameResult (untuk settleByServer)
    chain.service  baca game on-chain + tandatangan server
  game/          State machine + realtime
    round.ts       mekanik 1 ronde: draw/discard, call berprioritas (ron>pon/kan>chi),
                   ankan/shouminkan, riichi/double-riichi, ippatsu, furiten,
                   tsumo/ron/exhaustive draw + noten payment
    hanchan.ts     orkestrasi multi-ronde: rotasi dealer, wind East→South,
                   honba, riichi sticks, renchan, ranking final
    game.service   manajer room (in-memory) + finalisasi ranking & sign
    game.gateway   WebSocket (Socket.IO) event meja
  settlement/    Pencairan on-chain
    settlement.service  kumpul tanda tangan pemain -> settle / fallback server
    settlement.controller  REST: status, submit sig, typed-data, server-fallback
  prisma/        PrismaService (mirror metadata game ke Postgres)
```

### Alur settle (loop duit penuh)
1. Hanchan selesai → backend hitung **ranking final** & buka sesi settle
   (event WS `settleReady`, atau `GET /settlement/:id`).
2. Klien ambil payload EIP-712 (`GET /settlement/:id/typed-data`), tiap pemain
   `signTypedData`, lalu kirim via WS `submitSignature` atau
   `POST /settlement/:id/signature`.
3. Saat **4 tanda tangan** terkumpul → backend submit `settle` kooperatif on-chain
   (server bayar gas, siapa pun boleh memanggil).
4. Bila ada yang menolak TTD sampai `settleDeadline` → `POST /settlement/:id/server-fallback`
   memicu `settleByServer` (server attest; kontrak menegakkan deadline).
5. Hadiah dikreditkan di kontrak → pemenang `withdraw`.

### Provably fair
Seed = `keccak256(secret0..3)` dari commit–reveal on-chain. `wall.ts` mengocok tembok
secara deterministik dari seed itu (Fisher–Yates berbasis keccak256), sehingga siapa
pun bisa menghitung ulang tembok dari seed publik dan memverifikasi server tak curang.
Kerahasiaan tangan dijaga karena hanya pemilik seat yang menerima event `hand`.

## Menjalankan

```bash
npm install
cp .env.example .env        # isi SERVER_PRIVATE_KEY (= game.server on-chain)
npm run db:up               # Postgres via Docker
npm run prisma:generate
npm run prisma:migrate
npm run start:dev           # http://localhost:3001 (WebSocket Socket.IO)
```

## Test

```bash
npm test            # seluruh test (engine + ronde + chain)
npm run test:engine # hanya engine
```

## Status & roadmap

Sudah jalan & teruji (55 test):
- Engine deterministik, agari (3 bentuk), yaku inti + yakuman, scoring fu/han
- Scoring dengan **meld terbuka & kan**, **dora + kan-dora + uradora** (ura hanya saat riichi)
- Mekanik ronde lengkap: **call pon/chi/daiminkan**, **ankan/shouminkan** (+rinshan/kan-dora),
  riichi + **double riichi**, **ippatsu**, **furiten** (permanen/sementara/riichi),
  **chankan** (rob the kan), tsumo, ron, exhaustive draw + **noten payment**
- **Prioritas call** (ron > pon/kan > chi) + **multi-ron** (double/triple ron) via
  pengumpulan respons pemain + head-bump
- **Hanchan** multi-ronde: rotasi dealer, East→South, **honba**, **riichi sticks**,
  renchan (dealer menang/tenpai), ranking final
- commit/seed mirror kontrak, EIP-712 signer, gateway WS, skema Postgres

- **Settle on-chain**: kumpul tanda tangan pemain → `settle` kooperatif, atau
  `settleByServer` fallback; ekspos EIP-712 typed-data + REST/WS endpoint
- **Persist Postgres**: lifecycle game + hasil akhir (GameTable/Seat) + **snapshot
  state ronde LIVE** (kolom `liveState`) yang disimpan coalesced tiap aksi. Saat
  boot, game `PLAYING` dipulihkan dari DB → **resume setelah restart** (teruji e2e).

TODO lanjutan:
- Log Move per aksi (replay langkah-demi-langkah)
- Auth pemain di gateway (verifikasi tanda tangan wallet)
- Auth pemain (verifikasi tanda tangan wallet) di gateway
- Frontend MiniPay
