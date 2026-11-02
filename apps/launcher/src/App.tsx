import { useCallback, useEffect, useRef, useState } from "react";
import { CloseDialog } from "./components/CloseDialog";
import { Running } from "./components/Running";
import { Message, Setup } from "./components/Setup";
import { TitleBar } from "./components/TitleBar";
import { UpdateBar } from "./components/UpdateBar";
import { Card, LogBox } from "./components/ui";
import * as bridge from "./lib/bridge";
import { failureMessage } from "./lib/failure";
import { bridgeArgs, isLoopback, linkFor, loadPrefs, pickIp, Prefs, savePrefs, validate } from "./lib/settings";

const MAX_LINES = 300;

function Header({ stopped }: { stopped: boolean }) {
  return (
    <header className="flex items-end justify-between">
      <div>
        <div className="text-[32px] font-bold leading-none tracking-[.14em]">PIT WALL</div>
        <div className="mt-1.5 text-[13px] text-muted">Race engineer bridge for Assetto Corsa Competizione</div>
      </div>
      {stopped ? (
        <div className="flex items-center gap-2 font-mono text-[12px] text-bad">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
          STOPPED · v{__VERSION__}
        </div>
      ) : (
        <div className="flex items-center gap-2 font-mono text-[12px] text-muted">
          <span className="box-border size-2 rounded-full border-2 border-dim" />
          IDLE · v{__VERSION__}
        </div>
      )}
    </header>
  );
}

export function App() {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs([]));
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [since, setSince] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const served = useRef(false);

  useEffect(() => {
    bridge.info().then((i) => {
      setAddresses(i.addresses);
      if (i.broadcastPort <= 0) bridge.enableFieldTiming().catch(() => {});
      setPrefs(loadPrefs(i.addresses));
    }).catch((e) => setMessage({ text: `The bridge did not answer: ${e}`, tone: "bad" }));
  }, []);

  useEffect(() => {
    const subs = [
      bridge.onLine((line) => {
        if (line.startsWith("Pit Wall on")) served.current = true;
        setLines((l) => [...l.slice(-(MAX_LINES - 1)), line]);
      }),
      bridge.onExit((code) => {
        setRunning(false);
        setStopping(false);
        setMessage(served.current && code === 0
          ? { text: "Pit Wall stopped. Start it again when you want.", tone: "muted" }
          : { text: "Pit Wall could not run.", tone: "bad" });
      }),
      bridge.onCloseRequested(() => setConfirmClose(true)),
    ];
    return () => { subs.forEach((s) => s.then((off) => off())); };
  }, []);

  const recheck = useCallback(async () => {
    try {
      const i = await bridge.info();
      setAddresses(i.addresses);
      setPrefs((p) => (isLoopback(p.ip) ? { ...p, ip: pickIp(i.addresses) } : p));
    } catch (e) {
      setMessage({ text: `The bridge did not answer: ${e}`, tone: "bad" });
    }
  }, []);

  const startBridge = useCallback(async () => {
    const problem = validate(prefs.port, prefs.key, prefs.ip);
    if (problem) return setMessage({ text: problem, tone: "bad" });
    savePrefs(prefs);
    setMessage(null);
    setLines([]);
    served.current = false;
    try {
      await bridge.start(bridgeArgs(prefs));
      setSince(Date.now());
      setRunning(true);
    } catch (e) {
      setMessage({ text: String(e), tone: "bad" });
    }
  }, [prefs]);

  const stopBridge = () => { setStopping(true); bridge.stop(); };
  const failedStart = !running && message?.tone === "bad" && lines.length > 0;

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className={`flex min-h-0 flex-1 flex-col overflow-auto px-8 pb-4 pt-6 ${running || failedStart ? "gap-4" : "gap-3.5"}`}>
        {!running && <Header stopped={failedStart} />}

        {confirmClose && <CloseDialog onKeep={() => setConfirmClose(false)} onQuit={() => bridge.quit()} />}

        {running ? (
          <Running address={`${prefs.ip.trim()}:${prefs.port.trim()}`} link={linkFor(prefs)} lines={lines} stopping={stopping} since={since} onStop={stopBridge} />
        ) : (
          <>
            {failedStart && (
              <Card role="alert" className="flex flex-col gap-3 border-bad px-5 py-4">
                <div className="text-[20px] font-bold text-bad">Pit Wall could not run</div>
                <div className="text-[15px] leading-[1.45]">{failureMessage(lines, prefs.ip, prefs.port)}</div>
                <div className="rounded border border-line bg-bg p-3"><LogBox lines={lines.slice(-6)} /></div>
              </Card>
            )}
            <Setup prefs={prefs} onChange={setPrefs} addresses={addresses} failed={failedStart}
              message={failedStart ? null : message} onStart={startBridge} onRecheck={recheck} />
          </>
        )}

        <UpdateBar running={running} />
      </main>
    </div>
  );
}
