/**
 * Against the real API. Opt-in (`npm run test:live`), never in CI: it spends
 * anonymous quota and depends on the network.
 */
import { describe, expect, it } from "vitest";
import { CcnodesApiError, CcnodesClient, toBigInt } from "../src/index.js";

const live = process.env.CCNODES_LIVE === "1";
const c = new CcnodesClient({ baseUrl: process.env.CCNODES_BASE_URL, appId: "ccnodes-sdk-tests" });

describe.skipIf(!live)("live API", () => {
  it("fleet-wide endpoints", async () => {
    const chains = await c.listChains();
    expect(chains.length).toBeGreaterThan(5);
    for (const ch of chains) expect(ch.params.pubkey_prefix_hex).toMatch(/^[0-9a-f]{2,4}$/);
    const ov = await c.overview();
    expect(ov.chains[0]!.tip_time).toBeGreaterThan(1.7e9);
    const s = await c.search("1");
    expect(s.complete === true || s.inconclusive.length > 0).toBe(true);
    expect((await c.status()).length).toBeGreaterThan(5);
    expect(typeof (await c.pricing()).enforced).toBe("boolean");
  }, 60_000);

  for (const chain of ["bitcoin", "litecoin", "dogecoin", "ycash", "zcash"]) {
    it(`per-chain endpoints: ${chain}`, async () => {
      const tip = await c.tip(chain);
      const [byHeight] = await Promise.all([c.block(chain, tip.height - 3)]);
      const byHash = await c.block(chain, byHeight.id);
      expect(byHash.height).toBe(tip.height - 3);
      const recent = await c.blocks(chain, { limit: 10 });
      const busy = recent.find((b) => b.tx_count > 1) ?? recent[0]!;
      const txs = await c.blockTxs(chain, busy.id, { limit: 5 });
      expect(txs.length).toBeGreaterThan(0);
      const spend = txs.find((t) => !t.vin.some((v) => v.is_coinbase));
      if (spend) {
        expect(spend.fee).toBeDefined(); // #139: block txs carry fees on every chain
        const single = await c.tx(chain, spend.txid);
        expect(toBigInt(single.fee)).toBe(toBigInt(spend.fee));
        expect((await c.txHex(chain, spend.txid)).length).toBeGreaterThan(100);
        const addr = spend.vout.find((o) => o.scriptpubkey_address)?.scriptpubkey_address;
        // The history endpoints cost the server work proportional to the
        // address's history. On a mega-address that is tens of seconds of
        // indexer time per call, and repeating it once wedged a production
        // indexer (ccnodes.net#148). A test suite must not do that, so it only
        // walks modest addresses.
        const st = addr ? await c.address(chain, addr) : undefined;
        if (addr) expect(st!.address).toBe(addr);
        if (addr && st && st.available !== false && st.chain_stats.tx_count < 500) {
          await c.addressTxs(chain, addr);
          await c.addressUtxos(chain, addr).catch((e) => expect(e).toBeInstanceOf(CcnodesApiError));
          const bh = await c.balanceHistory(chain, addr);
          expect(typeof bh.available).toBe("boolean");
        }
      }
      expect(typeof (await c.mempool(chain)).count).toBe("number");
      await c.mempoolTxs(chain);
      expect((await c.fees(chain)).minimum).toBeGreaterThanOrEqual(0);
      const stats = await c.stats(chain);
      if (stats.market) expect(typeof stats.market.stale).toBe("boolean");
      const ch = await c.charts(chain, { range: "7d" });
      expect(ch.t.length).toBe(ch.series.hashrate.length);
      await c.marketCharts(chain, { range: "30d" });
      try {
        const rl = await c.richList(chain, { limit: 3 });
        expect(rl.entries.length).toBe(3);
        expect(typeof rl.entries[0]!.balance).toBe("string");
      } catch (e) {
        expect((e as CcnodesApiError).isBuilding).toBe(true); // an honest "still scanning"
      }
    }, 120_000);
  }

  it("keeps a TrumPOW amount past 2^53 exact", async () => {
    // The rich list's top address holds far more than 2^53 base units.
    const rl = await c.richList("trumpow", { limit: 1 });
    const top = rl.entries[0]!;
    expect(toBigInt(top.balance)! > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    // Its address summary returns the same magnitude as JSON NUMBERS; lossless
    // parsing must hand them back as exact strings, not rounded floats.
    const st = await c.address("trumpow", top.address);
    const funded = st.chain_stats.funded_txo_sum;
    if (typeof funded === "string") expect(funded).toMatch(/^\d{16,}$/);
    else expect(Number.isSafeInteger(funded)).toBe(true);
  }, 60_000);
});
