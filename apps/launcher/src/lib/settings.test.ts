import { describe, expect, test } from "vitest";
import { bridgeArgs, linkFor, newKey, pickIp, validate } from "./settings";

describe("pickIp", () => {
  test("takes the first address that is not loopback", () => {
    expect(pickIp(["127.0.0.1", "192.168.1.5", "25.1.2.3"])).toBe("192.168.1.5");
    expect(pickIp(["25.1.2.3", "192.168.1.5"])).toBe("25.1.2.3");
    expect(pickIp(["192.168.1.5"])).toBe("192.168.1.5");
    expect(pickIp(["127.0.0.1"])).toBe("127.0.0.1");
    expect(pickIp([])).toBe("127.0.0.1");
  });
});

describe("validate", () => {
  test("accepts a normal form", () => expect(validate("8765", "abcd1234efgh")).toBeNull());
  test.each(["0", "65536", "abc", "", "12.5"])("rejects port %j", (port) => expect(validate(port, "abcd1234efgh")).toMatch(/port/));
  test.each(["abcdefghijk", "has space", "x".repeat(65), "a/b/c/d"])("rejects key %j", (key) => expect(validate("8765", key)).toMatch(/key/));
});

describe("launch arguments", () => {
  const prefs = { ip: "25.1.2.3", port: " 8765 ", key: "abcd1234efgh", vjoy: true, open: false };
  test("bridge args and link", () => {
    expect(bridgeArgs(prefs)).toEqual(["--http", "25.1.2.3:8765", "--key", "abcd1234efgh", "--no-browser", "--vjoy"]);
    expect(bridgeArgs({ ...prefs, vjoy: false })).not.toContain("--vjoy");
    expect(linkFor(prefs)).toBe("http://25.1.2.3:8765/?key=abcd1234efgh");
    expect(bridgeArgs({ ...prefs, open: true })).toContain("--open");
    expect(linkFor({ ...prefs, open: true })).toBe("http://25.1.2.3:8765/");
  });
  test("generated keys pass validation", () => {
    for (let i = 0; i < 50; i++) expect(validate("8765", newKey())).toBeNull();
  });
});

describe("validate address", () => {
  test("accepts an IPv4 address", () => expect(validate("8765", "abcd1234efgh", "25.1.2.3")).toBeNull());
  test.each(["", "25.1.2", "25.1.2.300", "host.name"])("rejects %j", (ip) => expect(validate("8765", "abcd1234efgh", ip)).toMatch(/address/));
});
