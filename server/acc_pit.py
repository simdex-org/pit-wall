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

    python server/acc_pit.py                # self-test: every layout, against a simulated MFD
    python server/acc_pit.py --bind-vjoy    # bind ACC's MFD actions to vJoy buttons 1-6 (with bridge.py --vjoy)
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
GROUPS = ("fuel", "tyres", "pressures", "brakes", "repairs")   # what can be sent on its own; "tyres" includes the pressures


def clean(plan):
    """Validate a plan from the network. Raises ValueError. `only` lists the groups to send (all when absent);
    fields of groups not sent are not needed."""
    if not isinstance(plan, dict):
        raise ValueError("plan must be an object")
    only = plan.get("only", list(GROUPS))
    if not isinstance(only, list) or not only or any(g not in GROUPS for g in only):
        raise ValueError(f"only must list some of {', '.join(GROUPS)}")
    only = set(only)
    filler = {"fuel": 0, "compound": "dry", "tyre_set": 1, "pressures": [27.0] * 4, "front_pad": 1, "rear_pad": 1}
    wanted = {"fuel": ["fuel"], "tyres": ["compound", "tyre_set", "pressures"], "pressures": ["pressures"],
              "brakes": ["front_pad", "rear_pad"], "repairs": []}
    needed = {k for g in only for k in wanted[g]}
    plan = {**{k: v for k, v in filler.items() if k not in needed}, **{k: v for k, v in plan.items() if k in needed or k not in filler}}

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
        "only": sorted(only, key=GROUPS.index),
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

    VJOY_BUTTONS = {"pit": 1, "up": 2, "down": 3, "left": 4, "right": 5, "close": 6}   # bound to ACC's MFD actions in its Controls screen
    CLOSE_SCAN = 0x52   # Insert, ACC's default "Cycle MFD": leaves the pit page for the next one (extended key)
    VJOY_DLL = r"C:\Program Files\vJoy\x64\vJoyInterface.dll"

    def __init__(self, pit_key="p", key_ms=40, vjoy=None):
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
        self.scan = dict(self.ARROWS, pit=self._scan_of(pit_key), close=self.CLOSE_SCAN)
        self.hold = key_ms / 1000   # ponytail: one knob for hold and gap; raise it if ACC misses presses at low frame rates
        self.waiting, self.vjoy = False, vjoy
        if vjoy:
            # A virtual controller (vJoy) instead of the keyboard: ACC sees its own device for the MFD, so the driver's keyboard is
            # never touched and nothing has to wait for a lift.
            self.vj = vjoy_device(vjoy)
            return
        # Driving on a keyboard: a key typed into the MFD makes ACC drop the gas, brake and steering keys the driver is holding,
        # until they are pressed again. So MFD keys are only typed while the driver holds none of them (a lift, a coast into a
        # corner), and a driving key pressed during one is pressed again until the driver lets go of it. Only these few keys are
        # watched, and only to know whether they are held. A wheel driver holds none, so nothing waits.
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
            from acc_broadcast import acc_config_dir   # the real Documents folder, OneDrive or not
            with open(os.path.join(acc_config_dir(), "controls.json"), encoding="utf-8-sig") as f:
                names |= {b["key"]["key"] for b in json.load(f)["keyboardSettings"]["raceCommandButtonList"]
                          if b.get("actionType") in ("KeyboardGas", "KeyboardBrake", "KeyboardSteerLeft", "KeyboardSteerRight")}
        except (ImportError, OSError, ValueError, KeyError, TypeError):   # ImportError: acc_pit.py copied and run on its own
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

    def _lift(self):
        """Wait until the driver holds no driving key."""
        while True:
            for vk in list(self.physical):   # a release the hook missed (alt-tab, a stall): the key state says it is up
                if vk not in self.copies and not self.u.GetAsyncKeyState(vk) & 0x8000:
                    self.physical.discard(vk)
            if not any(vk in self.physical for vk in self.drive):
                break
            self.waiting = True
            time.sleep(0.005)
        self.waiting = False

    def _repress(self):
        with self.keys_lock:
            held = [vk for vk in self.drive if vk in self.physical]
            if held:
                self.copies.update(held)
                self._send(*[(self.drive[vk], 8) for vk in held])

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
        if self.vjoy:
            for _ in range(n):
                if not self.focused():
                    raise RuntimeError("ACC is not the focused window on the driver's PC - stopped before pressing anything else")
                vjoy_press(self.vj, self.vjoy, self.VJOY_BUTTONS[key], self.hold)
                if key == "pit":
                    time.sleep(0.2)
            return
        for _ in range(n):
            ext = 1 if key in self.ARROWS or key == "close" else 0   # KEYEVENTF_EXTENDEDKEY: arrows and Insert are on the extended block
            for flags in (8 | ext, 8 | ext | 2):   # KEYEVENTF_SCANCODE, then + KEYEVENTF_KEYUP
                self._lift()
                if not self.focused():
                    raise RuntimeError("ACC is not the focused window on the driver's PC - stopped before pressing anything else")
                self._send((self.scan[key], flags))
                for _ in range(5):   # a driving key pressed just now may be dropped too: press it again, like a held key repeats
                    time.sleep(self.hold / 5)
                    self._repress()
            if key == "pit":
                time.sleep(0.2)   # the page redraws before it takes the next key

    def read(self):
        b = self.mem[:GFX_SIZE]
        status = struct.unpack_from("<i", b, OFF_STATUS)[0]
        tyre_set, fuel, *p = struct.unpack_from("<i5f", b, OFF_MFD)
        cur, nxt = struct.unpack_from("<2i", b, OFF_SETS)
        return {"status": STATUS[status] if 0 <= status < 4 else "off", "fuel": round(fuel, 1), "tyre_set": tyre_set, "waiting_lift": self.waiting,
                "pressures": [round(x, 1) for x in p], "current_set": cur, "strategy_set": nxt,
                "in_pit_lane": bool(struct.unpack_from("<i", b, OFF_PITLANE)[0])}


def vjoy_device(dev):
    """vJoy's interface with device `dev` acquired for this program. Raises OSError with what to fix."""
    try:
        vj = ctypes.WinDLL(AccMfd.VJOY_DLL)
    except OSError:
        raise OSError(f"vJoy is not installed ({AccMfd.VJOY_DLL} not found)")
    status = vj.GetVJDStatus(dev)   # 0 owned by us, 1 free, 2 taken by another program, 3 missing
    if not vj.vJoyEnabled() or status in (2, 3) or vj.GetVJDButtonNumber(dev) < max(AccMfd.VJOY_BUTTONS.values()):
        raise OSError(f"vJoy device {dev} is not usable: it must exist, have at least 6 buttons and not be used by another program "
                      "(Configure vJoy, device 1, 8 buttons)")
    if status == 1 and not vj.AcquireVJD(dev):
        raise OSError(f"could not take vJoy device {dev}")
    vj.ResetVJD(dev)
    return vj


def vjoy_press(vj, dev, button, hold):
    if not vj.SetBtn(1, dev, button):
        raise OSError(f"vJoy device {dev} has no button {button}: give it at least 6 buttons in Configure vJoy")
    time.sleep(hold)
    vj.SetBtn(0, dev, button)
    time.sleep(hold)


def bind_vjoy(dev=1):
    """Help bind ACC's MFD actions to the vJoy buttons: each one is pressed every second for 10 s, announced by beeps."""
    import winsound
    vj = vjoy_device(dev)
    actions = [("pit", "MFD pitstop page"), ("up", "MFD up"), ("down", "MFD down"), ("left", "MFD left"), ("right", "MFD right"),
               ("close", "Cycle MFD (closes the pit page)")]
    print("In ACC open Options > Controls and find the MFD actions. Starting in 10 s.")
    print("For each action below: when you hear its beeps, click that action's binding in ACC; the button presses itself.")
    for i, (key, name) in enumerate(actions, 1):
        print(f"  {i} beep{'s' if i > 1 else ''}: {name} = vJoy button {AccMfd.VJOY_BUTTONS[key]}")
    time.sleep(10)
    for i, (key, name) in enumerate(actions, 1):
        print(f"now: {name} (vJoy button {AccMfd.VJOY_BUTTONS[key]}) - click it in ACC")
        for _ in range(i):
            winsound.Beep(880, 150)
            time.sleep(0.1)
        for _ in range(10):
            vjoy_press(vj, dev, AccMfd.VJOY_BUTTONS[key], 0.15)
            time.sleep(0.7)
    vj.RelinquishVJD(dev)
    print("Done. Check in ACC that the six MFD actions show vJoy buttons 1 to 6.")


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

    pos = [None]   # the row the cursor is on, counted from the top; None after the rows above it may have changed

    def at(row, key=None, n=1):   # cursor to row (negative: from the bottom), then key n times
        if row < 0 or pos[0] is None:   # from the top: the pitstop key twice puts the cursor on the first row
            mfd.press("pit", 2)
            mfd.press("down" if row >= 0 else "up", abs(row))
        else:                           # from where it is: one row at a time, no trip back to the top
            mfd.press("down" if row > pos[0] else "up", abs(row - pos[0]))
        pos[0] = row if row >= 0 else None   # counting from the bottom says nothing about the row from the top
        if key:
            mfd.press(key, n)

    def changed(row, key):   # a step that shows or hides rows: where everything is must be found again from the top
        at(row, key)
        pos[0] = None

    def probe(row):   # what one step right on this row changes; the step is undone with one step left
        # ponytail: one way only. A row that is already at its right-hand limit (pads on 4) is moved one step left; trying the
        # other way as well moved rows at their left-hand limit instead (pads on 1, the usual), so this is the lesser risk.
        a = mfd.read()
        at(row, "right")
        d = _diff(a, mfd.read())
        mfd.press("left")
        return d

    def steer(row, get, target, step):
        for _ in range(4):
            n = round((target - get(mfd.read())) / step)
            if n == 0:
                return "ok"
            at(row, "right" if n > 0 else "left", abs(n))
        v = get(mfd.read())
        return "ok" if round((target - v) / step) == 0 else f"stopped at {v}"

    only = set(plan["only"])
    tyre_rows = bool(only & {"tyres", "pressures", "brakes"})   # brakes are found by counting past the tyre rows

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

    if only - {"repairs"}:
        # Refuel is row 2 under a Strategy row, else row 1. Row 2 is probed, never row 1: stepping the Strategy row reloads that
        # strategy's fuel, tyres and pressures. Without a Strategy row, row 2 is Change tyres, which the probe switches and back.
        d = probe(2)
        refuel = 2 if abs(abs(d["fuel"]) - 1) < 0.05 and not d["set"] and not d["p"] else 1
        tyres = refuel + 1                                # the Change tyres row

    if "fuel" in only:
        res["fuel"] = steer(refuel, lambda m: m["fuel"], plan["fuel"], 1)

    if tyre_rows:
        tyres_were_on = bool(probe(tyres + 3)["p"])       # All four (dry) or FL (wet) only exists while tyres change
        if not tyres_were_on:                             # the tyre rows have to show to set them, or to count past them
            changed(tyres, "right")
            if not probe(tyres + 3)["p"]:
                raise RuntimeError("could not find the tyre rows on the pit page - is it the pitstop MFD page this key opens?")
        wet = wet_now()
        if "tyres" in only and (plan["compound"] == "wet") != wet:
            changed(tyres + (1 if wet else 2), "right" if plan["compound"] == "wet" else "left")   # Right is wet, Left is dry, whatever it was
            wet = wet_now()
        if "tyres" in only:
            res["compound"] = "ok" if (plan["compound"] == "wet") == wet else "did not change"
            res["tyre_set"] = "skipped" if wet else steer(tyres + 1, lambda m: m["tyre_set"], plan["tyre_set"], 1)
        if only & {"tyres", "pressures"}:
            first = tyres + (3 if wet else 4)
            for i, c in enumerate(CORNERS):
                res[c] = steer(first + i, lambda m, i=i: m["pressures"][i], plan["pressures"][i], 0.1)

        if "brakes" in only:
            brakes_on = tail_now() >= 5
            brakes = tyres + (6 if wet else 7) + 1        # the Change brakes row, tyre rows showing
            if plan["brakes"] != brakes_on:
                changed(brakes, "right")
                brakes_on = tail_now() >= 5
            res["brakes"] = "ok" if brakes_on == plan["brakes"] else "did not change"
            if plan["brakes"] and brakes_on:
                for row, k in ((brakes + 1, "front_pad"), (brakes + 2, "rear_pad")):
                    at(row, "left", 3)                    # down to compound 1, then up to the one asked for
                    mfd.press("right", plan[k] - 1)
                    res[k] = "sent"

    if "repairs" in only:
        for row, k in ((-2, "flip_suspension"), (-1, "flip_bodywork")):
            if plan[k]:
                at(row, "right")
                res[k] = "sent"

    if tyre_rows:
        # Tyres sent: as planned. Pressures alone: tyres stay on, since pressures only matter with new tyres. Otherwise as found.
        want_on = plan["tyres"] if "tyres" in only else True if "pressures" in only else tyres_were_on
        if not want_on:
            changed(tyres, "right")   # not probed after: with the tyre rows gone, the row it would step on can be a pad
        res["tyres"] = "switched on for the pressures" if "pressures" in only and "tyres" not in only and not tyres_were_on else "sent"
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
            if key == "close":   # leaves the pit page; where the cursor is does not matter until the page is opened again
                continue
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
                "current_set": 3, "strategy_set": 2, "in_pit_lane": False}   # set 3 on the car, as in FakePages


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
    for layout in itertools.product([False, True], repeat=5):
        for only in (["fuel"], ["repairs"], ["pressures"], ["brakes"], ["fuel", "pressures"]):
            m = FakeMfd(*layout)
            before = (m.fuel, list(m.p), m.set, dict(m.s), list(m.pads), list(m.repair))
            plan = clean(dict(plans[0], only=only))
            res = apply(plan, m)
            if "fuel" in only:
                assert m.fuel == plan["fuel"] and res["fuel"] == "ok", (layout, only, res)
            else:
                assert m.fuel == before[0] and m.strat == 0, (layout, only, m.fuel)   # the Strategy row is never stepped
            if "pressures" in only:
                assert m.p == plan["pressures"] and m.s["tyres"], (layout, only, m.p, m.s)
            else:
                assert m.p == before[1], (layout, only, m.p)
            if "brakes" in only:
                assert m.s["brakes"] and m.pads == [plan["front_pad"], plan["rear_pad"]] and m.s["tyres"] == before[3]["tyres"], (layout, only, m.s)
            else:
                assert m.s["brakes"] == before[3]["brakes"], (layout, only)
            if "repairs" in only:
                assert m.repair == [not before[5][0], before[5][1]] and m.presses <= 8, (layout, only, m.repair, m.presses)
            else:
                assert m.repair == before[5], (layout, only)
            assert m.s["wet"] == before[3]["wet"], (layout, only)
            n += 1
    for bad in [{}, dict(plans[0], only=["everything"]), dict(plans[0], only=[]), dict(plans[0], fuel=-1), dict(plans[0], pressures=[27] * 3), dict(plans[0], compound="slick"), dict(plans[0], front_pad=True)]:
        try:
            clean(bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")
    assert clean({"only": ["fuel"], "fuel": 30})["fuel"] == 30   # a fuel-only plan needs no tyre fields
    print(f"ok: {n} plans applied across every pit page layout; bad plans refused")


if __name__ == "__main__":
    if len(sys.argv) == 1:
        selftest()
    elif sys.argv[1] == "--bind-vjoy":
        bind_vjoy(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
    else:
        print(__doc__)
