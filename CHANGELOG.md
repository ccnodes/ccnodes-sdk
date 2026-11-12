# Changelog

## Unreleased

- Chain-data endpoints: `pools`, `valuePoolCharts`, `mweb`, `mwebPegs`,
  `mwebSupply`, `masternodes`, `masternodeList`, `masternodeEvents`,
  `masternodePayments`, `masternode`, `p2pNodes`, `p2pNodeList`, `addnodes`
  and `addnodesText`, plus a test that fails when the server documents a data
  endpoint the SDK lacks.

## 0.1.0 — unreleased

First release.

- `CcnodesClient`: every read endpoint of the explorer API — blocks, block
  transactions (with prevouts and fees), transactions, broadcast, addresses,
  balance history, rich lists, chain stats, charts, mempool, fees, and the
  fleet-wide `overview`, `search` and `status`.
- Lossless JSON: integers past 2^53 arrive as exact decimal strings, never as
  rounded floats. `toBigInt` and `formatUnits` for exact arithmetic.
- Typed errors: `CcnodesApiError` (`isBuilding`, `isRateLimited`,
  `isNotFound`) and `CcnodesNetworkError`.
- Pacing that mirrors the server's token bucket, retries with jittered backoff
  for transient failures, a per-attempt timeout and `AbortSignal` support.
- The chain list ships as a snapshot and refreshes lazily — adding a chain on
  the server needs no SDK release.
- `ccnodes/account`: wallet sign-in (SIWE), API-key management, and
  `ensureApiKey`, which creates a key at most once and never rotates one it did
  not create.
- `ccnodes/node`: file-backed credential store (0600) and chain cache,
  `clientFromEnv`, and an opt-in `privateKeySigner`.
