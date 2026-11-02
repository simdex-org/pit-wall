import { useState } from "react";
import * as bridge from "../lib/bridge";
import { isLoopback, linkFor, Prefs } from "../lib/settings";
import { Button, Card, Label, TextInput, Toggle } from "./ui";

export type Message = { text: string; tone: "bad" | "ok" | "muted" };

interface Props {
  prefs: Prefs;
  onChange: (p: Prefs) => void;
  addresses: string[];
  failed: boolean;
  message: Message | null;
  onStart: () => void;
  onRecheck: () => void;
}

const tone = { bad: "text-bad", ok: "text-ok", muted: "text-muted" } as const;

export function Setup({ prefs, onChange, addresses, failed, message, onStart, onRecheck }: Props) {
  const [note, setNote] = useState<Message | null>(null);
  const [binding, setBinding] = useState(false);
  const shown = note ?? message;
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => onChange({ ...prefs, [k]: v });
  const usable = addresses.filter((ip) => !isLoopback(ip));
  const noAddress = usable.length === 0;
  const inError = failed && !noAddress;
  const link = linkFor(prefs);

  async function bind() {
    setBinding(true);
    setNote({ text: "Switch to ACC, open Options > Controls and find the MFD actions. In 10 seconds the beeps start: click each action's binding when you hear its beeps (1 pit page, 2 up, 3 down, 4 left, 5 right, 6 cycle MFD). Then save the controls.", tone: "muted" });
    try {
      await bridge.bindVjoy();
      setNote({ text: "Done. ACC's six MFD actions should now show vJoy buttons 1 to 6.", tone: "ok" });
    } catch (e) {
      setNote({ text: `vJoy binding failed. Is vJoy installed, with device 1 set to 6 buttons or more? ${e}`, tone: "bad" });
    } finally {
      setBinding(false);
    }
  }

  const ipField = (
    <TextInput id="ip" value={prefs.ip} onChange={(e) => set("ip", e.target.value)} inputMode="decimal" aria-invalid={inError}
      className={`px-4 font-medium ${inError ? "h-[50px] border-bad text-[22px]" : "h-[54px] text-[24px]"}`} />
  );

  const portAndKey = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="port">PORT</Label>
        <TextInput id="port" value={prefs.port} onChange={(e) => set("port", e.target.value)} inputMode="numeric" className="h-11 w-28 px-3 text-[15px]" />
      </div>
      <div className="flex items-center gap-3.5">
        <Toggle id="open" checked={prefs.open} onChange={(v) => set("open", v)} />
        <label htmlFor="open" className="flex-1 cursor-pointer text-[15px] font-semibold">Anyone with the link can edit the pit stop</label>
      </div>
    </div>
  );

  return (
    <>
      {noAddress ? (
        <>
          <Card className="flex flex-col gap-3.5 border-warn p-[18px]">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="ip">IP ADDRESS</Label>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[.08em] text-warn">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M8 1.5l6.5 12h-13z" /><path d="M8 6.5v3.5M8 12v.01" /></svg>
                  NO ADDRESS FOUND
                </span>
              </div>
              {ipField}
            </div>
            <p className="m-0 text-[15px] leading-[1.45]">Pit Wall did not find an address your engineer could connect to. With 127.0.0.1 only this PC can open the dashboard.</p>
            <ol className="m-0 flex list-none flex-col gap-2 p-0 text-[14px] leading-[1.4]">
              {["Connect this PC to the network your engineer will use.", "Or type the address your engineer connects to.", "Press Check again."].map((t, i) => (
                <li key={t} className="flex gap-3"><span className="font-mono font-bold text-accent">{i + 1}</span><span>{t}</span></li>
              ))}
            </ol>
            <Button onClick={onRecheck} className="h-11 text-[15px] font-semibold">Check again</Button>
          </Card>
          <Card className="border-line px-[18px] py-3.5">{portAndKey}</Card>
        </>
      ) : (
        <Card className="flex flex-col gap-3.5 border-line p-[18px]">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="ip" tone={inError ? "bad" : "muted"}>IP ADDRESS</Label>
              {!inError && usable.includes(prefs.ip.trim()) && (
                <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[.08em] text-ok">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M2 6.5l3 3 5-6" /></svg>
                  DETECTED ON THIS PC
                </span>
              )}
            </div>
            {ipField}
            <p className="m-0 text-[12px] leading-[1.4] text-muted">
              {inError
                ? <>Found on this PC: <span className="font-mono text-text">{usable.join(", ")}</span></>
                : "This is the address your engineer connects to. Type another one if you connect another way."}
            </p>
          </div>
          {portAndKey}
          {!inError && (
            <div className="border-t border-line pt-3 text-[12px] leading-[1.45] text-muted">
              Link for your engineer<br />
              <span className="select-text break-all font-mono text-[13px] text-accent">{link}</span>
            </div>
          )}
        </Card>
      )}

      <Card className="flex items-center gap-3.5 border-line px-[18px] py-2.5">
        <Toggle id="vj" checked={prefs.vjoy} onChange={(v) => set("vjoy", v)} />
        <label htmlFor="vj" className="flex-1 cursor-pointer text-[15px] font-semibold">Press the pit page through vJoy</label>
        <Button onClick={bind} disabled={!prefs.vjoy || binding} className="h-9 px-3.5 font-semibold">{binding ? "Binding..." : "Bind in ACC"}</Button>
      </Card>

      <div className="flex-1" />

      {shown && <p className={`m-0 text-[13px] leading-snug ${tone[shown.tone]}`} role="status">{shown.text}</p>}
      <Button kind={noAddress ? "outline" : "primary"} onClick={onStart}>
        {failed && !noAddress ? "TRY AGAIN" : noAddress ? "START FOR THIS PC ONLY" : "START PIT WALL"}
      </Button>
    </>
  );
}
