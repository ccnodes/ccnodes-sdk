// Which chain is this on? A txid, block hash, height or address — every chain at once.
//   node examples/search.mjs DEgDVFa2DoW1533dxeDVdTxQFhMzs1pMke
import { CcnodesClient } from "ccnodes";

const q = process.argv[2] ?? "1";
const r = await new CcnodesClient({ appId: "example-search" }).search(q);
for (const hit of r.results) console.log(`${hit.chain.padEnd(10)} ${hit.kind.padEnd(8)} ${hit.id}`);
if (r.results.length === 0) {
  // An empty answer is only "not found" when every chain actually answered.
  console.log(r.complete ? "not found on any chain" : `no answer yet from: ${r.inconclusive.join(", ")}`);
}
