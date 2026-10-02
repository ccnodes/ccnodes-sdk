/**
 * Lossless JSON for amounts.
 *
 * Several chains this API serves have a total supply past 2^53 satoshis
 * (TrumPOW's is ~1.9e19, and Dingocoin, Pepecoin and Shibacoin are past 1e19 too),
 * so a single output can be an integer that a JavaScript `number` cannot hold.
 * Plain `JSON.parse` would round it silently: 6670866757953762928 comes back as
 * 6670866757953763328, which reads as a real balance and is wrong.
 *
 * `parseJson` turns any integer outside the safe range into a decimal STRING
 * before parsing, so no digit is ever lost. That is why amount fields are typed
 * `Sats = number | string`: in practice almost every value is a number, and the
 * string form only appears where a number could not have been exact. Use
 * `toBigInt()` when you need arithmetic you can trust on any chain.
 */

export type Sats = number | string;

/** Any amount this API returns, as an exact bigint. */
export function toBigInt(v: Sats | bigint | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "string") {
    const s = v.trim();
    return /^-?\d+$/.test(s) ? BigInt(s) : null;
  }
  return Number.isSafeInteger(v) ? BigInt(v) : null;
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

/** `JSON.parse`, except integers outside ±2^53 become decimal strings. */
export function parseJson<T = unknown>(text: string): T {
  // Fast path: an unsafe integer needs at least 16 digits in a row.
  if (!/\d{16}/.test(text)) return JSON.parse(text) as T;
  return JSON.parse(quoteUnsafeIntegers(text)) as T;
}

/** Exposed for tests. Rewrites only number tokens, never string contents. */
export function quoteUnsafeIntegers(text: string): string {
  let out = "";
  let last = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 34 /* " */) {
      // Skip a string literal, honouring escapes.
      i++;
      while (i < n) {
        const d = text.charCodeAt(i);
        if (d === 92 /* \ */) i += 2;
        else if (d === 34) { i++; break; }
        else i++;
      }
      continue;
    }
    if (c === 45 /* - */ || (c >= 48 && c <= 57)) {
      const start = i;
      if (c === 45) i++;
      while (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
      let isInt = true;
      if (i < n && text.charCodeAt(i) === 46 /* . */) {
        isInt = false;
        i++;
        while (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
      }
      const e = text.charCodeAt(i);
      if (i < n && (e === 101 || e === 69) /* e E */) {
        isInt = false;
        i++;
        const s = text.charCodeAt(i);
        if (s === 43 || s === 45) i++;
        while (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
      }
      if (isInt && i - start >= 16) {
        const tok = text.slice(start, i);
        const v = BigInt(tok);
        if (v > MAX || v < -MAX) {
          out += text.slice(last, start) + '"' + tok + '"';
          last = i;
        }
      }
      continue;
    }
    i++;
  }
  return last === 0 ? text : out + text.slice(last);
}
