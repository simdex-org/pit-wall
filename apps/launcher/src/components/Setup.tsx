import { useState } from "react";
import * as bridge from "../lib/bridge";
import { Prefs, vpnName } from "../lib/settings";
import { Button, Card, Label, Switch, TextInput } from "./ui";

interface Props {
  prefs: Prefs;
  onChange: (p: Prefs) => void;
  addresses: string[];
  hamachi: string;
  fieldTiming: boolean;
  onFieldTiming: () => void;
  onStart: () => void;
  message: { text: string; tone: "bad" | "ok" | "muted" } | null;
}

const tone = { bad: "text-bad", ok: "text-ok", muted: "text-muted" } as const;

export function Setup({ prefs, onChange, addresses, hamachi, fieldTiming, onFieldTiming, onStart, message }: Props) {
  const [note, setNote] = useState<Props["message"]>(null);
  const [binding, setBinding] = useState(false);
  const shown = note ?? message;
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => onChange({ ...prefs, [k]: v });

  async function enableField() {
    if (fieldTiming) return setNote({ text: "Field timing is on. The other cars come from ACC's broadcasting port.", tone: "ok" });
    try {
      const text = await bridge.enableFieldTiming();
      setNote({ text, tone: text.startsWith("Broadcasting") ? "ok" : "bad" });
      onFieldTiming();
    } catch (e) {
      setNote({ text: `Could not turn field timing on: ${e}`, tone: "bad" });
    }
  }

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

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <Label>VPN address</Label>
        <TextInput value={prefs.ip} onChange={(e) => set("ip", e.target.value)} list="pw-ips" spellCheck={false} inputMode="decimal" />
        <datalist id="pw-ips">
          {addresses.map((ip) => <option key={ip} value={ip}>{vpnName(ip)}</option>)}
        </datalist>
        <p className="mt-1 text-[12px] text-dim">
          {hamachi
            ? <>Your Hamachi address is <button type="button" className="text-text underline" onClick={() => set("ip", hamachi)}>{hamachi}</button>. Type another address if your engineer connects another way.</>
            : "No Hamachi address found. Open Hamachi and power it on, or type the address your engineer connects to."}
        </p>

        <div className="mt-4 grid grid-cols-[110px_1fr] gap-3">
          <div><Label>Port</Label><TextInput value={prefs.port} onChange={(e) => set("port", e.target.value)} inputMode="numeric" /></div>
          <div><Label>Key</Label><TextInput value={prefs.key} onChange={(e) => set("key", e.target.value)} /></div>
        </div>

        <div className="mt-4"><Switch checked={prefs.vjoy} onChange={(on) => set("vjoy", on)}>Press the pit page through vJoy</Switch></div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button onClick={enableField} className={fieldTiming ? "text-ok" : ""}>{fieldTiming ? "Field timing on" : "Turn on field timing"}</Button>
          <Button onClick={bind} disabled={!prefs.vjoy || binding}>{binding ? "Binding..." : "Bind vJoy in ACC"}</Button>
        </div>
      </Card>

      {shown && <p className={`min-h-5 text-[13px] leading-snug ${tone[shown.tone]}`} role="status">{shown.text}</p>}
      <Button kind="primary" onClick={onStart}>Start Pit Wall</Button>
    </div>
  );
}
