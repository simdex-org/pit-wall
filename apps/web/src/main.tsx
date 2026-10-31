import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { link } from "./feed/connection";
import "./modules";
import { appearance } from "./state/appearance";
import { migrate } from "./state/migrate";
import { nav } from "./state/nav";
import { prefs } from "./state/prefs";
import { recorder } from "./state/recorder";
import { feed } from "./feed/store";
import { templates } from "./state/templates";
import "./styles/index.css";

migrate();
appearance.boot();
templates.init();
nav.start();
link.connect(prefs.get().hz);
feed.subscribe(() => recorder.onFeed(feed.get()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
