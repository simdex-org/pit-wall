// The Win32 layer, exercised without ACC: what can be checked on any Windows PC.
import { describe, expect, test } from "vitest";
import koffi from "koffi";
import { AccMfd, vkOf } from "../src/pit/acc-mfd.js";
import { AccPages } from "../src/telemetry/pages.js";

describe.skipIf(process.platform !== "win32")("windows", () => {
  test("ACC's pages open (created if the game is not running) and read as zeros", () => {
    const r = new AccPages().read();
    expect(r.status).toBeTypeOf("number");
    expect(r.xyz).toHaveLength(3);
    expect(r.g_flags).toHaveLength(8);
  });

  test("the MFD reads, knows ACC is not focused, injects keys and runs its keyboard hook", async () => {
    const m = new AccMfd("p", 40);
    expect(m.read().status).toMatch(/off|live|replay|pause/);
    expect(m.focused()).toBe(false); // the test runner is in the foreground, not ACC
    await expect(m.press("pit")).rejects.toThrow(/not the focused window/);
    // Two key-up events for F24 (scan 0x76) in one SendInput call: harmless, and it proves the INPUT array layout.
    expect(() => (m as unknown as { send(...k: [number, number][]): void }).send([0x76, 8 | 2], [0x76, 8 | 2])).not.toThrow();
    await new Promise((r) => setTimeout(r, 300)); // the hook worker is up
    m.close();
  });

  test("INPUT is 40 bytes like the Win32 struct, and pit keys map", () => {
    const KB = koffi.struct("KB2", { wVk: "uint16", wScan: "uint16", dwFlags: "uint32", time: "uint32", dwExtraInfo: "uintptr_t" });
    const IN = koffi.struct("IN2", { type: "uint32", ki: KB, pad: koffi.array("uint8", 8) });
    expect(koffi.sizeof(IN)).toBe(40);
    expect([vkOf("p"), vkOf("F1"), vkOf("f24")]).toEqual([0x50, 0x70, 0x87]);
    expect(() => vkOf("pit")).toThrow();
  });
});
