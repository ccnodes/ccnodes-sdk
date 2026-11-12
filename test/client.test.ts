import { describe, expect, it } from "vitest";
import { CcnodesApiError, CcnodesClient, SDK_VERSION } from "../src/index.js";
import { mockFetch } from "./helpers.js";

const base = "https://example.test/v1";

describe("CcnodesClient", () => {
  it("sends the key, the client identifier, and nothing at construction", async () => {
    const m = mockFetch({ body: { height: 1, hash: "ab", synced: true } });
    const c = new CcnodesClient({ baseUrl: base, apiKey: "ccx_test", fetch: m.fn });
    expect(m.calls).toHaveLength(0); // constructing a client fetches nothing
    await c.tip("bitcoin");
    expect(m.calls[0]!.url).toBe(`${base}/bitcoin/blocks/tip`);
    expect(m.calls[0]!.headers.authorization).toBe("Bearer ccx_test");
    expect(m.calls[0]!.headers["x-ccnodes-client"]).toMatch(new RegExp(`^ccnodes-sdk/${SDK_VERSION.replace(/\./g, "\\.")} \\(node/`));
  });

  it("is anonymous without a key", async () => {
    const m = mockFetch({ body: [] });
    await new CcnodesClient({ baseUrl: base, fetch: m.fn }).listChains();
    expect(m.calls[0]!.headers.authorization).toBeUndefined();
  });

  it("routes a height and a hash to different endpoints", async () => {
    const m = mockFetch({ body: {} });
    const c = new CcnodesClient({ baseUrl: base, fetch: m.fn });
    await c.block("litecoin", 3186428);
    await c.block("litecoin", "3186428");
    await c.block("litecoin", "00".repeat(32));
    expect(m.calls.map((x) => x.url)).toEqual([
      `${base}/litecoin/block/height/3186428`,
      `${base}/litecoin/block/height/3186428`,
      `${base}/litecoin/block/${"00".repeat(32)}`,
    ]);
  });

  it("encodes path segments and query", async () => {
    const m = mockFetch({ body: {} });
    const c = new CcnodesClient({ baseUrl: base, fetch: m.fn });
    await c.search("a b/c");
    await c.blockTxs("dogecoin", "ab", { limit: 50, offset: 25 });
    expect(m.calls[0]!.url).toBe(`${base}/search?q=a%20b%2Fc`);
    expect(m.calls[1]!.url).toBe(`${base}/dogecoin/block/ab/txs?limit=50&offset=25`);
  });

  it("parses amounts losslessly", async () => {
    const m = mockFetch({ text: '{"address":"x","chain_stats":{"funded_txo_sum":15876050744101344598}}' });
    const s = await new CcnodesClient({ baseUrl: base, fetch: m.fn }).address("trumpow", "x");
    expect(s.chain_stats.funded_txo_sum).toBe("15876050744101344598");
  });

  it("retries a transient 502, then succeeds", async () => {
    const m = mockFetch([{ status: 502, body: { error: "bad gateway" } }, { body: { count: 1, vsize: 2, total_fee: 3 } }]);
    const r = await new CcnodesClient({ baseUrl: base, fetch: m.fn }).mempool("bitcoin");
    expect(r.count).toBe(1);
    expect(m.calls).toHaveLength(2);
  });

  it("does NOT retry a 503 building — it is a state, not an outage", async () => {
    const m = mockFetch({ status: 503, body: { error: "rich list is still being built", state: "building" } });
    const err = await new CcnodesClient({ baseUrl: base, fetch: m.fn }).richList("ycash").catch((e) => e);
    expect(err).toBeInstanceOf(CcnodesApiError);
    expect(err.isBuilding).toBe(true);
    expect(err.message).toBe("rich list is still being built");
    expect(m.calls).toHaveLength(1);
  });

  it("surfaces a 400 immediately with the server's reason", async () => {
    const m = mockFetch({ status: 400, body: { error: "min relay fee not met" } });
    const err = await new CcnodesClient({ baseUrl: base, fetch: m.fn }).broadcast("bitcoin", "00ff").catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.message).toBe("min relay fee not met");
    expect(m.calls).toHaveLength(1);
  });

  it("broadcasts raw hex as text/plain and refuses non-hex", async () => {
    const m = mockFetch({ body: { txid: "t" } });
    const c = new CcnodesClient({ baseUrl: base, fetch: m.fn });
    await expect(c.broadcast("bitcoin", "not hex")).rejects.toThrow(TypeError);
    await c.broadcast("bitcoin", " 0100ff \n");
    expect(m.calls[0]!.method).toBe("POST");
    expect(m.calls[0]!.headers["content-type"]).toBe("text/plain");
    expect(m.calls[0]!.body).toBe("0100ff");
  });

  it("gives up after maxRetries on a 429 for reads", async () => {
    const m = mockFetch({ status: 429, body: { error: "rate limited" } });
    const err = await new CcnodesClient({ baseUrl: base, fetch: m.fn, maxRetries: 1 }).tip("bitcoin").catch((e) => e);
    expect(err.isRateLimited).toBe(true);
    expect(m.calls).toHaveLength(2);
  });
  it("builds the chain-data endpoints' paths and queries", async () => {
    const m = mockFetch({ body: {} });
    const c = new CcnodesClient({ baseUrl: base, fetch: m.fn });
    const protx = "ab".repeat(32);
    await c.pools("bitcoin", { range: "7d" });
    await c.valuePoolCharts("zcash", { range: "all" });
    await c.valuePoolCharts("dash");
    await c.mweb("litecoin");
    await c.mwebPegs("litecoin", { direction: "out", limit: 200, before: 3211601 });
    await c.mwebSupply("litecoin", { range: "1y" });
    await c.masternodes("dash");
    await c.masternodeList("dash", { status: "banned", type: "evo" });
    await c.masternodeEvents("dash", { limit: 5, before: 1794441723 });
    await c.masternodePayments("dash", { limit: 10, before: 2570865 });
    await c.masternode("dash", protx);
    await c.p2pNodes("dogecoin");
    await c.p2pNodeList("bitcoin");
    await c.addnodes("dogecoin", { limit: 3 });
    expect(m.calls.map((x) => x.url.slice(base.length))).toEqual([
      "/bitcoin/pools?range=7d",
      "/zcash/charts/value-pools?range=all",
      "/dash/charts/value-pools",
      "/litecoin/mweb",
      "/litecoin/mweb/pegs?direction=out&limit=200&before=3211601",
      "/litecoin/mweb/supply?range=1y",
      "/dash/masternodes",
      "/dash/masternodes/list?status=banned&type=evo",
      "/dash/masternodes/events?limit=5&before=1794441723",
      "/dash/masternodes/payments?limit=10&before=2570865",
      `/dash/masternode/${protx}`,
      "/dogecoin/nodes",
      "/bitcoin/nodes/list",
      "/dogecoin/nodes/addnode?limit=3",
    ]);
  });

  it("returns the addnode list as plain text with format=text", async () => {
    const m = mockFetch({ text: "addnode=1.2.3.4:22556\naddnode=5.6.7.8:22556\n" });
    const txt = await new CcnodesClient({ baseUrl: base, fetch: m.fn }).addnodesText("dogecoin", { limit: 2 });
    expect(m.calls[0]!.url).toBe(`${base}/dogecoin/nodes/addnode?limit=2&format=text`);
    expect(txt).toBe("addnode=1.2.3.4:22556\naddnode=5.6.7.8:22556");
  });

  it("keeps value-pool balances as decimal strings and null as null", async () => {
    const m = mockFetch({
      text: '{"pools":["orchard"],"latest":{"height":1,"time":2,"pools":{"orchard":"32096996990608"}},"t":[1,2],"series":{"orchard":[null,"32096996990608"]}}',
    });
    const v = await new CcnodesClient({ baseUrl: base, fetch: m.fn }).valuePoolCharts("zcash");
    expect(v.latest.pools.orchard).toBe("32096996990608");
    expect(v.series.orchard).toEqual([null, "32096996990608"]);
  });
});
