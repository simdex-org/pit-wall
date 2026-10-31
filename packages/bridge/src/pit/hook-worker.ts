// Which driving keys the driver physically holds: a low-level keyboard hook, because only it can tell the real keyboard
// (and the instant it lets go) from the presses the bridge injects. A hook runs on the thread that installed it and needs
// that thread's message loop, so it lives in a worker. State goes to the main thread through a shared Int32Array
// indexed by virtual key (1 = held); slot 0 holds this thread's id so the main thread can stop the loop.
import { workerData } from "node:worker_threads";
import koffi from "koffi";

const held = new Int32Array((workerData as { shared: SharedArrayBuffer }).shared);
const drive = new Set<number>((workerData as { drive: number[] }).drive);

const user32 = koffi.load("user32.dll");
const k32 = koffi.load("kernel32.dll");
const KBLL = koffi.struct("KBDLLHOOKSTRUCT", { vkCode: "uint32", scanCode: "uint32", flags: "uint32", time: "uint32", dwExtraInfo: "uintptr_t" });
const POINT = koffi.struct("POINT", { x: "int32", y: "int32" });
const MSG = koffi.struct("MSG", { hwnd: "void *", message: "uint32", wParam: "uintptr_t", lParam: "intptr_t", time: "uint32", pt: POINT });
const HookProc = koffi.proto("intptr_t __stdcall HookProc(int code, uintptr_t wp, void *lp)");
const SetWindowsHookExW = user32.func("void * __stdcall SetWindowsHookExW(int id, HookProc *cb, void *mod, uint32 tid)");
const CallNextHookEx = user32.func("intptr_t __stdcall CallNextHookEx(void *hook, int code, uintptr_t wp, void *lp)");
const GetMessageW = user32.func("int __stdcall GetMessageW(_Out_ MSG *msg, void *hwnd, uint32 min, uint32 max)");
const GetCurrentThreadId = k32.func("uint32 __stdcall GetCurrentThreadId()");

const WH_KEYBOARD_LL = 13, LLKHF_INJECTED = 0x10, WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104;

const proc = koffi.register((code: number, wp: number, lp: unknown): number => {
  if (code === 0) {
    const k = koffi.decode(lp, KBLL) as { vkCode: number; flags: number };
    if (drive.has(k.vkCode) && !(k.flags & LLKHF_INJECTED)) { // ours are injected; the driver's are not
      Atomics.store(held, k.vkCode, wp === WM_KEYDOWN || wp === WM_SYSKEYDOWN ? 1 : 0);
    }
  }
  return CallNextHookEx(null, code, wp, lp) as number;
}, koffi.pointer(HookProc));

SetWindowsHookExW(WH_KEYBOARD_LL, proc, null, 0);
Atomics.store(held, 0, GetCurrentThreadId());
const msg = {};
while (GetMessageW(msg, null, 0, 0) > 0) { /* a low-level hook runs on this thread's message loop */ }
