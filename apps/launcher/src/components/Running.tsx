import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { Button, Card, Label } from "./ui";

interface Props {
  address: string;
  link: string;
  lines: string[];
  stopping: boolean;
  onStop: () => void;
}

export function Running({ address, link, lines, stopping, onStop }: Props) {
  const [copied, setCopied] = useState(false);
  const log = useRef<HTMLPreElement>(null);

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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex items-center gap-3 px-5 py-3">
        <span className={`text-xl ${stopping ? "text-warn" : "text-ok"}`} aria-hidden>●</span>
        <span className="text-[17px] font-semibold">{stopping ? "Stopping" : "Running"}</span>
        <span className="ml-auto font-mono text-[13px] text-muted">{address}</span>
        <Button kind="danger" onClick={onStop} disabled={stopping}>Stop</Button>
      </Card>

      <div>
        <Label>Send this link to your engineer</Label>
        <div className="flex gap-2">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()}
            className="h-10 min-w-0 flex-1 rounded-md border border-line bg-raise px-3 font-mono text-[13px] text-accent" />
          <Button onClick={() => openUrl(link)} className="h-10 w-[72px]">Open</Button>
          <Button onClick={copy} className={`h-10 w-24 border-accent ${copied ? "bg-ok text-bg" : "bg-accent text-bg hover:bg-accent-hover"}`}>{copied ? "Copied" : "Copy"}</Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <Label>Log</Label>
        <pre ref={log} className="min-h-32 flex-1 select-text overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[11px] leading-relaxed text-muted">{lines.join("\n")}</pre>
      </div>
      <p className="text-[12px] text-dim">Leave this window open, or minimise it, while you drive. Stop ends the connection, and so does closing the window.</p>
    </div>
  );
}
