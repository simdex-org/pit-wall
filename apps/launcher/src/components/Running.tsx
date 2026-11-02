import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { formatUptime } from "../lib/uptime";
import { Button, Caption, Card, Label, LogBox, TextInput } from "./ui";

interface Props {
  address: string;
  link: string;
  lines: string[];
  stopping: boolean;
  since: number;
  onStop: () => void;
}

export function Running({ address, link, lines, stopping, since, onStop }: Props) {
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <Card className="flex items-center gap-4 border-teal px-5 py-4">
        <span className={`size-3.5 shrink-0 rounded-full ${stopping ? "bg-warn" : "bg-ok"}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[26px] font-bold leading-none tracking-[.14em]">{stopping ? "STOPPING" : "RUNNING"}</div>
          <div className="mt-1.5 font-mono text-[13px] text-muted">{address} · up {formatUptime(now - since)}</div>
        </div>
        <Button kind="danger" onClick={onStop} disabled={stopping} className="h-11 px-6 text-[15px]">STOP</Button>
      </Card>

      <div className="flex flex-col gap-2">
        <Label htmlFor="link">SEND THIS LINK TO YOUR ENGINEER</Label>
        <TextInput id="link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-[50px] px-3.5 text-[14px] text-accent" />
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2.5">
          <Button onClick={() => openUrl(link)} className="h-[46px] text-[15px] font-semibold">Open</Button>
          <Button onClick={copy} className={`h-[46px] rounded text-[16px] font-bold tracking-[.1em] text-bg ${copied ? "bg-ok" : "bg-accent"}`}>{copied ? "COPIED" : "COPY LINK"}</Button>
        </div>
      </div>

      <Card className="flex gap-2.5 border-line px-3.5 py-3 text-[13px] leading-[1.4] text-muted">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#f5c518" strokeWidth="1.5" aria-hidden className="mt-px shrink-0"><path d="M8 1.5l6.5 12h-13z" /><path d="M8 6.5v3.5M8 12v.01" /></svg>
        <span>The link is plain HTTP and is not encrypted. Share it only with your engineer.</span>
      </Card>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <Caption>LOG</Caption>
        <div ref={log} className="min-h-24 flex-1 overflow-auto rounded-md border border-line bg-panel p-3.5">
          <LogBox lines={lines} />
        </div>
      </div>

      <p className="m-0 text-[12px] leading-[1.45] text-muted">Leave this window open, or minimise it, while you drive. Long races are fine. Stop ends the connection, and so does closing the window.</p>
    </>
  );
}
