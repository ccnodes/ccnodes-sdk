import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CcnodesClient } from "../src/index.js";
import { COVERAGE, NOT_IN_SDK, SAMPLE, isDataOp, uncovered } from "./coverage.js";
import { mockFetch } from "./helpers.js";

const base = "https://example.test/v1";
const snapshot = JSON.parse(readFileSync(new URL("./openapi-paths.json", import.meta.url), "utf8")) as {
  operations: string[];
};

describe("API coverage", () => {
  it("every data operation in the spec snapshot has an SDK method", () => {
    expect(uncovered(snapshot.operations)).toEqual([]);
  });

  it("the allowlist names only real, uncovered operations", () => {
    const have = new Set(COVERAGE.map((x) => x.op));
    for (const op of Object.keys(NOT_IN_SDK)) {
      expect(snapshot.operations).toContain(op);
      expect(have.has(op)).toBe(false);
    }
  });

  it("the table names only operations the spec documents", () => {
    for (const { op } of COVERAGE) expect(snapshot.operations).toContain(op);
    expect(COVERAGE.every((x) => isDataOp(x.op))).toBe(true);
  });

  for (const { op, call } of COVERAGE) {
    it(`${op} is the request its method sends`, async () => {
      const m = mockFetch({ body: {} });
      await call(new CcnodesClient({ baseUrl: base, fetch: m.fn }));
      const [method, path] = op.split(" ") as [string, string];
      const expected = path.replace(/\{(\w+)\}/g, (_, k: keyof typeof SAMPLE) => SAMPLE[k]);
      const url = new URL(m.calls[0]!.url);
      expect(`${m.calls[0]!.method} ${url.pathname.slice(new URL(base).pathname.length)}`).toBe(`${method} ${expected}`);
    });
  }
});
