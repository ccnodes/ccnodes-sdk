#!/usr/bin/env node
// Refuse a release whose versions disagree: package.json, src/version.ts and,
// when given, the git tag (v1.2.3). Run by CI and by the release workflow.
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const src = readFileSync(new URL("../src/version.ts", import.meta.url), "utf8").match(/SDK_VERSION = "([^"]+)"/)?.[1];
const tag = process.argv[2]?.replace(/^refs\/tags\//, "");
const problems = [];
if (pkg !== src) problems.push(`package.json ${pkg} != src/version.ts ${src}`);
if (tag && tag !== `v${pkg}`) problems.push(`tag ${tag} != v${pkg}`);
if (problems.length) {
  console.error("version mismatch:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`versions agree: ${pkg}${tag ? ` (tag ${tag})` : ""}`);
