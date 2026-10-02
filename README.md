# ccnodes

Typed client for the [ccnodes](https://ccnodes.net) explorer API: blocks, transactions,
addresses, rich lists, charts and mempools for Bitcoin, Litecoin, Dogecoin, Zcash, Dash,
Ycash and the scrypt family. The data comes from full nodes and indexers we run ourselves.

```sh
npm install ccnodes
```

```ts
import { CcnodesClient } from "ccnodes";

const cc = new CcnodesClient(); // anonymous: no key needed to start

const tip = await cc.tip("bitcoin");
const block = await cc.block("bitcoin", tip.height);
const txs = await cc.blockTxs("bitcoin", block.id, { limit: 10 });
console.log(txs.map((t) => [t.txid, t.fee])); // fees and input values included
```

Node 18+, modern browsers, Deno and Bun. No runtime dependencies. ESM and CommonJS.

## What's in the box

| | |
|---|---|
| **Chains** | `listChains()`, `overview()` (every chain's headline numbers, ordered by market cap), `status()`, plus `client.chains` (see below) |
| **Search** | `search(q)`: a txid, block hash, height or address, across every chain at once |
| **Blocks** | `tip`, `blocks`, `block(chain, heightOrHash)`, `blockTxs` |
| **Transactions** | `tx`, `txHex`, `broadcast` |
| **Addresses** | `address`, `addressTxs`, `addressUtxos`, `addressRank`, `balanceHistory` |
| **Rich lists & stats** | `richList`, `stats`, `charts`, `marketCharts`, `holderCharts` |
| **Mempool & fees** | `mempool`, `mempoolTxs`, `fees` |
| **Account** | `pricing()`, `usage()`; sign-in and API keys in [`ccnodes/account`](#api-keys-sign-in-with-a-wallet) |

Anything not wrapped yet: `cc.get<T>("/some/path", { query: "params" })`.

## Read this before you do arithmetic on amounts

Amounts are integers in the chain's base unit (satoshis, or that chain's equivalent).
Several chains here have a total supply **past 2^53 base units**: TrumPOW's is about
1.9 × 10^19. A JavaScript `number` can't hold such a value exactly, and plain
`JSON.parse` would round it without warning.

So this client parses losslessly. Any integer outside the safe range arrives as an
exact decimal **string**, which is why amount fields are typed `Sats = number | string`.
On most chains you'll only ever see numbers; when you need arithmetic you can trust on
every chain, convert:

```ts
import { toBigInt, formatUnits } from "ccnodes";

const s = await cc.address("trumpow", addr);
const funded = toBigInt(s.chain_stats.funded_txo_sum); // bigint, exact
formatUnits(funded!, 8); // "194500000000.00000001", no float involved
```

Fields the API already sends as strings (rich-list balances, supplies, market caps) are
typed `string`.

## Honest answers

The API prefers "we don't know" to a plausible wrong number, and the types say so:

- **`err.isBuilding`**: a rich list, rank or holder chart on a chain whose UTXO-set scan
  hasn't finished answers `503 {"state":"building"}`. That's a state, not an outage, so the
  client doesn't retry it.
  ```ts
  try { await cc.richList("ycash"); }
  catch (e) { if (e instanceof CcnodesApiError && e.isBuilding) showStillScanning(); }
  ```
- **`search().complete === false`**: some chains didn't answer in time (`inconclusive`).
  An empty `results` then means *not established*, not *does not exist*.
- **`address().available === false`**: the address has too much history to summarise. Its
  counters are zeroed and must be read as *unknown*, never as zero.
- **`fee` absent** means it couldn't be stated exactly. It is never estimated. On shielded
  chains it includes the pool terms, so it's correct where `inputs − outputs` isn't.
- **`market.stale`**: the price feed hasn't updated for a while. The price shown is the last
  real one; show its age (`market.age_secs`). `market: null` means no market we can quote,
  never a price of zero.

## API keys: sign in with a wallet

Anonymous access is rate-limited per IP. For your own quota, get a key, either from
[ccnodes.net](https://ccnodes.net) or in code, by signing in with an Ethereum wallet. The
first sign-in creates the account. There's no email and no form.

```ts
import { CcnodesClient } from "ccnodes";
import { ensureApiKey } from "ccnodes/account";
import { fileCredentialStore, privateKeySigner } from "ccnodes/node";

const signer = await privateKeySigner(process.env.WALLET_KEY!); // or any personal_sign
const { apiKey } = await ensureApiKey({
  client: new CcnodesClient(),
  ...signer,
  store: fileCredentialStore(), // ~/.ccnodes/credentials.json, mode 0600
});
const cc = new CcnodesClient({ apiKey, ratePerSec: 20 /* your plan's rate */ });
```

`ensureApiKey` is careful on purpose:

- It **reuses** a stored key with no network call. The server returns a raw key exactly
  once, so losing it means rotating, not re-creating.
- It **creates at most one** key, and only when the plan has room. Free plans hold two keys
  for life, and revoked keys count, so a library that minted a key per run would lock you
  out by the third run.
- It **never rotates** a key it didn't create. Pass `{ rotate: true }` or
  `{ rotateKeyId }` to do that deliberately.

In a browser, pass the wallet's own signer instead of a private key:

```ts
const signMessage = (msg: string) =>
  window.ethereum.request({ method: "personal_sign", params: [msg, address] });
```

`privateKeySigner` needs two optional peer dependencies:
`npm install @noble/curves @noble/hashes`. The core never loads them.

## Entry points

| Import | For | Pulls in |
|---|---|---|
| `ccnodes` | every read endpoint | nothing |
| `ccnodes/account` | wallet sign-in, API keys | nothing |
| `ccnodes/node` | credentials on disk, `clientFromEnv`, `privateKeySigner` | `node:fs`; `@noble/*` only when signing |

## New chains without a new release

The package ships a snapshot of the chain list, so `client.chains.get("dogecoin")` works
offline from the first line. Constructing a client fetches **nothing**: your startup never
waits on our uptime. The list refreshes lazily, the first time you ask
`client.chains.resolve(id)` about a chain it doesn't know, or when you call
`client.chains.refresh()`. A failed refresh keeps the list you had. In Node,
`clientFromEnv()` caches refreshes in `~/.ccnodes/chains.json`.

## Options

```ts
new CcnodesClient({
  apiKey,              // ccx_…; omit for the anonymous tier
  baseUrl,             // default https://ccnodes.net/explorer/v1
  ratePerSec: 8,       // pace to your plan's rate (anonymous: 8/s)
  burst,               // default max(rate × 5, 40), like the server
  maxRetries: 3,       // reads: network errors, 429 and 5xx (never a 503 "building")
  timeoutMs: 30_000,   // per attempt
  fetch,               // bring your own
  appId: "my-app/1.0", // appended to the client identifier
});
```

Every method takes `{ signal }` for cancellation. The client sends
`X-Ccnodes-Client: ccnodes-sdk/<version> (<runtime>)`, which is how SDK usage shows up in our
stats. It's never used for rate limits or access.

## Development

```sh
npm test            # unit tests, offline
npm run test:live   # against the real API (light: it skips heavy addresses)
npm run build
npm run snapshot:chains   # refresh the bundled chain list
```

Releases are published from a `v*` tag by the release workflow.

MIT licence.
