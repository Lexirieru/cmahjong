# cMahjong — Backend (Riichi Game Engine)

Offchain **Riichi** Mahjong engine + bridge to the Celo escrow contract. The blockchain
is only the cashier + notary (escrow, seed fairness, settlement); all game logic
lives here.

Stack: **NestJS + Socket.IO + Prisma/Postgres + ethers v6**.

## Architecture

```
src/
  engine/        Pure Riichi engine (framework-agnostic, tested)
    tiles.ts       136 tiles, 34 kinds, utils
    wall.ts        DETERMINISTIC shuffle from the on-chain seed (provably fair)
    deal.ts        13×4 deal + dead wall + dora
    agari.ts       win detection: standard / chiitoitsu / kokushi + tenpai/waits
    yaku.ts        yaku detection (common + main yakuman)
    score.ts       fu/han -> points (mangan+ table), pick the best interpretation
  chain/         Celo integration
    seed.ts        commit/seed mirroring the contract (keccak256 abi.encodePacked)
    signer.ts      EIP-712 GameResult (for settleByServer)
    chain.service  read on-chain game + server signature
  game/          State machine + realtime
    round.ts       single-round mechanics: draw/discard, prioritized calls (ron>pon/kan>chi),
                   ankan/shouminkan, riichi/double-riichi, ippatsu, furiten,
                   tsumo/ron/exhaustive draw + noten payment
    hanchan.ts     multi-round orchestration: dealer rotation, wind East→South,
                   honba, riichi sticks, renchan, final ranking
    game.service   room manager (in-memory) + ranking finalization & signing
    game.gateway   WebSocket (Socket.IO) table events
  settlement/    On-chain payout
    settlement.service  collect player signatures -> settle / server fallback
    settlement.controller  REST: status, submit sig, typed-data, server-fallback
  prisma/        PrismaService (mirror game metadata to Postgres)
```

### Settle flow (full money loop)
1. Hanchan finishes → backend computes the **final ranking** & opens a settle session
   (WS event `settleReady`, or `GET /settlement/:id`).
2. Clients fetch the EIP-712 payload (`GET /settlement/:id/typed-data`), each player
   `signTypedData`, then sends it via WS `submitSignature` or
   `POST /settlement/:id/signature`.
3. When **4 signatures** are collected → backend submits the cooperative `settle` on-chain
   (server pays gas, anyone may call it).
4. If someone refuses to sign by `settleDeadline` → `POST /settlement/:id/server-fallback`
   triggers `settleByServer` (server attests; the contract enforces the deadline).
5. Rewards are credited in the contract → winners `withdraw`.

### Provably fair
Seed = `keccak256(secret0..3)` from the on-chain commit–reveal. `wall.ts` shuffles the wall
deterministically from that seed (keccak256-based Fisher–Yates), so anyone can recompute
the wall from the public seed and verify the server didn't cheat. Hand secrecy is preserved
because only the seat owner receives the `hand` event.

## Running

```bash
npm install
cp .env.example .env        # set SERVER_PRIVATE_KEY (= game.server on-chain)
npm run db:up               # Postgres via Docker
npm run prisma:generate
npm run prisma:migrate
npm run start:dev           # http://localhost:3001 (WebSocket Socket.IO)
```

## Test

```bash
npm test            # all tests (engine + round + chain)
npm run test:engine # engine only
```

## Status & roadmap

Working & tested (74 tests):
- Deterministic engine, agari (3 forms), core yaku + yakuman, fu/han scoring
- Scoring with **open melds & kan**, **dora + kan-dora + uradora** (ura only on riichi)
- Complete round mechanics: **pon/chi/daiminkan calls**, **ankan/shouminkan** (+rinshan/kan-dora),
  riichi + **double riichi**, **ippatsu**, **furiten** (permanent/temporary/riichi),
  **chankan** (rob the kan), tsumo, ron, exhaustive draw + **noten payment**
- **Call priority** (ron > pon/kan > chi) + **multi-ron** (double/triple ron) via
  collecting player responses + head-bump
- **Hanchan** multi-round: dealer rotation, East→South, **honba**, **riichi sticks**,
  renchan (dealer wins/tenpai), final ranking
- commit/seed mirroring the contract, EIP-712 signer, WS gateway, Postgres schema

- **On-chain settle**: collect player signatures → cooperative `settle`, or
  `settleByServer` fallback; expose EIP-712 typed-data + REST/WS endpoints
- **Postgres persistence**: lifecycle + results + **live snapshot** (resume after
  restart) + **per-action Move log** for replay. `replayGame(seed, moves)`
  reproduces the game exactly (e2e tested: 347 actions → identical final state).
  Endpoints: `GET /games`, `GET /games/:id/replay` (seed tape + ordered actions).

Further TODO:
- Player auth at the gateway (verify wallet signature)
- MiniPay frontend
