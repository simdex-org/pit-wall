"""Pit Wall launcher: a small window that starts the bridge without a terminal and updates Pit Wall from GitHub.

    python server/launcher.py              the window (PitWall.exe is this file)
    python server/launcher.py --selftest
    PitWall.exe --simulate-acc             any other arguments go to bridge.py as they are

Build PitWall.exe (one file; needs pip install pyinstaller):
    python -m PyInstaller --onefile --windowed --name PitWall --icon server/pitwall.ico --add-data "server/pitwall.ico;." server/launcher.py

The exe loads server/bridge.py from the folder it sits in, so an update changes the bridge without a new exe.
Next to a git clone it updates with git pull; anywhere else it downloads main as a zip (the first start too).
"""
import importlib.util
import io
import json
import os
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import urllib.request
import webbrowser
import zipfile
# the bridge's own standard-library imports, so PyInstaller bundles them (the bridge itself is read from disk)
# ponytail: a module the bridge starts importing later needs a rebuilt exe
import argparse, atexit, bisect, collections, copy, ctypes, ctypes.wintypes, errno, functools, hmac, http.server  # noqa: E401,F401
import ipaddress, itertools, math, mmap, random, ssl, struct, tempfile, time, traceback, unicodedata, urllib.parse, uuid  # noqa: E401,F401
try:
    import winsound  # noqa: F401
except ImportError:
    pass

REPO = "simdex-org/pit-wall"
ROOT = os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, "frozen", False) else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFS = os.path.join(ROOT, "pitwall-launcher.json")
VERSION = os.path.join(ROOT, ".pitwall-version")
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def pick_ip(ips):
    """Hamachi's 25.x first, then Radmin VPN's 26.x, then any other address; 127.0.0.1 when there is none."""
    ips = [ip for ip in ips if not ip.startswith("127.")]
    return sorted(ips, key=lambda ip: (not ip.startswith("25."), not ip.startswith("26.")))[0] if ips else "127.0.0.1"


def my_ips():
    try:
        return sorted({a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)})
    except OSError:
        return []


def git(*a):
    r = subprocess.run(["git", "-C", ROOT, *a], capture_output=True, text=True, timeout=120, creationflags=NOWIN)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout).strip())
    return r.stdout.strip()


def is_clone():
    return os.path.isdir(os.path.join(ROOT, ".git"))


def remote_sha():
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/commits/main",
                                 headers={"Accept": "application/vnd.github.sha", "User-Agent": "pit-wall-launcher"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode().strip()


def check():
    """(update available, status text)"""
    if is_clone():
        git("fetch", "-q", "origin", "main")
        n = int(git("rev-list", "--count", "HEAD..FETCH_HEAD"))
        return n > 0, f"{n} new change{'s' * (n != 1)} on GitHub" if n else "Up to date"
    sha = remote_sha()
    try:
        with open(VERSION) as f:
            mine = f.read().strip()
    except OSError:
        mine = ""
    if sha == mine:
        return False, f"Up to date ({sha[:7]})"
    return True, "Update available" if mine else "Pit Wall's files need downloading"


def extract(data, root):
    """Writes the files of a GitHub zip over root, without its top folder (pit-wall-<sha>/)."""
    base = os.path.realpath(root)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for m in z.infolist():
            rel = m.filename.split("/", 1)[1] if "/" in m.filename else ""
            dest = os.path.realpath(os.path.join(base, rel))
            if m.is_dir() or not rel or not dest.startswith(base + os.sep):   # nothing outside the folder
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with z.open(m) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)


def update():
    if is_clone():
        git("pull", "--ff-only", "origin", "main")
        return "Updated: " + git("log", "-1", "--format=%h %s")
    sha = remote_sha()
    with urllib.request.urlopen(f"https://codeload.github.com/{REPO}/zip/{sha}", timeout=120) as r:
        extract(r.read(), ROOT)
    with open(VERSION, "w") as f:
        f.write(sha)
    return f"Updated to {sha[:7]}"


def bind_error(e, ip, port):
    w = getattr(e, "winerror", None)
    if w == 10049:
        return f"{ip} is not an address of this PC. Pick your Hamachi address (25.x.x.x) from the list."
    if w in (10048, 10013):
        return f"Port {port} is in use (is Pit Wall already open?) or reserved by Windows. Try another, e.g. {port + 1}."
    return f"Cannot use {ip}:{port}: {e.strerror or e}"


class Out(io.TextIOBase):
    """The bridge's prints, into the window."""
    def __init__(self, q):
        self.q = q

    def write(self, t):
        self.q.put(t)
        return len(t)


def run_bridge(ip, port, key, vjoy, out):
    sys.stdout = sys.stderr = out
    sys.argv = ["bridge.py", "--http", f"{ip}:{port}", "--key", key, "--no-browser"] + (["--vjoy"] if vjoy else []) + sys.argv[1:]
    srv = os.path.join(ROOT, "server")
    sys.path.insert(0, srv)
    spec = importlib.util.spec_from_file_location("bridge", os.path.join(srv, "bridge.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules["bridge"] = mod
    spec.loader.exec_module(mod)
    try:
        mod.main()
    except SystemExit:
        pass
    except Exception as e:   # shown in the window rather than lost
        print(f"Pit Wall stopped: {e!r}")


def gui():
    import tkinter as tk
    from tkinter import messagebox, ttk

    try:
        with open(PREFS) as f:
            prefs = json.load(f)
    except (OSError, ValueError):
        prefs = {}
    ips = my_ips()
    root = tk.Tk()
    root.title("Pit Wall")
    try:  # the exe carries the icon in its bundle; from source it sits next to this file
        root.iconbitmap(os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__))), "pitwall.ico"))
    except tk.TclError:
        pass
    root.resizable(False, False)
    pad = {"padx": 10, "pady": 4}
    q, live = queue.Queue(), {"on": False}

    def later(fn):   # run fn off the window's thread; fn returns a callable to run back on it
        threading.Thread(target=lambda: q.put(fn()), daemon=True).start()

    # ---------- setup ----------
    setup = ttk.Frame(root, padding=8)
    setup.grid()
    ttk.Label(setup, text="PIT WALL", font=("Segoe UI", 14, "bold")).grid(row=0, column=0, columnspan=3, sticky="w", **pad)
    ttk.Label(setup, text="Your VPN address").grid(row=1, column=0, sticky="w", **pad)
    ip = tk.StringVar(value=prefs.get("ip") if prefs.get("ip") in ips else pick_ip(ips))
    ttk.Combobox(setup, textvariable=ip, values=sorted(ips, key=lambda a: a != pick_ip(ips)), width=22).grid(row=1, column=1, columnspan=2, sticky="we", **pad)
    ttk.Label(setup, text="Port").grid(row=2, column=0, sticky="w", **pad)
    port = tk.StringVar(value=str(prefs.get("port", 8765)))
    ttk.Entry(setup, textvariable=port, width=8).grid(row=2, column=1, sticky="w", **pad)
    ttk.Label(setup, text="Key").grid(row=3, column=0, sticky="w", **pad)
    key = tk.StringVar(value=prefs.get("key") or secrets.token_urlsafe(6))
    ttk.Entry(setup, textvariable=key, width=24).grid(row=3, column=1, columnspan=2, sticky="we", **pad)
    vjoy = tk.BooleanVar(value=bool(prefs.get("vjoy")))
    ttk.Checkbutton(setup, text="Press the pit page through vJoy", variable=vjoy).grid(row=4, column=1, columnspan=2, sticky="w", **pad)
    err = ttk.Label(setup, foreground="#c0392b", wraplength=320)
    err.grid(row=5, column=0, columnspan=3, sticky="w", **pad)
    start = ttk.Button(setup, text="Start")
    start.grid(row=6, column=0, columnspan=3, sticky="we", **pad)
    ttk.Separator(setup).grid(row=7, column=0, columnspan=3, sticky="we", pady=6)
    upd_text = ttk.Label(setup, text="Checking for updates…", wraplength=230)
    upd_text.grid(row=8, column=0, columnspan=2, sticky="w", **pad)
    upd = ttk.Button(setup, text="Update", state="disabled")
    upd.grid(row=8, column=2, sticky="e", **pad)

    def have_code():
        return os.path.isfile(os.path.join(ROOT, "server", "bridge.py"))

    def checked(fn):
        def work():
            try:
                avail, text = fn()
            except Exception as e:
                avail, text = not have_code(), f"Could not reach GitHub: {e}"
            def show():
                upd_text.config(text=text)
                upd.config(state="normal" if avail or not have_code() else "disabled", text="Update" if have_code() else "Download")
                start.config(state="normal" if have_code() else "disabled")
            return show
        upd_text.config(text="Checking for updates…")
        later(work)

    def do_update():
        upd.config(state="disabled")
        upd_text.config(text="Updating…")
        def work():
            try:
                text = update()
                return lambda: (upd_text.config(text=text), start.config(state="normal" if have_code() else "disabled"))
            except Exception as e:
                return lambda: (upd_text.config(text=f"Update failed: {e}"), upd.config(state="normal"))
        later(work)
    upd.config(command=do_update)

    # ---------- running ----------
    def do_start():
        a, k = ip.get().strip(), key.get().strip()
        if not re.fullmatch(r"\d{1,5}", port.get().strip()) or not 0 < int(port.get()) < 65536:
            return err.config(text="The port is a number from 1 to 65535 (8765 if unsure).")
        if not re.fullmatch(r"[A-Za-z0-9_-]{4,64}", k):
            return err.config(text="The key: 4 to 64 letters, digits, - or _.")
        p = int(port.get())
        s = socket.socket()
        try:
            s.bind((a, p))
        except OSError as e:
            return err.config(text=bind_error(e, a, p))
        finally:
            s.close()
        with open(PREFS, "w") as f:
            json.dump({"ip": a, "port": p, "key": k, "vjoy": vjoy.get()}, f)
        setup.grid_remove()
        run = ttk.Frame(root, padding=8)
        run.grid()
        url = f"http://{a}:{p}/?key={k}"
        ttk.Label(run, text=f"● Running on {a}:{p}", font=("Segoe UI", 11, "bold"), foreground="#1e8449").grid(row=0, column=0, columnspan=3, sticky="w", **pad)
        ttk.Label(run, text="Send this link to your engineer:").grid(row=1, column=0, columnspan=3, sticky="w", **pad)
        link = ttk.Entry(run, width=44)
        link.insert(0, url)
        link.config(state="readonly")
        link.grid(row=2, column=0, sticky="we", **pad)

        def copy_link():
            root.clipboard_clear()
            root.clipboard_append(url)
            cp.config(text="Copied ✓")
            root.after(1500, lambda: cp.config(text="Copy"))
        cp = ttk.Button(run, text="Copy", command=copy_link, width=9)
        cp.grid(row=2, column=1)
        ttk.Button(run, text="Open", command=lambda: webbrowser.open(url), width=7).grid(row=2, column=2, padx=(0, 10))
        log = tk.Text(run, height=9, width=64, font=("Consolas", 8), state="disabled", relief="flat", background="#f4f4f4")
        log.grid(row=3, column=0, columnspan=3, sticky="we", **pad)
        ttk.Label(run, text="Leave this window open (minimise it) while you drive. Closing it stops Pit Wall.",
                  foreground="#666").grid(row=4, column=0, columnspan=3, sticky="w", **pad)
        live["on"], live["log"] = True, log
        out = queue.Queue()
        live["out"] = out
        threading.Thread(target=run_bridge, args=(a, p, k, vjoy.get(), Out(out)), daemon=True).start()
    start.config(command=do_start)

    def pump():
        while not q.empty():
            q.get()()
        if live["on"]:
            text = ""
            while not live["out"].empty():
                text += live["out"].get()
            if text:
                log = live["log"]
                log.config(state="normal")
                log.insert("end", text)
                log.delete("1.0", "end-300l")
                log.see("end")
                log.config(state="disabled")
        root.after(200, pump)

    def close():
        if not live["on"] or messagebox.askokcancel("Pit Wall", "Stop Pit Wall? Your engineer loses the dashboard."):
            root.destroy()
            os._exit(0)   # the bridge's threads (and the keyboard hook) end with the process
    root.protocol("WM_DELETE_WINDOW", close)
    root.bind("<Return>", lambda e: live["on"] or (do_start() if have_code() else do_update()))
    if have_code():
        checked(check)
    else:
        upd_text.config(text="Pit Wall's files are not in this folder yet. Click Download.")
        start.config(state="disabled")
        upd.config(state="normal", text="Download")
    pump()
    root.mainloop()


def selftest():
    assert pick_ip(["127.0.0.1", "192.168.1.5", "25.1.2.3"]) == "25.1.2.3"
    assert pick_ip(["192.168.1.5", "26.0.0.9"]) == "26.0.0.9" and pick_ip(["127.0.0.1"]) == "127.0.0.1"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("pit-wall-abc/server/bridge.py", "x")
        z.writestr("pit-wall-abc/../evil.txt", "x")
        z.writestr("pit-wall-abc/web/", "")
    d = tempfile.mkdtemp()
    extract(buf.getvalue(), os.path.join(d, "pw"))
    assert open(os.path.join(d, "pw", "server", "bridge.py")).read() == "x" and not os.path.exists(os.path.join(d, "evil.txt"))
    shutil.rmtree(d)
    print("ok: address picked Hamachi first, zip written into the folder only")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    else:
        gui()
