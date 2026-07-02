// React binding for the settings store. Re-renders the component whenever any
// setting changes; writes go straight through `settings.set(...)`.

import { useSyncExternalStore } from "react";
import { settings, type Settings } from "../settings.ts";

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.get, settings.get);
}
