import { useEffect, useMemo, useRef } from "react";
import { defineModule } from "../engine/registry";
import { aux } from "../engine/versions";
import { changed, FRAME_URL, frameDoc, type Payload } from "../lib/sandbox";
import { TOKENS } from "../state/appearance";
import { usePrefs } from "../state/prefs";
import fuelGauge from "./examples/fuel-gauge.html?raw";
import tyres from "./examples/tyres.html?raw";

const EXTRA_VARS = ["--acc-ink", "--font", "--num", "--r", "--p3"];

function theme(): Payload["theme"] {
  const cs = getComputedStyle(document.documentElement), vars: Record<string, string> = {};
  for (const v of [...TOKENS.map((t) => t[1]), ...EXTRA_VARS]) vars[v] = cs.getPropertyValue(v).trim();
  return { vars, scheme: cs.colorScheme || "dark" };
}

function Sandbox({ src, data }: { src: string; data: Payload }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sent = useRef<Partial<Payload>>({});
  const latest = useRef(data);
  latest.current = data;

  const push = () => {
    const win = frame.current?.contentWindow, d = changed(sent.current, latest.current);
    if (!win || !d) return;
    win.postMessage({ type: "data", data: d }, "*");
    sent.current = { ...latest.current };
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win || e.origin !== "null" || e.data?.type !== "ready") return;
      win.postMessage({ type: "source", html: frameDoc(src) }, "*");
      sent.current = {};
      push();
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(push);

  return <iframe ref={frame} key={src} src={FRAME_URL} sandbox="allow-scripts" title="Your module" referrerPolicy="no-referrer"
    style={{ flex: "1 1 auto", width: "100%", minHeight: 0, border: 0, background: "transparent" }} />;
}

defineModule({
  type: "html", title: "HTML module", group: "Custom",
  blurb: "Your own module in HTML and JavaScript over the live data. It runs locked away from the page: no network, no pit controls.",
  size: { w: 3, h: 6, minW: 2, minH: 2, maxW: 12, maxH: 30 }, needs: ["reading", "summary", "field", "laps", "units", "theme"], requires: [],
  options: [
    { key: "src", label: "Source (one HTML file)", type: "code", def: fuelGauge, choices: [[fuelGauge, "Fuel gauge"], [tyres, "Tyre temperatures"]],
      hint: "Read the data with pitwall.on(\"update\", fn) or pitwall.on(\"reading\", fn); pitwall.latest has the last of each. The module cannot reach the network, the page, the access key or the pit controls. See docs/custom-modules.md." },
  ],
  view({ ctx: c, opts }) {
    const units = usePrefs().units, tv = aux.version("theme");
    const th = useMemo(theme, [tv]);
    const data: Payload = { reading: c.r, summary: c.s, field: c.field, laps: c.laps, units, theme: th };
    return { flush: true, body: <Sandbox src={String(opts.src ?? "")} data={data} /> };
  },
});
