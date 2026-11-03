// ACC's pit page: scan-code key presses (or vJoy buttons) out, the MFD's values read back from shared memory.
// Every press first checks that ACC is the focused window.
import koffi from "koffi";
import { openShared } from "../win/shm.js";
import { Key, Mfd, MfdSnapshot, sleep } from "./mfd.js";
import { vjoyDevice, vjoyPress, VJoy, VJOY_BUTTONS } from "./vjoy.js";

// acpmf_graphics (SPageFileGraphic, ACC shared memory 1.8): 1588 bytes.
const GFX_SIZE = 1588, OFF_STATUS = 4, OFF_PITLANE = 1236, OFF_MFD = 1532, OFF_SETS = 1572;
const STATUS = ["off", "replay", "live", "pause"];

const user32 = koffi.load("user32.dll");
const k32 = koffi.load("kernel32.dll");
const KEYBDINPUT = koffi.struct("KEYBDINPUT", { wVk: "uint16", wScan: "uint16", dwFlags: "uint32", time: "uint32", dwExtraInfo: "uintptr_t" });
// pad = MOUSEINPUT, the union's largest member
const INPUT = koffi.struct("INPUT", { type: "uint32", ki: KEYBDINPUT, pad: koffi.array("uint8", 8) });
const SendInput = user32.func("uint32 __stdcall SendInput(uint32 n, INPUT *inputs, int size)");
const GetForegroundWindow = user32.func("void * __stdcall GetForegroundWindow()");
const GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)");
const MapVirtualKeyW = user32.func("uint32 __stdcall MapVirtualKeyW(uint32 code, uint32 type)");
const OpenProcess = k32.func("void * __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)");
const QueryFullProcessImageNameW = k32.func("int __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32 *size)");
const CloseHandle = k32.func("int __stdcall CloseHandle(void *h)");

const KEYEVENTF_EXTENDEDKEY = 1, KEYEVENTF_KEYUP = 2, KEYEVENTF_SCANCODE = 8;
const ARROWS = { up: 0x48, down: 0x50, left: 0x4b, right: 0x4d } as const; // scan codes; games read scan codes, not virtual keys
const CLOSE_SCAN = 0x52; // Insert, ACC's default "Cycle MFD": leaves the pit page for the next one (extended key)
const NOT_FOCUSED = "ACC is not the focused window on the driver's PC - stopped before pressing anything else";

export function vkOf(name: string): number {
  const n = name.toLowerCase();
  const fn = /^f(\d+)$/.exec(n);
  if (fn) return 0x70 + Number(fn[1]) - 1;
  if (n.length === 1) return n.toUpperCase().charCodeAt(0);
  throw new Error(`pit key must be one character or F1-F24, not '${n}'`);
}

export class AccMfd implements Mfd {
  private read_: () => Buffer;
  private scan: Record<Key, number>;
  private hold: number; // seconds; raise key-ms if ACC misses presses at low frame rates
  private vj: VJoy | null = null;

  constructor(pitKey = "p", keyMs = 40, private vjoy?: number) {
    this.read_ = openShared("Local\\acpmf_graphics", GFX_SIZE);
    this.scan = { ...ARROWS, pit: MapVirtualKeyW(vkOf(pitKey), 0), close: CLOSE_SCAN };
    this.hold = keyMs / 1000;
    if (vjoy) this.vj = vjoyDevice(vjoy); // A virtual controller instead of the keyboard: ACC sees its own device for the MFD.
  }

  /** (scan code, flags) pairs in one SendInput call, so ACC takes them in the same frame. */
  private send(...keys: [number, number][]): void {
    const inputs = keys.map(([sc, fl]) => ({ type: 1, ki: { wVk: 0, wScan: sc, dwFlags: fl, time: 0, dwExtraInfo: 0 }, pad: new Array(8).fill(0) }));
    SendInput(inputs.length, inputs, koffi.sizeof(INPUT));
  }

  focused(): boolean {
    const pid = [0];
    GetWindowThreadProcessId(GetForegroundWindow(), pid);
    const h = OpenProcess(0x1000, 0, pid[0]!); // PROCESS_QUERY_LIMITED_INFORMATION
    if (!h) return false;
    const buf = Buffer.alloc(1040), n = [520];
    const ok = QueryFullProcessImageNameW(h, 0, buf, n);
    CloseHandle(h);
    return !!ok && buf.subarray(0, 2 * n[0]!).toString("utf16le").toLowerCase().endsWith("ac2-win64-shipping.exe");
  }

  async press(key: Key, n = 1): Promise<void> {
    if (this.vj) {
      for (let k = 0; k < n; k++) {
        if (!this.focused()) throw new Error(NOT_FOCUSED);
        await vjoyPress(this.vj, this.vjoy!, VJOY_BUTTONS[key], this.hold);
        if (key === "pit") await sleep(200);
      }
      return;
    }
    for (let k = 0; k < n; k++) {
      const ext = key in ARROWS || key === "close" ? KEYEVENTF_EXTENDEDKEY : 0; // arrows and Insert are on the extended block
      for (const flags of [KEYEVENTF_SCANCODE | ext, KEYEVENTF_SCANCODE | ext | KEYEVENTF_KEYUP]) {
        if (!this.focused()) throw new Error(NOT_FOCUSED);
        this.send([this.scan[key], flags]);
        await sleep(this.hold * 1000);
      }
      if (key === "pit") await sleep(200); // the page redraws before it takes the next key
    }
  }

  async settle(): Promise<void> {
    const key = () => JSON.stringify([this.read().fuel, this.read().tyre_set, this.read().pressures]);
    let last = key(), since = Date.now();
    const end = since + 400;
    while (Date.now() < end && Date.now() - since < 50) {
      await sleep(10);
      const k = key();
      if (k !== last) { last = k; since = Date.now(); }
    }
  }

  read(): MfdSnapshot {
    const b = this.read_();
    const status = b.readInt32LE(OFF_STATUS);
    const round1 = (x: number) => Math.round(x * 10) / 10;
    return {
      status: STATUS[status] ?? "off", fuel: round1(b.readFloatLE(OFF_MFD + 4)), tyre_set: b.readInt32LE(OFF_MFD) + 1, // mfdTyreSet counts from 0, the page from 1
      pressures: [0, 1, 2, 3].map((k) => round1(b.readFloatLE(OFF_MFD + 8 + 4 * k))), current_set: b.readInt32LE(OFF_SETS), strategy_set: b.readInt32LE(OFF_SETS + 4),
      in_pit_lane: !!b.readInt32LE(OFF_PITLANE),
    };
  }
}
