#!/usr/bin/env python3
"""ACC's broadcasting API for Pit Wall: timing for the whole field, read on the driver's PC.

ACC sends positions, lap and sector times, pit-lane state and the entry list of every car over
UDP to a client that registers on the port set in
Documents\\Assetto Corsa Competizione\\Config\\broadcasting.json (updListenerPort; 0 = off).
Protocol version 4, little-endian, laid out as in Kunos' ksBroadcastingNetwork SDK.

This client only listens. It registers, asks for the entry list and the track data, and sends
nothing else: no focus, camera, HUD or replay request, which would move the driver's view
mid-race. It talks to 127.0.0.1 only; the broadcasting port is never reachable over the VPN.

    python server/acc_broadcast.py                  # self-test
    python server/acc_broadcast.py --enable [PORT]  # switch the port on in broadcasting.json, then restart ACC

Standard library only. `Field` turns the messages into standings (gaps, intervals, relative,
pits, lap history); `FakeField` is a pretend 20-car field for bridge.py --simulate-acc.
"""
import bisect
import collections
import ipaddress
import json
import math
import os
import random
import re
import secrets
import shutil
import socket
import struct
import sys
import time
import unicodedata

from acc_telemetry import fmt_lap

MAXI = 2147483647                      # Int32.MaxValue: "no time" in every lap and split
LOCS = ["none", "track", "pit", "entry", "exit"]
PIT_LOCS = (2, 3, 4)
CUPS = ["Pro", "Pro-Am", "Am", "Silver", "National"]
PHASES = ["none", "starting", "pre-formation", "formation", "pre-session", "green", "over", "post", "results"]
RACE = 10                              # broadcasting RaceSessionType.Race (shared memory says 2; only this file and acc_telemetry convert)
# ACC car model ids (byte in ENTRY_LIST_CAR) -> name, class. Unknown ids show as "Unknown", "?".
MODELS = {
    0: ("Porsche 991 GT3 R", "GT3"), 1: ("Mercedes-AMG GT3", "GT3"), 2: ("Ferrari 488 GT3", "GT3"), 3: ("Audi R8 LMS", "GT3"),
    4: ("Lamborghini Huracan GT3", "GT3"), 5: ("McLaren 650S GT3", "GT3"), 6: ("Nissan GT-R Nismo GT3 2018", "GT3"),
    7: ("BMW M6 GT3", "GT3"), 8: ("Bentley Continental GT3 2018", "GT3"), 9: ("Porsche 991 II GT3 Cup", "GTC"),
    10: ("Nissan GT-R Nismo GT3 2015", "GT3"), 11: ("Bentley Continental GT3 2015", "GT3"), 12: ("AMR V12 Vantage GT3", "GT3"),
    13: ("Reiter Engineering R-EX GT3", "GT3"), 14: ("Emil Frey Jaguar G3", "GT3"), 15: ("Lexus RC F GT3", "GT3"),
    16: ("Lamborghini Huracan GT3 Evo", "GT3"), 17: ("Honda NSX GT3", "GT3"), 18: ("Lamborghini Huracan ST", "GTC"),
    19: ("Audi R8 LMS Evo", "GT3"), 20: ("AMR V8 Vantage GT3", "GT3"), 21: ("Honda NSX GT3 Evo", "GT3"),
    22: ("McLaren 720S GT3", "GT3"), 23: ("Porsche 911 II GT3 R", "GT3"), 24: ("Ferrari 488 GT3 Evo", "GT3"),
    25: ("Mercedes-AMG GT3 2020", "GT3"), 26: ("Ferrari 488 Challenge Evo", "GTC"), 27: ("BMW M2 CS Racing", "TCX"),
    28: ("Porsche 992 GT3 Cup", "GTC"), 29: ("Lamborghini Huracan ST Evo2", "GTC"), 30: ("BMW M4 GT3", "GT3"),
    31: ("Audi R8 LMS GT3 Evo II", "GT3"), 32: ("Ferrari 296 GT3", "GT3"), 33: ("Lamborghini Huracan GT3 Evo2", "GT3"),
    34: ("Porsche 992 GT3 R", "GT3"), 35: ("McLaren 720S GT3 Evo", "GT3"), 36: ("Ford Mustang GT3", "GT3"),
    50: ("Alpine A110 GT4", "GT4"), 51: ("AMR V8 Vantage GT4", "GT4"), 52: ("Audi R8 LMS GT4", "GT4"), 53: ("BMW M4 GT4", "GT4"),
    55: ("Chevrolet Camaro GT4", "GT4"), 56: ("Ginetta G55 GT4", "GT4"), 57: ("KTM X-Bow GT4", "GT4"), 58: ("Maserati MC GT4", "GT4"),
    59: ("McLaren 570S GT4", "GT4"), 60: ("Mercedes-AMG GT4", "GT4"), 61: ("Porsche 718 Cayman GT4", "GT4"),
    80: ("Audi R8 LMS GT2", "GT2"), 82: ("KTM X-Bow GT2", "GT2"), 83: ("Maserati MC20 GT2", "GT2"),
    84: ("Mercedes-AMG GT2", "GT2"), 85: ("Porsche 911 GT2 RS CS Evo", "GT2"), 86: ("Porsche 935", "GT2"),
}


# ---------- the wire ----------
class _Reader:
    """Bounds-checked reads: a short or lying datagram raises ValueError, never reads past the end."""

    def __init__(self, b):
        self.b, self.o = b, 0

    def take(self, fmt):
        n = struct.calcsize(fmt)
        if self.o + n > len(self.b):
            raise ValueError("truncated packet")
        v = struct.unpack_from(fmt, self.b, self.o)
        self.o += n
        return v[0] if len(v) == 1 else v

    def text(self, limit=None):
        n = self.take("<H")
        if self.o + n > len(self.b):
            raise ValueError("truncated string")
        t = self.b[self.o:self.o + n].decode("utf-8", "replace")
        self.o += n
        t = "".join(c for c in t if unicodedata.category(c)[0] != "C")   # no control or format characters from the network
        return t[:limit] if limit else t

    def lap(self):
        ms, car, drv, n = self.take("<iHHB")
        splits = [self.take("<i") for _ in range(n)]
        bad, _best_ok, out, inl = self.take("<4B")
        splits = [None if s == MAXI else s for s in splits] + [None] * (3 - n)
        return {"ms": None if ms == MAXI else ms, "car": car, "drv": drv, "s": splits, "valid": not bad, "out": bool(out), "in": bool(inl)}


def parse(datagram):
    """One datagram from ACC -> (message type, dict). Pure; raises ValueError on a truncated or empty packet."""
    r = _Reader(bytes(datagram))
    kind = r.take("<B")
    if kind == 1:     # REGISTRATION_RESULT
        conn, ok, writable = r.take("<iBB")
        return kind, {"conn": conn, "success": ok > 0, "readonly": writable == 0, "msg": r.text(200)}
    if kind == 2:     # REALTIME_UPDATE
        ev, sidx, stype, phase, t, end, focus = r.take("<HHBBffi")
        r.text(), r.text(), r.text()           # camera set, camera, HUD page
        replay = r.take("<B") > 0
        if replay:
            r.take("<ff")
        tod, air, track, clouds, rain, wet = r.take("<fBBBBB")
        return kind, {"event_idx": ev, "session_idx": sidx, "type": stype, "phase": phase, "time_ms": t, "end_ms": end,
                      "focus": focus, "replay": replay, "tod_ms": tod, "air": air, "track": track,
                      "clouds": clouds / 10, "rain": rain / 10, "wet": wet / 10, "best": r.lap()}
    if kind == 3:     # REALTIME_CAR_UPDATE
        i, drv, ndrv, gear, x, y, yaw, loc, kmh, pos, cpos, tpos, spl, laps, delta = r.take("<HHBBfffBHHHHfHi")
        return kind, {"i": i, "drv": drv, "drivers": ndrv, "gear": gear - 2, "x": x, "y": y, "yaw": yaw, "loc": loc,
                      "kmh": kmh, "pos": pos, "cpos": cpos, "tpos": tpos, "spl": spl, "laps": laps, "delta": delta,
                      "best": r.lap(), "last": r.lap(), "cur": r.lap()}
    if kind == 4:     # ENTRY_LIST: the car indexes; each car's details follow as type 6
        conn, n = r.take("<iH")
        return kind, {"conn": conn, "cars": [r.take("<H") for _ in range(n)]}
    if kind == 5:     # TRACK_DATA
        conn = r.take("<i")
        name = r.text(64)
        tid, meters = r.take("<ii")
        for _ in range(r.take("<B")):          # camera sets, then HUD pages: read only to check the packet is whole
            r.text()
            for _ in range(r.take("<B")):
                r.text()
        for _ in range(r.take("<B")):
            r.text()
        return kind, {"conn": conn, "name": name, "id": tid, "meters": meters}
    if kind == 6:     # ENTRY_LIST_CAR
        i, model = r.take("<HB")
        team = r.text(48)
        num, cup, cur, nat, n = r.take("<iBBHB")
        drivers = []
        for _ in range(n):
            first, last, short = r.text(32), r.text(32), r.text(8)
            dcat, dnat = r.take("<BH")
            drivers.append({"first": first, "last": last, "short": short, "dcat": dcat, "nat": dnat})
        return kind, {"i": i, "model": model, "team": team, "num": num, "cup": cup, "cur_drv": cur, "nat": nat, "drivers": drivers}
    if kind == 7:     # BROADCASTING_EVENT
        etype = r.take("<B")
        msg = r.text(200)
        t, car = r.take("<ii")
        return kind, {"type": etype, "msg": msg, "time_ms": t, "car": car}
    return kind, {}


def _str(s):
    b = s.encode("utf-8")
    return struct.pack("<H", len(b)) + b


def pack_register(name, password, interval_ms, command_password=""):
    """REGISTER_COMMAND_APPLICATION, protocol version 4."""
    return struct.pack("<BB", 1, 4) + _str(name) + _str(password) + struct.pack("<i", interval_ms) + _str(command_password)


def pack_request(kind, conn_id):
    """Unregister, request entry list, request track data. Nothing else is ever sent: anything else moves the driver's view."""
    if kind not in (9, 10, 11):
        raise ValueError("only unregister, entry list and track data requests are sent")
    return struct.pack("<Bi", kind, conn_id)


# ---------- broadcasting.json ----------
def _cfg_path(path):
    return path or os.path.join(os.path.expanduser("~"), "Documents", "Assetto Corsa Competizione", "Config", "broadcasting.json")


def _decode(b):
    if b.startswith(b"\xff\xfe"):
        return b[2:].decode("utf-16-le"), "bom"
    if b[1:2] == b"\x00":
        return b.decode("utf-16-le"), "utf-16-le"
    return b.decode("utf-8-sig"), "utf-8"


def read_config(path=None):
    """ACC's broadcasting.json -> {"port", "password", "command_password", "path"}. Raises OSError / ValueError."""
    path = _cfg_path(path)
    with open(path, "rb") as f:
        j = json.loads(_decode(f.read())[0])
    return {"port": int(j.get("updListenerPort") or 0), "password": str(j.get("connectionPassword") or ""),
            "command_password": str(j.get("commandPassword") or ""), "path": path}


def enable(port=9000, path=None):
    """Switch ACC's broadcasting port on, keeping the file's encoding (ACC writes UTF-16LE without a BOM). Backs it up first."""
    path = _cfg_path(path)
    with open(path, "rb") as f:
        raw = f.read()
    text, enc = _decode(raw)
    j = json.loads(text)
    j["updListenerPort"] = int(port)
    if not j.get("connectionPassword"):
        j["connectionPassword"] = secrets.token_hex(6)
    shutil.copyfile(path, path + ".bak")
    out = json.dumps(j, indent=4)
    data = b"\xff\xfe" + out.encode("utf-16-le") if enc == "bom" else out.encode(enc)
    with open(path, "wb") as f:
        f.write(data)
    return f"Broadcasting on port {port} in {path} (backup: broadcasting.json.bak). Restart ACC for this to take effect."


# ---------- the client ----------
class Client:
    """Registers with ACC on 127.0.0.1 and hands every message to sink(kind, data). One thread; owns the socket."""

    def __init__(self, port, password, interval_ms=250, host="127.0.0.1", name="Pit Wall", command_password=""):
        if not ipaddress.ip_address(host).is_loopback:
            raise ValueError("the broadcasting port is only ever used on this PC")
        self.port, self.password, self.interval, self.host, self.name, self.cmd = port, password, interval_ms, host, name, command_password
        self.state = {"state": "off", "msg": "", "port": port}
        self.sock, self.conn, self.known, self.asked, self.sidx = None, None, {}, 0.0, None

    def _send(self, b):
        try:
            self.sock.send(b)
        except OSError:   # ACC not listening: the next recv says so
            pass

    def _ask_entries(self, now):
        if self.conn is not None and now - self.asked > 1.0:
            self.asked = now
            self._send(pack_request(10, self.conn))

    def run(self, sink):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(1.0)
        self.sock.connect((self.host, self.port))
        heard = reg = -1e9
        self.state.update(state="waiting", msg=f"Waiting for ACC on port {self.port}")
        while True:
            now = time.monotonic()
            if now - heard > 5 and now - reg > 5:   # nothing for 5 s: register (again)
                if self.state["state"] == "live":
                    self.state.update(state="waiting", msg=f"ACC stopped sending on port {self.port}")
                self.conn, reg = None, now
                self._send(pack_register(self.name, self.password, self.interval, self.cmd))
            try:
                data = self.sock.recv(65535)
            except socket.timeout:
                continue
            except OSError:   # WSAECONNRESET: ICMP port unreachable, ACC is not listening
                self.state.update(state="waiting", msg=f"ACC is not answering on port {self.port}")
                time.sleep(5)
                continue
            try:
                kind, d = parse(data)
            except ValueError:
                continue
            heard = now = time.monotonic()
            if kind == 1:
                if not d["success"]:
                    self.state.update(state="error", msg=d["msg"] or "ACC refused the connection: check connectionPassword")
                    continue
                self.conn = d["conn"]
                self.state.update(state="live", msg=f"ACC broadcasting on port {self.port}" + (" (read-only)" if d["readonly"] else ""))
                self.asked = now
                self._send(pack_request(10, self.conn))
                self._send(pack_request(11, self.conn))
            elif kind == 2:
                if self.sidx is not None and d["session_idx"] != self.sidx:
                    self._ask_entries(now)
                self.sidx = d["session_idx"]
            elif kind == 3:
                if self.known.get(d["i"], -1) != d["drivers"]:   # unknown car or a driver count that disagrees: entry list again
                    self._ask_entries(now)
            elif kind == 4:
                self.known = {i: -1 for i in d["cars"]}
            elif kind == 6:
                self.known[d["i"]] = len(d["drivers"])
            sink(kind, d)

    def close(self):
        if self.sock and self.conn is not None:
            self._send(pack_request(9, self.conn))


# ---------- standings ----------
def _t_at(pts, dists, d):
    """When a car was at distance d (laps + spline), interpolated between its marks; None outside them."""
    if len(pts) < 2 or not dists[0] <= d <= dists[-1]:
        return None
    k = bisect.bisect_left(dists, d)
    if k == 0:
        return pts[0][1]
    (d0, t0), (d1, t1) = pts[k - 1], pts[k]
    return t0 + (t1 - t0) * (d - d0) / (d1 - d0) if d1 > d0 else t1


def _wrap(x):
    return ((x + 1.5) % 1) - 0.5


class Field:
    """ACC broadcasting messages in (on), standings out (snapshot). Not thread-safe: bridge.py calls it under its LOCK.
    Times are ACC's session time (ms) from the latest REALTIME_UPDATE, which every car update in that batch shares."""

    def __init__(self):
        self.cars, self.ent, self.track, self.rt = {}, {}, None, None
        self.t, self.sidx, self.phase, self.me = 0.0, None, None, None
        self.slow_seq, self.events = 0, []
        self.xz_s, self.xz_map, self.xz_done = [], None, False

    # --- input ---
    def on(self, kind, d):
        if kind == 2:
            if self.sidx is not None and d["session_idx"] != self.sidx:   # new session: pits, marks and laps start over
                self.cars = {}
            if self.phase is not None and d["phase"] != self.phase and 0 <= d["phase"] < len(PHASES):
                self.events.append((0, "RC", f"Session phase: {PHASES[d['phase']]}"))
            self.sidx, self.phase, self.rt, self.t = d["session_idx"], d["phase"], d, d["time_ms"]
        elif kind == 3:
            self._car(d)
        elif kind == 4:
            keep = set(d["cars"])
            self.ent = {i: e for i, e in self.ent.items() if i in keep}
            self.cars = {i: c for i, c in self.cars.items() if i in keep}
        elif kind == 5:
            self.track = {"name": d["name"], "id": d["id"], "length_m": d["meters"] if d["meters"] > 0 else None}
        elif kind == 6:
            name, cls = MODELS.get(d["model"], ("Unknown", "?"))
            self.ent[d["i"]] = {"num": d["num"], "team": d["team"], "model": d["model"], "model_name": name, "class": cls,
                                "cup": d["cup"], "cup_name": CUPS[d["cup"]] if d["cup"] < len(CUPS) else "?", "nat": d["nat"],
                                "drivers": [{k: v[k] for k in ("first", "last", "short", "dcat")} for v in d["drivers"]]}
        elif kind == 7:
            num = self._num(d["car"])
            if d["type"] == 3:
                self.events.append((1, "RC", f"Race control: {d['msg']}"))
            elif d["type"] == 4:
                self.events.append((1, "RC", f"Accident: #{num}"))
            elif d["type"] == 6:
                c = self.cars.get(d["car"])
                ms = c and c["best"]
                self.events.append((0, "RC", f"Session best {fmt_lap(ms)} #{num}" if ms else f"Session best #{num}"))

    def _num(self, i):
        return self.ent.get(i, {}).get("num", i)

    def _bump(self, c):
        self.slow_seq += 1
        c["seq"] = self.slow_seq

    def _car(self, d):
        i, t = d["i"], self.t
        c = self.cars.get(i)
        if c is None:
            c = self.cars[i] = {"marks": collections.deque(maxlen=300), "hist": collections.deque(maxlen=100), "pits": 0,
                                "last_pit_lap": None, "pit_t": None, "lane_ms": None, "exit_laps": None, "int_hist": [], "gap_hist": [],
                                "gap": None, "gap_laps": 0, "int": None, "int_laps": 0, "loc": None, "laps": None, "drv": None, "seq": 0,
                                "last": None, "dist": None}
        dist = d["laps"] + d["spl"]
        if c["dist"] is not None and abs(dist - c["dist"]) > 0.5:   # laps and spline wrap in different packets: take the nearer reading
            dist = min((dist - 1, dist + 1), key=lambda x: abs(x - c["dist"]))
            if abs(dist - c["dist"]) > 0.5:                         # back to the pits / teleported: the old marks mean nothing now
                c["marks"].clear()
                dist = d["laps"] + d["spl"]
        m = c["marks"]
        if not m or (dist > m[-1][0] and math.floor(dist * 100) > math.floor(m[-1][0] * 100)):
            m.append((dist, t))
        slow = c["drv"] is not None and d["drv"] != c["drv"]
        loc, prev = d["loc"], c["loc"]
        if prev is not None and prev not in PIT_LOCS and loc in PIT_LOCS:
            c["pits"], c["last_pit_lap"], c["pit_t"], slow = c["pits"] + 1, d["laps"], t, True
            if i != self.me:
                self.events.append((0, "FIELD", f"#{self._num(i)} in the pits, L{d['laps'] + 1}"))
        elif prev in PIT_LOCS and loc == 1:
            c["exit_laps"], slow = d["laps"], True
            if c["pit_t"] is not None:
                c["lane_ms"] = int(t - c["pit_t"])
                if i != self.me:
                    self.events.append((0, "FIELD", f"#{self._num(i)} out, lane {c['lane_ms'] / 1000:.1f} s"))
        elif prev is not None and loc != prev:
            slow = True
        last = d["last"]
        if c["laps"] is not None and d["laps"] > c["laps"]:
            c["hist"].append({"n": d["laps"], "ms": last["ms"], "s": last["s"][:3], "valid": last["valid"], "out": last["out"],
                              "in": last["in"], "gap": c["gap"], "pos": d["pos"]})
            c["int_hist"], c["gap_hist"] = (c["int_hist"] + [c["int"]])[-5:], (c["gap_hist"] + [c["gap"]])[-5:]
            slow = True
        elif c["hist"] and c["last"] is not None and last["ms"] != c["last"]["ms"] and c["hist"][-1]["n"] == d["laps"]:
            c["hist"][-1].update(ms=last["ms"], s=last["s"][:3], valid=last["valid"])   # the last lap arrived a packet after the line
            slow = True
        c.update(pos=d["pos"], cpos=d["cpos"], laps=d["laps"], spl=d["spl"], kmh=d["kmh"], gear=d["gear"], loc=loc,
                 cur=d["cur"]["ms"], delta=d["delta"], drv=d["drv"], x=d["x"], y=d["y"], dist=dist, last=last, best_lap=d["best"],
                 best=d["best"]["ms"], out=d["cur"]["out"], inl=d["cur"]["in"])
        if slow or not c["seq"]:
            self._bump(c)

    # --- derived ---
    def mode(self):
        return "race" if self.rt and self.rt["type"] == RACE else "best"

    def _resolve_me(self, hint):
        if not hint:
            return
        c = self.cars.get(hint.get("id"))
        if c and abs(c["laps"] - hint["laps"]) <= 1 and abs(_wrap(c["spl"] - hint["spl"])) < 0.02:
            self.me = hint["id"]
            return
        name = (hint.get("name") or "").strip().lower()
        for i, e in self.ent.items():
            if name and any(f"{d['first']} {d['last']}".strip().lower() == name for d in e["drivers"]):
                self.me = i
                return
        self.me = None

    def _xz_check(self, hint):
        """Broadcast WorldPosX/Y only count once they match shared memory's x, z under one of four axis mappings."""
        c = self.cars.get(self.me)
        if self.xz_done or not hint or not c or (hint.get("kmh") or 0) < 5:
            return
        self.xz_s.append((c["x"], c["y"], hint["xyz"][0], hint["xyz"][2]))
        if len(self.xz_s) < 30:
            return
        self.xz_done = True
        if all(abs(x) < 1e-6 and abs(y) < 1e-6 for x, y, _, _ in self.xz_s):   # zeros, as the Go SDK saw: no positions
            return
        # ponytail: the two sources are up to 250 ms apart, so at speed the error grows; a fallback only, the spline path comes first
        maps = [lambda x, y: (x, y), lambda x, y: (x, -y), lambda x, y: (-x, y), lambda x, y: (y, x)]
        err = [sum(math.hypot(f(x, y)[0] - sx, f(x, y)[1] - sz) for x, y, sx, sz in self.xz_s) / len(self.xz_s) for f in maps]
        k = min(range(4), key=err.__getitem__)
        if err[k] < 5:
            self.xz_map = maps[k]

    def _pts(self, c):
        pts = list(c["marks"])
        if c["dist"] is not None and (not pts or c["dist"] > pts[-1][0]):
            pts.append((c["dist"], self.t))
        return pts, [p[0] for p in pts]

    def _gap(self, a, b):
        """Race gap of b behind a, ms, plus whole laps when a is a lap or more ahead."""
        diff = a["dist"] - b["dist"]
        if diff < 0:
            return None, 0
        n = math.floor(diff) if diff >= 1 else 0
        ta = _t_at(*a["_pts"], b["dist"] + n)
        return (None if ta is None else max(0, int(round(self.t - ta)))), n

    def _pace(self, c):
        ok = [h["ms"] for h in c["hist"] if h["ms"] and h["valid"] and not h["out"] and not h["in"]][-3:]
        return sum(ok) / len(ok) if ok else None

    def _order(self):
        return sorted(self.cars.items(), key=lambda kv: (kv[1]["pos"] or 999, kv[0]))

    def _compute(self):
        for c in self.cars.values():
            c["_pts"] = self._pts(c)
        order = self._order()
        race = self.mode() == "race"
        p1 = order[0][1] if order else None
        for k, (i, c) in enumerate(order):
            if k == 0:
                c["gap"], c["gap_laps"], c["int"], c["int_laps"] = 0 if race or c["best"] else None, 0, None, 0
            elif race:
                prev = order[k - 1][1]
                c["gap"], c["gap_laps"] = self._gap(p1, c)
                # the interval from the two gaps to P1 when both are in the same lap, so Gap and Int always agree (the
                # car-to-car time is off while the car ahead crawls down the pit lane); car to car otherwise
                if c["gap"] is not None and prev["gap"] is not None and c["gap_laps"] == prev["gap_laps"]:
                    c["int"], c["int_laps"] = max(0, c["gap"] - prev["gap"]), 0
                else:
                    c["int"], c["int_laps"] = self._gap(prev, c)
            else:
                ahead = order[k - 1][1]
                c["gap"] = c["best"] - p1["best"] if c["best"] and p1["best"] else None
                c["int"] = c["best"] - ahead["best"] if c["best"] and ahead["best"] else None
                c["gap_laps"] = c["int_laps"] = 0
        me = self.cars.get(self.me)
        for i, c in self.cars.items():
            c["rel"] = None
            if me is None or c is me:
                c["rel"] = 0 if c is me else None
                continue
            f = _wrap(c["spl"] - me["spl"])
            if f >= 0:     # ahead on track: how long ago it passed where I am
                tc = _t_at(*c["_pts"], c["dist"] - f)
                c["rel"] = None if tc is None else int(round(self.t - tc))
            else:          # behind: how long ago I passed where it is
                tm = _t_at(*me["_pts"], me["dist"] + f)
                c["rel"] = None if tm is None else -int(round(self.t - tm))
        return order

    def snapshot(self, me_hint, mandatory, loss_ms):
        """The `field` payload (fast part). me_hint: {"id", "laps", "spl", "name", "xyz", "kmh"} from shared memory, or None.
        mandatory: stops every car owes in this race, or None; loss_ms: what a stop costs, for the net position."""
        self._resolve_me(me_hint)
        self._xz_check(me_hint)
        order = self._compute()
        race = self.mode() == "race"
        ref = (self.race_info() or {}).get("leader_pace_ms")
        net = {}
        if race and mandatory is not None and loss_ms is not None and ref:
            tot = {i: c["gap"] + c["gap_laps"] * ref + max(0, mandatory - c["pits"]) * loss_ms for i, c in order if c["gap"] is not None}
            if len(tot) == len(order):
                net = {i: k + 1 for k, i in enumerate(sorted(tot, key=lambda i: (tot[i], i)))}
        rt = self.rt or {}
        best = rt.get("best") or {}
        return {
            "t": self.t, "type": rt.get("type"), "phase": rt.get("phase"), "idx": self.sidx, "mode": self.mode(), "me": self.me,
            "best": {"ms": best["ms"], "car": best["car"]} if best.get("ms") else None,
            "weather": {k: rt[k] for k in ("air", "track", "clouds", "rain", "wet")} if rt else None,
            "track_m": (self.track or {}).get("length_m"), "xz_ok": self.xz_map is not None,
            "cars": [{"i": i, "pos": c["pos"], "cpos": c["cpos"], "laps": c["laps"], "spl": c["spl"], "kmh": c["kmh"], "gear": c["gear"],
                      "loc": LOCS[c["loc"]] if 0 <= c["loc"] < len(LOCS) else "none", "cur": c["cur"], "delta": c["delta"],
                      "gap": c["gap"], "gap_laps": c["gap_laps"], "int": c["int"], "int_laps": c["int_laps"], "rel": c["rel"],
                      "net": net.get(i), "drv": c["drv"], "xz": list(self.xz_map(c["x"], c["y"])) if self.xz_map else None}
                     for i, c in order],
        }

    def _slow(self, c):
        last = c["last"] or {}
        best = c["best_lap"] if c.get("best_lap") else {}
        return {"seq": c["seq"], "last": last.get("ms"), "last_s": (last.get("s") or [None] * 3)[:3], "last_valid": last.get("valid"),
                "best": best.get("ms"), "best_s": (best.get("s") or [None] * 3)[:3], "pits": c["pits"], "last_pit_lap": c["last_pit_lap"],
                "lane_ms": c["lane_ms"], "stint_laps": c["laps"] - (c["exit_laps"] if c["exit_laps"] is not None else 0),
                "out": c["out"], "in": c["inl"], "int_hist": c["int_hist"], "gap_hist": c["gap_hist"]}

    def slow_since(self, seq):
        """Slow per-car fields (lap times, pits, histories) of cars that changed after seq, and the newest seq."""
        return {str(i): self._slow(c) for i, c in self.cars.items() if c["seq"] > seq}, self.slow_seq

    def entries(self):
        return {"track": dict(self.track) if self.track else None,
                "cars": {str(i): dict(e, drivers=[dict(d) for d in e["drivers"]]) for i, e in self.ent.items()}}

    def car_laps(self, idx):
        c = self.cars.get(idx)
        return [dict(h, s=list(h["s"])) for h in c["hist"]] if c else []

    def race_info(self):
        """What acc_telemetry's strategy needs from the field: the leader's distance and pace, and the session mode."""
        order = self._order()
        if not order:
            return None
        p1 = order[0][1]
        return {"leader_dist": p1["dist"], "leader_pace_ms": self._pace(p1), "mode": self.mode(), "elapsed_ms": self.t}

    def rejoin(self, my_idx, loss_ms):
        """Where I come out if I stop now and it costs loss_ms: my gap to the leader plus the loss, ranked against the cars
        not in the pits. {pos, ahead, behind, around}; gap_ms in around is signed (negative: ahead of me). None outside races."""
        me = self.cars.get(my_idx)
        if self.mode() != "race" or me is None or loss_ms is None or me.get("gap") is None:
            return None
        ref = (self.race_info() or {}).get("leader_pace_ms") or 0
        t = {i: c["gap"] + c["gap_laps"] * ref for i, c in self.cars.items()
             if i != my_idx and c.get("gap") is not None and c["loc"] not in PIT_LOCS}
        mine = me["gap"] + me["gap_laps"] * ref + loss_ms
        rows = sorted([(v, i) for i, v in t.items()] + [(mine, my_idx)])
        k = rows.index((mine, my_idx))
        row = lambda j: {"i": rows[j][1], "gap_ms": int(round(abs(rows[j][0] - mine)))} if 0 <= j < len(rows) and j != k else None
        lo = max(0, min(k - 2, len(rows) - 5))
        return {"pos": k + 1, "ahead": row(k - 1), "behind": row(k + 1),
                "around": [{"i": i, "gap_ms": int(round(v - mine))} for v, i in rows[lo:lo + 5]]}


# ---------- a pretend field for --simulate-acc ----------
NAMES = [("Lena", "Varga"), ("Tomas", "Reyes"), ("Aiko", "Mori"), ("Jonas", "Lindqvist"), ("Mara", "Okafor"), ("Pietro", "Sala"),
         ("Ines", "Duarte"), ("Kalle", "Rautio"), ("Noor", "Haddad"), ("Felix", "Brandt"), ("Sofia", "Marek"), ("Ruben", "Castell"),
         ("Yuki", "Tanabe"), ("Oskar", "Wiles"), ("Leila", "Farrow"), ("Matteo", "Ricci"), ("Hana", "Novak"), ("Dario", "Pell"),
         ("Elin", "Strand")]
TEAMS = ["Northline Racing", "Vela Motorsport", "Kestrel GT", "Blue Fen Racing", "Atlas Endurance", "Corsa Nove", "Redwater GT",
         "Ostra Racing", "Halden Motorsport", "Sable Works"]
FAKE_MODELS = [32, 30, 34, 31, 25, 33, 35, 22, 24, 20, 36, 23, 16, 19, 21, 50, 61, 53, 60]   # 15 GT3, then 4 GT4


class FakeField(Field):
    """20 made-up cars round FakePages' circuit, on the same clock, so the map, the laps and the positions agree. Car 7 is
    the player, driven by FakePages; the others lap at 58.8-62.6 s and stop every 18-26 laps for 52 s in the pit lane."""

    LANE_MS, PIT_IN = 52000, 0.97

    def __init__(self, pages, session="race", seed=7):
        super().__init__()
        self.pages, self.quali, self.rnd = pages, session == "quali", random.Random(seed)
        self.state = {"state": "live", "msg": "simulated field", "port": 0}
        self.sim, self.started, self.t_sim, self.me_best = {}, False, None, None
        rnd, names, models = self.rnd, iter(NAMES), iter(FAKE_MODELS)
        for i in range(1, 21):
            if i == 7:
                continue
            every = rnd.randint(18, 26)
            age = every - 1 if i == 2 else rnd.randint(0, 25) % every   # car 2 is on its in-lap: someone pits in the first minutes
            d0 = 3.5 + rnd.uniform(-0.45, 0.45)
            first, last = next(names)
            self.sim[i] = {"base": rnd.uniform(58800, 62600), "every": every, "stint": age, "laps": int(d0), "spl": d0 % 1,
                           "start": None, "dur": None, "pit": None, "out": False, "valid": True, "last": None, "best": None,
                           "model": next(models), "num": [3, 11, 14, 22, 27, 33, 41, 46, 52, 58, 61, 66, 72, 77, 81, 88, 91, 95, 99][i - 1 - (i > 7)],
                           "team": TEAMS[i % len(TEAMS)], "cup": i % 3, "first": first, "last_name": last}

    def _page_t(self):
        p = self.pages
        return (p.clock() - p.t0) * 1000 + 3.5 * p.lap

    def _lapd(self, ms, s=(None, None, None), valid=True, out=False, inl=False, car=0):
        return {"ms": ms, "car": car, "drv": 0, "s": list(s), "valid": valid, "out": out, "in": inl}

    def _new_lap(self, c, t):
        c["start"], c["dur"] = t, c["base"] + self.rnd.uniform(-250, 250)
        c["valid"] = not ((c["laps"] + 1) % 5 == 0 and self.rnd.random() < 0.1)

    def _advance(self, i, c, t, dt):
        if c["start"] is None:
            self._new_lap(c, t - c["spl"] * c["base"])
        if c["pit"] is not None:
            e = t - c["pit"]
            spl = c["spl"] + 0.06 * dt / self.LANE_MS   # 0.97 -> 1.03 of a lap in 52 s: the lane crosses the line
            if e >= self.LANE_MS:
                c["pit"], c["stint"] = None, 0
            loc = 3 if e < 3000 else 4 if e > self.LANE_MS - 3000 else 2
        else:
            spl, loc = c["spl"] + dt / c["dur"], 1
            if not self.quali and c["stint"] >= c["every"] and c["spl"] < self.PIT_IN <= spl:
                c["pit"], spl, loc = t, self.PIT_IN, 3
        if spl >= 1:   # the line
            spl -= 1
            c["laps"] += 1
            ms = int(t - c["start"])
            s1, s2 = int(ms * self.rnd.uniform(0.32, 0.34)), int(ms * self.rnd.uniform(0.33, 0.35))
            c["last"] = self._lapd(ms, (s1, s2, ms - s1 - s2), c["valid"], c["out"], c["pit"] is not None, i)
            if c["valid"] and not c["out"] and (c["best"] is None or ms < c["best"]["ms"]):
                c["best"] = c["last"]
            c["out"] = c["pit"] is not None
            c["stint"] += c["pit"] is None
            self._new_lap(c, t)
        c["spl"], c["loc"] = spl, loc

    def messages(self):
        """One batch as ACC would send it: (entry list and track data once,) a realtime update, then every car."""
        t = self._page_t()
        dt = 0 if self.t_sim is None else t - self.t_sim
        self.t_sim, out = t, []
        raw = self.pages.read()
        me = {"laps": raw["laps"], "spl": raw["track_pos"], "loc": 1, "kmh": int(raw["speed"]), "gear": raw["gear"] - 1,
              "cur": raw["cur_ms"], "valid": bool(raw["valid"]), "out": False}
        if raw["laps"] > 0:
            ms = raw["last_ms"]
            me["last"] = self._lapd(ms, (int(ms * .33), int(ms * .34), ms - int(ms * .33) - int(ms * .34)), (raw["laps"] - 1) % 5 != 2, car=7)
        if not self.started:
            self.started = True
            out.append((5, {"conn": 1, "name": "Demo circuit", "id": 0, "meters": 5000}))
            out.append((4, {"conn": 1, "cars": list(range(1, 21))}))
            for i, c in sorted(self.sim.items()):
                out.append((6, {"i": i, "model": c["model"], "team": c["team"], "num": c["num"], "cup": c["cup"], "cur_drv": 0, "nat": 0,
                                "drivers": [{"first": c["first"], "last": c["last_name"], "short": c["last_name"][:3].upper(), "dcat": 1, "nat": 0}]}))
            out.append((6, {"i": 7, "model": 32, "team": "Pit Wall Demo", "num": 7, "cup": 0, "cur_drv": 0, "nat": 0,
                            "drivers": [{"first": raw["name"], "last": "", "short": raw["name"][:3].upper(), "dcat": 1, "nat": 0}]}))
        for i, c in self.sim.items():
            self._advance(i, c, t, dt)
        if "last" in me and me["last"]["valid"] and (self.me_best is None or me["last"]["ms"] < self.me_best["ms"]):
            self.me_best = me["last"]
        rows = list(self.sim.items()) + [(7, dict(me, best=self.me_best, last=me.get("last")))]
        if self.quali:   # qualifying: best lap first, cars without one after, by distance
            key = lambda r: (r[1]["best"] is None, r[1]["best"]["ms"] if r[1]["best"] else -(r[1]["laps"] + r[1]["spl"]))
        else:
            key = lambda r: -(r[1]["laps"] + r[1]["spl"])
        rows.sort(key=key)
        cup_n = collections.Counter()
        best = min((c["best"] for _, c in rows if c["best"]), key=lambda b: b["ms"], default=None)
        out.append((2, {"event_idx": 0, "session_idx": 0, "type": 4 if self.quali else RACE, "phase": 5, "time_ms": t, "end_ms": t + raw["time_left"],
                        "focus": 7, "replay": False, "tod_ms": (14 * 3600 * 1000 + t), "air": 22, "track": 29, "clouds": 0.2, "rain": 0.0,
                        "wet": 0.0, "best": best or self._lapd(None)}))
        for pos, (i, c) in enumerate(rows, 1):
            cup = 0 if i == 7 else c["cup"]
            cup_n[cup] += 1
            empty = self._lapd(None, car=i)
            out.append((3, {"i": i, "drv": 0, "drivers": 1, "gear": c.get("gear", 4), "x": 0.0, "y": 0.0, "yaw": 0.0, "loc": c["loc"],
                            "kmh": c.get("kmh", 0 if c["loc"] == 2 else 200), "pos": pos, "cpos": cup_n[cup], "tpos": pos, "spl": c["spl"],
                            "laps": c["laps"], "delta": 0, "best": c["best"] or empty, "last": c["last"] or empty,
                            "cur": self._lapd(int(t - c["start"]) if c.get("start") is not None else c.get("cur"), valid=c["valid"], out=c["out"], car=i)}))
        return out

    def on(self, kind, d):
        new = kind == 3 and d["i"] not in self.cars
        super().on(kind, d)
        if new:   # the pretend race was running before the bridge: give each car its last three laps of marks at its pace
            c, pace = self.cars[d["i"]], self.pages.lap if d["i"] == 7 else self.sim[d["i"]]["base"]
            c["marks"].extendleft((c["dist"] - k / 100, self.t - k / 100 * pace) for k in range(1, 300))

    def step(self):
        for kind, d in self.messages():
            self.on(kind, d)

    def run(self, sink):
        while True:
            for kind, d in self.messages():
                sink(kind, d)
            time.sleep(0.25)


# ---------- self-test ----------
def _lap_bytes(ms, n=3, bad=0):
    return struct.pack("<iHHB", ms, 1, 0, n) + struct.pack(f"<{n}i", *([20000, 20000, MAXI][3 - n:])) + struct.pack("<4B", bad, 1, 0, 0)


def selftest():
    import acc_telemetry
    import tempfile
    s = lambda t: _str(t)
    msgs = {
        1: struct.pack("<BiBB", 1, 5, 1, 0) + s("ok"),
        2: struct.pack("<BHHBBffi", 2, 1, 2, 10, 5, 1000.0, 3600000.0, 3) + s("set") + s("cam") + s("hud") + struct.pack("<B", 0)
           + struct.pack("<fBBBBB", 50400000.0, 22, 29, 2, 0, 0) + _lap_bytes(59640),
        3: struct.pack("<BHHBBfffBHHHHfHi", 3, 12, 0, 1, 7, 1.5, -2.5, 0.1, 1, 214, 1, 1, 1, 0.412, 18, -120)
           + _lap_bytes(59640) + _lap_bytes(MAXI, 0) + _lap_bytes(24123, 1, 1),
        4: struct.pack("<BiH3H", 4, 5, 3, 12, 7, 33),
        5: struct.pack("<Bi", 5, 5) + s("spa") + struct.pack("<ii", 7, 7004) + struct.pack("<B", 1) + s("set") + struct.pack("<B", 1) + s("cam")
           + struct.pack("<B", 1) + s("hud"),
        6: struct.pack("<BHB", 6, 12, 32) + s("Team \x07Bell") + struct.pack("<iBBHB", 12, 1, 0, 3, 1) + s("Aiko") + s("Mori") + s("MOR") + struct.pack("<BH", 2, 48),
        7: struct.pack("<BB", 7, 3) + s("Car 33 penalty") + struct.pack("<ii", 120000, 33),
    }
    for kind, b in msgs.items():
        k, d = parse(b)
        assert k == kind, (k, kind)
        for cut in range(1, len(b)):   # every truncation is refused, never read past the end
            try:
                parse(b[:cut])
            except ValueError:
                continue
            raise AssertionError(f"type {kind} cut at {cut} parsed")
    assert parse(msgs[1])[1] == {"conn": 5, "success": True, "readonly": True, "msg": "ok"}
    c = parse(msgs[3])[1]
    assert c["gear"] == 5 and c["last"]["ms"] is None and c["last"]["s"] == [None] * 3 and c["best"]["s"] == [20000, 20000, None]
    assert c["cur"]["valid"] is False and c["laps"] == 18 and abs(c["spl"] - 0.412) < 1e-6
    assert parse(msgs[6])[1]["team"] == "Team Bell" and parse(msgs[6])[1]["drivers"][0]["short"] == "MOR"
    assert parse(msgs[5])[1]["meters"] == 7004 and parse(msgs[7])[1]["car"] == 33 and parse(msgs[4])[1]["cars"] == [12, 7, 33]
    try:
        parse(b"")
        raise AssertionError("empty packet parsed")
    except ValueError:
        pass
    assert pack_register("Pit Wall", "pw", 250)[:2] == b"\x01\x04" and pack_request(10, 5) == b"\x0a\x05\x00\x00\x00"
    view_change = 7 * 7 + 1
    try:
        pack_request(view_change, 1)
        raise AssertionError("a view request was packed")
    except ValueError:
        pass
    forbidden = re.compile("0x3[123]|\\b(49|5[01])\\b")   # message types that move the driver's camera, HUD or replay
    with open(os.path.abspath(__file__), encoding="utf-8") as f:
        src = [ln for ln in f if "pack" in ln]
    assert not [ln for ln in src if forbidden.search(ln)], "a view-changing message type next to a packer"

    with tempfile.TemporaryDirectory() as tmp:   # broadcasting.json as ACC writes it: UTF-16LE, no BOM
        p = os.path.join(tmp, "broadcasting.json")
        with open(p, "wb") as f:
            f.write(json.dumps({"updListenerPort": 0, "connectionPassword": "", "commandPassword": ""}).encode("utf-16-le"))
        assert read_config(p)["port"] == 0
        assert enable(9000, p).endswith("Restart ACC for this to take effect.")
        cfg = read_config(p)
        with open(p, "rb") as f:
            raw = f.read()
        assert cfg["port"] == 9000 and len(cfg["password"]) == 12 and raw[1:2] == b"\x00" and not raw.startswith(b"\xff\xfe")
        assert os.path.exists(p + ".bak")

    now = [0.0]
    pages = acc_telemetry.FakePages(clock=lambda: now[0])
    ff = FakeField(pages)
    hint = lambda: (lambda r: {"id": r["me"], "laps": r["laps"], "spl": r["track_pos"], "name": r["name"], "xyz": r["xyz"], "kmh": r["speed"]})(pages.read())
    pitted = False
    for _ in range(3 * 60 * 4):   # three simulated minutes at 4 Hz
        now[0] += 0.25
        ff.step()
        pitted = pitted or any(c["loc"] in PIT_LOCS for i, c in ff.cars.items() if i != 7)
    snap = ff.snapshot(hint(), 1, 25000)
    cars = snap["cars"]
    assert len(cars) == 20 and sorted(c["pos"] for c in cars) == list(range(1, 21)) and snap["me"] == 7 and snap["mode"] == "race", snap["me"]
    gaps = [(c["gap_laps"], c["gap"]) for c in cars]
    assert all(g is not None and g >= 0 for _, g in gaps) and gaps == sorted(gaps), gaps
    assert pitted, "nobody pitted in three minutes"
    me = ff.cars[7]
    rel = sorted(((_wrap(c["spl"] - me["spl"]), c["rel"]) for i, c in ff.cars.items() if i != 7), key=lambda x: abs(x[0]))
    ahead, behind = next(r for f, r in rel if f > 0), next(r for f, r in rel if f < 0)
    assert ahead > 0 and behind < 0, (ahead, behind)
    assert all(c["net"] for c in cars) and ff.rejoin(7, 30000)["pos"] >= 1 and ff.race_info()["leader_dist"] > 3
    slow, seq = ff.slow_since(-1)
    assert len(slow) == 20 and ff.slow_since(seq)[0] == {} and len(ff.entries()["cars"]) == 20
    assert any(ff.car_laps(i) for i in ff.cars) and not snap["xz_ok"]

    now[0] = 0.0
    pages = acc_telemetry.FakePages(clock=lambda: now[0])
    fq = FakeField(pages, "quali")
    for _ in range(3 * 60 * 4):
        now[0] += 0.25
        fq.step()
    q = fq.snapshot(hint(), None, None)["cars"]
    p1 = fq.cars[q[0]["i"]]["best"]
    assert all(c["gap"] == fq.cars[c["i"]]["best"] - p1 for c in q if fq.cars[c["i"]]["best"]), q
    bests = [fq.cars[c["i"]]["best"] for c in q if fq.cars[c["i"]]["best"]]
    assert bests == sorted(bests) and fq.rejoin(7, 30000) is None and not any(c["loc"] in PIT_LOCS for c in fq.cars.values())
    print(f"ok: 7 message types round-trip, truncations refused, only types 1/9/10/11 sent, broadcasting.json kept UTF-16LE, "
          f"20-car field with gaps in order, rel signs right, quali by best lap")


if __name__ == "__main__":
    if "--enable" in sys.argv:
        rest = sys.argv[sys.argv.index("--enable") + 1:]
        print(enable(int(rest[0]) if rest else 9000))
    else:
        selftest()
