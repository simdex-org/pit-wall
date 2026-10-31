import { describe, expect, test } from "vitest";
import { isNewer, parseStamp } from "../src/update.js";

const old = { sha: "a", time: "2026-10-30T10:00:00.000Z" };
const fresh = { sha: "b", time: "2026-10-30T11:00:00.000Z" };

describe("update", () => {
  test("a stamp needs a sha and a real time", () => {
    expect(parseStamp(old)).toEqual(old);
    expect(parseStamp({ sha: "a", time: "later" })).toBeNull();
    expect(parseStamp({ sha: 1, time: old.time })).toBeNull();
    expect(parseStamp(null)).toBeNull();
  });

  test("only a later build counts, and never when running from source", () => {
    expect(isNewer(old, fresh)).toBe(true);
    expect(isNewer(fresh, old)).toBe(false);
    expect(isNewer(old, old)).toBe(false);
    expect(isNewer(null, fresh)).toBe(false);
  });
});
