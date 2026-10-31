import { useState } from "react";
import { Workspace } from "./engine/Workspace";
import { useNav } from "./state/nav";
import { usePrefs } from "./state/prefs";
import { ConfirmHost } from "./shell/confirm";
import { Drawer, EditBar } from "./shell/EditBar";
import { EngineerBar, useDrawer } from "./shell/EngineerBar";
import { KeysDialog } from "./shell/KeysDialog";
import { KpiStrip } from "./shell/KpiStrip";
import { ModuleOptions } from "./shell/ModuleOptions";
import { Settings } from "./shell/Settings";
import { Templates } from "./shell/Templates";
import { FocusPopup } from "./shell/FocusPopup";
import { PitCall } from "./shell/PitCall";
import { Toast } from "./shell/Toast";
import { TopBar } from "./shell/TopBar";
import { useShortcuts } from "./shell/useShortcuts";
import { Welcome } from "./shell/Welcome";

export function App() {
  const { tpl, wsId } = useNav();
  const prefs = usePrefs();
  const [welcome, setWelcome] = useState(true);
  const [drawerOpen, toggleDrawer] = useDrawer();
  const [keys, setKeys] = useState(false);
  useShortcuts({ toggleDrawer, drawerOpen, showKeys: () => setKeys(true) });
  const ws = tpl.workspaces.find((w) => w.id === wsId) ?? tpl.workspaces[0]!;

  return (
    <>
      {welcome && <Welcome onEnter={() => setWelcome(false)} />}
      <div className="app" id="app">
        <TopBar onKeys={() => setKeys(true)} />
        {prefs.kpiOn && <KpiStrip />}
        <EditBar />
        <Workspace workspace={ws} />
        <EngineerBar open={drawerOpen} onToggle={toggleDrawer} />
      </div>
      <Drawer />
      <ModuleOptions />
      <Templates />
      <Settings />
      <KeysDialog open={keys} onClose={() => setKeys(false)} />
      <ConfirmHost />
      <Toast />
      <FocusPopup />
      <PitCall />
    </>
  );
}
