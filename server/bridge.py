#!/usr/bin/env python3
"""Pit Wall: the race engineer's dashboard for Assetto Corsa Competizione.

Runs on the driver's PC. Reads ACC's shared memory (acc_telemetry.py), serves
web/index.html plus a Server-Sent-Events stream the page draws from, and,
when the engineer sends a pit plan, sets it in the game's pit page
(acc_pit.py). Sending a plan needs the access key printed at start; watching
does not.

    python server/bridge.py                          # http://0.0.0.0:8765, reachable over the VPN
    python server/bridge.py --simulate-acc --key demo   # a pretend session, no game needed

Standard library only.
"""
import argparse
import functools
import hmac
import http.server
import json
import os
import secrets
import socket
import struct
import threading
import time
import webbrowser

import acc_pit
import acc_telemetry

STATE = {"reading": None, "summary": None, "t_reading": 0.0, "t_summary": 0.0, "ver": 0, "pit_job": None}
LOCK = threading.Lock()
PIT = {"mfd": None, "key": "", "busy": threading.Lock()}


def pit_snapshot():
    try:
        return PIT["mfd"].read() if PIT["mfd"] else None
    except (OSError, ValueError):
        return None


def set_job(**job):
    with LOCK:
        STATE["pit_job"] = dict(job, t=time.time())
        STATE["ver"] += 1


def run_plan(plan):
    set_job(state="running", plan=plan)
    try:
        res = acc_pit.apply(plan, PIT["mfd"])
        set_job(state="done", plan=plan, res=res)
        print("pit plan applied:", res)
    except Exception as e:   # anything: the page must hear it rather than see "running" forever
        set_job(state="error", plan=plan, msg=str(e))
        print("pit plan failed:", e)
    finally:
        PIT["busy"].release()


def acc_loop(pages, tel):
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
        reading, n = tel.update(raw), n + 1
        summary = tel.summary(raw) if n % 3 == 0 else None
        with LOCK:
            STATE["reading"], STATE["t_reading"] = reading, time.time()
            if summary:
                STATE["summary"], STATE["t_summary"] = summary, time.time()
            STATE["ver"] += 1


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, code, text):
        body = text.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/pit":
            return self.reply(404, "not found")
        if not hmac.compare_digest(self.headers.get("X-Pit-Key", "").encode(), PIT["key"].encode()):
            return self.reply(403, "wrong or missing access key")
        if not PIT["mfd"]:
            return self.reply(503, "pit control is not available on this PC")
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= 4096:
            return self.reply(400, "bad request")
        try:
            plan = acc_pit.clean(json.loads(self.rfile.read(n)))
        except ValueError as e:   # json errors are ValueErrors too
            return self.reply(400, str(e))
        if not PIT["busy"].acquire(blocking=False):
            return self.reply(409, "a plan is still being applied")
        threading.Thread(target=run_plan, args=(plan,), daemon=True).start()
        self.reply(202, "applying")

    def do_GET(self):
        if self.path.startswith("/events"):
            return self.events()
        if self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def events(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        last_ver, last_beat = -1, 0.0
        try:
            while True:
                with LOCK:
                    snap = dict(STATE)
                now = time.time()
                if snap["ver"] != last_ver or now - last_beat > 1.0:
                    payload = {
                        "reading": snap["reading"],
                        "summary": snap["summary"],
                        "reading_age_ms": int((now - snap["t_reading"]) * 1000) if snap["t_reading"] else None,
                        "summary_age_ms": int((now - snap["t_summary"]) * 1000) if snap["t_summary"] else None,
                        "pit": pit_snapshot(),
                        "pit_job": snap["pit_job"],
                    }
                    self.wfile.write(b"data: " + json.dumps(payload).encode() + b"\n\n")
                    self.wfile.flush()
                    last_ver, last_beat = snap["ver"], now
                else:
                    time.sleep(0.01)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--http", default="0.0.0.0:8765", help="where the page is served (default 0.0.0.0:8765: this PC and the VPN)")
    ap.add_argument("--no-browser", action="store_true", help="do not open the page automatically")
    ap.add_argument("--key", default=secrets.token_urlsafe(6), help="access key for sending pit plans (default: a new one each start)")
    ap.add_argument("--pit-key", default="p", help="ACC's key for the pitstop MFD page (default p)")
    ap.add_argument("--key-ms", type=int, default=40, help="how long each key is held and released, ms (default 40)")
    ap.add_argument("--simulate-acc", action="store_true", help="a pretend session and pit page instead of the game, to try the dashboard")
    args = ap.parse_args()

    PIT["key"] = args.key
    try:
        PIT["mfd"] = acc_pit.FakeMfd() if args.simulate_acc else acc_pit.AccMfd(args.pit_key, args.key_ms)
    except (OSError, AttributeError, ValueError) as e:   # not Windows (no named mappings / WinDLL), or a bad --pit-key
        print(f"pit control off: {e}")

    try:
        pages = acc_telemetry.FakePages() if args.simulate_acc else acc_telemetry.AccPages()
        threading.Thread(target=acc_loop, args=(pages, acc_telemetry.Telemetry()), daemon=True).start()
    except (OSError, AttributeError, TypeError) as e:   # not Windows: no named shared memory
        print(f"telemetry off: {e}")

    hh, hp = args.http.rsplit(":", 1)
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
    server = http.server.ThreadingHTTPServer((hh, int(hp)), functools.partial(Handler, directory=here))
    hosts = sorted({a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)} | {"127.0.0.1"}) if hh == "0.0.0.0" else [hh]
    print(f"Pit Wall on {args.http}   (Ctrl+C to stop)")
    print("Engineer, open one of these (the Hamachi one is 25.x.x.x):")
    for h in hosts:
        print(f"    http://{h}:{hp}/?key={args.key}")
    if not args.no_browser:
        webbrowser.open(f"http://{'127.0.0.1' if hh == '0.0.0.0' else hh}:{hp}/?key={args.key}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
