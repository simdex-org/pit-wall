import { feed } from "../feed/store";
import { useFeed } from "../feed/useFeed";

export function FocusPopup() {
  const c = useFeed();
  if (c.focus === "self") return null;
  return <button type="button" id="focusPop" onClick={() => feed.setFocus("self")}>Back to my car</button>;
}
