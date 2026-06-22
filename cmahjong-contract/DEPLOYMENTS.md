# Deployments

## Celo Mainnet (chain id 42220) — UUPS Upgradeable ✅

> **The address used by the app & Talent App = PROXY.** The implementation holds only the logic.

| Item | Value |
|------|-------|
| **MahjongTable (PROXY)** | [`0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4`](https://celoscan.io/address/0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4) |
| Implementation (v1) | [`0xb0b902ba7Fa60bc057684E56fAA32D3516ddaE53`](https://celoscan.io/address/0xb0b902ba7Fa60bc057684E56fAA32D3516ddaE53) |
| Pattern | UUPS (ERC1967Proxy) |
| Owner / house / upgrader | `0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E` |
| Rake | 0 bps (no house cut — skill-prize model) |
| Verified | ✅ proxy & implementation on Celoscan |
| Compiler | solc 0.8.30, optimizer 200, evm cancun |

### Buy-in token allowlist
| Token | Address | Decimals |
|-------|---------|----------|
| cUSD | `0x765DE816845861e75A25fCA122bb6898B8B1282a` | 18 |
| USDC | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | 6 |
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 |
| CELO (native) | `0x0000000000000000000000000000000000000000` | 18 |

The owner can add/remove tokens via `setTokenAllowed(token, allowed)`.

### Upgrade (UUPS)
Owner only. Deploy a new implementation then call on the proxy:
`upgradeToAndCall(newImpl, initData)` (initData `0x` if there is no migration).

---

## Deprecated

| Version | Address | Notes |
|-------|---------|---------|
| v0 (non-upgradeable) | `0x5AB8a679fd0419a15A37e530Fad4F18C10011A0c` | **Do not use.** Replaced by the UUPS version above. |
