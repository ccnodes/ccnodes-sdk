/**
 * Response types for the ccnodes explorer API (`/explorer/v1`).
 *
 * Hand-written for 0.x from captured live responses on bitcoin, litecoin,
 * dogecoin and ycash. They will be generated from the server's OpenAPI schemas
 * once those are filled in; until then, a field marked optional here is one we
 * have seen absent on at least one chain, not a guess.
 *
 * Amounts are integer base units (satoshis, or the chain's equivalent). Fields
 * typed `Sats` are numbers whenever the value is exact as a JS number, and
 * decimal strings when it is not; see `toBigInt` in json.ts. Fields the server
 * already sends as strings (rich-list balances, supplies, market caps) are
 * typed `string` and are always decimal integers or decimals.
 */

import type { Sats } from "./json.js";

// ---- chains -------------------------------------------------------------------

export interface ChainParams {
  /** Base58 version byte for P2PKH. Absent on chains whose version is two bytes (Zcash family). */
  pubkey_prefix?: number;
  /** Canonical P2PKH version as hex, one OR two bytes. Present on every chain. */
  pubkey_prefix_hex: string;
  script_prefix?: number;
  script_prefix_hex: string;
  wif_prefix: number;
  bech32_hrp?: string;
  /** Relay floor in base units per 1000 vbytes. */
  min_relay_sat_kvb: number;
  dust_sats: number;
}

export interface ChainStatusSummary {
  tip_height: number;
  tip_hash: string;
  behind: number;
  synced: boolean;
}

export interface Chain {
  id: string;
  name: string;
  ticker: string;
  decimals: number;
  color: string;
  /** `"utxo"` for every chain served today. */
  model: string;
  segwit: boolean;
  params: ChainParams;
  status?: ChainStatusSummary;
}

// ---- blocks -------------------------------------------------------------------

export interface MwebHeader {
  kernel_offset: string;
  kernel_root: string;
  leaf_root: string;
  output_root: string;
  stealth_offset: string;
}

/** Litecoin only. MW→MW amounts are confidential; these are the visible totals. */
export interface MwebBlockSummary {
  header: MwebHeader;
  num_inputs: number;
  num_kernels: number;
  num_outputs: number;
  peg_in_count: number;
  peg_out_count: number;
  peg_out_amount: Sats;
  txo_set_size: number;
  mweb_amount?: Sats;
  amount_change?: Sats;
}

export interface ShieldedPool {
  name: string;
  chain_value: Sats;
  value_delta: Sats;
}

/** Zcash-family chains only. */
export interface ShieldedBlockSummary {
  shielded_txs: number;
  joinsplits: number;
  sapling_spends: number;
  sapling_outputs: number;
  orchard_actions: number;
  ironwood_actions: number;
  pools: ShieldedPool[];
}

export interface Block {
  /** Block hash. */
  id: string;
  height: number;
  version: number;
  timestamp: number;
  /** Null on chains whose daemon does not report it. */
  mediantime: number | null;
  previousblockhash: string;
  merkle_root: string;
  bits: number;
  difficulty: number;
  /** Absent on chains with 32-byte nonces (Zcash family); see `nonce_hex`. */
  nonce?: number;
  nonce_hex?: string;
  size: number;
  weight: number;
  tx_count: number;
  total_out?: Sats;
  total_fees?: Sats;
  mweb?: MwebBlockSummary;
  shielded?: ShieldedBlockSummary;
}

export interface Tip {
  height: number;
  hash: string;
  synced: boolean;
}

// ---- transactions -------------------------------------------------------------

export interface TxStatus {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

export interface TxOut {
  value: Sats;
  scriptpubkey: string;
  scriptpubkey_type?: string;
  /** Absent for outputs with no standard address (OP_RETURN, bare multisig…). */
  scriptpubkey_address?: string;
}

export interface TxIn {
  is_coinbase: boolean;
  /** Absent on coinbase inputs. */
  txid?: string;
  vout?: number;
  sequence: number;
  scriptsig?: string;
  witness?: string[];
  /** The output this input spends. Absent when it could not be resolved. */
  prevout?: TxOut;
}

export interface Transaction {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  /** May be 0 on chains whose daemon reports no witness data; derive from `weight / 4`. */
  vsize: number;
  /**
   * Absent when it cannot be stated exactly (an unresolved input, or a
   * coinbase). Never estimated. On shielded chains it includes the pool terms,
   * so it is correct where plain `inputs - outputs` would not be.
   */
  fee?: Sats;
  vin: TxIn[];
  vout: TxOut[];
  status: TxStatus;
  mweb?: Record<string, unknown>;
  shielded?: Record<string, unknown>;
}

export interface BroadcastResult {
  txid: string;
  /** The chain already had this transaction; nothing was sent. */
  already_known?: boolean;
}

// ---- addresses ----------------------------------------------------------------

export interface ScriptStats {
  funded_txo_count: number;
  funded_txo_sum: Sats;
  spent_txo_count: number;
  spent_txo_sum: Sats;
  tx_count: number;
}

export interface AddressStats {
  address: string;
  chain_stats: ScriptStats;
  mempool_stats: ScriptStats;
  /**
   * `false` when the address has too much history to summarise within the
   * server's time budget. The counters are then zeroed and MUST NOT be read as
   * zero — they mean "unknown". Omitted (i.e. true) otherwise.
   */
  available?: boolean;
}

export interface Utxo {
  txid: string;
  vout: number;
  value: Sats;
  status: TxStatus;
}

export interface BalancePoint {
  txid: string;
  /** Block height. */
  h: number;
  /** Block time. */
  t: number;
  /** Running balance after this transaction, decimal string in base units. */
  balance: string;
}

export interface BalanceHistory {
  address: string;
  decimals: number;
  /**
   * False when the curve was not drawn: `reason` says why (`too-large` for an
   * address past the server's history cap). Never a partial curve.
   */
  available: boolean;
  reason?: string;
  note?: string;
  tx_count?: number;
  max_txs?: number;
  /** The final balance was cross-checked against the address's live UTXOs. */
  checked_against_utxos?: boolean;
  /** False when history paging ran out of time; points then cover only part of it. */
  complete?: boolean;
  points: BalancePoint[];
}

export interface AddressRank {
  address: string;
  /**
   * Null when the address is outside the ranked top-N (`ranked_within`). That is
   * not a claim of zero balance.
   */
  rank: number | null;
  ranked_within?: number;
  /** Decimal string in base units, when ranked. */
  balance?: string;
  utxo_count?: number;
}

// ---- rich list ------------------------------------------------------------------

export interface RichListEntry {
  rank: number;
  address: string;
  /** Decimal string in base units. */
  balance: string;
  utxo_count: number;
}

export interface RichListBucket {
  /** log10 of whole coins: -1 is (0,1), 0 is [1,10), 1 is [10,100)… */
  bucket: number;
  addresses: number;
  total: string;
}

export interface RichList {
  chain: string;
  height: number;
  /** `all`, or `transparent` on shielded chains, where shares are of transparent supply only. */
  scope: string;
  total_supply: string;
  /** Supply in outputs with no decodable address: real coins belonging to no rank. */
  unattributed: string;
  top10_sum: string;
  top100_sum: string;
  address_count: number;
  utxo_count: number;
  ranked_count: number;
  limit: number;
  offset: number;
  updated_at: string;
  verified: boolean | null;
  verified_at: string | null;
  entries: RichListEntry[];
  distribution: RichListBucket[];
}

// ---- market, supply, stats ------------------------------------------------------

export interface MarketQuote {
  usd: number;
  /** Decimal string, USD. */
  market_cap: string | null;
  volume_24h: string | null;
  /** Whole coins, as reported by the market feed. */
  circulating_supply: string | null;
  chg_24h: number | null;
  /** When the quote was taken (RFC 3339). */
  ts: string;
  /** Seconds since `ts`. */
  age_secs: number;
  /**
   * The feed has not updated for a while (default: 30 minutes). The price is
   * the last real one, but it is not live — show its age.
   */
  stale: boolean;
  source: string;
}

/** Circulating supply measured by our own node. Exact, in base units. */
export interface SupplyFromScan {
  sats: string;
  source: string;
  height: number;
  taken_at: string;
  utxo_count: number | null;
}

/** Circulating supply from the market feed, in WHOLE COINS — not base units. */
export interface SupplyFromMarket {
  coins: string;
  source: string;
}

export type Supply = SupplyFromScan | SupplyFromMarket;

export interface ChainStats {
  chain: string;
  ticker: string;
  decimals: number;
  height: string;
  difficulty: number;
  hashrate: number;
  hashrate_window_blocks: number;
  block_target_secs: number;
  block_interval_24h_secs: number;
  blocks_24h: string;
  samples_full_24h: string;
  txs_per_block_24h: number | null;
  /** Null on chains with no market we can quote — never a price of 0. */
  market: MarketQuote | null;
  market_note: string | null;
  supply?: Supply;
}

// ---- charts ---------------------------------------------------------------------

export type ChartRange = "24h" | "7d" | "30d" | "1y" | "all";

export interface Charts {
  chain: string;
  ticker: string;
  decimals: number;
  range: string;
  from: number;
  to: number;
  bucket_secs: number;
  block_target_secs: number;
  /** Sampled blocks per bucket. A sampled total is not a total; see `samples_full`. */
  stride_blocks: number;
  samples: number;
  samples_full: number;
  complete: boolean;
  /** Bucket start times (unix seconds), aligned with every series. */
  t: number[];
  /** Samples per bucket. */
  n: number[];
  series: {
    difficulty: Array<number | null>;
    hashrate: Array<number | null>;
    block_interval: Array<number | null>;
    /** Null on chains with no per-block economics (header-only chains). */
    block_size: Array<number | null> | null;
    tx_count: Array<number | null> | null;
    fee_rate: Array<number | null> | null;
  };
}

export interface MarketCharts {
  chain: string;
  range: string;
  has_market: boolean;
  market_note: string | null;
  market: { day: string[]; usd: Array<number | null>; market_cap: Array<string | null> } | null;
  supply: Array<{ t: number; height: number; sats: string; source: string }>;
}

export interface HolderCharts {
  chain: string;
  range: string;
  /** Number of daily snapshots behind the series; one means "still collecting". */
  snapshots: number;
  since: number;
  t: number[];
  supply: string[];
  address_count: number[];
  top10: string[];
  top100: string[];
  top1000: string[];
  addresses: Array<{ address: string; rank: number; t: number[]; balance: string[] }>;
}

// ---- mempool and fees -------------------------------------------------------------

export interface MempoolInfo {
  count: number;
  vsize: number;
  total_fee: Sats;
}

export interface MempoolTxs {
  count: number;
  txs: Array<{ txid: string; fee: Sats; vsize: number; feerate: number; time: number }>;
  histogram: Array<{ from: number | null; to: number | null; count: number; vsize: number }>;
}

/** Base units per vbyte. */
export interface FeeEstimate {
  fastest: number;
  half_hour: number;
  hour: number;
  economy: number;
  minimum: number;
}

// ---- fleet-wide -------------------------------------------------------------------

export interface OverviewChain {
  id: string;
  name: string;
  ticker: string;
  color: string;
  decimals: number;
  model: string;
  online: boolean;
  state: string;
  height: number;
  headers: number;
  tip_hash: string;
  /** The tip block's own timestamp, read from the node. */
  tip_time: number;
  difficulty: number;
  hashrate: number;
  /** 30 days of daily mean hashrate; null for a day with no sample. */
  hashrate_30d: Array<number | null>;
  block_target_secs: number;
  block_interval_24h_secs: number;
  blocks_24h: string;
  txs_per_block_24h: number | null;
  mempool: { count: number; vsize: number } | null;
  market: MarketQuote | null;
  market_note: string | null;
  supply?: Supply;
  /** The chain's rich list has finished building. */
  richlist: boolean;
  indexer_online: boolean;
}

export interface Overview {
  /** Ordered by market cap, largest first; chains with no quote come last. */
  chains: OverviewChain[];
  default_chain: string;
  generated_at: number;
  hashrate_30d_from: number;
  hashrate_30d_bucket_secs: number;
}

export interface SearchResult {
  chain: string;
  kind: "tx" | "block" | "address" | string;
  id: string;
  height?: number;
  confirmed?: boolean;
  /** Absent means "could not establish", which is not zero. */
  tx_count?: number;
}

export interface SearchResponse {
  query: string;
  kind: string;
  /** Ranked by where the query actually has history. Can name several chains. */
  results: SearchResult[];
  /**
   * False means "not found" was NOT established: some chains did not answer in
   * time (`inconclusive`). Do not show an empty result as "does not exist"
   * without checking this.
   */
  complete: boolean;
  inconclusive: string[];
}

export interface NodeStatus {
  id: string;
  name: string;
  ticker: string;
  color: string;
  enabled: boolean;
  online: boolean;
  state: string;
  blocks: number;
  headers: number;
  verification_progress: number;
  peers: number;
  best_block_hash: string;
  indexer?: {
    kind: string;
    primary_label: string;
    primary_online: boolean;
    backup_label: string | null;
    backup_online: boolean | null;
  };
}

export interface Plan {
  id: string;
  name: string;
  blurb: string;
  usd_month: number | null;
  monthly_cu: number | null;
  rate_per_sec: number;
  max_keys: number | null;
}

export interface Pricing {
  /** False while the API is free in preview: usage is recorded, nothing is billed. */
  enforced: boolean;
  enabled: boolean;
  plans: Plan[];
  free_monthly_cu: number;
  cu_per_usd: number;
  min_usd: number;
  endpoint_costs: Record<string, number>;
  auth_methods: { siwe: boolean; email: boolean };
  [k: string]: unknown;
}

export interface Usage {
  [k: string]: unknown;
}
