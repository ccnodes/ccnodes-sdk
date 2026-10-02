import { describe, expect, it } from "vitest";
import { ChainRegistry } from "../src/index.js";
import type { Chain } from "../src/index.js";

const chain = (id: string) => ({ id, name: id, ticker: id.toUpperCase(), decimals: 8, color: "#000", model: "utxo", segwit: false, params: {} }) as unknown as Chain;

describe("ChainRegistry", () => {
  it("answers from the snapshot without fetching", async () => {
    let n = 0;
    const r = new ChainRegistry(async () => { n++; return []; }, {}, [chain("bitcoin")]);
    expect(r.get("bitcoin")?.id).toBe("bitcoin");
    expect(await r.resolve("bitcoin")).toBeDefined();
    expect(n).toBe(0);
    expect(r.origin).toBe("snapshot");
  });

  it("refreshes once for an unknown chain, and de-duplicates concurrent asks", async () => {
    let n = 0;
    const r = new ChainRegistry(async () => { n++; return [chain("bitcoin"), chain("newcoin")]; }, {}, [chain("bitcoin")]);
    const [a, b] = await Promise.all([r.resolve("newcoin"), r.resolve("newcoin")]);
    expect(a?.id).toBe("newcoin");
    expect(b?.id).toBe("newcoin");
    expect(n).toBe(1);
    expect(r.origin).toBe("network");
  });

  it("keeps the old list when a refresh fails, and does not hammer", async () => {
    let n = 0;
    const r = new ChainRegistry(async () => { n++; throw new Error("down"); }, {}, [chain("bitcoin")]);
    expect(await r.resolve("ghost")).toBeUndefined();
    expect(await r.resolve("ghost")).toBeUndefined();
    expect(n).toBe(1); // throttled: one attempt per minute
    expect(r.list().map((c) => c.id)).toEqual(["bitcoin"]);
  });

  it("uses a fresh cache before the network", async () => {
    let n = 0;
    const cache = { load: async () => ({ fetchedAt: Date.now(), chains: [chain("cachedcoin")] }), save: async () => {} };
    const r = new ChainRegistry(async () => { n++; return []; }, { cache }, [chain("bitcoin")]);
    expect((await r.resolve("cachedcoin"))?.id).toBe("cachedcoin");
    expect(n).toBe(0);
    expect(r.origin).toBe("cache");
  });
});
