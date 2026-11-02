import { useCallback, useEffect, useState } from "react";
import { checkForUpdate, installUpdate, type UpdateCheck } from "../lib/updates";
import { Button } from "./ui";

type State = "checking" | "none" | "current" | "available" | "installing" | "failed";

export function UpdateBar({ running }: { running: boolean }) {
  const [state, setState] = useState<State>("checking");
  const [found, setFound] = useState<UpdateCheck | null>(null);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    setState("checking");
    try {
      const c = await checkForUpdate();
      setFound(c);
      setState(c.latestVersion === null ? "none" : c.available ? "available" : "current");
    } catch (e) {
      setError(String(e));
      setState("failed");
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const install = async () => {
    setState("installing");
    try {
      await installUpdate();
    } catch (e) {
      setError(String(e));
      setState("failed");
    }
  };

  const text = {
    checking: "Checking for updates.",
    none: "No release has been published yet.",
    current: "Pit Wall is up to date.",
    available: `${found?.latestVersion ? `Version ${found.latestVersion} is` : "A newer version is"} available.${running ? " Stop Pit Wall to update." : ""}`,
    installing: "Downloading the update. Pit Wall will restart.",
    failed: `Update failed: ${error}`,
  }[state];

  return (
    <div role="status" className="flex items-center justify-between gap-3 text-[12px] text-muted">
      <span className="flex-1">{text}</span>
      {state === "available" && <Button kind="warn" disabled={running} onClick={install}>UPDATE</Button>}
      {(state === "none" || state === "current" || state === "failed") && <Button kind="link" onClick={check}>Check for updates</Button>}
    </div>
  );
}
