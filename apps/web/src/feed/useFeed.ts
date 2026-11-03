import { useSyncExternalStore } from "react";
import { Ctx, feed } from "./store";

export const useFeed = (): Ctx => useSyncExternalStore(feed.subscribe, feed.get);
