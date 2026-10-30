#!/usr/bin/env python3
"""Pit Wall: the race engineer's dashboard for Assetto Corsa Competizione.

Runs on the driver's PC. Reads ACC's shared memory (acc_telemetry.py) and,
when ACC's broadcasting port is on, the timing of the whole field
(acc_broadcast.py). Serves web/index.html plus a Server-Sent-Events stream
the page draws from, and, when the engineer sends a pit plan, sets it in the
game's pit page (acc_pit.py). Sending a plan or changing the shared
thresholds needs the access key printed at start; watching does not.

    python server/bridge.py                          # this PC only; it prints how to open it to the VPN
    python server/bridge.py --http 25.1.2.3:8765     # the driver's Hamachi address: the engineer can connect
    python server/bridge.py --simulate-acc --key demo   # a pretend session and 20-car field, no game needed
    python server/acc_broadcast.py --enable          # once: switch ACC's broadcasting port on (then restart ACC)

Endpoints: GET /events[?hz=5|10|15|30] (SSE), GET /lap?n=N (a whole lap's trace and line),
GET /field/laps?car=N (another car's laps), POST /pit, POST /config and POST /mfd/close (all need X-Pit-Key).

Standard library only.
"""
import argparse
import atexit
import errno
import functools
import hmac
import http.server
import ipaddress
import json
import math
import os
import secrets
import socket
import struct
import sys
import threading
import traceback
import time
import urllib.parse
import webbrowser

import acc_broadcast
import acc_pit
import acc_telemetry

STATE = {"reading": None, "summary": None, "t_reading": 0.0, "t_summary": 0.0, "ver": 0, "pit_job": None, "laps": [], "laps_ver": 0,
         "field": None, "field_ver": 0, "t_field": 0.0, "entries": None, "entries_ver": 0, "log": [], "log_seq": 0, "lap": 0,
         "pit_log": [], "pit_log_ver": 0, "config": acc_telemetry.clean_config({}), "config_ver": 0,
         "bc": {"state": "off", "msg": "", "port": 0}}
LOCK = threading.Lock()
PIT = {"mfd": None, "key": "", "busy": threading.Lock(), "doing": "", "closed_at": 0.0}   # doing: what holds busy, "plan" or "close"
FIELD = {"f": None}    # the acc_broadcast.Field (or FakeField); only touched under LOCK
CTX = {"hint": None, "mandatory": None, "loss_ms": None}   # what the broadcast thread needs from the telemetry thread
TEL = {"t": None}


def _rnd(o):
    """Floats to 3 decimals (and NaN/inf, which JSON cannot carry, to null), recursively; a new object."""
    if isinstance(o, float):
        return round(o, 3) if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _rnd(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_rnd(v) for v in o]
    return o


def log(sev, cat, text, lap=None):
    """One line of the bridge log, stamped with the lap in progress unless lap is given. Call under LOCK."""
    STATE["log_seq"] += 1
    STATE["log"].append({"seq": STATE["log_seq"], "t": round(time.time(), 3), "lap": STATE["lap"] if lap is None else lap,
                         "sev": sev, "cat": cat, "text": text})
    del STATE["log"][:-500]
    STATE["ver"] += 1


def pit_snapshot():
    try:
        if not PIT["mfd"]:
            return None
        s = PIT["mfd"].read()
        s["busy"] = PIT["doing"] if PIT["busy"].locked() else ""   # "plan" or "close" (a Close pit page has no pit_job)
        return s
    except (OSError, ValueError):
        return None


def set_job(**job):
    with LOCK:
        STATE["pit_job"] = dict(job, t=time.time())
        STATE["ver"] += 1


def close_page():
    try:
        PIT["mfd"].press("close")
        PIT["closed_at"] = time.time()
        sev, text = 0, "Cycle MFD sent to close the pit page"   # what was pressed: ACC does not say which MFD page is showing
    except Exception as e:   # not focused, vJoy gone: said in the log rather than lost
        sev, text = 2, f"Could not close the pit page: {e}"
    finally:
        PIT["busy"].release()
    print(text)
    with LOCK:
        log(sev, "PLAN", text)


def run_plan(plan, by):
    set_job(state="running", plan=plan, by=by, only=plan["only"])
    end = {}
    try:
        res = acc_pit.apply(plan, PIT["mfd"])
        end = {"state": "done", "res": res}
        print("pit plan applied:", res)
    except Exception as e:   # anything: the page must hear it rather than see "running" forever
        end = {"state": "error", "msg": str(e)}
        print("pit plan failed:", e)
    finally:
        set_job(plan=plan, by=by, only=plan["only"], **end)
        with LOCK:
            STATE["pit_log"] = (STATE["pit_log"] + [dict(end, t=time.time(), by=by, only=plan["only"], plan=plan)])[-50:]
            STATE["pit_log_ver"] += 1
            log(0 if end["state"] == "done" else 2, "PLAN",
                f"Pit plan ({', '.join(plan['only'])}) " + (f"applied, sent by {by}" if end["state"] == "done" else f"failed, sent by {by}: {end['msg']}"))
        PIT["busy"].release()


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = os.name != "nt"   # on Windows SO_REUSEADDR lets a second bridge share the port

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def field_ext(sim):
    """What the telemetry and the strategy take from the field, read under LOCK: ext for Telemetry.update and race info."""
    f, snap = FIELD["f"], STATE["field"]
    if not f or STATE["bc"].get("state") != "live" or not snap:
        return {}, None, None
    me = next((c for c in snap["cars"] if c["i"] == snap["me"]), None)
    ent = f.ent.get(snap["me"]) or {}
    ext = {"field": True, "car_class": ent.get("class") if ent.get("class") in acc_telemetry.CLASSES else None,
           "track_m": snap["track_m"], "gap_ms": me and me["gap"]}
    return ext, f.race_info(), me


def acc_loop(pages, tel, sim):
    """30 times a second: read ACC, build the reading; every third time the summary too."""
    n, said = 0, None
    while True:
        time.sleep(1 / 30)
        try:
            raw = pages.read()
        except (OSError, ValueError, struct.error):
            continue
        live = raw["status"] in (2, 3)   # live or paused; off and replays have nothing to show
        if live != said:
            print(f"ACC: {raw['car']} at {raw['track']}, {raw['name']} driving" if live else "ACC: waiting for a session on this PC")
            said = live
        if not live:
            continue
        with LOCK:
            try:
                ext, race, me = field_ext(sim)
            except Exception as e:   # a field bug must not stop the telemetry: carry on without the field
                ext, race, me = {}, None, None
                field_err(e)
            tel.config = STATE["config"]
            if sim and me:   # the pretend session: position and gaps from the pretend field, so the KPI strip and standings agree
                behind = next((c for c in STATE["field"]["cars"] if c["pos"] == me["pos"] + 1), None)
                raw.update(position=me["pos"], gap_ahead=me["int"] or 0, gap_behind=(behind or {}).get("int") or 0)
        reading, n = tel.update(raw, ext), n + 1
        summary = tel.summary(raw, race) if n % 3 == 0 else None
        with LOCK:
            f = FIELD["f"]
            if summary and f and ext:
                st = summary["strategy"]
                try:
                    now = next((o for o in st["options"] if o["id"] == "now_f"), None)
                    loss = (now["loss_s"] if now else st["drive_loss_s"]) * 1000
                    st["rejoin"] = f.rejoin(f.me, loss)
                    for o in st["options"]:
                        rj = f.rejoin(f.me, o["loss_s"] * 1000)
                        o["rejoin_pos"] = rj and rj["pos"]
                    CTX["loss_ms"] = loss
                except Exception as e:   # only the rejoin figures stay empty
                    st["rejoin"] = None
                    field_err(e)
            if summary:
                ses = reading["reading"]["session"]
                ml = ses["missing_mandatory_pits"]
                cfg_m = STATE["config"]["strategy"]["mandatory_stops"]
                CTX["mandatory"] = cfg_m if cfg_m is not None else (ml + len(tel.stops) if ml is not None else None)
            CTX["hint"] = {"id": raw["me"], "laps": raw["laps"], "spl": raw["track_pos"], "name": raw["name"], "xyz": raw["xyz"], "kmh": raw["speed"], "coords": raw.get("coords")}
            reading["reading"]["xz"] = [v for i, q in (raw.get("coords") or {}).items() for v in (i, q[0], q[1])]   # every car's position at the reading's rate, [id, x, z, ...]
            STATE["reading"], STATE["t_reading"], STATE["lap"] = _rnd(reading), time.time(), raw["laps"] + 1
            if summary:
                STATE["summary"], STATE["t_summary"] = _rnd(summary), time.time()
            if tel.laps_ver != STATE["laps_ver"]:
                STATE["laps"], STATE["laps_ver"] = _rnd(tel.laps), tel.laps_ver
                lay = None if sim else tel.best_layout()   # the pretend track is not a real one
                if lay:
                    save_layout(raw["track"], lay)
            for sev, cat, text in tel.events:   # a LAP line reports the lap just completed, not the one in progress
                log(sev, cat, text, raw["laps"] if cat == "LAP" else None)
            tel.events.clear()
            STATE["ver"] += 1


TRACK_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tracks")


def track_file(name):
    return os.path.join(TRACK_DIR, "".join(c if c.isalnum() or c in "_-" else "_" for c in str(name).lower())[:60] + ".json")


def load_layout(name):
    try:
        with open(track_file(name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save_layout(name, lay):
    """Keep a track's layout between sessions: replaced only by a better one (valid beats invalid, then faster). Never raises."""
    old = load_layout(name)
    if old and (not old.get("valid"), old.get("ms", 9e9)) <= (not lay["valid"], lay["ms"]):
        return
    try:
        os.makedirs(TRACK_DIR, exist_ok=True)
        with open(track_file(name), "w", encoding="utf-8") as f:
            json.dump(dict(lay, track=name), f, separators=(",", ":"))
    except OSError:
        pass


def field_err(e, said=set()):
    """A field bug: logged once per kind of error (under LOCK), and the caller carries on."""
    k = f"{type(e).__name__}: {e}"[:200]
    if k not in said:
        said.add(k)
        log(2, "FIELD", f"Field timing error, skipped: {k}")
        traceback.print_exc()


def bc_loop(src, field):
    """The broadcast thread: ACC's messages (or the pretend field's) into Field; a snapshot every 250 ms when it changed."""
    last = {"t": 0.0, "key": None}

    def sink(kind, d):
        with LOCK:
            try:
                _sink(kind, d)
            except Exception as e:   # one bad message must not end the thread and leave stale field data marked live
                field_err(e)

    def _sink(kind, d):
        if kind == 2 and time.time() - last["t"] >= 0.25:   # a new batch begins: the last one is whole, and its time still current
            last["t"] = STATE["t_field"] = time.time()
            snap = _rnd(field.snapshot(CTX["hint"], CTX["mandatory"], CTX["loss_ms"]))
            key = json.dumps({k: v for k, v in snap.items() if k != "t"})
            if key != last["key"]:
                last["key"], STATE["field"], STATE["field_ver"] = key, snap, STATE["field_ver"] + 1
                STATE["ver"] += 1
        field.on(kind, d)
        if kind in (4, 5, 6):
            ent = _rnd(field.entries())
            if ent != STATE["entries"]:
                STATE["entries"], STATE["entries_ver"] = ent, STATE["entries_ver"] + 1
                STATE["ver"] += 1
        for e in field.events:
            log(*e)
        field.events.clear()

    try:
        src.run(sink)
    except Exception as e:   # the page then says the field stopped instead of showing it frozen
        src.state.update(state="error", msg=f"Broadcasting client stopped: {e}")


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def end_headers(self):
        # Browsers otherwise keep the page's scripts a while and show an old version after an update; this makes them ask
        # each time, and an unchanged file is answered with a short 304.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def reply(self, code, text, kind="text/plain; charset=utf-8"):
        body = text.encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def reply_json(self, code, obj):
        self.reply(code, json.dumps(_rnd(obj)), "application/json")

    def host_ok(self):
        """Only requests addressed to an IP or localhost: a page on some other site that rebinds its DNS name
        to this PC sends its own name as Host, and is turned away."""
        h = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        try:
            ipaddress.ip_address(h)
            return True
        except ValueError:
            return h == "localhost"

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= 4096:
            raise ValueError("bad request")
        return json.loads(self.rfile.read(n))   # json errors are ValueErrors too

    def do_POST(self):
        if not self.host_ok():
            return self.reply(403, "use the PC's IP address")
        if self.path not in ("/pit", "/config", "/mfd/close"):
            return self.reply(404, "not found")
        if not hmac.compare_digest(self.headers.get("X-Pit-Key", "").encode(), PIT["key"].encode()):
            return self.reply(403, "wrong or missing access key")
        if self.path == "/mfd/close":   # take the pit page off the driver's screen (ACC's Cycle MFD)
            if not PIT["mfd"]:
                return self.reply(503, "pit control is not available on this PC")
            snap = pit_snapshot()   # outside a live session Cycle MFD would only move the driver's MFD to another page
            if not snap or snap.get("status") != "live":
                return self.reply(409, "ACC is not live on the driver's PC")
            if not PIT["busy"].acquire(blocking=False):
                return self.reply(409, "a plan is still being applied" if PIT["doing"] == "plan" else "the pit page is already being closed")
            if time.time() - PIT["closed_at"] < 2:   # a second Cycle MFD would move the driver's MFD on to another page
                PIT["busy"].release()
                return self.reply(409, "the pit page was just closed; wait 2 s")
            PIT["doing"] = "close"
            threading.Thread(target=close_page, daemon=True).start()
            return self.reply(202, "closing")
        if self.path == "/config":
            try:
                raw = self.body()
                with LOCK:
                    cfg = acc_telemetry.clean_config(raw, STATE["config"])
                    STATE["config"], STATE["config_ver"] = cfg, STATE["config_ver"] + 1
                    log(0, "CFG", f"Thresholds changed by {self.client_address[0]}: {', '.join(raw)}")
            except (ValueError, TypeError) as e:
                return self.reply(400, str(e))
            return self.reply_json(200, cfg)
        if not PIT["mfd"]:
            return self.reply(503, "pit control is not available on this PC")
        try:
            plan = acc_pit.clean(self.body())
        except ValueError as e:
            return self.reply(400, str(e))
        if not PIT["busy"].acquire(blocking=False):
            return self.reply(409, "a plan is still being applied" if PIT["doing"] == "plan" else "the pit page is being closed")
        PIT["doing"] = "plan"
        threading.Thread(target=run_plan, args=(plan, self.client_address[0]), daemon=True).start()
        self.reply(202, "applying")

    def do_GET(self):
        if not self.host_ok():
            return self.reply(403, "use the PC's IP address")
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/events":
            return self.events(q)
        if u.path in ("/lap", "/field/laps"):
            name, hi = ("n", 99999) if u.path == "/lap" else ("car", 65535)
            try:
                v = int(q.get(name, [""])[0])
                if not (1 if name == "n" else 0) <= v <= hi:
                    raise ValueError
            except ValueError:
                return self.reply(400, f"{name} must be a whole number")
            if u.path == "/lap":
                lap = TEL["t"] and TEL["t"].lap_trace(v)
                return self.reply_json(200, lap) if lap else self.reply_json(404, {})
            with LOCK:
                laps = FIELD["f"].car_laps(v) if FIELD["f"] else []
            return self.reply_json(200, {"car": v, "laps": laps})
        if u.path == "/track":   # the saved layout of the track being driven: the map needs no lap of its own
            with LOCK:
                name = (STATE["reading"] or {}).get("reading", {}).get("fixed", {}).get("track")
            lay = name and load_layout(name)
            return self.reply_json(200, lay) if lay else self.reply_json(404, {})
        if self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def events(self, q):
        hz = q.get("hz", ["30"])[0]
        gap = 1 / (int(hz) if hz in ("5", "10", "15", "30") else 30)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        # what this client was last sent; -1: everything on the first message
        sent = {"ver": -1, "summary": None, "laps": -1, "field": -1, "slow": -1, "entries": -1, "log": 0, "pit_log": -1, "config": -1}
        last_send = last_beat = 0.0
        try:
            while True:
                now = time.time()
                with LOCK:
                    changed = STATE["ver"] != sent["ver"]
                    if not ((changed and now - last_send >= gap) or now - last_beat > 1.0):
                        snap = None
                    else:
                        snap = dict(STATE)
                        snap["new_log"] = [l for l in STATE["log"] if l["seq"] > sent["log"]]
                        field = None
                        if snap["field"] and snap["field_ver"] != sent["field"]:
                            slow, seq = FIELD["f"].slow_since(sent["slow"])
                            field = dict(snap["field"], slow=_rnd(slow))
                            sent["slow"] = seq
                        snap["bc"] = dict(STATE["bc"])
                if snap is None:
                    time.sleep(0.01)
                    continue
                payload = {   # each key only when it changed for this client; the reading at most hz times a second
                    "reading": snap["reading"],
                    "summary": snap["summary"] if snap["t_summary"] != sent["summary"] else None,
                    "laps": snap["laps"] if snap["laps_ver"] != sent["laps"] else None,
                    "field": field,
                    "entries": snap["entries"] if snap["entries_ver"] != sent["entries"] else None,
                    "log": snap["new_log"] or None,
                    "pit_log": snap["pit_log"] if snap["pit_log_ver"] != sent["pit_log"] else None,
                    "config": snap["config"] if snap["config_ver"] != sent["config"] else None,
                    "reading_age_ms": int((now - snap["t_reading"]) * 1000) if snap["t_reading"] else None,
                    "summary_age_ms": int((now - snap["t_summary"]) * 1000) if snap["t_summary"] else None,
                    "field_age_ms": int((now - snap["t_field"]) * 1000) if snap["t_field"] else None,
                    "bc": snap["bc"],
                    "pit": _rnd(pit_snapshot()),
                    "pit_job": _rnd(snap["pit_job"]),
                }
                self.wfile.write(b"data: " + json.dumps(payload).encode() + b"\n\n")
                self.wfile.flush()
                sent.update(ver=snap["ver"], summary=snap["t_summary"], laps=snap["laps_ver"], entries=snap["entries_ver"],
                            pit_log=snap["pit_log_ver"], config=snap["config_ver"])
                if field is not None:
                    sent["field"] = snap["field_ver"]
                if snap["new_log"]:
                    sent["log"] = snap["new_log"][-1]["seq"]
                last_send = last_beat = now
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return


def start_field(args, pages):
    """Field timing: the broadcasting client on 127.0.0.1 (or the pretend field), in its own thread. Prints what it did."""
    off = lambda msg: (STATE.update(bc={"state": "off", "msg": msg, "port": 0}), print(msg))
    if args.broadcast_port == 0:
        return off("Field timing off (--broadcast-port 0).")
    if args.simulate_acc:
        if pages is None:
            return off("Field timing off: no simulated session.")
        f = acc_broadcast.FakeField(pages, args.sim_session)
        src = f
    else:
        try:
            cfg = acc_broadcast.read_config()
        except (OSError, ValueError) as e:
            cfg = {"port": 0, "password": "", "command_password": ""}
            if args.broadcast_port is None:
                return off(f"Field timing off: could not read broadcasting.json ({e}). Run  python server/acc_broadcast.py --enable  then restart ACC.")
        port = args.broadcast_port if args.broadcast_port is not None else cfg["port"]
        if not port:
            return off("Field timing off: broadcasting.json has updListenerPort 0. Run  python server/acc_broadcast.py --enable  then restart ACC.")
        pw = args.broadcast_password if args.broadcast_password is not None else cfg["password"]
        src, f = acc_broadcast.Client(port, pw), acc_broadcast.Field()   # no command password: Pit Wall only reads
        atexit.register(src.close)
    FIELD["f"], STATE["bc"] = f, src.state
    threading.Thread(target=bc_loop, args=(src, f), daemon=True).start()
    print("Field timing: " + ("simulated 20-car field" + (" (qualifying)" if args.sim_session == "quali" else "")
                              if args.simulate_acc else f"listening to ACC's broadcasting on 127.0.0.1:{src.port}"))


def main():
    for s in (sys.stdout, sys.stderr):   # line by line also when redirected to a file (None under pythonw)
        try:
            s.reconfigure(line_buffering=True)
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--http", default="127.0.0.1:8765", help="where the page is served: this PC's VPN address and a port (default 127.0.0.1:8765, this PC only)")
    ap.add_argument("--no-browser", action="store_true", help="do not open the page automatically")
    ap.add_argument("--key", default=secrets.token_urlsafe(16), help="access key for sending pit plans and changing thresholds (default: a new one each start)")
    ap.add_argument("--pit-key", default="p", help="ACC's key for the pitstop MFD page (default p)")
    ap.add_argument("--key-ms", type=int, default=40, help="how long each key is held and released, ms (default 40)")
    ap.add_argument("--vjoy", type=int, nargs="?", const=1, help="press the MFD through vJoy device N (default 1) instead of the keyboard")
    ap.add_argument("--simulate-acc", action="store_true", help="a pretend session, 20-car field and pit page instead of the game, to try the dashboard")
    ap.add_argument("--broadcast-port", type=int, help="ACC's broadcasting UDP port for field timing, on 127.0.0.1 only "
                                                       "(default: updListenerPort in broadcasting.json; 0 turns field timing off, also with --simulate-acc)")
    ap.add_argument("--broadcast-password", help="connectionPassword for ACC's broadcasting (default: the one in broadcasting.json)")
    ap.add_argument("--sim-session", choices=("race", "quali"), default="race", help="with --simulate-acc: a race (default) or qualifying, ordered by best lap")
    ap.add_argument("--sim-track", choices=("demo", *acc_telemetry.SIM_TRACKS), default="demo", metavar="TRACK",
                    help="with --simulate-acc: the made-up circuit (default, 1:00 laps) or a real layout at a GT3's pace: "
                         + ", ".join(acc_telemetry.SIM_TRACKS))
    ap.add_argument("--sim-speed", type=float, default=1.0, help="with --simulate-acc: run the pretend session N times faster (e.g. 8)")
    args = ap.parse_args()
    hh, _, hp = args.http.rpartition(":")
    if not hh or not hp.isdigit():
        ap.error("--http must be ADDRESS:PORT, e.g. --http 25.1.2.3:8765")

    PIT["key"] = args.key
    try:
        PIT["mfd"] = acc_pit.FakeMfd() if args.simulate_acc else acc_pit.AccMfd(args.pit_key, args.key_ms, args.vjoy)
    except (OSError, AttributeError, ValueError) as e:   # not Windows (no named mappings / WinDLL), or a bad --pit-key
        print(f"pit control off: {e}")

    pages = None
    try:
        t0, k = time.monotonic(), max(0.1, args.sim_speed)
        clock = (lambda: t0 + (time.monotonic() - t0) * k) if args.simulate_acc else time.monotonic   # the pretend session's own time
        pages = (acc_telemetry.FakePages(session=1 if args.sim_session == "quali" else 2, clock=clock, track=args.sim_track)
                 if args.simulate_acc else acc_telemetry.AccPages())
        TEL["t"] = acc_telemetry.Telemetry(STATE["config"], clock=clock)
        threading.Thread(target=acc_loop, args=(pages, TEL["t"], args.simulate_acc), daemon=True).start()
    except (OSError, AttributeError, TypeError) as e:   # not Windows: no named shared memory
        print(f"telemetry off: {e}")
    start_field(args, pages)

    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
    try:
        server = Server((hh, int(hp)), functools.partial(Handler, directory=here))
    except OSError as e:   # 10049: an address of another PC (often the other person's Hamachi address); 10048: port in use; 10013: reserved by Windows
        mine = sorted({a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)})
        print(f"Cannot serve on {args.http}: {e.strerror or e}")
        if getattr(e, "winerror", None) in (10048, 10013) or e.errno in (98, errno.EADDRINUSE, errno.EACCES):
            print(f"Port {hp} is in use or reserved: another bridge or program has it, or Windows reserves it "
                  f"(netsh int ipv4 show excludedportrange tcp). Pass another port, e.g. --http {hh}:8766")
        elif getattr(e, "winerror", None) == 10049 or e.errno == errno.EADDRNOTAVAIL:
            print("That address is not one of this PC's. Use this PC's own VPN address (Hamachi's is 25.x.x.x):")
            rest = " ".join(a for a in sys.argv[1:] if a not in (args.http, "--http") and not a.startswith("--http="))
            for ip in sorted(mine, key=lambda ip: not ip.startswith("25.")):
                print(f"    python server/bridge.py --http {ip}:{hp} {rest}".rstrip())
        sys.exit(1)
    print(f"Pit Wall on {args.http}   (Ctrl+C to stop)")
    if hh in ("127.0.0.1", "localhost"):
        ips = sorted({a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)} - {"127.0.0.1"})
        print("Only this PC can open it. For the engineer, start it on your VPN address (Hamachi's is 25.x.x.x):")
        for ip in sorted(ips, key=lambda ip: not ip.startswith("25.")):
            print(f"    python server/bridge.py --http {ip}:{hp}")
    else:
        print(f"Engineer, open:   http://{hh}:{hp}/?key={args.key}")
    if not args.no_browser:
        webbrowser.open(f"http://{'127.0.0.1' if hh == '0.0.0.0' else hh}:{hp}/?key={args.key}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
