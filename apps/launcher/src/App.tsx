import { useCallback, useEffect, useRef, useState } from "react";
import { Running } from "./components/Running";
import { Setup } from "./components/Setup";
import { TitleBar } from "./components/TitleBar";
import { UpdateBar } from "./components/UpdateBar";
import { Button } from "./components/ui";
import * as bridge from "./lib/bridge";
import { bridgeArgs, linkFor, loadPrefs, Prefs, savePrefs, validate } from "./lib/settings";

type Message = { text: string; tone: "bad" | "ok" | "muted" };
const MAX_LINES = 300;

export function App() {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [fieldTiming, setFieldTiming] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs([]));
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const served = useRef(false);

  useEffect(() => {
    bridge.info().then((i) => {
      setAddresses(i.addresses);
      setFieldTiming(i.broadcastPort > 0);
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
          : { text: "Pit Wall could not run. The last log lines say why.", tone: "bad" });
      }),
      bridge.onCloseRequested(() => setConfirmClose(true)),
    ];
    return () => { subs.forEach((s) => s.then((off) => off())); };
  }, []);

  const startBridge = useCallback(async () => {
    const problem = validate(prefs.port, prefs.key);
    if (problem) return setMessage({ text: problem, tone: "bad" });
    savePrefs(prefs);
    setMessage(null);
    setLines([]);
    served.current = false;
    try {
      await bridge.start(bridgeArgs(prefs));
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
      <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-7">
        <header className="flex items-center justify-between">
          <img src="/logo.svg" alt="Pit Wall" className="h-11" />
          <p className="text-right text-xs leading-snug text-dim">Race engineer bridge<br />Assetto Corsa Competizione</p>
        </header>

        {confirmClose && (
          <div role="alertdialog" aria-label="Close Pit Wall" className="flex items-center gap-3 rounded-lg border border-warn bg-panel px-4 py-3 text-[14px]">
            <span className="flex-1">Stop Pit Wall and close the window? Your engineer loses the dashboard.</span>
            <Button onClick={() => setConfirmClose(false)}>Keep running</Button>
            <Button kind="danger" onClick={() => bridge.quit()}>Stop and close</Button>
          </div>
        )}

        {running ? (
          <Running address={`${prefs.ip}:${prefs.port.trim()}`} link={linkFor(prefs)} lines={lines} stopping={stopping} onStop={stopBridge} />
        ) : (
          <>
            <Setup prefs={prefs} onChange={setPrefs} addresses={addresses} fieldTiming={fieldTiming}
              onFieldTiming={() => setFieldTiming(true)} onStart={startBridge} message={message} />
            {failedStart && <pre className="select-text overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[11px] text-muted">{lines.slice(-6).join("\n")}</pre>}
          </>
        )}

        <div className="mt-auto"><UpdateBar running={running} /></div>
      </main>
    </div>
  );
}
