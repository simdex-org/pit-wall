#!/usr/bin/env python3
"""Pit stop control for Assetto Corsa Competizione, run on the driver's PC.

ACC has no way to write the pit strategy from outside: its shared memory and
its broadcasting API are read-only. So this does what the driver would do: it
presses the MFD keys (the pitstop-page key, then the arrows) while ACC has
focus, and reads the MFD's fuel, tyre set and four pressures back from the
shared-memory page "acpmf_graphics" to steer to the target and confirm it.
Tyre change, compound, brake pads and repairs are not published, so they are
set by position; tyre change, compound and brake change are then confirmed
indirectly (by which rows answer), pads and repairs cannot be.

The pit page, top to bottom (the pitstop key pressed twice leaves the cursor
on the first row; Up from the first row wraps to the last):

    Pit limiter, [Strategy], Refuel, Change tyres,
      [Tyre set (dry only), Compound, All four, FL, FR, RL, RR]   while Change tyres is on
    Change brakes, [Front pads, Rear pads]                          while Change brakes is on
    [Driver], Repair suspension, Repair bodywork

    python server/acc_pit.py        # self-test: every layout, against a simulated MFD
"""
import ctypes
import ctypes.wintypes
import itertools
import json
import mmap
import os
import struct
import sys
import threading
import time

# acpmf_graphics (SPageFileGraphic, ACC shared memory 1.8): 1588 bytes.
GFX_SIZE, OFF_STATUS, OFF_PITLANE, OFF_MFD, OFF_SETS = 1588, 4, 1236, 1532, 1572
STATUS = ["off", "replay", "live", "pause"]
CORNERS = ["fl", "fr", "rl", "rr"]


def clean(plan):
    """Validate a plan from the network. Raises ValueError."""
    if not isinstance(plan, dict):
        raise ValueError("plan must be an object")

    def num(k, lo, hi, kind=float):
        v = plan.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
            raise ValueError(f"{k} must be a number from {lo} to {hi}")
        return kind(v)

    p = plan.get("pressures")
    if not isinstance(p, list) or len(p) != 4:
        raise ValueError("pressures must be four numbers")
    if plan.get("compound") not in ("dry", "wet"):
        raise ValueError("compound must be dry or wet")
    return {
        "fuel": num("fuel", 0, 150, int), "tyres": plan.get("tyres") is True, "compound": plan["compound"],
        "tyre_set": num("tyre_set", 1, 50, int),
        "pressures": [_psi(v) for v in p],
        "brakes": plan.get("brakes") is True, "front_pad": num("front_pad", 1, 4, int), "rear_pad": num("rear_pad", 1, 4, int),
        "flip_suspension": plan.get("flip_suspension") is True, "flip_bodywork": plan.get("flip_bodywork") is True,
    }


def _psi(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not 15 <= v <= 40:
        raise ValueError("pressures must be from 15 to 40 psi")
    return round(float(v), 1)


# ---------- the real thing: shared memory in, key presses out (Windows only) ----------
class _KI(ctypes.Structure):
    _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort), ("dwFlags", ctypes.c_ulong),
                ("time", ctypes.c_ulong), ("dwExtraInfo", ctypes.c_size_t)]


class _INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("ki", _KI), ("pad", ctypes.c_byte * 8)]   # pad = MOUSEINPUT, the union's largest member


class _KBLL(ctypes.Structure):   # KBDLLHOOKSTRUCT
    _fields_ = [("vkCode", ctypes.c_ulong), ("scanCode", ctypes.c_ulong), ("flags", ctypes.c_ulong),
                ("time", ctypes.c_ulong), ("dwExtraInfo", ctypes.c_size_t)]


_HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, ctypes.c_size_t, ctypes.c_ssize_t)


class AccMfd:
    """ACC's pit page on this PC. Keys go only to ACC: every press first checks ACC is the focused window."""
    ARROWS = {"up": 0x48, "down": 0x50, "left": 0x4B, "right": 0x4D}   # scan codes; games read scan codes, not virtual keys

    def __init__(self, pit_key="p", key_ms=40):
        # ACCESS_WRITE like every ACC reader: started before ACC, this creates the mapping ACC then opens. Nothing is written.
        self.mem = mmap.mmap(-1, GFX_SIZE, tagname="Local\\acpmf_graphics", access=mmap.ACCESS_WRITE)
        self.u, self.k = ctypes.WinDLL("user32"), ctypes.WinDLL("kernel32")
        self.u.GetForegroundWindow.restype = ctypes.c_void_p
        self.u.GetWindowThreadProcessId.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        self.k.OpenProcess.restype = ctypes.c_void_p
        self.k.QueryFullProcessImageNameW.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_ulong)]
        self.k.CloseHandle.argtypes = [ctypes.c_void_p]
        self.u.SetWindowsHookExW.argtypes = [ctypes.c_int, _HOOKPROC, ctypes.c_void_p, ctypes.c_ulong]
        self.u.SetWindowsHookExW.restype = ctypes.c_void_p
        self.u.CallNextHookEx.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_size_t, ctypes.c_ssize_t]
        self.u.CallNextHookEx.restype = ctypes.c_ssize_t
        self.scan = dict(self.ARROWS, pit=self._scan_of(pit_key))
        self.hold = key_ms / 1000   # ponytail: one knob for hold and gap; raise it if ACC misses presses at low frame rates
        # Driving on a keyboard: a key going down or up makes ACC drop the gas, brake and steering keys the driver is holding,
        # until they are pressed again. So every MFD press re-presses whichever of them the driver physically holds, and lets go
        # of that copy the moment the driver lets go of the real key. Only these few keys are watched, and only to know if held.
        self.drive = self._driving_keys()
        self.physical, self.copies, self.keys_lock = set(), set(), threading.Lock()   # the lock: no copy is pressed after its release
        threading.Thread(target=self._watch_keyboard, daemon=True).start()
        threading.Thread(target=self._let_go, daemon=True).start()

    def _scan_of(self, name):
        name = name.lower()
        vk = 0x70 + int(name[1:]) - 1 if name[:1] == "f" and name[1:].isdigit() else ord(name.upper()) if len(name) == 1 else None
        if vk is None:
            raise ValueError(f"pit key must be one character or F1-F24, not {name!r}")
        return self.u.MapVirtualKeyW(vk, 0)

    def _driving_keys(self):
        """{virtual key: scan code} of ACC's keyboard gas, brake and steering, from its controls.json, plus W A S D."""
        names = {"W", "A", "S", "D"}
        try:
            with open(os.path.expanduser(r"~\Documents\Assetto Corsa Competizione\Config\controls.json"), encoding="utf-8-sig") as f:
                names |= {b["key"]["key"] for b in json.load(f)["keyboardSettings"]["raceCommandButtonList"]
                          if b.get("actionType") in ("KeyboardGas", "KeyboardBrake", "KeyboardSteerLeft", "KeyboardSteerRight")}
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return {ord(n.upper()): self.u.MapVirtualKeyW(ord(n.upper()), 0) for n in names if len(n) == 1 and n.isalnum()}

    def _watch_keyboard(self):
        """Which driving keys the driver physically holds: a low-level hook, because only it can tell the real keyboard
        (and the instant it lets go) from the presses this program injects."""
        self.physical.update(vk for vk in self.drive if self.u.GetAsyncKeyState(vk) & 0x8000)   # nothing injected yet: this is the real state

        def proc(code, wp, lp):
            k = ctypes.cast(lp, ctypes.POINTER(_KBLL)).contents
            if code == 0 and k.vkCode in self.drive and not k.flags & 0x10:   # 0x10 LLKHF_INJECTED: ours, not the driver's
                (self.physical.add if wp in (0x100, 0x104) else self.physical.discard)(k.vkCode)
            return self.u.CallNextHookEx(None, code, wp, lp)

        self._proc = _HOOKPROC(proc)   # kept alive for as long as the hook
        self.u.SetWindowsHookExW(13, self._proc, None, 0)   # WH_KEYBOARD_LL
        msg = ctypes.wintypes.MSG()
        while self.u.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:   # a low-level hook runs on this thread's message loop
            pass

    def _let_go(self):
        while True:
            time.sleep(0.005)
            with self.keys_lock:
                for vk in list(self.copies):
                    if vk not in self.physical:   # the driver let go: so does our copy, so nothing stays held
                        self.copies.discard(vk)
                        self._send((self.drive[vk], 8 | 2))

    def _send(self, *keys):
        """(scan code, flags) pairs in one SendInput call, so ACC takes them in the same frame."""
        arr = (_INPUT * len(keys))(*[_INPUT(type=1, ki=_KI(wScan=sc, dwFlags=fl)) for sc, fl in keys])
        self.u.SendInput(len(keys), arr, ctypes.sizeof(_INPUT))

    def focused(self):
        pid = ctypes.c_ulong()
        self.u.GetWindowThreadProcessId(self.u.GetForegroundWindow(), ctypes.byref(pid))
        h = self.k.OpenProcess(0x1000, False, pid.value)   # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        buf, n = ctypes.create_unicode_buffer(520), ctypes.c_ulong(520)
        ok = self.k.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n))
        self.k.CloseHandle(h)
        return bool(ok) and buf.value.lower().endswith("ac2-win64-shipping.exe")

    def press(self, key, n=1):
        for _ in range(n):
            if not self.focused():
                raise RuntimeError("ACC is not the focused window on the driver's PC - stopped before pressing anything else")
            ext = 1 if key in self.ARROWS else 0   # KEYEVENTF_EXTENDEDKEY: arrows are on the extended block
            for flags in (8 | ext, 8 | ext | 2):   # KEYEVENTF_SCANCODE, then + KEYEVENTF_KEYUP
                with self.keys_lock:
                    held = [vk for vk in self.drive if vk in self.physical]
                    self.copies.update(held)
                    self._send((self.scan[key], flags), *[(self.drive[vk], 8) for vk in held])   # the MFD key, and the driver's keys again
                time.sleep(self.hold)
            if key == "pit":
                time.sleep(0.2)   # the page redraws before it takes the next key

    def read(self):
        b = self.mem[:GFX_SIZE]
        status = struct.unpack_from("<i", b, OFF_STATUS)[0]
        tyre_set, fuel, *p = struct.unpack_from("<i5f", b, OFF_MFD)
        cur, nxt = struct.unpack_from("<2i", b, OFF_SETS)
        return {"status": STATUS[status] if 0 <= status < 4 else "off", "fuel": round(fuel, 1), "tyre_set": tyre_set,
                "pressures": [round(x, 1) for x in p], "current_set": cur, "strategy_set": nxt,
                "in_pit_lane": bool(struct.unpack_from("<i", b, OFF_PITLANE)[0])}


# ---------- driving the page to a plan ----------
def _diff(a, b):
    return {"fuel": round(b["fuel"] - a["fuel"], 1), "set": b["tyre_set"] - a["tyre_set"],
            "p": [i for i in range(4) if abs(a["pressures"][i] - b["pressures"][i]) > 0.05]}


def apply(plan, mfd):
    """Drive the pit page to `plan` (see clean). Returns {field: "ok" | "sent" | "skipped" | problem}.
    "ok" was read back from the game; "sent" was pressed but ACC does not publish it."""
    if mfd.read()["status"] != "live":
        raise RuntimeError("ACC is not in a live session on the driver's PC")
    res = {}

    def at(row, key=None, n=1):   # cursor to row (negative: from the bottom), then key n times
        mfd.press("pit", 2)
        mfd.press("down" if row >= 0 else "up", abs(row))
        if key:
            mfd.press(key, n)

    def probe(row):   # what one step on this row changes; the step is undone
        a = mfd.read()
        at(row, "right")
        d = _diff(a, mfd.read())
        mfd.press("left")
        if not d["fuel"] and not d["set"] and not d["p"]:   # at a limit, or a row nothing reports: try the other way
            at(row, "left")
            d = _diff(a, mfd.read())
            mfd.press("right")
        return d

    def steer(row, get, target, step):
        for _ in range(4):
            n = round((target - get(mfd.read())) / step)
            if n == 0:
                return "ok"
            at(row, "right" if n > 0 else "left", abs(n))
        v = get(mfd.read())
        return "ok" if round((target - v) / step) == 0 else f"stopped at {v}"

    # Where things are. Refuel is row 1, or row 2 under a Strategy row: the one that moves fuel, and only fuel, by 1 L.
    d = probe(1)
    refuel = 1 if abs(abs(d["fuel"]) - 1) < 0.05 and not d["set"] and not d["p"] else 2
    tyres = refuel + 1                                    # the Change tyres row
    tyres_were_on = bool(probe(tyres + 3)["p"])           # All four (dry) or FL (wet) only exists while tyres change
    if not tyres_were_on:
        at(tyres, "right")
        if not probe(tyres + 3)["p"]:
            raise RuntimeError("could not find the tyre rows on the pit page - is it the pitstop MFD page this key opens?")

    def wet_now():   # row tyres+4 is FL when dry (a Tyre set row is above), FR when wet
        d = probe(tyres + 4)["p"]
        if d not in ([0], [1]):
            raise RuntimeError("the tyre rows are not where ACC puts them")
        return d == [1]

    def tail_now():   # rows below RR: Change brakes, [2 pads], [Driver], 2 repairs = 3..6
        for tail in range(3, 7):
            if probe(-(tail + 1))["p"] == [3]:
                return tail
        raise RuntimeError("could not count the rows below the tyres")

    wet = wet_now()
    tail = tail_now()
    brakes_on = tail >= 5

    res["fuel"] = steer(refuel, lambda m: m["fuel"], plan["fuel"], 1)

    if plan["tyres"]:
        if (plan["compound"] == "wet") != wet:
            at(tyres + (1 if wet else 2), "right" if plan["compound"] == "wet" else "left")   # Right is wet, Left is dry, whatever it was
            wet = wet_now()
        res["compound"] = "ok" if (plan["compound"] == "wet") == wet else "did not change"
        res["tyre_set"] = "skipped" if wet else steer(tyres + 1, lambda m: m["tyre_set"], plan["tyre_set"], 1)
        first = tyres + (3 if wet else 4)
        for i, c in enumerate(CORNERS):
            res[c] = steer(first + i, lambda m, i=i: m["pressures"][i], plan["pressures"][i], 0.1)
    else:
        res.update({k: "skipped" for k in ["compound", "tyre_set"] + CORNERS})

    brakes = tyres + (6 if wet else 7) + 1                 # the Change brakes row, tyre rows showing
    if plan["brakes"] != brakes_on:
        at(brakes, "right")
        brakes_on = tail_now() >= 5
    res["brakes"] = "ok" if brakes_on == plan["brakes"] else "did not change"
    if plan["brakes"] and brakes_on:
        for row, k in ((brakes + 1, "front_pad"), (brakes + 2, "rear_pad")):
            at(row, "left", 3)                             # down to compound 1, then up to the one asked for
            mfd.press("right", plan[k] - 1)
            res[k] = "sent"
    else:
        res["front_pad"] = res["rear_pad"] = "skipped"

    for row, k in ((-2, "flip_suspension"), (-1, "flip_bodywork")):
        if plan[k]:
            at(row, "right")
            res[k] = "sent"

    if not plan["tyres"]:
        at(tyres, "right")
        res["tyres"] = "ok" if not probe(tyres + 3)["p"] else "did not change"
    else:
        res["tyres"] = "ok"
    return res


# ---------- a simulated pit page: the self-test, and --simulate-acc for trying the dashboard without the game ----------
class FakeMfd:
    def __init__(self, strategy=True, tyres=True, wet=False, brakes=False, driver=False):
        self.s = {"strategy": strategy, "tyres": tyres, "wet": wet, "brakes": brakes, "driver": driver}
        self.fuel, self.set, self.p, self.pads, self.repair = 12.0, 3, [27.5, 27.4, 27.3, 27.2], [2, 3], [True, True]
        self.cur, self.strat, self.presses = 0, 0, 0

    def rows(self):
        s = self.s
        r = ["limiter"] + ["strategy"] * s["strategy"] + ["fuel", "tyres"]
        if s["tyres"]:
            r += ([] if s["wet"] else ["set"]) + ["compound", "all"] + CORNERS
        return r + ["brakes"] + ["pad0", "pad1"] * s["brakes"] + ["driver"] * s["driver"] + ["susp", "body"]

    def press(self, key, n=1):
        for _ in range(n):
            self.presses += 1
            if key == "pit":
                self.cur = 0
            elif key in ("up", "down"):
                self.cur = (self.cur + (1 if key == "down" else -1)) % len(self.rows())
            else:
                d, row = (1 if key == "right" else -1), self.rows()[self.cur]
                if row == "fuel":
                    self.fuel = min(120.0, max(0.0, self.fuel + d))
                elif row == "set":
                    self.set = min(50, max(1, self.set + d))
                elif row == "compound":
                    self.s["wet"] = d > 0
                    self.cur = self.rows().index("compound")
                elif row == "all":
                    self.p = [round(x + d * 0.1, 1) for x in self.p]
                elif row in CORNERS:
                    i = CORNERS.index(row)
                    self.p[i] = round(self.p[i] + d * 0.1, 1)
                elif row in ("tyres", "brakes"):
                    self.s[row] = not self.s[row]
                elif row.startswith("pad"):
                    i = int(row[3])
                    self.pads[i] = min(4, max(1, self.pads[i] + d))
                elif row in ("susp", "body"):
                    self.repair[row == "body"] = not self.repair[row == "body"]
                elif row == "strategy":   # switching strategy loads that strategy's fuel and pressures
                    self.strat ^= 1
                    self.fuel, self.p = [(30.0, [26.0] * 4), (55.0, [27.0] * 4)][self.strat]
                    self.p = list(self.p)

    def read(self):
        return {"status": "live", "fuel": self.fuel, "tyre_set": self.set, "pressures": list(self.p),
                "current_set": 1, "strategy_set": 2, "in_pit_lane": False}


def selftest():
    plans = [
        {"fuel": 47, "tyres": True, "compound": "dry", "tyre_set": 5, "pressures": [26.4, 26.6, 26.1, 26.3],
         "brakes": True, "front_pad": 1, "rear_pad": 4, "flip_suspension": True, "flip_bodywork": False},
        {"fuel": 0, "tyres": True, "compound": "wet", "tyre_set": 2, "pressures": [30.0, 30.0, 29.5, 29.5],
         "brakes": False, "front_pad": 2, "rear_pad": 2, "flip_suspension": False, "flip_bodywork": True},
        {"fuel": 120, "tyres": False, "compound": "dry", "tyre_set": 1, "pressures": [27.0] * 4,
         "brakes": False, "front_pad": 1, "rear_pad": 1, "flip_suspension": False, "flip_bodywork": False},
    ]
    n = 0
    for layout in itertools.product([False, True], repeat=5):
        for plan in plans:
            m = FakeMfd(*layout)
            repair0 = list(m.repair)
            res = apply(clean(plan), m)
            assert m.fuel == plan["fuel"] and res["fuel"] == "ok", (layout, plan, res, m.fuel)
            assert m.s["tyres"] == plan["tyres"] and m.s["brakes"] == plan["brakes"], (layout, plan, m.s)
            if plan["tyres"]:
                assert m.s["wet"] == (plan["compound"] == "wet"), (layout, plan)
                assert m.p == plan["pressures"], (layout, plan, m.p)
                assert plan["compound"] == "wet" or m.set == plan["tyre_set"], (layout, plan, m.set)
            if plan["brakes"]:
                assert m.pads == [plan["front_pad"], plan["rear_pad"]], (layout, plan, m.pads)
            assert m.repair == [repair0[0] ^ plan["flip_suspension"], repair0[1] ^ plan["flip_bodywork"]], (layout, plan, m.repair)
            assert m.s["strategy"] == layout[0] and m.s["driver"] == layout[4]
            n += 1
    for bad in [{}, dict(plans[0], fuel=-1), dict(plans[0], pressures=[27] * 3), dict(plans[0], compound="slick"), dict(plans[0], front_pad=True)]:
        try:
            clean(bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")
    print(f"ok: {n} plans applied across every pit page layout; bad plans refused")


if __name__ == "__main__":
    selftest() if len(sys.argv) == 1 else print(__doc__)
