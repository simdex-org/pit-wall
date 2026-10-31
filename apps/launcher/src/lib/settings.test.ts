import { describe, expect, test } from "vitest";
import { bridgeArgs, linkFor, newKey, pickIp, validate } from "./settings";

describe("pickIp", () => {
  test("prefers Hamachi, then Radmin, then anything but loopback", () => {
    expect(pickIp(["127.0.0.1", "192.168.1.5", "25.1.2.3"])).toBe("25.1.2.3");
    expect(pickIp(["192.168.1.5", "26.0.0.9"])).toBe("26.0.0.9");
    expect(pickIp(["192.168.1.5"])).toBe("192.168.1.5");
    expect(pickIp(["127.0.0.1"])).toBe("127.0.0.1");
    expect(pickIp([])).toBe("127.0.0.1");
  });
});

describe("validate", () => {
  test("accepts a normal form", () => expect(validate("8765", "abcd1234")).toBeNull());
  test.each(["0", "65536", "abc", "", "12.5"])("rejects port %j", (port) => expect(validate(port, "abcd1234")).toMatch(/port/));
  test.each(["abc", "has space", "x".repeat(65), "a/b/c/d"])("rejects key %j", (key) => expect(validate("8765", key)).toMatch(/key/));
});

describe("launch arguments", () => {
  const prefs = { ip: "25.1.2.3", port: " 8765 ", key: "abcd1234", vjoy: true };
  test("bridge args and link", () => {
    expect(bridgeArgs(prefs)).toEqual(["--http", "25.1.2.3:8765", "--key", "abcd1234", "--no-browser", "--vjoy"]);
    expect(bridgeArgs({ ...prefs, vjoy: false })).not.toContain("--vjoy");
    expect(linkFor(prefs)).toBe("http://25.1.2.3:8765/?key=abcd1234");
  });
  test("generated keys pass validation", () => {
    for (let i = 0; i < 50; i++) expect(validate("8765", newKey())).toBeNull();
  });
});
