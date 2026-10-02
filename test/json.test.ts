import { describe, expect, it } from "vitest";
import { formatUnits, parseJson, toBigInt } from "../src/index.js";
import { quoteUnsafeIntegers } from "../src/json.js";

describe("lossless JSON", () => {
  it("keeps an integer past 2^53 exact, as a string", () => {
    // The value CLAUDE.md records being mangled by Number(): 6670866757953762928 -> ...3328
    const v = parseJson<{ value: number | string }>('{"value":6670866757953762928}');
    expect(v.value).toBe("6670866757953762928");
    expect(toBigInt(v.value)).toBe(6670866757953762928n);
  });

  it("leaves safe integers as numbers", () => {
    expect(parseJson<{ a: number }>('{"a":9007199254740991}').a).toBe(9007199254740991);
    expect(parseJson<{ a: number }>('{"a":1234567890123456}').a).toBe(1234567890123456);
  });

  it("never touches digits inside strings", () => {
    const s = '{"txid":"12345678901234567890123456789012","n":"99999999999999999999"}';
    expect(quoteUnsafeIntegers(s)).toBe(s);
  });

  it("handles escaped quotes inside strings", () => {
    const s = '{"a":"x\\"99999999999999999999","b":99999999999999999999}';
    expect(parseJson<{ a: string; b: string }>(s)).toEqual({ a: 'x"99999999999999999999', b: "99999999999999999999" });
  });

  it("leaves floats and exponents alone", () => {
    expect(parseJson<{ d: number }>('{"d":12345678901234567.5}').d).toBeCloseTo(12345678901234568);
    expect(parseJson<{ d: number }>('{"d":1.5e30}').d).toBe(1.5e30);
  });

  it("handles negative unsafe integers and arrays", () => {
    expect(parseJson<Array<number | string>>("[-99999999999999999999, 1]")).toEqual(["-99999999999999999999", 1]);
  });
});

describe("formatUnits", () => {
  it("formats exactly, past 2^53 too", () => {
    expect(formatUnits(123456789, 8)).toBe("1.23456789");
    expect(formatUnits(100000000, 8)).toBe("1");
    expect(formatUnits("19450000000000000001", 8)).toBe("194500000000.00000001");
    expect(formatUnits(-5, 2)).toBe("-0.05");
  });
});
