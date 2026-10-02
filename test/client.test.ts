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
});
