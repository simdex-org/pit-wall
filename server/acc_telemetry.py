#!/usr/bin/env python3
"""ACC telemetry for Pit Wall, run on the driver's PC.

Reads Assetto Corsa Competizione's three shared-memory pages (physics,
graphics, static) and turns them into what the dashboard draws: a 30 Hz
reading of the car and session, and a 10 Hz summary with the engineer's
advice, the strategy (the single source of every fuel, lap and stop
figure), stints, measured pit stops and a debrief of the last laps. Each
whole lap is also kept as a 400-point trace and a racing line for /lap.

Offsets follow Kunos' "ACC Shared Memory Documentation" 1.8.12.

    python server/acc_telemetry.py          # self-test: simulated laps and a stop through the whole pipeline
    python server/acc_telemetry.py --probe  # print the not-yet-verified fields once a second from a live session
"""
import copy
import math
import mmap
import struct
import sys
import time

SESSIONS = {0: "Practice", 1: "Qualifying", 2: "Race", 3: "Hotlap", 4: "Time attack", 7: "Hotstint", 8: "Superpole"}
STATUS = ["Off", "Replay", "Live", "Pause"]
CORNERS = ["FL", "FR", "RL", "RR"]
CLASSES = ["GT3", "GT4", "GT2", "GTC", "TCX"]
DRY_PSI, WET_PSI = (26.0, 27.0), (29.5, 31.0)   # GT3 hot-pressure windows: the defaults of every class until the user sets one
BRAKE_HOT_C, PAD_LOW_MM, TYRE_COLD_C = 750, 12, 65
GFLAGS = ["yellow", "y1", "y2", "y3", "white", "green", "chequered", "red"]
FLAG_TEXT = {1: "Blue flag", 2: "Yellow flag", 3: "Black flag", 4: "White flag", 5: "Chequered flag", 6: "Penalty flag", 7: "Green", 8: "Orange flag"}
RAIN = ["Dry", "Drizzle", "Light rain", "Medium rain", "Heavy rain", "Storm"]
PENALTIES = [("none", "none"), ("DT", "cutting"), ("SG10", "cutting"), ("SG20", "cutting"), ("SG30", "cutting"), ("DSQ", "cutting"),
             ("-BEST", "best lap removed, cutting"), ("DT", "pit speeding"), ("SG10", "pit speeding"), ("SG20", "pit speeding"),
             ("SG30", "pit speeding"), ("DSQ", "pit speeding"), ("-BEST", "pit speeding"), ("DSQ", "ignored mandatory pit"),
             ("TIME", "post-race time"), ("DSQ", "trolling"), ("DSQ", "pit entry"), ("DSQ", "pit exit"), ("DSQ", "wrong way"),
             ("DT", "ignored driver stint"), ("DSQ", "ignored driver stint"), ("DSQ", "exceeded driver stint limit")]
SERVABLE = {1, 2, 3, 4, 7, 8, 9, 10, 19}            # served in the pit lane, within 3 laps
NB, LCH = 400, ["t", "speed", "thr", "brk", "steer", "gear", "rpm"]   # lap traces: as recorder.js resample()


def _class_th():
    return {"dry_psi": list(DRY_PSI), "wet_psi": list(WET_PSI), "tyre_c": [TYRE_COLD_C, 105],
            "brake_c": {"front": [200, BRAKE_HOT_C], "rear": [200, BRAKE_HOT_C]}, "pad_low_mm": PAD_LOW_MM, "water_c": [105, 115]}


# Shared by everyone watching this bridge; POST /config changes it (clean_config). Every class starts as a copy of GT3.
DEFAULT_CONFIG = {
    "thresholds": {k: _class_th() for k in CLASSES},
    "fuel_low_laps": 3,
    "strategy": {"reserve_laps": 1.0, "laps_override": None, "pit_loss_s": 25.0, "refuel_s_per_l": 0.25, "tyre_s": 30.0,
                 "min_stationary_s": 0.0, "fuel_and_tyres": "parallel", "mandatory_stops": None,
                 "pit_window_open_min": None, "pit_window_close_min": None},
}


def clean_config(raw, base=None):
    """A partial config from the network, merged onto base (default: the defaults) and checked whole. Raises ValueError."""
    if not isinstance(raw, dict):
        raise ValueError("config must be an object")
    out = copy.deepcopy(base or DEFAULT_CONFIG)

    def merge(dst, src, path):
        for k, v in src.items():
            if k not in dst:
                raise ValueError(f"unknown setting {path}{k}")
            if isinstance(dst[k], dict):
                if not isinstance(v, dict):
                    raise ValueError(f"{path}{k} must be an object")
                merge(dst[k], v, f"{path}{k}.")
            else:
                dst[k] = v
    merge(out, raw, "")

    def num(v, lo, hi, name, integer=False, null=False):
        if v is None and null:
            return None
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi or (integer and v != int(v)):
            raise ValueError(f"{name} must be {'a whole number' if integer else 'a number'} from {lo} to {hi}{' or empty' if null else ''}")
        return int(v) if integer else float(v)

    def pair(v, lo, hi, name):
        if not isinstance(v, list) or len(v) != 2:
            raise ValueError(f"{name} must be two numbers")
        a, b = num(v[0], lo, hi, name), num(v[1], lo, hi, name)
        if not a < b:
            raise ValueError(f"{name}: the first must be below the second")
        return [a, b]

    for cls, t in out["thresholds"].items():
        t["dry_psi"], t["wet_psi"] = pair(t["dry_psi"], 15, 40, f"{cls} dry psi"), pair(t["wet_psi"], 15, 40, f"{cls} wet psi")
        t["tyre_c"] = pair(t["tyre_c"], 0, 200, f"{cls} tyre °C")
        for axle in ("front", "rear"):
            t["brake_c"][axle] = pair(t["brake_c"][axle], 100, 1200, f"{cls} {axle} brake °C")
        t["pad_low_mm"], t["water_c"] = num(t["pad_low_mm"], 0, 30, f"{cls} pad mm"), pair(t["water_c"], 60, 150, f"{cls} water °C")
    out["fuel_low_laps"] = num(out["fuel_low_laps"], 0, 20, "fuel_low_laps")
    s = out["strategy"]
    s["reserve_laps"] = num(s["reserve_laps"], 0, 10, "reserve_laps")
    s["laps_override"] = num(s["laps_override"], 1, 999, "laps_override", True, True)
    for k, hi in (("pit_loss_s", 200), ("refuel_s_per_l", 5), ("tyre_s", 120), ("min_stationary_s", 200)):
        s[k] = num(s[k], 0, hi, k)
    if s["fuel_and_tyres"] not in ("parallel", "sequential"):
        raise ValueError("fuel_and_tyres must be parallel or sequential")
    s["mandatory_stops"] = num(s["mandatory_stops"], 0, 9, "mandatory_stops", True, True)
    o = s["pit_window_open_min"] = num(s["pit_window_open_min"], 0, 1440, "pit_window_open_min", null=True)
    c = s["pit_window_close_min"] = num(s["pit_window_close_min"], 0, 1440, "pit_window_close_min", null=True)
    if (o is None) != (c is None) or (o is not None and not o < c):
        raise ValueError("pit window: set both minutes, open before close, or neither")
    return out


def car_class(model):
    m = (model or "").lower()
    return "GT4" if "gt4" in m else "GT2" if "gt2" in m else "GTC" if "cup" in m else "TCX" if "m2_cs" in m else "GT3"


def fmt_lap(ms):
    if not ms or ms < 0:
        return "-"
    return f"{int(ms // 60000)}:{ms % 60000 / 1000:06.3f}"


def resample(smp, ms):
    """Samples of a whole lap -> NB points per channel at even track position: exactly recorder.js resample()."""
    d, j = {k: [0.0] * NB for k in LCH}, 0
    for i in range(NB):
        p = i / (NB - 1)
        while j < len(smp) - 2 and smp[j + 1]["p"] < p:
            j += 1
        a, b = smp[j], smp[j + 1]
        f = max(0.0, min(1.0, (p - a["p"]) / (b["p"] - a["p"]))) if b["p"] > a["p"] else 0.0
        for k in LCH:
            d[k][i] = a[k] + (b[k] - a[k]) * f
    d["gear"] = [math.floor(g + 0.5) for g in d["gear"]]   # Math.round
    end = d["t"][-1]
    if end > 0 and ms > 0:   # make the last point the official lap time
        d["t"] = [t * ms / end for t in d["t"]]
    return d


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _f(b, o, n=1):
    v = struct.unpack_from(f"<{n}f", b, o)
    return v[0] if n == 1 else list(v)


def _i(b, o, n=1):
    v = struct.unpack_from(f"<{n}i", b, o)
    return v[0] if n == 1 else list(v)


def _w(b, o, n=33):
    return b[o:o + 2 * n].decode("utf-16-le", "ignore").split("\0", 1)[0]


class AccPages:
    """ACC's shared memory on this PC. Read-only in practice; see AccMfd for why the mapping is opened writable."""
    SIZES = {"physics": 800, "graphics": 1588, "static": 688}

    def __init__(self):
        self.m = {k: mmap.mmap(-1, n, tagname="Local\\acpmf_" + k, access=mmap.ACCESS_WRITE) for k, n in self.SIZES.items()}

    def read(self):
        p, g, s = (self.m[k][:] for k in ("physics", "graphics", "static"))
        ids, me = _i(g, 976, 60), _i(g, 1216)
        car = ids.index(me) if me in ids else 0
        return {
            "status": _i(g, 4), "session": _i(g, 8),
            "gas": _f(p, 4), "brake": _f(p, 8), "fuel": _f(p, 12), "gear": _i(p, 16), "rpm": _i(p, 20), "steer": _f(p, 24),
            "speed": _f(p, 28), "acc_g": _f(p, 44, 3), "pressure": _f(p, 88, 4), "core_temp": _f(p, 152, 4),
            "damage": _f(p, 224, 5), "tyres_out": _i(p, 244), "limiter": _i(p, 248), "air": _f(p, 288), "road": _f(p, 292),
            "brake_temp": _f(p, 348, 4), "clutch": _f(p, 364), "bias": _f(p, 564), "tc_on": _i(p, 672), "abs_on": _i(p, 676),
            "susp_damage": _f(p, 680, 4), "water": _f(p, 712), "brake_press": _f(p, 716, 4),
            "front_pad_compound": _i(p, 732), "rear_pad_compound": _i(p, 736), "pad": _f(p, 740, 4), "disc": _f(p, 756, 4),
            "laps": _i(g, 132), "position": _i(g, 136), "cur_ms": _i(g, 140), "last_ms": _i(g, 144), "best_ms": _i(g, 148),
            "time_left": _f(g, 152), "in_box": _i(g, 160), "sector": _i(g, 164), "compound": _w(g, 176), "track_pos": _f(g, 248),
            "xyz": _f(g, 256 + 12 * car, 3), "me": me, "penalty_time": _f(g, 1220), "flag": _i(g, 1224), "penalty": _i(g, 1228),
            "pit_lane": _i(g, 1236), "mandatory_done": _i(g, 1244), "wind": _f(g, 1248), "wind_dir": _f(g, 1252),
            "tc": _i(g, 1268), "tc_cut": _i(g, 1272), "map": _i(g, 1276), "abs": _i(g, 1280), "fuel_per_lap": _f(g, 1284),
            "rain_lights": _i(g, 1288), "lights_stage": _i(g, 1296), "exhaust": _f(g, 1300), "wiper": _i(g, 1304),
            "stint_total_left": _i(g, 1308), "stint_left": _i(g, 1312), "rain_tyres": _i(g, 1316), "session_index": _i(g, 1320),
            "used_fuel": _f(g, 1324), "delta_ms": _i(g, 1360), "est_lap_ms": _i(g, 1396), "valid": _i(g, 1408), "fuel_laps": _f(g, 1412),
            "track_status": _w(g, 1416), "missing_pits": _i(g, 1484), "clock": _f(g, 1488), "g_flags": _i(g, 1500, 8),
            "grip": _i(g, 1556), "rain": _i(g, 1560, 3), "tyre_set": _i(g, 1572), "gap_ahead": _i(g, 1580), "gap_behind": _i(g, 1584),
            "car": _w(s, 68), "track": _w(s, 134), "name": f"{_w(s, 200)} {_w(s, 266)}".strip(),
            "sectors": _i(s, 400), "max_rpm": _i(s, 412), "max_fuel": _f(s, 416), "fuel_rate": _f(s, 468), "tyre_rate": _f(s, 472),
            "track_len": _f(s, 520), "timed": _i(s, 596), "extra_lap": _i(s, 600), "pit_open": _i(s, 676), "pit_close": _i(s, 680),
            "online": _i(s, 684),
        }


class Telemetry:
    """Raw page values in, the dashboard's reading and summary out. Keeps what needs history: laps, sectors, stints, stops,
    fuel, lap traces. `events` collects log lines (sev, category, text) for bridge.py to drain; they are edge-triggered."""

    def __init__(self, config=None, clock=time.monotonic):
        self.config, self.clock, self.seq, self.cls = config or copy.deepcopy(DEFAULT_CONFIG), clock, 0, "GT3"
        self._new_session()

    def _new_session(self):
        self.prev, self.splits, self.debrief = None, [], []
        self.stint_start = self.fuel_at_line = None
        self.lap_fuel, self.lap_brake_max, self.best, self.stint = [], 0.0, None, []
        self.laps, self.lap_start_pit, self.lap_saw_pit, self.laps_ver = [], False, False, 0   # every lap of the session, for the Laps tab
        self.events, self.edge, self.advice_ids = [], {}, set()
        self.stint_no, self.stint_road, self.stops, self.stop, self.pending = 1, None, [], None, None
        self.cur, self.line, self.traces = [], [], {}
        self.pen, self.sess_len, self.race_t, self.t_prev, self.last_st = None, 0.0, None, None, {}

    @property
    def th(self):
        t = self.config["thresholds"]
        return t.get(self.cls) or t["GT3"]

    def update(self, r, ext=None):
        """One reading. ext (from the bridge, all optional): field (bool, broadcasting live), car_class and track_m from it,
        gap_ms (my gap to the leader, for the lap list)."""
        ext = ext or {}
        self.seq += 1
        p = self.prev
        if p and r["session_index"] != p["session_index"]:
            self._new_session()
            p = None
        now = self.clock()
        self.cls = ext.get("car_class") or car_class(r["car"])
        self.sess_len = max(self.sess_len, r["time_left"])
        if self.stint_road is None:
            self.stint_road = r["road"]
        if self.stint_start is None or r["pit_lane"]:
            self.stint_start, self.stint = r["laps"], []
        if p and r["sector"] > p["sector"]:
            self.splits.append(r["cur_ms"])
        self.lap_brake_max = max(self.lap_brake_max, *r["brake_temp"])
        self.lap_saw_pit = self.lap_saw_pit or bool(r["pit_lane"])
        if p:
            self._edges(r, p)
            self._pits(r, p, now)
        if p and r["laps"] > p["laps"]:
            self._lap_done(r, p, ext)
        self._sample(r)
        self.prev, self.t_prev = r, now
        mp, po, pc = r["missing_pits"], r["pit_open"], r["pit_close"]
        win = 0 < po < pc
        return {"what": "pit-wall/session", "sequence": self.seq, "from": r["name"], "reading": {
            "car": {
                "gear": r["gear"] - 1, "speed_kmh": r["speed"], "rpm": r["rpm"], "throttle": r["gas"], "brake": r["brake"],
                "clutch": r["clutch"], "reference_delta_s": r["delta_ms"] / 1000, "fuel_litres": r["fuel"],
                "pit_limiter": bool(r["limiter"]), "tyres_off_track": r["tyres_out"], "abs_in_action": r["abs_on"], "tc_in_action": r["tc_on"],
                "tyre_pressure_psi": r["pressure"], "tyre_core_temp_c": r["core_temp"], "brake_temp_c": r["brake_temp"],
                "brake_pad_mm": r["pad"], "brake_disc_mm": r["disc"], "brake_bias": r["bias"] * 100, "tc_level": r["tc"],
                "abs_level": r["abs"], "acc_g": r["acc_g"], "steer_angle": r["steer"], "damage": r["damage"],
                "air_temp_c": r["air"], "road_temp_c": r["road"], "water_temp_c": r["water"], "exhaust_temp_c": r["exhaust"],
                "brake_pressure": r["brake_press"], "suspension_damage": r["susp_damage"],
                "front_pad_compound": r["front_pad_compound"] + 1, "rear_pad_compound": r["rear_pad_compound"] + 1,
                "rain_lights": bool(r["rain_lights"]), "lights_stage": r["lights_stage"], "wiper": r["wiper"]},
            "session": {
                "current_lap_ms": r["cur_ms"], "last_lap_ms": r["last_ms"], "best_lap_ms": r["best_ms"], "lap_is_valid": bool(r["valid"]),
                "current_sector": r["sector"], "in_pit_lane": bool(r["pit_lane"]), "compound": r["compound"], "tc_cut": r["tc_cut"],
                "engine_map": r["map"] + 1, "completed_laps": r["laps"], "total_laps": 0, "session_time_left_ms": max(0, r["time_left"]),
                "kind": SESSIONS.get(r["session"], "Session"), "status": STATUS[r["status"]] if 0 <= r["status"] < 4 else "Off",
                "position": r["position"], "wind_speed_kmh": r["wind"] * 3.6, "wind_direction_deg": math.degrees(r["wind_dir"]) % 360,
                "fuel_per_lap": self.fuel_per_lap(r), "track_position": r["track_pos"], "car_position_m": r["xyz"],
                "gap_ahead_ms": r["gap_ahead"], "gap_behind_ms": r["gap_behind"], "track_grip": r["grip"], "rain": r["rain"],
                "rain_tyres": bool(r["rain_tyres"]), "tyre_set": r["tyre_set"],
                "flag": r["flag"], "global_flags": {k: bool(v) for k, v in zip(GFLAGS, r["g_flags"])}, "penalty": r["penalty"],
                "penalty_time_s": r["penalty_time"], "mandatory_pit_done": bool(r["mandatory_done"]),
                "missing_mandatory_pits": mp if 0 <= mp <= 50 else None, "stint_time_left_ms": r["stint_left"] if r["stint_left"] >= 0 else -1,
                "stint_total_time_left_ms": r["stint_total_left"], "in_pit_box": bool(r["in_box"]), "clock_s": r["clock"],
                "estimated_lap_ms": r["est_lap_ms"], "session_index": r["session_index"], "used_fuel_l": r["used_fuel"],
                "track_status": r["track_status"], "lap_number": r["laps"] + 1, "player_car_id": r["me"]},
            "fixed": {"car_model": r["car"], "track": r["track"], "track_config": "", "driver_name": r["name"],
                      "sector_count": r["sectors"] or 3, "max_rpm": r["max_rpm"], "max_fuel": r["max_fuel"],
                      "track_length_m": ext.get("track_m") or r["track_len"], "is_timed_race": bool(r["timed"]),
                      "has_extra_lap": bool(r["extra_lap"]), "pit_window_start_ms": po if win else 0, "pit_window_end_ms": pc if win else 0,
                      "is_online": bool(r["online"]), "fuel_rate": r["fuel_rate"], "tyre_rate": r["tyre_rate"], "car_class": self.cls},
            "capabilities": {"tyre_edge_temps": False, "tyre_wear": False, "sectors": True, "field": bool(ext.get("field")),
                             "flags": True, "traces": True}}}

    def fuel_per_lap(self, r):
        """Our own figure, the last three green laps, once there are any; ACC's estimate until then."""
        return sum(self.lap_fuel[-3:]) / len(self.lap_fuel[-3:]) if self.lap_fuel else r["fuel_per_lap"]

    def _elapsed(self, r):
        """Session time so far, ms: from broadcasting when the field is live, else the longest time-left seen minus now."""
        return self.race_t if self.race_t is not None else self.sess_len - r["time_left"]

    # ---------- the log ----------
    def _edge(self, key, on, sev, cat, text):
        if on and not self.edge.get(key):
            self.events.append((sev, cat, text))
        self.edge[key] = bool(on)

    def _edges(self, r, p):
        th = self.th
        if r["flag"] != p["flag"] and r["flag"] in FLAG_TEXT:
            self.events.append((0 if r["flag"] in (5, 7) else 1, "FLAG", FLAG_TEXT[r["flag"]]))
        for k in (1, 2, 3):
            self._edge(f"y{k}", r["g_flags"][k], 1, "FLAG", f"Yellow in sector {k}")
        if r["penalty"] and r["penalty"] != p["penalty"] and 0 < r["penalty"] < len(PENALTIES):
            self.events.append((2, "FLAG", "Penalty: {} {}".format(*PENALTIES[r["penalty"]])))
        self._edge("invalid", not r["valid"], 1, "CAR", "Lap invalidated")
        self._edge("off", r["tyres_out"] >= 3, 1, "CAR", f"Off track: {r['tyres_out']} wheels out")
        self._edge("dmg", sum(r["damage"]) > 0, 2, "CAR", "Car damage")
        for i, c in enumerate(CORNERS):
            hot = th["brake_c"]["front" if i < 2 else "rear"][1]
            self._edge("tyre" + c, r["core_temp"][i] > th["tyre_c"][1], 1, "CAR", f"{c} tyre {r['core_temp'][i]:.0f} °C, over {th['tyre_c'][1]:.0f}")
            self._edge("brk" + c, r["brake_temp"][i] > hot, 2, "CAR", f"{c} brake {r['brake_temp'][i]:.0f} °C, over {hot:.0f}")

    # ---------- pit stops, measured ----------
    def _pits(self, r, p, now):
        if r["pit_lane"] and not p["pit_lane"]:
            self.events.append((0, "PIT", f"Pit lane in, L{r['laps'] + 1}"))
            self.stop = {"lap": r["laps"] + 1, "t": now, "t_ms": self._elapsed(r), "fuel": p["fuel"], "set": r["tyre_set"], "box": 0.0,
                         "ref": self.last_st.get("lap_ref_ms")}
        elif self.stop and r["pit_lane"]:
            if r["in_box"] and r["speed"] < 1:
                self.stop["box"] += now - self.t_prev
        elif self.stop and p["pit_lane"] and not r["pit_lane"]:
            st, self.stop = self.stop, None
            lane_ms, box_ms = int((now - st["t"]) * 1000), int(st["box"] * 1000)
            self.events.append((0, "PIT", f"Pit lane out, lane {lane_ms / 1000:.1f} s"))
            if box_ms > 0:   # stopped in the box; a drive-through is not a stop
                added = max(0.0, r["fuel"] - st["fuel"])
                rec = {"lap": st["lap"], "t_ms": st["t_ms"], "lane_ms": lane_ms, "box_ms": box_ms, "loss_ms": None, "fuel_added_l": added,
                       "set_before": st["set"], "set_after": r["tyre_set"], "tyres": r["tyre_set"] != st["set"]}
                self.stops.append(rec)
                self.pending = {"rec": rec, "in": st["lap"], "out": max(r["laps"] + 1, st["lap"] + 1), "ref": st["ref"]}
                self.stint_no, self.stint_road = self.stint_no + 1, r["road"]
                self.events.append((0, "PIT", f"Stop L{st['lap']}: lane {lane_ms / 1000:.1f} s, box {box_ms / 1000:.1f} s, "
                                              f"+{added:.1f} L, set {st['set']}→{r['tyre_set']}"))

    # ---------- laps ----------
    def _sample(self, r):
        p, c = r["track_pos"], self.cur
        if not c or p > c[-1]["p"]:   # position must advance; drops jitter and the wrap after the line
            c.append({"p": p, "t": r["cur_ms"], "speed": r["speed"], "thr": r["gas"], "brk": r["brake"], "steer": r["steer"],
                      "gear": r["gear"] - 1, "rpm": r["rpm"]})
        x, z = r["xyz"][0], r["xyz"][2]
        if (x or z) and (not self.line or math.hypot(self.line[-1][0] - x, self.line[-1][1] - z) > 1.5):
            self.line.append([x, z])

    def _lap_done(self, r, p, ext):
        ms, lines, n = r["last_ms"], [], r["laps"]
        th = self.th
        whole = len(self.splits) + 1 == (r["sectors"] or 3)
        sectors = [b - a for a, b in zip([0] + self.splits, self.splits + [ms])] if whole and ms > 0 else []
        green = not p["pit_lane"] and not r["pit_lane"] and self.fuel_at_line is not None
        used = self.fuel_at_line - p["fuel"] if green and self.fuel_at_line - p["fuel"] > 0.2 else None   # no refuel in the lap
        if used is not None:
            self.lap_fuel.append(used)
            lines.append((0, f"Used {used:.2f} L"))
        if not p["valid"]:
            lines.append((1, "Lap invalid: track limits"))
        elif 0 < ms and (self.best is None or ms < self.best):
            self.best = ms
            lines.append((0, "Best lap so far"))
        elif self.best:
            lines.append((0, f"{(ms - self.best) / 1000:+.3f} s off the best lap"))
        lo, hi = th["wet_psi"] if r["rain_tyres"] else th["dry_psi"]
        out = [f"{c} {v:.1f}" for c, v in zip(CORNERS, r["pressure"]) if not lo <= v <= hi]
        lines.append((1, f"Pressures out of {lo}-{hi} psi at the line: {', '.join(out)}") if out else (0, "Pressures in the window"))
        if self.lap_brake_max > max(th["brake_c"]["front"][1], th["brake_c"]["rear"][1]):
            lines.append((1, f"Brakes peaked at {self.lap_brake_max:.0f} °C"))
        self.debrief.insert(0, {"lap_number": n, "lap_time_ms": ms, "sectors_ms": sectors,
                                "lines": [{"severity": s, "text": t} for s, t in lines]})
        del self.debrief[3:]
        if not r["pit_lane"] and ms > 0:   # the stint so far, for the degradation and brake wear modules
            self.stint.append({"n": n, "ms": ms, "valid": bool(p["valid"]), "pads": r["pad"],
                               "fuel": round(used, 2) if used is not None else None})
            del self.stint[:-60]
        if ms > 0:   # OUT: began in the pit lane; IN: went into it
            item = {"n": n, "ms": ms, "s": sectors, "valid": bool(p["valid"]), "fuel": round(used, 2) if used is not None else None,
                    "out": self.lap_start_pit, "in": self.lap_saw_pit and not self.lap_start_pit, "stint": self.stint_no,
                    "set": r["tyre_set"], "wet": bool(r["rain_tyres"]), "fuel_end": r["fuel"], "pos": r["position"], "gap": ext.get("gap_ms"),
                    "psi": list(r["pressure"]), "core": list(r["core_temp"]), "track_c": r["road"], "trace": False}
            c = self.cur
            if len(c) > 60 and c[0]["p"] < 0.1 and c[-1]["p"] > 0.9:   # only whole laps: a part lap cannot be compared
                self.traces[n] = {"ms": ms, "valid": item["valid"], "ch": resample(c, ms), "line": self.line}
                item["trace"] = True
            self.laps.append(item)
            del self.laps[:-200]
            self._prune_traces()
            self.laps_ver += 1
            self.events.append((0 if item["valid"] else 1, "LAP", f"Lap {n} {fmt_lap(ms)}" + ("" if item["valid"] else " (invalid)")))
        if self.pending and n >= self.pending["out"]:   # the out-lap is done: what the stop cost against the pace at the time
            pd, self.pending = self.pending, None
            by = {l["n"]: l["ms"] for l in self.laps}
            a, b = by.get(pd["in"]), by.get(pd["out"])
            if a and b and pd["ref"]:
                pd["rec"]["loss_ms"] = int(a + b - 2 * pd["ref"])
                self.events.append((0, "PIT", f"Stop L{pd['in']} cost {pd['rec']['loss_ms'] / 1000:.1f} s"))
        self.splits, self.lap_brake_max, self.fuel_at_line = [], 0.0, r["fuel"]
        self.lap_start_pit = self.lap_saw_pit = bool(r["pit_lane"])
        self.cur, self.line = [], []

    def _prune_traces(self):
        """Keep the last 40 traced laps and the best valid one."""
        ok = [l for l in self.laps if l["trace"] and l["valid"]]
        keep = set(sorted(self.traces)[-40:]) | ({min(ok, key=lambda l: l["ms"])["n"]} if ok else set())
        for n in [n for n in self.traces if n not in keep]:
            del self.traces[n]
        for i, l in enumerate(self.laps):
            if l["trace"] and l["n"] not in self.traces:
                self.laps[i] = dict(l, trace=False)

    def lap_trace(self, n):
        """GET /lap?n=N: a whole lap's 400-point channels and its racing line, or None."""
        t = self.traces.get(n)
        if not t:
            return None
        return {"n": n, "ms": t["ms"], "valid": t["valid"], "ch": {k: [round(v, 3) for v in t["ch"][k]] for k in LCH},
                "line": [[round(x, 1), round(z, 1)] for x, z in t["line"]]}

    # ---------- the summary ----------
    def _own_pace(self):
        return _mean([l["ms"] for l in self.laps if l["valid"] and not l["out"] and not l["in"]][-3:])

    def best_lap(self, r):
        ok = [l["ms"] for l in self.laps if l["valid"]]
        if ok:
            return min(ok), "bridge"
        return (r["best_ms"], "acc") if 0 < r["best_ms"] < 3.6e6 else (None, None)

    def press_line(self, r):
        """Mean hot pressure at the line over the last 3 green laps of this stint: what the next stop's correction is based on."""
        ls = [l for l in self.laps if l["stint"] == self.stint_no and l["valid"] and not l["out"] and not l["in"]][-3:]
        if not ls:
            return None
        return {"psi": [_mean(l["psi"][i] for l in ls) for i in range(4)], "laps": len(ls), "track_c_delta": r["road"] - self.stint_road}

    def stints(self, r):
        out = []
        for n in sorted({l["stint"] for l in self.laps} | {self.stint_no}):
            ls = [l for l in self.laps if l["stint"] == n]
            ok = [l["ms"] for l in ls if l["valid"]]
            out.append({"n": n, "from": ls[0]["n"] if ls else None, "to": ls[-1]["n"] if ls else None, "laps": len(ls),
                        "best_ms": min(ok) if ok else None, "avg_ms": _mean([l["ms"] for l in ls if l["valid"] and not l["out"] and not l["in"]]),
                        "fuel_per_lap": _mean([l["fuel"] for l in ls]), "tyre_set": ls[-1]["set"] if ls else r["tyre_set"],
                        "wet": ls[-1]["wet"] if ls else bool(r["rain_tyres"]), "current": n == self.stint_no})
        return out

    def penalty(self, r):
        k = r["penalty"]
        if k in SERVABLE:
            if not self.pen or self.pen["kind"] != k:
                self.pen = {"kind": k, "at": r["laps"]}
            return {"kind": k, "laps_left": 3 - (r["laps"] - self.pen["at"])}
        if not k:
            self.pen = None
        return None

    def strategy(self, r, race=None):
        """Every fuel, lap and stop figure the page shows. race: {leader_dist, leader_pace_ms, mode, elapsed_ms} from the
        broadcasting field, or None."""
        cfg = self.config["strategy"]
        if race and race.get("elapsed_ms") is not None:
            self.race_t = race["elapsed_ms"]
        fpl, fuel, cap, reserve = self.fuel_per_lap(r), r["fuel"], r["max_fuel"], cfg["reserve_laps"]
        done, tp = r["laps"], r["track_pos"]
        lap_no, dme = done + 1, done + tp
        dl = race["leader_dist"] if race and race.get("leader_dist") is not None else dme
        own, (best, _) = self._own_pace(), self.best_lap(r)
        if race and race.get("mode") == "race" and race.get("leader_pace_ms"):
            ref, ref_src = race["leader_pace_ms"], "leader"
        elif own:
            ref, ref_src = own, "own"
        elif best:
            ref, ref_src = best, "best"
        else:
            ref = ref_src = None
        my = own or ref

        def ceil(x):   # an argument within 1e-6 of a whole number is that number
            k = round(x)
            return int(k) if abs(x - k) < 1e-6 else math.ceil(x)

        # ponytail: ACC's shared memory has no race lap count, so the "laps" source (total_laps > 0) has no input to read yet
        finish = src = None
        if r["session"] != 2:   # practice and qualifying: no flag to plan fuel for, only the fuel-limited box lap
            pass
        elif cfg["laps_override"]:
            finish, src = done + cfg["laps_override"], "override"
        elif r["time_left"] > 0 and ref:
            dflag = ceil(dl + r["time_left"] / ref)
            finish, src = ceil(dme + (dflag - dl) * ref / my), "timed"
        if finish is not None:
            finish += bool(r["extra_lap"])
        st = {"lap_ref_ms": ref, "lap_ref_src": ref_src, "my_pace_ms": my, "dist_to_go": None, "laps_to_go": None, "laps_src": src,
              "fuel_per_lap": fpl, "laps_of_fuel": None, "fuel_needed_l": None, "fuel_to_add_l": None, "fits_tank": None,
              "stops_needed": 0, "stops_why": None, "box_by_lap": None, "box_in_laps": None, "add_at_box_l": None, "spare_l": None,
              "save_lpl": None, "pit_window": None, "mandatory_left": None, "reserve_laps": reserve, "options": [], "rejoin": None}
        fuel_stops = 0

        def add_at(lap):   # fuel to put in when boxing at the end of `lap`: to the flag, capped by the tank space there
            left = max(0.0, fuel - (lap - dme) * fpl)
            return min(max(0.0, (finish - lap + reserve) * fpl - left), cap - left)

        if fpl > 0:
            st["laps_of_fuel"] = fuel / fpl
            st["box_by_lap"] = lap_no + max(0, math.floor(fuel / fpl - (1 - tp) - reserve))
            st["box_in_laps"] = st["box_by_lap"] - lap_no
            if finish is not None:
                dist = finish - dme
                need = (dist + reserve) * fpl
                st.update(dist_to_go=dist, laps_to_go=finish - done, fuel_needed_l=need, fuel_to_add_l=max(0.0, need - fuel))
                st["fits_tank"] = st["fuel_to_add_l"] <= cap - fuel
                per_stop = cap - reserve * fpl
                fuel_stops = 0 if need <= fuel else math.ceil((need - fuel) / per_stop) if per_stop > 0 else 1
                st["add_at_box_l"] = add_at(st["box_by_lap"])
                if dist > 0 and 0.9 * fpl <= fuel / dist < fpl:
                    st["save_lpl"] = fuel / dist
        mp = r["missing_pits"]
        if 0 <= mp <= 50:
            st["mandatory_left"] = mp
        elif cfg["mandatory_stops"] is not None:
            st["mandatory_left"] = max(0, cfg["mandatory_stops"] - len(self.stops))
        stint_stops = 1 if 0 <= r["stint_left"] < r["time_left"] else 0
        terms = [("fuel", fuel_stops), ("mandatory", st["mandatory_left"] or 0), ("stint", stint_stops)]
        st["stops_needed"] = max(v for _, v in terms)
        st["stops_why"] = next((k for k, v in terms if v == st["stops_needed"]), None) if st["stops_needed"] else None
        if st["fuel_needed_l"] is not None and not st["stops_needed"]:
            st["spare_l"] = fuel - st["fuel_needed_l"]

        el = self._elapsed(r)
        o = c = None
        if cfg["pit_window_open_min"] is not None:
            o, c, wsrc = cfg["pit_window_open_min"] * 60000, cfg["pit_window_close_min"] * 60000, "config"
        elif 0 < r["pit_open"] < r["pit_close"]:
            o, c, wsrc = r["pit_open"], r["pit_close"], "acc"
        if o is not None and ref:
            at = lambda ms: max(lap_no, lap_no + math.ceil((ms - el) / ref))
            st["pit_window"] = {"open_lap": at(o), "close_lap": at(c), "src": wsrc}

        loss = [(s["loss_ms"] - s["box_ms"]) / 1000 for s in self.stops if s["loss_ms"] is not None]
        refuel = [s["box_ms"] / 1000 / s["fuel_added_l"] for s in self.stops if not s["tyres"] and s["fuel_added_l"] >= 5]
        tyres = [s["box_ms"] / 1000 for s in self.stops if s["tyres"] and s["fuel_added_l"] < 5]
        st.update(drive_loss_s=_mean(loss) if loss else cfg["pit_loss_s"], drive_loss_src="measured" if loss else "config",
                  refuel_s_per_l=_mean(refuel) if refuel else cfg["refuel_s_per_l"], refuel_src="measured" if refuel else "est",
                  tyre_s=_mean(tyres) if tyres else cfg["tyre_s"], tyre_src="measured" if tyres else "est")

        def stationary(litres, ty):
            a, b = litres * st["refuel_s_per_l"], st["tyre_s"] if ty else 0.0
            return max(cfg["min_stationary_s"], max(a, b) if cfg["fuel_and_tyres"] == "parallel" else a + b)

        if fpl > 0 and finish is not None:
            # one row per distinct lap: now, the last lap the fuel allows, and the window's opening lap when it is later
            per_stop = cap - reserve * fpl
            rows, seen = [], set()
            cand = [("now", "Box now", lap_no), ("late", f"Box L{st['box_by_lap']}", st["box_by_lap"])]
            if st["pit_window"] and st["pit_window"]["open_lap"] > lap_no:
                cand.append(("win", f"Box L{st['pit_window']['open_lap']} (window)", st["pit_window"]["open_lap"]))
            for row in cand:
                if row[2] not in seen:
                    seen.add(row[2])
                    rows.append(row)
            for key, label, lap in rows:
                add = add_at(lap)
                left = max(0.0, fuel - (lap - dme) * fpl)
                short = (finish - lap + reserve) * fpl - (left + add)   # fuel still missing to the flag after this stop
                more = 0 if short <= 1e-6 else math.ceil(short / per_stop) if per_stop > 0 else 1
                for ty in (False, True):
                    s = stationary(add, ty)
                    st["options"].append({"id": f"{key}_{'ft' if ty else 'f'}", "label": f"{label}, fuel{' + tyres' if ty else ''}", "lap": lap,
                                          "add_l": add, "stationary_s": s, "loss_s": st["drive_loss_s"] + s, "rejoin_pos": None,
                                          "reach": lap <= st["box_by_lap"], "more_stops": more})
        return st

    def summary(self, r, race=None):
        fpl = self.fuel_per_lap(r)
        st = self.last_st = self.strategy(r, race)
        pl, pen = self.press_line(r), self.penalty(r)
        best, src = self.best_lap(r)
        adv = self.advice(r, st, pl, pen)
        ids = {a["id"] for a in adv}
        self.events += [(a["severity"], "ENG", a["text"]) for a in adv if a["id"] not in self.advice_ids]
        self.advice_ids = ids
        return {"what": "pit-wall/summary", "fuel_per_lap": fpl, "stint_laps": r["laps"] - (self.stint_start or 0), "max_rpm": r["max_rpm"],
                "best_ms": best, "best_src": src, "advice": adv, "press_line": pl, "strategy": st, "stints": self.stints(r),
                "stops": [dict(s) for s in self.stops], "penalty": pen, "debrief": self.debrief, "stint": self.stint}

    def advice(self, r, st, pl, pen):
        th, out, moving = self.th, [], r["speed"] > 60 and not r["pit_lane"]
        lo, hi = th["wet_psi"] if r["rain_tyres"] else th["dry_psi"]
        if pl:   # never the instant value: the mean at the line over green laps
            for aid, name, ix in (("press_front", "Fronts", (0, 1)), ("press_rear", "Rears", (2, 3))):
                v = sum(pl["psi"][i] for i in ix) / 2
                if not lo <= v <= hi:
                    out.append((1, aid, f"{name} {v:.1f} psi, {abs(v - (hi if v > hi else lo)):.1f} {'over' if v > hi else 'under'} the "
                                        f"{lo:.1f}-{hi:.1f} window at the line: {'lower' if v > hi else 'raise'} them at the next stop"))
        cold = [c for c, t in zip(CORNERS, r["core_temp"]) if moving and 0 < t < th["tyre_c"][0]]
        if cold:
            out.append((0, "tyres_cold", f"Tyres still cold: {', '.join(cold)}"))
        hot = [(c, t) for i, (c, t) in enumerate(zip(CORNERS, r["brake_temp"])) if t > th["brake_c"]["front" if i < 2 else "rear"][1]]
        if hot:
            out.append((2, "brakes_hot", f"Brakes overheating: {', '.join(c for c, _ in hot)} at {max(t for _, t in hot):.0f} °C"))
        pad, low = min(r["pad"]), th["pad_low_mm"]
        if 0 < pad < low:
            out.append((2 if pad < low - 4 else 1, "pads_low", f"Brake pads down to {pad:.1f} mm: change them at the next stop"))
        lof = st["laps_of_fuel"]
        if lof is not None and st["box_in_laps"] == 0 and st["fuel_to_add_l"] != 0:
            out.append((2, "fuel_box", f"Fuel for {lof:.1f} laps: box this lap"))
        elif lof is not None and lof < self.config["fuel_low_laps"]:
            out.append((1, "fuel_low", f"Fuel for {lof:.1f} laps"))
        if r["session"] == 2 and st["fuel_needed_l"] is not None:
            short = st["fuel_to_add_l"]
            out.append((0, "fuel_flag", f"{short:.0f} L short of the flag ({st['laps_to_go']} laps): plan the stop" if short > 0.5
                        else f"Fuel to the flag, {r['fuel'] - st['fuel_needed_l']:.1f} L spare"))
        if sum(r["damage"]) > 0:
            out.append((1, "damage", "Car damaged: think about repairs at the stop"))
        if not r["rain_tyres"] and len(r["rain"]) > 1 and 3 <= r["rain"][1] < len(RAIN):
            out.append((1, "rain_coming", f"{RAIN[r['rain'][1]]} in 10 min on dry tyres: think about wets"))
        pw = st["pit_window"]
        if st["mandatory_left"] and pw and pw["close_lap"] - (r["laps"] + 1) <= 2:
            out.append((1, "window_closing", f"Pit window closes on lap {pw['close_lap']}: {st['mandatory_left']} mandatory stop still owed"))
        if st["lap_ref_ms"] and 0 <= r["stint_left"] < 2 * st["lap_ref_ms"]:
            out.append((2, "stint_limit", f"Driver stint ends in {r['stint_left'] / 1000:.0f} s: box within two laps"))
        if pen:
            short, why = PENALTIES[pen["kind"]]
            out.append((2, "penalty", f"Serve {short} ({why}): {pen['laps_left']} laps left"))
        return [{"id": i, "severity": s, "text": t} for s, i, t in sorted(out, key=lambda x: -x[0])]


class FakePages:
    """A pretend ACC session (a Ferrari 296 on a made-up circuit), for --simulate-acc and the self-test."""

    def __init__(self, lap_ms=60000, clock=time.monotonic, session=2):
        self.lap, self.clock, self.t0, self.session = lap_ms, clock, clock(), session   # session: ACC's kind, 2 race, 1 qualifying

    def _where(self, w, lap):
        """World position (metres) on the made-up circuit, a little off the ideal line, differently every lap."""
        x, z = 800 * math.cos(w), 450 * math.sin(w) + 120 * math.sin(2 * w)
        dx, dz = -800 * math.sin(w), 450 * math.cos(w) + 240 * math.cos(2 * w)
        off = 2.0 * math.sin(3 * w + lap * 1.7) + 0.8 * math.sin(7 * w + lap)
        n = math.hypot(dx, dz) or 1
        return [x - dz / n * off, 0.0, z + dx / n * off]

    def read(self):
        el = (self.clock() - self.t0) * 1000
        t = el + 3.5 * self.lap
        pos, laps, w = (t % self.lap) / self.lap, int(t // self.lap), (t % self.lap) / self.lap * 2 * math.pi
        sp = 175 + 70 * math.sin(w * 6)
        yellow = laps % 7 == 3 and 0.33 < pos < 0.66
        return {
            "status": 2, "session": self.session, "gas": max(0.0, min(1.0, 0.6 + 0.5 * math.sin(w * 6 + 0.4))), "brake": max(0.0, -math.sin(w * 6 + 0.4) - 0.5),
            "fuel": max(0.0, 60 - t / self.lap * 3.1), "gear": 2 + max(0, min(5, int(sp / 45))), "rpm": int(5200 + 2200 * math.sin(w * 25) ** 2),
            "steer": 0.3 * math.sin(w * 5), "speed": sp, "acc_g": [1.2 * math.sin(w * 5), 0.0, 0.8 * math.cos(w * 5)],
            "pressure": [27.6, 27.8, 26.6, 26.8], "core_temp": [84.0, 86.0, 79.0, 81.0], "damage": [0.0] * 5, "tyres_out": 0, "limiter": 0,
            "air": 22.4, "road": 29.1, "brake_temp": [412.0, 405.0, 330.0, 338.0], "clutch": 0.0, "bias": 0.565, "tc_on": 0, "abs_on": 0,
            "susp_damage": [0.0] * 4, "water": 92.0, "brake_press": [0.0] * 4, "front_pad_compound": 0, "rear_pad_compound": 0,
            "pad": [round(x - t / self.lap * k, 2) for x, k in zip([24.1, 24.0, 25.2, 25.3], [0.21, 0.2, 0.12, 0.12])], "disc": [31.8, 31.8, 31.9, 31.9],
            "laps": laps, "position": 7, "cur_ms": int(t % self.lap), "last_ms": self.lap - 500 + 110 * laps + laps * 7919 % 400 if laps else 0,
            "best_ms": self.lap - 120 if laps > 1 else 2147483647, "time_left": 3.2e6 - t, "in_box": 0, "sector": int(pos * 3),
            "compound": "dry_compound", "track_pos": pos, "xyz": self._where(w, laps), "me": 7, "penalty_time": 0.0,
            "flag": 2 if yellow else 0, "penalty": 0, "pit_lane": 0, "mandatory_done": int(laps >= 20), "wind": 2.3, "wind_dir": 3.73,
            "tc": 3, "tc_cut": 2, "map": 0, "abs": 2, "fuel_per_lap": 3.0, "rain_lights": 0, "lights_stage": 0, "exhaust": 610.0, "wiper": 0,
            "stint_total_left": int(3600000 - el), "stint_left": int(3600000 - el), "rain_tyres": 0, "session_index": 0,
            "used_fuel": t / self.lap * 3.1, "delta_ms": int(-214 + 100 * math.sin(w)), "est_lap_ms": self.lap, "valid": int(laps % 5 != 2),
            "fuel_laps": 12.0, "track_status": "", "missing_pits": int(laps < 20) if self.session == 2 else 255, "clock": 14 * 3600 + el / 1000,
            "g_flags": [0, 0, int(yellow), 0, 0, 0, 0, 0], "grip": 2, "rain": [0, 1, 2], "tyre_set": 3,
            "gap_ahead": int(1840 - 90 * (t / self.lap)), "gap_behind": int(950 + 60 * (t / self.lap)),
            "car": "ferrari_296_gt3", "track": "demo_circuit", "name": "Daniel", "sectors": 3, "max_rpm": 8000, "max_fuel": 120.0,
            "fuel_rate": 1.0, "tyre_rate": 1.0, "track_len": 5000.0, "timed": 1, "extra_lap": 0, "pit_open": 1200000, "pit_close": 2400000,
            "online": 0}


def probe():
    """The fields not yet checked in a real session, raw, once a second: compare them with what the game shows."""
    pages = AccPages()
    while True:
        r = pages.read()
        print(f"pit_open={r['pit_open']} pit_close={r['pit_close']} missing_pits={r['missing_pits']} "
              f"track_len={r['track_len']:.1f} timed={r['timed']}   (session {r['session']}, lap {r['laps'] + 1})", flush=True)
        time.sleep(1)


def selftest():
    now = [0.0]
    pages, tel = FakePages(lap_ms=60000, clock=lambda: now[0]), Telemetry(clock=lambda: now[0])
    for _ in range(int(3.2 * 60 * 30)):   # a bit over three laps at 30 Hz
        now[0] += 1 / 30
        raw = pages.read()
        reading = tel.update(raw)
    s = tel.summary(raw)
    car, ses = reading["reading"]["car"], reading["reading"]["session"]
    assert len(tel.debrief) == 3 and tel.debrief[0]["lap_number"] > tel.debrief[1]["lap_number"], tel.debrief
    d = tel.debrief[0]
    assert len(d["sectors_ms"]) == 3 and sum(d["sectors_ms"]) == d["lap_time_ms"], d
    assert abs(s["fuel_per_lap"] - 3.1) < 0.05, s["fuel_per_lap"]
    assert any(a["text"].startswith("Fronts 27.7 psi, 0.7 over") and a["id"] == "press_front" for a in s["advice"]), s["advice"]
    assert s["stint_laps"] >= 3 and 1 <= car["gear"] <= 6 and ses["status"] == "Live" and ses["kind"] == "Race"
    assert any("Pressures out of" in l["text"] for l in d["lines"]) and any("Used 3.10 L" == l["text"] for l in d["lines"]), d["lines"]
    assert [l["n"] for l in s["stint"]] == [d["lap_number"] for d in reversed(tel.debrief)], s["stint"]
    assert [l["n"] for l in tel.laps] == [l["n"] for l in s["stint"]] and len(tel.laps[-1]["s"]) == 3 and not tel.laps[-1]["out"], tel.laps
    assert s["stint"][-1]["pads"][0] < s["stint"][0]["pads"][0] and ses["gap_ahead_ms"] > 0 and reading["reading"]["fixed"]["max_fuel"] == 120
    st = s["strategy"]
    assert abs(st["laps_of_fuel"] - car["fuel_litres"] / s["fuel_per_lap"]) < 1e-9 and "fuel_laps_remaining" not in s
    assert st["laps_src"] == "timed" and st["stops_needed"] == 1 and st["stops_why"] == "fuel" and st["pit_window"]["src"] == "acc"
    assert [o["id"] for o in st["options"]] == ["now_f", "now_ft", "late_f", "late_ft", "win_f", "win_ft"], st["options"]
    assert st["options"][1]["stationary_s"] == 30.0 and st["drive_loss_src"] == "config" and s["best_src"] == "bridge"
    o = {x["id"]: x for x in st["options"]}   # boxing now leaves a second stop; the window opens after the fuel runs out
    assert o["now_f"]["more_stops"] == 1 and o["late_f"]["more_stops"] == 0 and o["late_f"]["reach"] and not o["win_f"]["reach"], st["options"]
    q = Telemetry(clock=lambda: now[0]).strategy(dict(raw, session=1))
    assert q["laps_to_go"] is None and q["options"] == [] and q["box_by_lap"] is not None, q
    traced = [l for l in tel.laps if l["trace"]]
    assert traced and not tel.laps[0]["trace"], tel.laps   # the first lap was joined halfway
    lt = tel.lap_trace(traced[-1]["n"])
    assert len(lt["ch"]["t"]) == NB and abs(lt["ch"]["t"][-1] - lt["ms"]) < 0.01 and len(lt["line"]) > 1000 and tel.lap_trace(999) is None
    cats = {c for _, c, _ in tel.events}
    assert {"LAP", "ENG", "FLAG"} <= cats, cats

    fuel_add, n0 = [0.0], now[0]   # a stop: into the lane for 30 s, 10 s of it stood in the box taking 40 L, then two laps
    while now[0] < n0 + 3 * 60:
        now[0] += 1 / 30
        raw, e = pages.read(), now[0] - n0
        if 20 <= e < 50:
            raw.update(pit_lane=1, in_box=int(30 <= e < 40), speed=0.0 if 30 <= e < 40 else 60.0)
        if e >= 40:
            fuel_add[0] = 40.0
        raw["fuel"] += fuel_add[0]
        if e >= 40:
            raw["tyre_set"] = 4
        tel.update(raw)
    s = tel.summary(raw)
    stop = s["stops"][0]
    assert len(s["stops"]) == 1 and abs(stop["box_ms"] - 10000) < 100 and abs(stop["fuel_added_l"] - 40) < 2 and stop["tyres"], stop
    assert stop["loss_ms"] is not None and s["strategy"]["drive_loss_src"] == "measured" and [x["n"] for x in s["stints"]] == [1, 2], s["stints"]
    assert any(t.startswith("Stop L") and "cost" in t for _, _, t in tel.events), tel.events

    c = clean_config({"thresholds": {"GT4": {"dry_psi": [25, 26.5]}}, "strategy": {"mandatory_stops": 1}})
    assert c["thresholds"]["GT4"]["dry_psi"] == [25.0, 26.5] and c["thresholds"]["GT3"]["dry_psi"] == [26.0, 27.0] and c["strategy"]["mandatory_stops"] == 1
    for bad in ({"thresholds": {"GT5": {}}}, {"strategy": {"tyre_s": 500}}, {"thresholds": {"GT3": {"dry_psi": [27, 26]}}},
                {"strategy": {"pit_window_open_min": 10}}, {"fuel_low_laps": True}, [], {"strategy": {"mandatory_stops": 1.5}}):
        try:
            clean_config(bad)
            raise AssertionError(f"accepted {bad}")
        except ValueError:
            pass
    assert car_class("bmw_m4_gt4") == "GT4" and car_class("porsche_992_gt3_cup") == "GTC" and car_class("ferrari_296_gt3") == "GT3"
    print(f"ok: {len(tel.debrief)} laps debriefed, sectors add up, fuel {s['fuel_per_lap']:.2f} L/lap, {len(s['advice'])} advice lines, "
          f"stop measured ({stop['loss_ms'] / 1000:.1f} s), {len(tel.traces)} lap traces, config checked")


if __name__ == "__main__":
    probe() if "--probe" in sys.argv else selftest()
