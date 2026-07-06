// The app shell. Two screens for now — the game (default) and the dev
// diagnostics page (#dev) — switched by the URL hash so each is reloadable and
// linkable. Routing is the only thing React owns at the top level; everything
// per-frame lives below in the engine.

import { useState, useSyncExternalStore } from "react";
import { ArcadeScreen } from "./ArcadeScreen.tsx";
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
  // Play and the arcade are app state (not bookmarkable routes); only #dev
  // routes. The arcade owns picker ↔ game internally so its camera session
  // survives game switches.
  const [screen, setScreen] = useState<"home" | "play" | "minigames">("home");
  if (current === "dev") return <DevScreen />;
  if (screen === "play") return <PlayScreen onExit={() => setScreen("home")} />;
  if (screen === "minigames") return <ArcadeScreen onExit={() => setScreen("home")} />;
  return (
    <GameScreen
      onBegin={() => setScreen("play")}
      onMinigames={() => setScreen("minigames")}
    />
  );
}
