import { describe, expect, test } from "vitest";
import koffi from "koffi";

const win = process.platform === "win32";
// both load kernel32 as soon as they are imported
const { AccMfd } = win ? await import("../src/pit/acc-mfd.js") : ({} as typeof import("../src/pit/acc-mfd.js"));
const { AccPages } = win ? await import("../src/telemetry/pages.js") : ({} as typeof import("../src/telemetry/pages.js"));
const { LmuPages } = win ? await import("../src/telemetry/lmu-pages.js") : ({} as typeof import("../src/telemetry/lmu-pages.js"));

describe.skipIf(!win)("windows", () => {
  test("ACC's pages open (created if the game is not running) and read as zeros", () => {
    const r = new AccPages().read();
    expect(r.status).toBeTypeOf("number");
    expect(r.xyz).toHaveLength(3);
    expect(r.g_flags).toHaveLength(8);
  });

  test("LMU's mapping is only opened, never made: without the game there is no session", () => {
    expect(new LmuPages().read()).toEqual({ status: 0 });
  });

  test("the MFD reads, knows ACC is not focused, injects keys", async () => {
    const m = new AccMfd("p", 40);
    expect(m.read().status).toMatch(/off|live|replay|pause/);
    expect(m.focused()).toBe(false);
    await expect(m.press("pit")).rejects.toThrow(/not the focused window/);
    expect(() => (m as unknown as { send(...k: [number, number][]): void }).send([0x76, 8 | 2], [0x76, 8 | 2])).not.toThrow();
  });

  test("INPUT is 40 bytes like the Win32 struct", () => {
    const KB = koffi.struct("KB2", { wVk: "uint16", wScan: "uint16", dwFlags: "uint32", time: "uint32", dwExtraInfo: "uintptr_t" });
    const IN = koffi.struct("IN2", { type: "uint32", ki: KB, pad: koffi.array("uint8", 8) });
    expect(koffi.sizeof(IN)).toBe(40);
  });
});
