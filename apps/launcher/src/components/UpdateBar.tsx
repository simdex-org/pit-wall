import { useCallback, useEffect, useState } from "react";
import { checkForUpdate, installUpdate } from "../lib/updates";
import { Button } from "./ui";

type State = "checking" | "none" | "current" | "available" | "installing" | "done" | "failed";

export function UpdateBar({ running }: { running: boolean }) {
  const [state, setState] = useState<State>("checking");

  const check = useCallback(async () => {
    setState("checking");
    try {
      const found = await checkForUpdate();
      setState(found.latest === null ? "none" : found.available ? "available" : "current");
    } catch {
      setState("failed");
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const install = async () => {
    setState("installing");
    try {
      await installUpdate();
      setState("done");
    } catch {
      setState("failed");
    }
  };

  const text = {
    checking: "Checking for updates.",
    none: "No update has been published yet.",
    current: "Pit Wall is up to date.",
    available: running ? "A newer version is available. Stop Pit Wall to update." : "A newer version is available.",
    installing: "Downloading the update.",
    done: "Updated. Start Pit Wall to use it.",
    failed: "Could not reach the update server.",
  }[state];

  return (
    <div role="status" className="flex items-center gap-3 text-xs text-muted">
      <span className="flex-1">{text}</span>
      {state === "available" && <Button disabled={running} onClick={install}>Update</Button>}
      {(state === "none" || state === "current" || state === "failed") && <Button onClick={check}>Check for updates</Button>}
    </div>
  );
}
