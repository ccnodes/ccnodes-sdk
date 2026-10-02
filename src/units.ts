import { toBigInt, type Sats } from "./json.js";

/**
 * Base units to a decimal string of whole coins, exactly — no float in the
 * path, so it is right for amounts past 2^53 too.
 *
 * ```ts
 * formatUnits(123456789, 8)  // "1.23456789"
 * formatUnits("19450000000000000000", 8)  // "194500000000"
 * ```
 */
export function formatUnits(amount: Sats | bigint, decimals: number): string {
  const v = toBigInt(amount);
  if (v === null) throw new TypeError(`not an integer amount: ${String(amount)}`);
  if (!Number.isInteger(decimals) || decimals < 0) throw new RangeError("decimals must be a non-negative integer");
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;
  let frac = (abs % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toString() + (frac ? "." + frac : "");
}
