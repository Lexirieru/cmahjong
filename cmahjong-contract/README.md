# cMahjong — Contracts

Smart contract escrow & settlement for **cMahjong**, a 4-player skill-based mahjong on
**Celo**. Four players each deposit a stablecoin entry (USDm / USDC / USDT) that forms the
prize pool; the blockchain acts purely as a **cashier + notary** — it holds the entries,
anchors fairness, and pays out the prize by rank with **no house cut**. The game logic
(tiles, turns, move validation) runs **offchain**.

## `MahjongTable.sol`

A single contract manages many games (`gameId => Game`). One-game flow:

1. **`createGame`** — organizer sets the buy-in, `server` (engine operator), payout weights
   (uma/oka, ranks 1..4, sum = 10000 bps), and deadlines (commit/reveal/settle).
2. **`joinGame`** — 4 players deposit the buy-in (needs `approve` first) + submit
   `commitment = keccak256(gameId, player, secret)` for fairness.
3. **`revealSeed`** — each player opens their secret; once all four are open,
   `seed = keccak256(secret0..3)` is anchored onchain (provably fair, no single
   party can predetermine the tile order).
4. **(offchain)** — the game is played, the server computes the 1st..4th ranking.
5. **`settle`** — all four players sign the ranking (EIP-712) → the payout is settled
   once at the end (not per round, to save fees).
   **`settleByServer`** — fallback after `settleDeadline`: the server attests the
   ranking (anti rage-quit / players refusing to sign).

### Anti-griefing / timeout
- **`cancelUnfilled`** — table not full by `commitDeadline` → refund the joiners.
- **`cancelUnrevealed`** — someone stalls the reveal until `revealDeadline` → the
  stalling player **forfeits** their stake, split evenly among those who revealed.

### Trust model (MVP)
The server cannot rig the tile order (a pooled commit–reveal seed), but players
trust the server not to leak opponents' hands. Honest and good enough for a hackathon.
North star: encrypted shuffle (mental poker) → zkMahjong.

## Development

```shell
forge build
forge test            # many tests: happy path, edge cases, & revert paths
forge test -vvv       # verbose
forge fmt
forge coverage
```

## Deploy

Fill in `.env` (see `.env.example`), then:

```shell
# Alfajores testnet (recommended first)
forge script script/DeployMahjongTable.s.sol --rpc-url alfajores --broadcast --verify

# Celo mainnet
forge script script/DeployMahjongTable.s.sol --rpc-url celo --broadcast --verify
```

cUSD: mainnet `0x765DE816845861e75A25fCA122bb6898B8B1282a`,
Alfajores `0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1`.
