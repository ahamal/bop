// The app shell. Two screens for now — the game (default) and the dev
// diagnostics page (#dev) — switched by the URL hash so each is reloadable and
// linkable. Routing is the only thing React owns at the top level; everything
// per-frame lives below in the engine.

import { useState, useSyncExternalStore } from "react";
import { DevScreen } from "./DevScreen.tsx";
import { GameScreen } from "./GameScreen.tsx";
import { PlayScreen } from "./PlayScreen.tsx";
import { useSettings } from "./useSettings.ts";
import { useApplyTheme } from "./theme.ts";

function subscribe(cb: () => void): () => void {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function route(): string {
  return window.location.hash.replace(/^#\/?/, "");
}

export function App() {
  const current = useSyncExternalStore(subscribe, route);
  useApplyTheme(useSettings().theme);
  // The play screen is app state (not a bookmarkable route); only #dev routes.
  const [playing, setPlaying] = useState(false);
  if (current === "dev") return <DevScreen />;
  if (playing) return <PlayScreen />;
  return <GameScreen onBegin={() => setPlaying(true)} />;
}
