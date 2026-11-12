/**
 * Against the real API. Opt-in (`npm run test:live`), never in CI: it spends
 * anonymous quota and depends on the network.
 */
import { describe, expect, it } from "vitest";
import { CcnodesApiError, CcnodesClient, toBigInt } from "../src/index.js";
import { operationsOf, uncovered } from "./coverage.js";

const live = process.env.CCNODES_LIVE === "1";
const c = new CcnodesClient({ baseUrl: process.env.CCNODES_BASE_URL, appId: "ccnodes-sdk-tests" });
const decimalString = /^-?\d+$/;

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

  it("every data operation in the live spec has an SDK method", async () => {
    // Drift check: a new server endpoint fails here until the SDK covers it
    // (or lists it in NOT_IN_SDK). Refresh the offline copy with
    // `npm run snapshot:openapi`.
    const spec = await c.get<{ paths: Record<string, Record<string, unknown>> }>("/openapi.json");
    expect(uncovered(operationsOf(spec))).toEqual([]);
  }, 30_000);

  it("mining and value pools", async () => {
    const p = await c.pools("bitcoin", { range: "7d" });
    expect(typeof p.complete).toBe("boolean");
    expect(p.identified + p.unidentified.blocks).toBe(p.blocks);
    for (const chain of ["zcash", "ycash", "litecoin", "junkcoin", "dash"]) {
      const v = await c.valuePoolCharts(chain, { range: "7d" });
      expect(v.pools.length).toBeGreaterThan(0);
      for (const pool of v.pools) {
        expect(v.series[pool]!.length).toBe(v.t.length);
        for (const x of v.series[pool]!) if (x !== null) expect(x).toMatch(decimalString);
      }
    }
    const missing = await c.valuePoolCharts("bitcoin").catch((e) => e);
    expect((missing as CcnodesApiError).status).toBe(404);
  }, 60_000);

  it("MWEB (litecoin)", async () => {
    const m = await c.mweb("litecoin");
    expect(m.pool_sats).toMatch(decimalString);
    const pegs = await c.mwebPegs("litecoin", { direction: "out", limit: 5 });
    expect(pegs.pegs.every((x) => x.direction === "out" && typeof x.to_address === "string")).toBe(true);
    const ins = await c.mwebPegs("litecoin", { direction: "in", limit: 5 });
    expect(ins.pegs.every((x) => x.to_address === undefined)).toBe(true);
    const sup = await c.mwebSupply("litecoin", { range: "7d" });
    expect(sup.pool_sats.length).toBe(sup.t.length);
  }, 60_000);

  it("masternodes (dash)", async () => {
    const s = await c.masternodes("dash");
    expect(s.payments_24h.to_platform_sats).toMatch(decimalString);
    expect(s.payment_cycle.estimate).toBe(true);
    // Filtered: the full list is about 1 MB.
    const list = await c.masternodeList("dash", { status: "banned", type: "evo" });
    expect(list.masternodes.length).toBe(list.count);
    const ev = await c.masternodeEvents("dash", { limit: 3 });
    expect(ev.events.length).toBeLessThanOrEqual(3);
    const pay = await c.masternodePayments("dash", { limit: 3 });
    expect(pay.payments[0]!.amount_sats).toMatch(decimalString);
    const one = await c.masternode("dash", pay.payments[0]!.protx);
    expect(one.masternode.protx).toBe(pay.payments[0]!.protx);
    expect(typeof one.masternode.in_list).toBe("boolean");
  }, 60_000);

  it("P2P nodes", async () => {
    const n = await c.p2pNodes("dogecoin");
    expect(n.reachable).toBeGreaterThan(0);
    const list = await c.p2pNodeList("dogecoin");
    expect(list.nodes.length).toBe(list.count);
    const a = await c.addnodes("bitcoin", { limit: 3 });
    expect(a.lines.join("\n")).toBe(a.conf);
    const txt = await c.addnodesText("bitcoin", { limit: 3 });
    expect(txt.split("\n").every((l) => l.startsWith("addnode="))).toBe(true);
  }, 60_000);
});
