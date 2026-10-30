"""Pit Wall launcher: a small window that starts the bridge without a terminal and updates Pit Wall from GitHub.

    python server/launcher.py              the window (PitWall.exe is this file)
    python server/launcher.py --selftest
    PitWall.exe --simulate-acc             any other arguments go to bridge.py as they are

The window needs pip install customtkinter pillow (the bridge itself stays standard library only).
Build PitWall.exe (one file; needs pip install pyinstaller as well):
    python -m PyInstaller --onefile --windowed --name PitWall --icon server/pitwall.ico --add-data "server/pitwall.ico;." --add-data "server/pitwall-logo.png;." --collect-data customtkinter server/launcher.py

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
# the dashboard's colours (web/css/app.css)
BG, PANEL, RAISE, LINE, TXT, MUT, DIM = "#0a0b0d", "#101216", "#171a1f", "#262a31", "#e6e8eb", "#a1a7b0", "#7a818b"
ACC, ACC_H, OK, OK_H, NEW, NEW_H, BAD = "#2ad4c4", "#22b3a5", "#3ddc84", "#32b56c", "#f5c518", "#d4aa12", "#ff5468"


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
        return n > 0, f"New version: {n} change{'s' * (n != 1)} on GitHub" if n else "You have the latest version"
    sha = remote_sha()
    try:
        with open(VERSION) as f:
            mine = f.read().strip()
    except OSError:
        mine = ""
    if sha == mine:
        return False, f"You have the latest version ({sha[:7]})"
    return True, "A new version is on GitHub" if mine else "Pit Wall's files need downloading"


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


def asset(name):   # bundled into the exe; from source it sits next to this file
    return os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__))), name)


def gui():
    import customtkinter as ctk
    from tkinter import messagebox
    from PIL import Image

    try:
        with open(PREFS) as f:
            prefs = json.load(f)
    except (OSError, ValueError):
        prefs = {}
    ips = my_ips()
    ctk.set_appearance_mode("dark")
    root = ctk.CTk(fg_color=BG)
    root.title("Pit Wall")
    try:
        root.iconbitmap(asset("pitwall.ico"))
    except Exception:
        pass
    root.resizable(False, False)
    q, live = queue.Queue(), {"on": False}
    font = lambda size=13, weight="normal": ctk.CTkFont("Segoe UI", size, weight)   # noqa: E731
    field = {"height": 38, "corner_radius": 6, "border_width": 1, "fg_color": RAISE, "border_color": LINE, "text_color": TXT, "font": font(14)}

    def later(fn):   # run fn off the window's thread; fn returns a callable to run back on it
        threading.Thread(target=lambda: q.put(fn()), daemon=True).start()

    def fit():   # CTk opens at 600x500; size the window to what it holds
        root.update_idletasks()
        k = root._get_window_scaling()
        root.geometry(f"{round(root.winfo_reqwidth() / k)}x{round(root.winfo_reqheight() / k)}")

    def label(master, text, size=13, color=TXT, weight="normal", **kw):
        return ctk.CTkLabel(master, text=text, text_color=color, font=font(size, weight), anchor="w", justify="left", **kw)

    head = ctk.CTkFrame(root, fg_color="transparent")
    head.pack(fill="x", padx=28, pady=(24, 0))
    ctk.CTkLabel(head, text="", image=ctk.CTkImage(Image.open(asset("pitwall-logo.png")), size=(171, 46))).pack(side="left")
    label(head, "Race engineer bridge\nAssetto Corsa Competizione", 12, DIM).pack(side="right")

    # ---------- setup ----------
    setup = ctk.CTkFrame(root, fg_color="transparent")
    setup.pack(fill="x", padx=28, pady=(20, 24))
    card = ctk.CTkFrame(setup, fg_color=PANEL, border_color=LINE, border_width=1, corner_radius=10)
    card.pack(fill="x")
    card.grid_columnconfigure(1, weight=1)
    label(card, "VPN ADDRESS", 11, MUT, "bold").grid(row=0, column=0, columnspan=2, sticky="w", padx=20, pady=(18, 4))
    ip = ctk.StringVar(value=prefs.get("ip") if prefs.get("ip") in ips else pick_ip(ips))
    ctk.CTkComboBox(card, variable=ip, values=sorted(ips, key=lambda a: a != pick_ip(ips)) or ["127.0.0.1"], width=420,
                    button_color=LINE, button_hover_color="#363b44", dropdown_fg_color=RAISE, dropdown_hover_color=LINE,
                    dropdown_text_color=TXT, dropdown_font=font(14), **field).grid(row=1, column=0, columnspan=2, sticky="we", padx=20)
    label(card, "Your Hamachi address (25.x) is picked for you; change it if your engineer connects another way.", 11, DIM,
          wraplength=420).grid(row=2, column=0, columnspan=2, sticky="w", padx=20, pady=(4, 0))
    label(card, "PORT", 11, MUT, "bold").grid(row=3, column=0, sticky="w", padx=(20, 10), pady=(14, 4))
    label(card, "KEY", 11, MUT, "bold").grid(row=3, column=1, sticky="w", padx=(0, 20), pady=(14, 4))
    port = ctk.StringVar(value=str(prefs.get("port", 8765)))
    ctk.CTkEntry(card, textvariable=port, width=110, **field).grid(row=4, column=0, sticky="w", padx=(20, 10))
    key = ctk.StringVar(value=prefs.get("key") or secrets.token_urlsafe(6))
    ctk.CTkEntry(card, textvariable=key, **field).grid(row=4, column=1, sticky="we", padx=(0, 20))
    vjoy = ctk.BooleanVar(value=bool(prefs.get("vjoy")))
    ctk.CTkSwitch(card, text="Press the pit page through vJoy", variable=vjoy, font=font(13), text_color=TXT, fg_color=LINE,
                  progress_color=ACC, button_color=TXT, button_hover_color="#ffffff").grid(row=5, column=0, columnspan=2, sticky="w", padx=20, pady=(16, 18))
    err = label(setup, "", 12, BAD, wraplength=460)
    err.pack(fill="x", pady=(6, 0))
    start = ctk.CTkButton(setup, text="Start Pit Wall", height=48, corner_radius=8, font=font(16, "bold"),
                          fg_color=ACC, hover_color=ACC_H, text_color=BG, text_color_disabled=DIM)
    start.pack(fill="x", pady=(4, 0))
    bar = ctk.CTkFrame(setup, fg_color=PANEL, border_color=LINE, border_width=1, corner_radius=10)
    bar.pack(fill="x", pady=(14, 0))
    upd_text = label(bar, "", 12, MUT, wraplength=290)
    upd_text.pack(side="left", fill="x", expand=True, padx=(18, 10), pady=14)
    upd = ctk.CTkButton(bar, width=140, height=36, corner_radius=8, font=font(14, "bold"))
    upd.pack(side="right", padx=(0, 12))
    st = {"avail": False}

    def have_code():
        return os.path.isfile(os.path.join(ROOT, "server", "bridge.py"))

    def can_start():
        on = have_code()
        start.configure(state="normal" if on else "disabled", fg_color=ACC if on else RAISE)

    def show_upd(kind, text):
        """ok: green; new (an update, or the first download): yellow; checking/busy: disabled; fail: Retry."""
        color, hover = {"ok": (OK, OK_H), "new": (NEW, NEW_H), "busy": (NEW, NEW)}.get(kind, (RAISE, LINE))
        name = {"checking": "Checking…", "busy": "Updating…", "ok": "✓  Up to date", "fail": "Retry",
                "new": "Update" if have_code() else "Download"}[kind]
        st["avail"] = kind == "new"
        ink = BG if color != RAISE else TXT
        upd.configure(text=name, fg_color=color, hover_color=hover, text_color=ink, text_color_disabled=ink if color != RAISE else DIM,
                      state="disabled" if kind in ("checking", "busy") else "normal")
        upd_text.configure(text=text, text_color=NEW if kind == "new" else BAD if kind == "fail" else MUT)

    def checked(fn):
        def work():
            try:
                avail, text = fn()
                kind = "new" if avail else "ok"
            except Exception as e:
                kind, text = "fail" if have_code() else "new", f"Could not reach GitHub: {e}"
            return lambda: (show_upd(kind, text), can_start())
        show_upd("checking", "Checking GitHub for a newer Pit Wall…")
        later(work)

    def do_update():
        show_upd("busy", "Downloading the latest Pit Wall…")
        def work():
            try:
                text = update()
                return lambda: (show_upd("ok", text), can_start())
            except Exception as e:
                return lambda: show_upd("new", f"Update failed: {e}")
        later(work)
    upd.configure(command=lambda: do_update() if st["avail"] else checked(check))   # the green button checks again

    # ---------- running ----------
    def do_start():
        a, k = ip.get().strip(), key.get().strip()
        if not re.fullmatch(r"\d{1,5}", port.get().strip()) or not 0 < int(port.get()) < 65536:
            return err.configure(text="The port is a number from 1 to 65535 (8765 if unsure).")
        if not re.fullmatch(r"[A-Za-z0-9_-]{4,64}", k):
            return err.configure(text="The key: 4 to 64 letters, digits, - or _.")
        p = int(port.get())
        s = socket.socket()
        try:
            s.bind((a, p))
        except OSError as e:
            return err.configure(text=bind_error(e, a, p))
        finally:
            s.close()
        with open(PREFS, "w") as f:
            json.dump({"ip": a, "port": p, "key": k, "vjoy": vjoy.get()}, f)
        setup.pack_forget()
        run = ctk.CTkFrame(root, fg_color="transparent")
        run.pack(fill="x", padx=28, pady=(20, 24))
        url = f"http://{a}:{p}/?key={k}"
        status = ctk.CTkFrame(run, fg_color=PANEL, border_color=LINE, border_width=1, corner_radius=10)
        status.pack(fill="x")
        label(status, "●", 18, OK).pack(side="left", padx=(18, 8), pady=10)
        label(status, "Running", 15, TXT, "bold").pack(side="left")
        ctk.CTkLabel(status, text=f"{a}:{p}", font=ctk.CTkFont("Consolas", 13), text_color=MUT).pack(side="right", padx=18)
        label(run, "SEND THIS LINK TO YOUR ENGINEER", 11, MUT, "bold").pack(fill="x", pady=(18, 6))
        row = ctk.CTkFrame(run, fg_color="transparent")
        row.pack(fill="x")
        link = ctk.CTkEntry(row, **{**field, "font": ctk.CTkFont("Consolas", 13), "text_color": ACC})
        link.insert(0, url)
        link.configure(state="readonly")
        link.pack(side="left", fill="x", expand=True)

        def copy_link():
            root.clipboard_clear()
            root.clipboard_append(url)
            cp.configure(text="✓  Copied", fg_color=OK, hover_color=OK_H)
            root.after(1500, lambda: cp.configure(text="Copy", fg_color=ACC, hover_color=ACC_H))
        ctk.CTkButton(row, text="Open", width=72, height=38, corner_radius=6, font=font(14, "bold"), fg_color=RAISE, hover_color=LINE,
                      border_width=1, border_color=LINE, text_color=TXT, command=lambda: webbrowser.open(url)).pack(side="right", padx=(8, 0))
        cp = ctk.CTkButton(row, text="Copy", width=96, height=38, corner_radius=6, font=font(14, "bold"), fg_color=ACC, hover_color=ACC_H,
                           text_color=BG, command=copy_link)
        cp.pack(side="right", padx=(8, 0))
        label(run, "LOG", 11, MUT, "bold").pack(fill="x", pady=(18, 6))
        log = ctk.CTkTextbox(run, height=190, width=520, corner_radius=8, border_width=1, fg_color=PANEL, border_color=LINE,
                             text_color=MUT, font=ctk.CTkFont("Consolas", 11), scrollbar_button_color=LINE, wrap="none")
        log.configure(state="disabled")
        log.pack(fill="x")
        label(run, "Leave this window open (minimise it) while you drive. Closing it stops Pit Wall.", 12, DIM).pack(fill="x", pady=(12, 0))
        fit()
        live["on"], live["log"] = True, log
        out = queue.Queue()
        live["out"] = out
        threading.Thread(target=run_bridge, args=(a, p, k, vjoy.get(), Out(out)), daemon=True).start()
    start.configure(command=do_start)

    def pump():
        while not q.empty():
            q.get()()
        if live["on"]:
            text = ""
            while not live["out"].empty():
                text += live["out"].get()
            if text:
                log = live["log"]
                log.configure(state="normal")
                log.insert("end", text)
                log.delete("1.0", "end-300l")
                log.see("end")
                log.configure(state="disabled")
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
        show_upd("new", "Pit Wall's files are not in this folder yet. Click Download.")
        can_start()
    fit()
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
