import { CcnodesApiError, CcnodesNetworkError } from "./errors.js";
import { parseJson } from "./json.js";
import { TokenBucket } from "./limiter.js";
import { ChainRegistry, type ManifestCache } from "./manifest.js";
import { SDK_VERSION } from "./version.js";
import type {
  AddnodeList,
  AddressRank,
  AddressStats,
  BalanceHistory,
  Block,
  BroadcastResult,
  Chain,
  ChartRange,
  ChainStats,
  Charts,
  FeeEstimate,
  HolderCharts,
  MarketCharts,
  MasternodeDetail,
  MasternodeEvents,
  MasternodeList,
  MasternodePayments,
  MasternodeSummary,
  MempoolInfo,
  MempoolTxs,
  MiningPools,
  MwebPegs,
  MwebSummary,
  MwebSupply,
  NodeStatus,
  Overview,
  P2PNetwork,
  P2PNodeList,
  Pricing,
  RichList,
  SearchResponse,
  Tip,
  Transaction,
  Usage,
  Utxo,
  ValuePoolCharts,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://ccnodes.net/explorer/v1";

export interface CcnodesClientOptions {
  /**
   * Your API key (`ccx_…`). Optional: without one you use the anonymous tier,
   * which is rate-limited per IP. Create one at https://ccnodes.net or with
   * `ccnodes/account`'s `ensureApiKey`.
   */
  apiKey?: string;
  /** Default `https://ccnodes.net/explorer/v1`. */
  baseUrl?: string;
  /**
   * Steady request rate the client paces itself to. Default 8/s, the
   * anonymous tier's rate. Set it to your plan's `rate_per_sec` when using a key.
   */
  ratePerSec?: number;
  /** Requests allowed at once before pacing starts. Default `max(rate × 5, 40)`, as the server does. */
  burst?: number;
  /** Retries for reads that failed transiently (network, 429, 5xx). Default 3. */
  maxRetries?: number;
  /** Per-attempt timeout. Default 30s. */
  timeoutMs?: number;
  /** A `fetch` implementation. Default: the global one (Node 18+, browsers, Deno, Bun). */
  fetch?: typeof fetch;
  /** Persist chain-list refreshes between processes (see `ccnodes/node`'s `fileManifestCache`). */
  manifestCache?: ManifestCache;
  /** Appended to the client identifier, e.g. `"my-app/1.2"`. */
  appId?: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface Page {
  limit?: number;
  offset?: number;
}

type Query = Record<string, string | number | boolean | undefined>;

/**
 * A client for one ccnodes API base URL.
 *
 * ```ts
 * import { CcnodesClient } from "ccnodes";
 * const cc = new CcnodesClient({ apiKey: process.env.CCNODES_API_KEY });
 * const tip = await cc.tip("bitcoin");
 * ```
 */
export class CcnodesClient {
  readonly baseUrl: string;
  /** Known chains: a bundled snapshot, refreshed lazily from `GET /chains`. */
  readonly chains: ChainRegistry;
  private readonly apiKey?: string;
  private readonly bucket: TokenBucket;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly clientId: string;

  constructor(opts: CcnodesClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = opts.apiKey?.trim() || undefined;
    const rate = opts.ratePerSec ?? 8;
    this.bucket = new TokenBucket(rate, opts.burst ?? Math.max(rate * 5, 40));
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    // Wrap rather than store the bare global: calling it as `this.fetchFn(…)`
    // would rebind `this`, and browsers throw "Illegal invocation".
    const f = opts.fetch;
    this.fetchFn = f ? (i, init) => f(i, init) : (i, init) => fetch(i, init);
    this.clientId = `ccnodes-sdk/${SDK_VERSION} (${runtime()})` + (opts.appId ? ` ${opts.appId}` : "");
    this.chains = new ChainRegistry(() => this.listChains(), { cache: opts.manifestCache });
  }

  // ---- fleet-wide ----------------------------------------------------------------

  /** Every chain, live, with sync status. (`client.chains` is the cached view.) */
  listChains(o?: RequestOptions): Promise<Chain[]> {
    return this.get("/chains", undefined, o);
  }
  /** Every chain's headline numbers in one request, ordered by market cap. */
  overview(o?: RequestOptions): Promise<Overview> {
    return this.get("/overview", undefined, o);
  }
  /**
   * Resolve a txid, block hash, height or address across every chain.
   * Check `complete` before treating an empty result as "not found".
   */
  search(q: string, o?: RequestOptions): Promise<SearchResponse> {
    return this.get("/search", { q }, o);
  }
  /** Live status of every node and its address index. */
  status(o?: RequestOptions): Promise<NodeStatus[]> {
    return this.get("/status", undefined, o);
  }
  /** Plans, endpoint costs and whether billing is enforced. */
  pricing(o?: RequestOptions): Promise<Pricing> {
    return this.get("/pricing", undefined, o);
  }
  /** Usage and quota for the API key this client was built with. */
  usage(o?: RequestOptions): Promise<Usage> {
    return this.get("/account/usage", undefined, o);
  }

  // ---- blocks --------------------------------------------------------------------

  tip(chain: string, o?: RequestOptions): Promise<Tip> {
    return this.get(`/${seg(chain)}/blocks/tip`, undefined, o);
  }
  /** Most recent blocks, newest first. `limit` up to 50. */
  blocks(chain: string, opts: { limit?: number } & RequestOptions = {}): Promise<Block[]> {
    return this.get(`/${seg(chain)}/blocks`, { limit: opts.limit }, opts);
  }
  /** A block by height (number, or a decimal string) or by hash. */
  block(chain: string, heightOrHash: number | string, o?: RequestOptions): Promise<Block> {
    return isHeight(heightOrHash)
      ? this.get(`/${seg(chain)}/block/height/${heightOrHash}`, undefined, o)
      : this.get(`/${seg(chain)}/block/${seg(String(heightOrHash))}`, undefined, o);
  }
  /** A block's transactions, with prevouts and fees. `limit` up to 100. */
  blockTxs(chain: string, hash: string, opts: Page & RequestOptions = {}): Promise<Transaction[]> {
    return this.get(`/${seg(chain)}/block/${seg(hash)}/txs`, { limit: opts.limit, offset: opts.offset }, opts);
  }

  // ---- transactions ----------------------------------------------------------------

  tx(chain: string, txid: string, o?: RequestOptions): Promise<Transaction> {
    return this.get(`/${seg(chain)}/tx/${seg(txid)}`, undefined, o);
  }
  async txHex(chain: string, txid: string, o?: RequestOptions): Promise<string> {
    return (await this.text("GET", `/${seg(chain)}/tx/${seg(txid)}/hex`, undefined, undefined, o)).trim();
  }
  /**
   * Broadcast a signed raw transaction (hex). A policy reject (fee too low,
   * dust, missing inputs) throws a 400 carrying the node's reason; a
   * transaction the chain already has resolves with `already_known: true`.
   */
  async broadcast(chain: string, rawHex: string, o?: RequestOptions): Promise<BroadcastResult> {
    const body = rawHex.trim();
    if (!/^[0-9a-fA-F]+$/.test(body)) throw new TypeError("broadcast: rawHex must be a hex string");
    return parseJson(await this.text("POST", `/${seg(chain)}/tx`, undefined, body, o));
  }

  // ---- addresses ---------------------------------------------------------------------

  /** Balance and counters. Check `available` before reading zeros as zeros. */
  address(chain: string, address: string, o?: RequestOptions): Promise<AddressStats> {
    return this.get(`/${seg(chain)}/address/${seg(address)}`, undefined, o);
  }
  /** Most recent transactions, newest first. */
  addressTxs(chain: string, address: string, o?: RequestOptions): Promise<Transaction[]> {
    return this.get(`/${seg(chain)}/address/${seg(address)}/txs`, undefined, o);
  }
  /** Unspent outputs, capped by the server (2,000); a capped list is not a balance. */
  addressUtxos(chain: string, address: string, o?: RequestOptions): Promise<Utxo[]> {
    return this.get(`/${seg(chain)}/address/${seg(address)}/utxo`, undefined, o);
  }
  /** Rich-list rank and exact balance, where the chain's rich list is built. */
  addressRank(chain: string, address: string, o?: RequestOptions): Promise<AddressRank> {
    return this.get(`/${seg(chain)}/address/${seg(address)}/rank`, undefined, o);
  }
  /** Running balance over time. `available: false` means no curve, never a partial one. */
  balanceHistory(chain: string, address: string, o?: RequestOptions): Promise<BalanceHistory> {
    return this.get(`/${seg(chain)}/address/${seg(address)}/balance-history`, undefined, o);
  }

  // ---- rich list, stats, charts ----------------------------------------------------------

  /**
   * Top addresses by balance. Throws a `CcnodesApiError` with `isBuilding` on a
   * chain whose scan has not finished. `limit` up to 1000.
   */
  richList(chain: string, opts: Page & RequestOptions = {}): Promise<RichList> {
    return this.get(`/${seg(chain)}/richlist`, { limit: opts.limit, offset: opts.offset }, opts);
  }
  stats(chain: string, o?: RequestOptions): Promise<ChainStats> {
    return this.get(`/${seg(chain)}/stats`, undefined, o);
  }
  charts(chain: string, opts: { range?: ChartRange } & RequestOptions = {}): Promise<Charts> {
    return this.get(`/${seg(chain)}/charts`, { range: opts.range }, opts);
  }
  marketCharts(chain: string, opts: { range?: ChartRange } & RequestOptions = {}): Promise<MarketCharts> {
    return this.get(`/${seg(chain)}/charts/market`, { range: opts.range }, opts);
  }
  holderCharts(chain: string, opts: { range?: ChartRange } & RequestOptions = {}): Promise<HolderCharts> {
    return this.get(`/${seg(chain)}/charts/holders`, { range: opts.range }, opts);
  }

  // ---- mempool and fees --------------------------------------------------------------

  mempool(chain: string, o?: RequestOptions): Promise<MempoolInfo> {
    return this.get(`/${seg(chain)}/mempool`, undefined, o);
  }
  mempoolTxs(chain: string, o?: RequestOptions): Promise<MempoolTxs> {
    return this.get(`/${seg(chain)}/mempool/txs`, undefined, o);
  }
  /** Fee rates in base units per vbyte. */
  fees(chain: string, o?: RequestOptions): Promise<FeeEstimate> {
    return this.get(`/${seg(chain)}/fees/recommended`, undefined, o);
  }

  // ---- mining pools and value pools -----------------------------------------------------

  /** Who mined the blocks in `range`. Check `complete`; `unidentified` blocks are counted, not dropped. */
  pools(chain: string, opts: { range?: ChartRange } & RequestOptions = {}): Promise<MiningPools> {
    return this.get(`/${seg(chain)}/pools`, { range: opts.range }, opts);
  }
  /**
   * Value-pool balances over time: shielded pools (Zcash, Ycash), MWEB (Litecoin, Junkcoin), Platform credit (Dash).
   * 404 on other chains; `isBuilding` until the ledger is collected.
   */
  valuePoolCharts(chain: string, opts: { range?: ChartRange } & RequestOptions = {}): Promise<ValuePoolCharts> {
    return this.get(`/${seg(chain)}/charts/value-pools`, { range: opts.range }, opts);
  }

  // ---- MWEB ---------------------------------------------------------------------------

  /** MWEB pool balance and 24 h peg flow. Litecoin only; 404 elsewhere. */
  mweb(chain: string, o?: RequestOptions): Promise<MwebSummary> {
    return this.get(`/${seg(chain)}/mweb`, undefined, o);
  }
  /** Peg-ins and peg-outs, newest first. Page with `before: next_before`. Litecoin only. */
  mwebPegs(
    chain: string,
    opts: { direction?: "in" | "out" | "all"; limit?: number; before?: number } & RequestOptions = {},
  ): Promise<MwebPegs> {
    return this.get(`/${seg(chain)}/mweb/pegs`, { direction: opts.direction, limit: opts.limit, before: opts.before }, opts);
  }
  /** MWEB pool balance and peg totals per bucket. Litecoin only. */
  mwebSupply(chain: string, opts: { range?: ChartRange } & RequestOptions = {}): Promise<MwebSupply> {
    return this.get(`/${seg(chain)}/mweb/supply`, { range: opts.range }, opts);
  }

  // ---- masternodes --------------------------------------------------------------------

  /** Masternode network summary. Dash only (404 elsewhere); `isBuilding` until the list is collected. */
  masternodes(chain: string, o?: RequestOptions): Promise<MasternodeSummary> {
    return this.get(`/${seg(chain)}/masternodes`, undefined, o);
  }
  /** Every masternode in the current list (about 1 MB unfiltered). Dash only. */
  masternodeList(
    chain: string,
    opts: { status?: "enabled" | "banned" | "all"; type?: "regular" | "evo" | "all" } & RequestOptions = {},
  ): Promise<MasternodeList> {
    return this.get(`/${seg(chain)}/masternodes/list`, { status: opts.status, type: opts.type }, opts);
  }
  /** List events, newest first. `before` is a unix time; page with `next_before`. `limit` up to 200. */
  masternodeEvents(chain: string, opts: { limit?: number; before?: number } & RequestOptions = {}): Promise<MasternodeEvents> {
    return this.get(`/${seg(chain)}/masternodes/events`, { limit: opts.limit, before: opts.before }, opts);
  }
  /** Payouts, newest first. `before` is a block height; page with `next_before`. `limit` up to 200. */
  masternodePayments(
    chain: string,
    opts: { limit?: number; before?: number } & RequestOptions = {},
  ): Promise<MasternodePayments> {
    return this.get(`/${seg(chain)}/masternodes/payments`, { limit: opts.limit, before: opts.before }, opts);
  }
  /** One masternode by ProTx hash, including one that has left the list. */
  masternode(chain: string, protx: string, o?: RequestOptions): Promise<MasternodeDetail> {
    return this.get(`/${seg(chain)}/masternode/${seg(protx)}`, undefined, o);
  }

  // ---- P2P network ---------------------------------------------------------------------

  /** The crawler's latest pass over the chain's P2P network. Counts are of reachable nodes only. */
  p2pNodes(chain: string, o?: RequestOptions): Promise<P2PNetwork> {
    return this.get(`/${seg(chain)}/nodes`, undefined, o);
  }
  /** Every node reached in the latest pass (about 1 MB on bitcoin). */
  p2pNodeList(chain: string, o?: RequestOptions): Promise<P2PNodeList> {
    return this.get(`/${seg(chain)}/nodes/list`, undefined, o);
  }
  /** `addnode=ip:port` lines of reachable nodes at our tip. `limit` up to 64. */
  addnodes(chain: string, opts: { limit?: number } & RequestOptions = {}): Promise<AddnodeList> {
    return this.get(`/${seg(chain)}/nodes/addnode`, { limit: opts.limit }, opts);
  }
  /** The same lines as plain text, ready to append to a conf file. */
  async addnodesText(chain: string, opts: { limit?: number } & RequestOptions = {}): Promise<string> {
    return (await this.text("GET", `/${seg(chain)}/nodes/addnode`, { limit: opts.limit, format: "text" }, undefined, opts)).trim();
  }

  // ---- plumbing ------------------------------------------------------------------------

  /** GET a path under the base URL and parse it losslessly. For endpoints not wrapped yet. */
  async get<T>(path: string, query?: Query, o?: RequestOptions): Promise<T> {
    return parseJson<T>(await this.text("GET", path, query, undefined, o));
  }

  /** Identifies this SDK to the server: `ccnodes-sdk/<version> (<runtime>)`. */
  get clientIdentifier(): string {
    return this.clientId;
  }

  /** @internal Used by `ccnodes/account` for the session-authenticated plane. */
  async _request(
    method: string,
    path: string,
    init: { body?: unknown; bearer?: string; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    const text = await this.send(method, path, undefined, body, "application/json", init.bearer, init.signal);
    return text ? parseJson(text) : null;
  }

  private text(method: string, path: string, query: Query | undefined, body: string | undefined, o?: RequestOptions) {
    return this.send(method, path, query, body, "text/plain", this.apiKey, o?.signal);
  }

  private async send(
    method: string,
    path: string,
    query: Query | undefined,
    body: string | undefined,
    contentType: string,
    bearer: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const url = this.baseUrl + path + qs(query);
    const headers: Record<string, string> = { accept: "application/json", "x-ccnodes-client": this.clientId };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers["content-type"] = contentType;
    // Browsers forbid setting User-Agent and silently drop it; elsewhere it makes
    // logs readable. The custom header above is what works everywhere.
    if (!isBrowser()) headers["user-agent"] = this.clientId;

    const label = `${method} ${path}`;
    for (let attempt = 0; ; attempt++) {
      await this.bucket.take();
      const ac = new AbortController();
      const onAbort = () => ac.abort(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => ac.abort(new Error(`timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
      let resp: Response;
      try {
        if (signal?.aborted) throw signal.reason ?? new Error("aborted");
        resp = await this.fetchFn(url, { method, headers, body, signal: ac.signal });
      } catch (e) {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) throw e;
        if (attempt >= this.maxRetries || !retryableMethod(method, path)) {
          throw new CcnodesNetworkError(`${label}: ${(e as Error)?.message ?? e}`, e);
        }
        await sleep(backoffMs(attempt));
        continue;
      }
      let text: string;
      try {
        text = await resp.text(); // read on every path: an unread body holds the connection
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      if (resp.ok) return text;

      let parsed: unknown;
      try {
        parsed = parseJson(text);
      } catch {
        parsed = undefined;
      }
      const reason = (parsed as { error?: string } | undefined)?.error ?? `HTTP ${resp.status}`;
      const err = new CcnodesApiError(resp.status, reason, parsed, label);
      if (attempt >= this.maxRetries || !retryableStatus(method, path, err)) throw err;
      await sleep(backoffMs(attempt));
    }
  }
}

// ---- helpers --------------------------------------------------------------------------

function retryableMethod(method: string, path: string): boolean {
  // Re-sending a broadcast is safe (a known tx answers already_known), and a
  // network failure means we do not know whether it arrived.
  return method === "GET" || (method === "POST" && /\/tx$/.test(path));
}

function retryableStatus(method: string, path: string, err: CcnodesApiError): boolean {
  if (!retryableMethod(method, path)) return false;
  if (err.isBuilding) return false; // a state, not a failure: retrying will not change it
  if (err.status === 429) return method === "GET"; // a throttled broadcast should surface
  return err.status === 502 || err.status === 503 || err.status === 504 || err.status === 500;
}

function backoffMs(attempt: number): number {
  const base = 250 * 2 ** attempt;
  return base + Math.random() * base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function seg(s: string): string {
  return encodeURIComponent(s);
}

function qs(q?: Query): string {
  if (!q) return "";
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? "?" + parts.join("&") : "";
}

function isHeight(v: number | string): boolean {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0;
  return /^\d{1,12}$/.test(v);
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof (window as { document?: unknown }).document !== "undefined";
}

function runtime(): string {
  const g = globalThis as {
    process?: { versions?: { node?: string; bun?: string } };
    Deno?: { version?: { deno?: string } };
  };
  if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}`;
  if (g.process?.versions?.bun) return `bun/${g.process.versions.bun}`;
  if (g.process?.versions?.node) return `node/${g.process.versions.node}`;
  return isBrowser() ? "browser" : "unknown";
}
