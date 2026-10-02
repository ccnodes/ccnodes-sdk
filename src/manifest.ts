/**
 * The chain list, without a release per chain.
 *
 * `GET /v1/chains` is generated on the server from the same config that decides
 * which chains exist, so it is the one source of truth. The SDK consumes it with
 * a deliberately conservative policy:
 *
 *  1. A snapshot ships inside the package, so the client knows every chain on
 *     day one with no network call. Constructing a client fetches NOTHING —
 *     your startup never depends on our uptime.
 *  2. The list refreshes LAZILY: the first time you ask about a chain the
 *     snapshot does not know, or when you call `refresh()` yourself.
 *  3. A refresh can be persisted with a `ManifestCache` (the Node entry point
 *     ships a file-backed one), so it is not one fetch per process.
 *  4. A failed refresh keeps the list you already had. It never throws.
 */

import { CHAINS_SNAPSHOT } from "./chains-snapshot.js";
import type { Chain } from "./types.js";

export interface ManifestCache {
  load(): Promise<{ fetchedAt: number; chains: Chain[] } | null>;
  save(entry: { fetchedAt: number; chains: Chain[] }): Promise<void>;
}

export interface ChainRegistryOptions {
  /** Where to persist refreshes between processes. Default: none (memory only). */
  cache?: ManifestCache;
  /** A cached list younger than this is used instead of fetching. Default 24h. */
  cacheTtlMs?: number;
  /** Minimum gap between network refreshes triggered by unknown ids. Default 60s. */
  minRefreshIntervalMs?: number;
}

export class ChainRegistry {
  private chains: Chain[];
  private source: "snapshot" | "cache" | "network" = "snapshot";
  private inflight: Promise<boolean> | null = null;
  private lastAttempt = 0;
  private cacheChecked = false;
  private readonly cacheTtlMs: number;
  private readonly minRefreshIntervalMs: number;

  constructor(
    private readonly fetchChains: () => Promise<Chain[]>,
    private readonly opts: ChainRegistryOptions = {},
    snapshot: readonly Chain[] = CHAINS_SNAPSHOT,
  ) {
    this.chains = snapshot.map((c) => ({ ...c }));
    this.cacheTtlMs = opts.cacheTtlMs ?? 24 * 3600 * 1000;
    this.minRefreshIntervalMs = opts.minRefreshIntervalMs ?? 60 * 1000;
  }

  /** Every chain currently known, synchronously. */
  list(): readonly Chain[] {
    return this.chains;
  }

  /** Where the current list came from. */
  get origin(): "snapshot" | "cache" | "network" {
    return this.source;
  }

  /** A known chain, synchronously, or undefined. Never fetches. */
  get(id: string): Chain | undefined {
    return this.chains.find((c) => c.id === id);
  }

  /**
   * A chain by id, refreshing the list once if it is not known yet. Returns
   * undefined only if the server does not know it either (or could not be
   * reached — the error is swallowed by design; see rule 4).
   */
  async resolve(id: string): Promise<Chain | undefined> {
    const known = this.get(id);
    if (known) return known;
    await this.loadCacheOnce();
    if (this.get(id)) return this.get(id);
    // Join a refresh already in flight (a concurrent caller started it) before
    // the throttle check — otherwise the second caller sees the fresh attempt
    // stamp, skips, and answers "unknown" while the answer is on its way.
    if (this.inflight) await this.inflight;
    else if (Date.now() - this.lastAttempt >= this.minRefreshIntervalMs) await this.refresh();
    return this.get(id);
  }

  /** Fetch the live list now. Resolves false (keeping the old list) on failure. */
  refresh(): Promise<boolean> {
    if (this.inflight) return this.inflight;
    this.lastAttempt = Date.now();
    this.inflight = (async () => {
      try {
        const live = await this.fetchChains();
        if (!Array.isArray(live) || live.length === 0) return false;
        this.chains = live.map(({ status: _status, ...c }) => c as Chain);
        this.source = "network";
        await this.opts.cache?.save({ fetchedAt: Date.now(), chains: this.chains }).catch(() => {});
        return true;
      } catch {
        return false;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  private async loadCacheOnce(): Promise<void> {
    if (this.cacheChecked || !this.opts.cache) return;
    this.cacheChecked = true;
    try {
      const hit = await this.opts.cache.load();
      if (hit && Date.now() - hit.fetchedAt < this.cacheTtlMs && hit.chains.length > 0) {
        this.chains = hit.chains;
        this.source = "cache";
      }
    } catch {
      /* a broken cache is the same as no cache */
    }
  }
}
