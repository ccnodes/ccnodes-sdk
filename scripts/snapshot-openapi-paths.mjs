#!/usr/bin/env node
// Regenerate test/openapi-paths.json from the live /v1/openapi.json.
//
// The snapshot is what test/coverage.test.ts checks offline: every data path
// the server documents must have an SDK method. The live drift test in
// test/live.test.ts checks the same against the spec as served today.
import { writeFileSync } from "node:fs";

const base = (process.env.CCNODES_BASE_URL || "https://ccnodes.net/explorer/v1").replace(/\/$/, "");
const res = await fetch(base + "/openapi.json", { headers: { "x-ccnodes-client": "ccnodes-sdk/snapshot" } });
if (!res.ok) throw new Error(`GET /openapi.json -> HTTP ${res.status}`);
const spec = await res.json();
const ops = [];
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const method of Object.keys(item)) {
    if (["get", "post", "put", "patch", "delete"].includes(method)) ops.push(`${method.toUpperCase()} ${path}`);
  }
}
ops.sort();
const out = {
  _generated: "by scripts/snapshot-openapi-paths.mjs; do not edit by hand",
  source: `${base}/openapi.json`,
  date: new Date().toISOString().slice(0, 10),
  operations: ops,
};
writeFileSync(new URL("../test/openapi-paths.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${ops.length} operations over ${Object.keys(spec.paths ?? {}).length} paths`);
