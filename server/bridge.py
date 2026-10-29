#!/usr/bin/env python3
"""Engineer web view for Pro Engineer, with pit stop control for ACC.

Listens on the UDP port the driver's copy sends to (both the 30 Hz session
reading and the 10 Hz summary with the engineer's advice), and serves
web/index.html plus a Server-Sent-Events stream the page draws from.

Run on the driver's PC it also reads ACC's pit page (MFD) and, when the
engineer sends a plan, sets it in the game - see acc_pit.py. Sending a plan
needs the access key printed at start; watching does not.

    python server/bridge.py --udp 127.0.0.1:9001 --http 0.0.0.0:8765   # on the driver's PC
    python server/bridge.py                  # UDP 0.0.0.0:9001 -> http://127.0.0.1:8765
    python server/bridge.py --udp 0.0.0.0:9005 --http 127.0.0.1:8080 --no-browser

Standard library only. Close the terminal app's LAN listener first (O on the
LAN tab) - two programs cannot own the same UDP port.
"""
import argparse
import functools
import hmac
import http.server
import json
import os
import secrets
import socket
import threading
import time
import webbrowser

import acc_pit

STATE = {"reading": None, "summary": None, "t_reading": 0.0, "t_summary": 0.0, "peer": "", "ver": 0, "pit_job": None}
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


def udp_loop(sock):
    while True:
        data, peer = sock.recvfrom(65535)
        try:
            msg = json.loads(data)
        except ValueError:
            continue
        if not isinstance(msg, dict):
            continue
        with LOCK:
            if msg.get("what") == "pro-engineer/session":
                STATE["reading"], STATE["t_reading"] = msg, time.time()
            elif msg.get("magic") == "acpe":
                STATE["summary"], STATE["t_summary"] = msg, time.time()
            else:
                continue
            STATE["peer"] = peer[0]
            STATE["ver"] += 1
            STATE["rx"] = STATE.get("rx", 0) + 1


def report_loop():
    """Every 5 s say whether anything is arriving - the fastest way to tell a firewall from a page problem."""
    seen = 0
    while True:
        time.sleep(5)
        with LOCK:
            n, peer = STATE.get("rx", 0), STATE["peer"]
        if n == seen:
            print("nothing received in the last 5 s - is the driver sharing? is Python allowed through the firewall on ALL network types?")
        else:
            print(f"receiving: {(n - seen) / 5:.0f} datagrams/s from {peer}")
        seen = n


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
                        "peer": snap["peer"],
                        "udp": snap.get("udp"),
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
    ap.add_argument("--udp", default="0.0.0.0:9001", help="where the driver sends (default 0.0.0.0:9001)")
    ap.add_argument("--http", default="127.0.0.1:8765", help="where the page is served (default 127.0.0.1:8765)")
    ap.add_argument("--no-browser", action="store_true", help="do not open the page automatically")
    ap.add_argument("--key", default=secrets.token_urlsafe(6), help="access key for sending pit plans (default: a new one each start)")
    ap.add_argument("--pit-key", default="p", help="ACC's key for the pitstop MFD page (default p)")
    ap.add_argument("--key-ms", type=int, default=40, help="how long each key is held and released, ms (default 40)")
    ap.add_argument("--simulate-acc", action="store_true", help="a pretend pit page instead of the game, to try the dashboard")
    args = ap.parse_args()

    PIT["key"] = args.key
    try:
        PIT["mfd"] = acc_pit.FakeMfd() if args.simulate_acc else acc_pit.AccMfd(args.pit_key, args.key_ms)
    except (OSError, AttributeError, ValueError) as e:   # not Windows (no named mappings / WinDLL), or a bad --pit-key
        print(f"pit control off: {e}")

    STATE["udp"] = args.udp
    uh, up = args.udp.rsplit(":", 1)
    hh, hp = args.http.rsplit(":", 1)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind((uh, int(up)))
    except OSError as e:
        print(f"Cannot listen on UDP {args.udp}: {e}")
        print("Another program already owns that port - usually ac_pro_engineer with LAN still on.")
        print("Close it (or press 0 then O in it to turn LAN off) and run this again.")
        input("Press Enter to exit.")
        return
    threading.Thread(target=udp_loop, args=(sock,), daemon=True).start()
    threading.Thread(target=report_loop, daemon=True).start()

    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
    server = http.server.ThreadingHTTPServer((hh, int(hp)), functools.partial(Handler, directory=here))
    hosts = sorted({a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)} | {"127.0.0.1"}) if hh == "0.0.0.0" else [hh]
    print(f"UDP {args.udp}  ->  HTTP {args.http}   (Ctrl+C to stop)")
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
