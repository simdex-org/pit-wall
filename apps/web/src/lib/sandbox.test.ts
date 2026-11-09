import { describe, expect, test } from "vitest";
import type { ModuleDef } from "../engine/types";
import { sanitizeOptions } from "../state/templates";
import { changed, cleanSource, frameDoc, MAX_SOURCE, sourceProblem } from "./sandbox";

type Api = { latest: Record<string, unknown>; on: (k: string, fn: (v: unknown) => void) => () => void };

function boot() {
  const parent = {}, props: Record<string, string> = {};
  let listener: (e: unknown) => void = () => {};
  const win = {
    RTCPeerConnection: class {},
    document: { documentElement: { style: { setProperty: (k: string, v: string) => { props[k] = v; }, colorScheme: "" } } },
    addEventListener: (_: string, fn: (e: unknown) => void) => { listener = fn; },
  } as Record<string, unknown>;
  const code = /<script>([\s\S]*?)<\/script>/.exec(frameDoc("<p>hi</p>"))![1]!;
  new Function("window", "parent", code)(win, parent);
  const send = (data: unknown, source: unknown = parent) => listener({ source, data });
  return { win, api: win.pitwall as Api, props, send, parent };
}

describe("module frame helper", () => {
  test("hands each kind of data to its listeners and keeps the latest", () => {
    const { api, send } = boot();
    const got: unknown[] = [], all: unknown[] = [];
    api.on("reading", (v) => got.push(v));
    api.on("update", (v) => all.push(v));
    send({ type: "data", data: { reading: { car: { fuel_litres: 40 } }, summary: null } });
    expect(got).toEqual([{ car: { fuel_litres: 40 } }]);
    expect(all).toHaveLength(1);
    expect(api.latest.summary).toBeNull();
    const late: unknown[] = [];
    api.on("reading", (v) => late.push(v));
    expect(late).toEqual([{ car: { fuel_litres: 40 } }]);
  });

  test("ignores messages that are not from the page or not data", () => {
    const { api, send } = boot();
    const got: unknown[] = [];
    api.on("reading", (v) => got.push(v));
    send({ type: "data", data: { reading: 1 } }, {});
    send({ type: "source", html: "x" });
    send(null);
    expect(got).toEqual([]);
  });

  test("a failing listener does not stop the others, and off works", () => {
    const { api, send } = boot();
    const got: unknown[] = [];
    const err = console.error;
    console.error = () => {};
    api.on("laps", () => { throw new Error("boom"); });
    const off = api.on("laps", (v) => got.push(v));
    send({ type: "data", data: { laps: [1] } });
    off();
    send({ type: "data", data: { laps: [2] } });
    console.error = err;
    expect(got).toEqual([[1]]);
  });

  test("applies the theme colours and removes WebRTC", () => {
    const { win, send, props } = boot();
    send({ type: "data", data: { theme: { vars: { "--txt": "#fff" }, scheme: "dark" } } });
    expect(props["--txt"]).toBe("#fff");
    expect(win.RTCPeerConnection).toBeUndefined();
  });

  test("the helper cannot be replaced by module code", () => {
    const { win } = boot();
    expect(() => { "use strict"; (win as Record<string, unknown>).pitwall = 1; }).toThrow();
  });
});

describe("module source", () => {
  test("puts the helper first and keeps the source's doctype out of the body", () => {
    const d = frameDoc("<!DOCTYPE html><html><body>x</body></html>");
    expect(d.startsWith("<!doctype html><script>")).toBe(true);
    expect(d.match(/doctype/gi)).toHaveLength(1);
  });

  test("size limit and cleaning", () => {
    expect(sourceProblem("x".repeat(MAX_SOURCE))).toBeNull();
    expect(sourceProblem("x".repeat(MAX_SOURCE + 1))).toMatch(/limit/);
    expect(cleanSource("x".repeat(MAX_SOURCE + 1))).toBeNull();
    expect(cleanSource(5)).toBeNull();
    expect(cleanSource("a\n\tb\r\n\u0000c")).toBe("a\n\tb\r\nc");
  });

  test("a source keeps its lines in the saved layout; an oversized one falls back to the default", () => {
    const def = { options: [{ key: "src", label: "", type: "code", def: "d" }] } as unknown as ModuleDef;
    expect(sanitizeOptions(def, { src: "<p>\n</p>" }, () => {})).toEqual({ src: "<p>\n</p>" });
    expect(sanitizeOptions(def, { src: "x".repeat(MAX_SOURCE + 1) }, () => {})).toEqual({ src: "d" });
  });

  test("only changed parts of the payload are sent", () => {
    const r = { a: 1 }, base = { reading: r, summary: null, field: null, laps: [], units: {}, theme: {} };
    expect(changed({}, base)).toEqual(base);
    expect(changed(base, { ...base })).toBeNull();
    expect(changed(base, { ...base, reading: { a: 1 } })).toEqual({ reading: { a: 1 } });
  });
});
