import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", account: "src/account.ts", node: "src/node.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  // The optional signing deps must never be bundled into the package.
  external: ["@noble/curves", "@noble/hashes"],
});
