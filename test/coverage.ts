/**
 * Which SDK method serves each documented API operation. Shared by the offline
 * coverage test (against test/openapi-paths.json) and the live drift test.
 */
import type { CcnodesClient } from "../src/index.js";

/** Values substituted for `{param}` in a path, and passed to each method below. */
export const SAMPLE = {
  chain: "testchain",
  hash: "ab".repeat(32),
  height: "123",
  txid: "cd".repeat(32),
  address: "addr1",
  protx: "ef".repeat(32),
} as const;

export interface Covered {
  /** `METHOD /path`, exactly as the spec writes it. */
  op: string;
  call: (c: CcnodesClient) => Promise<unknown>;
}

const { chain, hash, height, txid, address, protx } = SAMPLE;

export const COVERAGE: Covered[] = [
  { op: "GET /chains", call: (c) => c.listChains() },
  { op: "GET /overview", call: (c) => c.overview() },
  { op: "GET /search", call: (c) => c.search("x") },
  { op: "GET /status", call: (c) => c.status() },
  { op: "GET /pricing", call: (c) => c.pricing() },
  { op: "GET /account/usage", call: (c) => c.usage() },
  { op: "GET /{chain}/blocks/tip", call: (c) => c.tip(chain) },
  { op: "GET /{chain}/blocks", call: (c) => c.blocks(chain) },
  { op: "GET /{chain}/block/height/{height}", call: (c) => c.block(chain, Number(height)) },
  { op: "GET /{chain}/block/{hash}", call: (c) => c.block(chain, hash) },
  { op: "GET /{chain}/block/{hash}/txs", call: (c) => c.blockTxs(chain, hash) },
  { op: "GET /{chain}/tx/{txid}", call: (c) => c.tx(chain, txid) },
  { op: "GET /{chain}/tx/{txid}/hex", call: (c) => c.txHex(chain, txid) },
  { op: "POST /{chain}/tx", call: (c) => c.broadcast(chain, "00") },
  { op: "GET /{chain}/address/{address}", call: (c) => c.address(chain, address) },
  { op: "GET /{chain}/address/{address}/txs", call: (c) => c.addressTxs(chain, address) },
  { op: "GET /{chain}/address/{address}/utxo", call: (c) => c.addressUtxos(chain, address) },
  { op: "GET /{chain}/address/{address}/rank", call: (c) => c.addressRank(chain, address) },
  { op: "GET /{chain}/address/{address}/balance-history", call: (c) => c.balanceHistory(chain, address) },
  { op: "GET /{chain}/richlist", call: (c) => c.richList(chain) },
  { op: "GET /{chain}/stats", call: (c) => c.stats(chain) },
  { op: "GET /{chain}/charts", call: (c) => c.charts(chain) },
  { op: "GET /{chain}/charts/market", call: (c) => c.marketCharts(chain) },
  { op: "GET /{chain}/charts/holders", call: (c) => c.holderCharts(chain) },
  { op: "GET /{chain}/charts/value-pools", call: (c) => c.valuePoolCharts(chain) },
  { op: "GET /{chain}/mempool", call: (c) => c.mempool(chain) },
  { op: "GET /{chain}/mempool/txs", call: (c) => c.mempoolTxs(chain) },
  { op: "GET /{chain}/fees/recommended", call: (c) => c.fees(chain) },
  { op: "GET /{chain}/pools", call: (c) => c.pools(chain) },
  { op: "GET /{chain}/mweb", call: (c) => c.mweb(chain) },
  { op: "GET /{chain}/mweb/pegs", call: (c) => c.mwebPegs(chain) },
  { op: "GET /{chain}/mweb/supply", call: (c) => c.mwebSupply(chain) },
  { op: "GET /{chain}/masternodes", call: (c) => c.masternodes(chain) },
  { op: "GET /{chain}/masternodes/list", call: (c) => c.masternodeList(chain) },
  { op: "GET /{chain}/masternodes/events", call: (c) => c.masternodeEvents(chain) },
  { op: "GET /{chain}/masternodes/payments", call: (c) => c.masternodePayments(chain) },
  { op: "GET /{chain}/masternode/{protx}", call: (c) => c.masternode(chain, protx) },
  { op: "GET /{chain}/nodes", call: (c) => c.p2pNodes(chain) },
  { op: "GET /{chain}/nodes/list", call: (c) => c.p2pNodeList(chain) },
  { op: "GET /{chain}/nodes/addnode", call: (c) => c.addnodes(chain) },
];

/**
 * Data operations deliberately left out of the SDK, each with its reason.
 * Keep this empty unless there is a real reason.
 */
export const NOT_IN_SDK: Record<string, string> = {};

/**
 * Account, auth and billing (`/me*`, `/auth/*`, `/topups*`) are the session
 * plane, served by `ccnodes/account`, and are not checked here.
 */
export function isDataOp(op: string): boolean {
  const path = op.slice(op.indexOf(" ") + 1);
  return !/^\/(me|auth|topups)(\/|$)/.test(path);
}

/** Data operations in `ops` with no SDK method and no `NOT_IN_SDK` entry. */
export function uncovered(ops: string[]): string[] {
  const have = new Set(COVERAGE.map((x) => x.op));
  return ops.filter((op) => isDataOp(op) && !have.has(op) && !(op in NOT_IN_SDK));
}

/** `METHOD /path` operations from an OpenAPI document. */
export function operationsOf(spec: { paths?: Record<string, Record<string, unknown>> }): string[] {
  const ops: string[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const m of Object.keys(item)) {
      if (["get", "post", "put", "patch", "delete"].includes(m)) ops.push(`${m.toUpperCase()} ${path}`);
    }
  }
  return ops.sort();
}
