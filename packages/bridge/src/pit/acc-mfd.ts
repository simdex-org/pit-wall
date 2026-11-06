import koffi from "koffi";
import { openShared } from "../win/shm.js";
import { accKeys, keyCode } from "./acc-keys.js";
import { Key, Mfd, MfdSnapshot, sleep } from "./mfd.js";
import { vjoyDevice, vjoyPress, VJoy, VJOY_BUTTONS } from "./vjoy.js";

const GFX_SIZE = 1588, OFF_STATUS = 4, OFF_PITLANE = 1236, OFF_MFD = 1532, OFF_SETS = 1572;
const STATUS = ["off", "replay", "live", "pause"];

const user32 = koffi.load("user32.dll");
const k32 = koffi.load("kernel32.dll");
const KEYBDINPUT = koffi.struct("KEYBDINPUT", { wVk: "uint16", wScan: "uint16", dwFlags: "uint32", time: "uint32", dwExtraInfo: "uintptr_t" });
const INPUT = koffi.struct("INPUT", { type: "uint32", ki: KEYBDINPUT, pad: koffi.array("uint8", 8) });
const SendInput = user32.func("uint32 __stdcall SendInput(uint32 n, INPUT *inputs, int size)");
const GetForegroundWindow = user32.func("void * __stdcall GetForegroundWindow()");
const GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)");
const MapVirtualKeyW = user32.func("uint32 __stdcall MapVirtualKeyW(uint32 code, uint32 type)");
const OpenProcess = k32.func("void * __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)");
const QueryFullProcessImageNameW = k32.func("int __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32 *size)");
const CloseHandle = k32.func("int __stdcall CloseHandle(void *h)");

const KEYEVENTF_EXTENDEDKEY = 1, KEYEVENTF_KEYUP = 2, KEYEVENTF_SCANCODE = 8;
const NOT_FOCUSED = "ACC is not the focused window on the driver's PC - stopped before pressing anything else";

export class AccMfd implements Mfd {
  private read_: () => Buffer;
  private scan = {} as Record<Key, [number, number]>;
  private hold: number;
  readonly keys: Record<Key, string>;
  private vj: VJoy | null = null;

  constructor(pitKey?: string, keyMs = 40, private vjoy?: number) {
    this.read_ = openShared("Local\\acpmf_graphics", GFX_SIZE);
    this.keys = accKeys();
    if (pitKey) this.keys.pit = pitKey;
    for (const [k, name] of Object.entries(this.keys) as [Key, string][]) {
      const c = keyCode(name);
      this.scan[k] = [MapVirtualKeyW(c.vk, 0), c.ext ? KEYEVENTF_EXTENDEDKEY : 0];
    }
    this.hold = keyMs / 1000;
    if (vjoy) this.vj = vjoyDevice(vjoy);
  }

  private send(...keys: [number, number][]): void {
    const inputs = keys.map(([sc, fl]) => ({ type: 1, ki: { wVk: 0, wScan: sc, dwFlags: fl, time: 0, dwExtraInfo: 0 }, pad: new Array(8).fill(0) }));
    SendInput(inputs.length, inputs, koffi.sizeof(INPUT));
  }

  focused(): boolean {
    const pid = [0];
    GetWindowThreadProcessId(GetForegroundWindow(), pid);
    const h = OpenProcess(0x1000, 0, pid[0]!);
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
      const [sc, ext] = this.scan[key];
      for (const flags of [KEYEVENTF_SCANCODE | ext, KEYEVENTF_SCANCODE | ext | KEYEVENTF_KEYUP]) {
        if (!this.focused()) throw new Error(NOT_FOCUSED);
        this.send([sc, flags]);
        await sleep(this.hold * 1000);
      }
      if (key === "pit") await sleep(200);
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
      status: STATUS[status] ?? "off", fuel: round1(b.readFloatLE(OFF_MFD + 4)), tyre_set: b.readInt32LE(OFF_MFD) + 1,
      pressures: [0, 1, 2, 3].map((k) => round1(b.readFloatLE(OFF_MFD + 8 + 4 * k))), current_set: b.readInt32LE(OFF_SETS), strategy_set: b.readInt32LE(OFF_SETS + 4),
      in_pit_lane: !!b.readInt32LE(OFF_PITLANE),
    };
  }
}
