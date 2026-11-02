import { Prefs, SIM_TRACKS } from "../lib/settings";
import { Card, Label, TextInput, Toggle } from "./ui";

const field = "h-9 px-2.5 text-[14px]";

export function SimCard({ prefs, onChange }: { prefs: Prefs; onChange: (p: Prefs) => void }) {
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => onChange({ ...prefs, [k]: v });
  const text = (k: keyof Prefs, label: string, placeholder: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={k}>{label}</Label>
      <TextInput id={k} value={String(prefs[k])} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} className={field} />
    </div>
  );
  const pick = (k: "simSession" | "simTrack", label: string, options: string[]) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={k}>{label}</Label>
      <select id={k} value={prefs[k]} onChange={(e) => set(k, e.target.value)} className={`${field} rounded border border-line bg-bg text-text`}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <Card className="flex flex-col gap-3 border-line px-[18px] py-2.5">
      <div className="flex items-center gap-3.5">
        <Toggle id="sim" checked={prefs.sim} onChange={(v) => set("sim", v)} />
        <label htmlFor="sim" className="flex-1 cursor-pointer text-[15px] font-semibold">Simulate a session (no game)</label>
      </div>
      {prefs.sim && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-line pt-3">
          {pick("simSession", "SESSION", ["race", "quali", "practice", "weekend"])}
          {pick("simTrack", "TRACK", SIM_TRACKS)}
          {text("simCars", "CARS (8-60)", "20")}
          {text("simMinutes", "MINUTES (3-1440)", "default")}
          {text("simPace", "YOUR PACE (1-5)", "random")}
          {text("simGrid", "GRID SLOT", "by pace, or random")}
          {text("simSpeed", "SPEED (x)", "1")}
          {text("simClasses", "CLASSES", "GT3=80,GT4=20")}
        </div>
      )}
    </Card>
  );
}
