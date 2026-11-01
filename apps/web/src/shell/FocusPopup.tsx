import { feed } from "../feed/store";
import { useFeed } from "../feed/useFeed";

/** Shown while the page follows another car: one click goes back to your own. */
export function FocusPopup() {
  const c = useFeed();
  if (c.focus === "self") return null;
  return <button type="button" id="focusPop" onClick={() => feed.setFocus("self")}>Back to my car</button>;
}
