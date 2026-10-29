#!/usr/bin/env python3
"""ACC telemetry for Pit Wall, run on the driver's PC.

Reads Assetto Corsa Competizione's three shared-memory pages (physics,
graphics, static) and turns them into what the dashboard draws: a 30 Hz
reading of the car and session, and a 10 Hz summary with the engineer's
advice and a debrief of the last laps.

Offsets follow Kunos' "ACC Shared Memory Documentation" 1.8.12.

    python server/acc_telemetry.py      # self-test: simulated laps through the whole pipeline
"""
import math
import mmap
import struct
import time

SESSIONS = {0: "Practice", 1: "Qualifying", 2: "Race", 3: "Hotlap", 4: "Time attack", 7: "Hotstint", 8: "Superpole"}
STATUS = ["Off", "Replay", "Live", "Pause"]
CORNERS = ["FL", "FR", "RL", "RR"]
DRY_PSI, WET_PSI = (26.0, 27.0), (29.5, 31.0)   # ponytail: GT3 hot-pressure windows; GT4 and the Cup cars differ, make them per class when needed
BRAKE_HOT_C, PAD_LOW_MM, TYRE_COLD_C = 750, 12, 65


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
            "pad": _f(p, 740, 4), "disc": _f(p, 756, 4),
            "laps": _i(g, 132), "position": _i(g, 136), "cur_ms": _i(g, 140), "last_ms": _i(g, 144), "best_ms": _i(g, 148),
            "time_left": _f(g, 152), "sector": _i(g, 164), "compound": _w(g, 176), "track_pos": _f(g, 248),
            "xyz": _f(g, 256 + 12 * car, 3), "pit_lane": _i(g, 1236), "wind": _f(g, 1248), "wind_dir": _f(g, 1252),
            "tc": _i(g, 1268), "tc_cut": _i(g, 1272), "map": _i(g, 1276), "abs": _i(g, 1280), "fuel_per_lap": _f(g, 1284),
            "rain_tyres": _i(g, 1316), "delta_ms": _i(g, 1360), "valid": _i(g, 1408), "fuel_laps": _f(g, 1412),
            "car": _w(s, 68), "track": _w(s, 134), "name": f"{_w(s, 200)} {_w(s, 266)}".strip(),
            "sectors": _i(s, 400), "max_rpm": _i(s, 412),
        }


class Telemetry:
    """Raw page values in, the dashboard's reading and summary out. Keeps what needs history: laps, sectors, stint, fuel."""

    def __init__(self):
        self.seq, self.prev, self.splits, self.debrief = 0, None, [], []
        self.stint_start = self.fuel_at_line = None
        self.lap_fuel, self.lap_brake_max, self.best = [], 0.0, None

    def update(self, r):
        self.seq += 1
        p = self.prev
        if self.stint_start is None or r["pit_lane"]:
            self.stint_start = r["laps"]
        if p and r["sector"] > p["sector"]:
            self.splits.append(r["cur_ms"])
        self.lap_brake_max = max(self.lap_brake_max, *r["brake_temp"])
        if p and r["laps"] > p["laps"]:
            self._lap_done(r, p)
        self.prev = r
        return {"what": "pit-wall/session", "sequence": self.seq, "from": r["name"], "reading": {
            "car": {
                "gear": r["gear"] - 1, "speed_kmh": r["speed"], "rpm": r["rpm"], "throttle": r["gas"], "brake": r["brake"],
                "clutch": r["clutch"], "reference_delta_s": r["delta_ms"] / 1000, "fuel_litres": r["fuel"],
                "pit_limiter": bool(r["limiter"]), "tyres_off_track": r["tyres_out"], "abs_in_action": r["abs_on"], "tc_in_action": r["tc_on"],
                "tyre_pressure_psi": r["pressure"], "tyre_core_temp_c": r["core_temp"], "brake_temp_c": r["brake_temp"],
                "brake_pad_mm": r["pad"], "brake_disc_mm": r["disc"], "brake_bias": r["bias"] * 100, "tc_level": r["tc"],
                "abs_level": r["abs"], "acc_g": r["acc_g"], "steer_angle": r["steer"], "damage": r["damage"],
                "air_temp_c": r["air"], "road_temp_c": r["road"]},
            "session": {
                "current_lap_ms": r["cur_ms"], "last_lap_ms": r["last_ms"], "best_lap_ms": r["best_ms"], "lap_is_valid": bool(r["valid"]),
                "current_sector": r["sector"], "in_pit_lane": bool(r["pit_lane"]), "compound": r["compound"], "tc_cut": r["tc_cut"],
                "engine_map": r["map"] + 1, "completed_laps": r["laps"], "total_laps": 0, "session_time_left_ms": max(0, r["time_left"]),
                "kind": SESSIONS.get(r["session"], "Session"), "status": STATUS[r["status"]] if 0 <= r["status"] < 4 else "Off",
                "position": r["position"], "wind_speed_kmh": r["wind"] * 3.6, "wind_direction_deg": math.degrees(r["wind_dir"]) % 360,
                "surface_grip": 0, "fuel_per_lap": self.fuel_per_lap(r), "track_position": r["track_pos"], "car_position_m": r["xyz"]},
            "fixed": {"car_model": r["car"], "track": r["track"], "track_config": "", "driver_name": r["name"],
                      "sector_count": r["sectors"] or 3, "max_rpm": r["max_rpm"]},
            "capabilities": {"tyre_edge_temps": False, "tyre_wear": False, "sectors": True}}}

    def fuel_per_lap(self, r):
        """Our own figure, the last three green laps, once there are any; ACC's estimate until then."""
        return sum(self.lap_fuel[-3:]) / len(self.lap_fuel[-3:]) if self.lap_fuel else r["fuel_per_lap"]

    def _lap_done(self, r, p):
        ms, lines = r["last_ms"], []
        n = len(self.splits) + 1 == (r["sectors"] or 3)
        sectors = [b - a for a, b in zip([0] + self.splits, self.splits + [ms])] if n and ms > 0 else []
        green = not p["pit_lane"] and not r["pit_lane"] and self.fuel_at_line is not None
        if green and self.fuel_at_line - p["fuel"] > 0.2:
            self.lap_fuel.append(self.fuel_at_line - p["fuel"])
            lines.append((0, f"Used {self.lap_fuel[-1]:.2f} L"))
        if not p["valid"]:
            lines.append((1, "Lap invalid: track limits"))
        elif 0 < ms and (self.best is None or ms < self.best):
            self.best = ms
            lines.append((0, "Best lap so far"))
        elif self.best:
            lines.append((0, f"{(ms - self.best) / 1000:+.3f} s off the best lap"))
        lo, hi = WET_PSI if r["rain_tyres"] else DRY_PSI
        psi = r["pressure"]
        out = [f"{c} {v:.1f}" for c, v in zip(CORNERS, psi) if not lo <= v <= hi]
        lines.append((1, f"Pressures out of {lo}-{hi} psi at the line: {', '.join(out)}") if out else (0, "Pressures in the window"))
        if self.lap_brake_max > BRAKE_HOT_C:
            lines.append((1, f"Brakes peaked at {self.lap_brake_max:.0f} °C"))
        self.debrief.insert(0, {"lap_number": r["laps"], "lap_time_ms": ms, "sectors_ms": sectors,
                                "lines": [{"severity": s, "text": t} for s, t in lines]})
        del self.debrief[3:]
        self.splits, self.lap_brake_max, self.fuel_at_line = [], 0.0, r["fuel"]

    def summary(self, r):
        fpl = self.fuel_per_lap(r)
        return {"what": "pit-wall/summary", "fuel_per_lap": fpl, "fuel_laps_remaining": r["fuel"] / fpl if fpl > 0 else r["fuel_laps"],
                "stint_laps": r["laps"] - (self.stint_start or 0), "max_rpm": r["max_rpm"], "advice": self.advice(r, fpl),
                "debrief": self.debrief}

    def advice(self, r, fpl):
        out, moving = [], r["speed"] > 60 and not r["pit_lane"]
        lo, hi = WET_PSI if r["rain_tyres"] else DRY_PSI
        if moving and r["laps"] - (self.stint_start or 0) >= 1:   # hot pressures only mean something once the tyres are up to temperature
            for name, ix in (("Fronts", (0, 1)), ("Rears", (2, 3))):
                v = sum(r["pressure"][i] for i in ix) / 2
                if not lo <= v <= hi:
                    out.append((1, f"{name} {v:.1f} psi, {abs(v - (hi if v > hi else lo)):.1f} {'over' if v > hi else 'under'} the {lo}-{hi} window: "
                                   f"{'lower' if v > hi else 'raise'} them at the next stop"))
        cold = [c for c, t in zip(CORNERS, r["core_temp"]) if moving and 0 < t < TYRE_COLD_C]
        if cold:
            out.append((0, f"Tyres still cold: {', '.join(cold)}"))
        hot = [c for c, t in zip(CORNERS, r["brake_temp"]) if t > BRAKE_HOT_C]
        if hot:
            out.append((2, f"Brakes overheating: {', '.join(hot)} at {max(r['brake_temp']):.0f} °C"))
        pad = min(r["pad"])
        if 0 < pad < PAD_LOW_MM:
            out.append((2 if pad < PAD_LOW_MM - 4 else 1, f"Brake pads down to {pad:.1f} mm: change them at the next stop"))
        laps_left = r["fuel"] / fpl if fpl > 0 else 0
        if fpl > 0 and laps_left < 2:
            out.append((2, f"Fuel for {laps_left:.1f} laps: box this lap"))
        elif fpl > 0 and laps_left < 4:
            out.append((1, f"Fuel for {laps_left:.1f} laps"))
        lap = self.best or (r["last_ms"] if 0 < r["last_ms"] < 3.6e6 else 0)
        if r["session"] == 2 and fpl > 0 and lap and r["time_left"] > 0:
            to_go = math.ceil(r["time_left"] / lap) + 1                # the lap running when the clock hits zero
            short = to_go * fpl - r["fuel"]
            out.append((0, f"{short:.0f} L short of the flag ({to_go} laps): plan the stop" if short > 0.5
                        else f"Fuel to the flag, {-short:.1f} L spare"))
        if sum(r["damage"]) > 0:
            out.append((1, "Car damaged: think about repairs at the stop"))
        return [{"severity": s, "text": t} for s, t in sorted(out, key=lambda x: -x[0])]


class FakePages:
    """A pretend ACC session (Ferrari 296 at the Nürburgring 24h), for --simulate-acc and the self-test."""

    def __init__(self, lap_ms=120000, clock=time.monotonic):
        self.lap, self.clock, self.t0 = lap_ms, clock, clock()

    def read(self):
        t = (self.clock() - self.t0) * 1000 + 3.5 * self.lap
        pos, laps, w = (t % self.lap) / self.lap, int(t // self.lap), (t % self.lap) / self.lap * 2 * math.pi
        sp = 175 + 70 * math.sin(w * 6)
        return {
            "status": 2, "session": 2, "gas": max(0.0, min(1.0, 0.6 + 0.5 * math.sin(w * 6 + 0.4))), "brake": max(0.0, -math.sin(w * 6 + 0.4) - 0.5),
            "fuel": max(0.0, 60 - t / self.lap * 3.1), "gear": 2 + max(0, min(5, int(sp / 45))), "rpm": int(5200 + 2200 * math.sin(w * 25) ** 2),
            "steer": 0.3 * math.sin(w * 5), "speed": sp, "acc_g": [1.2 * math.sin(w * 5), 0.0, 0.8 * math.cos(w * 5)],
            "pressure": [27.6, 27.8, 26.6, 26.8], "core_temp": [84.0, 86.0, 79.0, 81.0], "damage": [0.0] * 5, "tyres_out": 0, "limiter": 0,
            "air": 22.4, "road": 29.1, "brake_temp": [412.0, 405.0, 330.0, 338.0], "clutch": 0.0, "bias": 0.565, "tc_on": 0, "abs_on": 0,
            "pad": [24.1, 24.0, 25.2, 25.3], "disc": [31.8, 31.8, 31.9, 31.9],
            "laps": laps, "position": 7, "cur_ms": int(t % self.lap), "last_ms": self.lap - 300 + laps * 7919 % 900 if laps else 0,
            "best_ms": self.lap - 412 if laps > 1 else 2147483647, "time_left": 3.2e6 - t, "sector": int(pos * 3), "compound": "dry_compound",
            "track_pos": pos, "xyz": [0.0, 0.0, 0.0], "pit_lane": 0, "wind": 2.3, "wind_dir": 3.73, "tc": 3, "tc_cut": 2, "map": 0, "abs": 2,
            "fuel_per_lap": 3.0, "rain_tyres": 0, "delta_ms": int(-214 + 100 * math.sin(w)), "valid": 1, "fuel_laps": 12.0,
            "car": "ferrari_296_gt3", "track": "nurburgring_24h", "name": "Daniel", "sectors": 3, "max_rpm": 8000}


def selftest():
    now = [0.0]
    pages, tel = FakePages(lap_ms=60000, clock=lambda: now[0]), Telemetry()
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
    assert any(a["text"].startswith("Fronts 27.7 psi, 0.7 over") for a in s["advice"]), s["advice"]
    assert s["stint_laps"] >= 3 and 1 <= car["gear"] <= 6 and ses["status"] == "Live" and ses["kind"] == "Race"
    assert any("Pressures out of" in l["text"] for l in d["lines"]) and any("Used 3.10 L" == l["text"] for l in d["lines"]), d["lines"]
    print(f"ok: {len(tel.debrief)} laps debriefed, sectors add up, fuel {s['fuel_per_lap']:.2f} L/lap, {len(s['advice'])} advice lines")


if __name__ == "__main__":
    selftest()
