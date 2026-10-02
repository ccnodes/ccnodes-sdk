// Every chain's headline numbers, then one block's transactions with fees.
//   node examples/fleet.mjs
import { CcnodesClient, formatUnits } from "ccnodes";

const cc = new CcnodesClient({ appId: "example-fleet" });

const { chains } = await cc.overview();
for (const c of chains) {
  const price = c.market ? `$${c.market.usd}${c.market.stale ? ` (as of ${Math.round(c.market.age_secs / 60)}m ago)` : ""}` : c.market_note ?? "—";
  console.log(`${c.name.padEnd(10)} height ${String(c.height).padStart(9)}  ${price}`);
}

const tip = await cc.tip("litecoin");
const block = await cc.block("litecoin", tip.height - 1);
const txs = await cc.blockTxs("litecoin", block.id, { limit: 5 });
console.log(`\nlitecoin block ${block.height}: ${block.tx_count} txs`);
for (const t of txs) {
  const fee = t.fee === undefined ? "coinbase" : `${formatUnits(t.fee, 8)} LTC fee`;
  console.log(`  ${t.txid.slice(0, 16)}…  ${fee}`);
}
