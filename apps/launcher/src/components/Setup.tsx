import { useState } from "react";
import * as bridge from "../lib/bridge";
import { Prefs, vpnName } from "../lib/settings";
import { Button, Card, ComboInput, Label, Switch, TextInput } from "./ui";

interface Props {
  prefs: Prefs;
  onChange: (p: Prefs) => void;
  addresses: string[];
  hamachi: string;
  onStart: () => void;
  message: { text: string; tone: "bad" | "ok" | "muted" } | null;
}

const tone = { bad: "text-bad", ok: "text-ok", muted: "text-muted" } as const;

export function Setup({ prefs, onChange, addresses, hamachi, onStart, message }: Props) {
  const [note, setNote] = useState<Props["message"]>(null);
  const [binding, setBinding] = useState(false);
  const shown = note ?? message;
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => onChange({ ...prefs, [k]: v });

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
        <ComboInput value={prefs.ip} onChange={(v) => set("ip", v)} options={addresses.map((ip) => ({ value: ip, hint: vpnName(ip) }))} />
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

        <Button onClick={bind} disabled={!prefs.vjoy || binding} className="mt-4 w-full">{binding ? "Binding..." : "Bind vJoy in ACC"}</Button>
      </Card>

      {shown && <p className={`min-h-5 text-[13px] leading-snug ${tone[shown.tone]}`} role="status">{shown.text}</p>}
      <Button kind="primary" onClick={onStart}>Start Pit Wall</Button>
    </div>
  );
}
