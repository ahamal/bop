// The app shell. Every screen is a hash route — home (default), the routine
// (#play), the arcade (#arcade), the info pages (#science, #about, #credits),
// and the dev diagnostics page (#dev) — so each
// is bookmarkable, reloadable, and browser-back works (hash changes push
// history entries). Routing is the only thing React owns at the top level;
// everything per-frame lives below in the engine.

import { useSyncExternalStore } from "react";
import { ArcadeScreen } from "./ArcadeScreen.tsx";
import { DevScreen } from "./DevScreen.tsx";
import { GameScreen } from "./GameScreen.tsx";
import { PlayScreen } from "./PlayScreen.tsx";
import { ScienceScreen } from "./ScienceScreen.tsx";
import { AboutScreen } from "./AboutScreen.tsx";
import { CreditsScreen } from "./CreditsScreen.tsx";
import { useSettings } from "./useSettings.ts";
import { useApplyTheme } from "./theme.ts";

function subscribe(cb: () => void): () => void {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function route(): string {
  return window.location.hash.replace(/^#\/?/, "");
}

const go = (hash: string): void => {
  window.location.hash = hash;
};
const goHome = (): void => go("");

export function App() {
  const current = useSyncExternalStore(subscribe, route);
  useApplyTheme(useSettings().theme);
  if (current === "dev") return <DevScreen />;
  if (current === "play") return <PlayScreen onExit={goHome} />;
  if (current === "arcade") return <ArcadeScreen onExit={goHome} />;
  if (current === "science") return <ScienceScreen onExit={goHome} />;
  if (current === "about") return <AboutScreen onExit={goHome} />;
  if (current === "credits") return <CreditsScreen onExit={goHome} />;
  // Anything unrecognized falls through to home.
  return <GameScreen onBegin={() => go("play")} onMinigames={() => go("arcade")} />;
}
