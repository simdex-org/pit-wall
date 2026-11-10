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
  const prefs = { game: "auto" as const, ip: "25.1.2.3", port: " 8765 ", key: "abcd1234efgh", open: false, teamOn: false, teamCode: "", team: "" };
  test("bridge args and link", () => {
    expect(bridgeArgs(prefs)).toEqual(["--http", "25.1.2.3:8765", "--key", "abcd1234efgh", "--no-browser"]);
    expect(linkFor(prefs)).toBe("http://25.1.2.3:8765/?key=abcd1234efgh");
    expect(bridgeArgs({ ...prefs, open: true })).toContain("--open");
    expect(linkFor({ ...prefs, open: true })).toBe("http://25.1.2.3:8765/");
  });
  test("solo adds nothing; team adds the code and each teammate's IP", () => {
    expect(bridgeArgs({ ...prefs, teamCode: "vela-24h-spa", team: "25.4.5.6" })).not.toContain("--team-code");
    const team = { ...prefs, teamOn: true, teamCode: " vela-24h-spa ", team: " 25.4.5.6, 25.7.8.9:8770 " };
    expect(bridgeArgs(team).slice(-6)).toEqual(["--team-code", "vela-24h-spa", "--team", "25.4.5.6", "--team", "25.7.8.9:8770"]);
    expect(bridgeArgs({ ...team, team: "" }).slice(-2)).toEqual(["--team-code", "vela-24h-spa"]);
  });
  test("team needs a code; teammates are IP addresses", () => {
    const v = (code: string, mates: string, on = true) => validate("8765", "abcd1234efgh", "25.1.2.3", { on, code, mates });
    expect(v("vela-24h-spa", "")).toBeNull();
    expect(v("vela-24h-spa", "25.4.5.6 25.7.8.9:8770 http://25.1.1.1:8765/?key=abcdefghijkl")).toBeNull();
    expect(v("", "", false)).toBeNull();
    expect(v("short", "")).toMatch(/team code/);
    for (const bad of ["teammate-pc", "25.4.5", "25.4.5.300", "25.4.5.6:99999"]) expect(v("vela-24h-spa", bad), bad).toMatch(/teammate/);
  });
  test("generated keys pass validation", () => {
    for (let i = 0; i < 50; i++) expect(validate("8765", newKey())).toBeNull();
  });
});

describe("validate address", () => {
  test("accepts an IPv4 address", () => expect(validate("8765", "abcd1234efgh", "25.1.2.3")).toBeNull());
  test.each(["", "25.1.2", "25.1.2.300", "host.name"])("rejects %j", (ip) => expect(validate("8765", "abcd1234efgh", ip)).toMatch(/address/));
});

describe("game argument", () => {
  const prefs = { game: "auto" as const, ip: "127.0.0.1", port: "8765", key: "abcd1234efgh", open: false, teamOn: false, teamCode: "", team: "" };
  test("is only added for Assetto Corsa", () => {
    expect(bridgeArgs(prefs)).not.toContain("--game");
    expect(bridgeArgs(prefs, "ac").slice(-2)).toEqual(["--game", "ac"]);
  });
});
