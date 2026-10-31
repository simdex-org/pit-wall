import { useSyncExternalStore } from "react";
import { Ctx, feed } from "./store";

/** The whole context, re-rendering on every payload. For the always-visible chrome; modules use useModuleCtx instead. */
export const useFeed = (): Ctx => useSyncExternalStore(feed.subscribe, feed.get);
