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
    round.ts       mekanik 1 ronde (draw/discard/riichi/tsumo/ron/ranking)
    game.service   manajer room (in-memory) + finalisasi ranking & sign
    game.gateway   WebSocket (Socket.IO) event meja
  prisma/        PrismaService (mirror metadata game ke Postgres)
```

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

Sudah jalan & teruji: engine deterministik, agari (3 bentuk), set yaku inti +
yakuman, scoring fu/han, mekanik ronde (draw/discard/riichi/tsumo/ron/ranking),
commit/seed mirror kontrak, EIP-712 signer, gateway WS, skema Postgres.

TODO lanjutan:
- Call **pon/chi/kan** + interupsi giliran (out-of-turn)
- Furiten, ippatsu, uradora, dora setelah kan
- Multi-ronde **hanchan** (East + South) + renchan dealer
- Persist penuh state ronde ke Postgres (replay/resume)
- Auth pemain (verifikasi tanda tangan wallet) di gateway
- Endpoint settle: relay ranking + signature ke kontrak
