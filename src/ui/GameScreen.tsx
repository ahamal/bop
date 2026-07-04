// The game screen — a placeholder for now, but with the settings dropdown wired
// in (top-right). This is where the session, avatar, note highway, and React
// HUD will come together. The dev page (#dev) keeps the real tracking UI.

import { useState } from "react";
import { WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { Button } from "./Button.tsx";
import { HeroAvatar } from "../avatar/HeroAvatar.tsx";

const FADE_MS = 500;

export function GameScreen({ onBegin }: { onBegin: () => void }) {
  const [leaving, setLeaving] = useState(false);

  // Fade the home out, then hand off to the play screen (app state, not a route)
  // so it fades in — a crossfade rather than an instant cut.
  const begin = (): void => {
    setLeaving(true);
    setTimeout(onBegin, FADE_MS);
  };

  return (
    <div
      className={`relative flex min-h-screen flex-col items-center justify-center gap-6 bg-bg pb-24 text-text transition-opacity duration-500 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="absolute right-4 top-4">
        <SettingsMenu />
      </div>

      <HeroAvatar className="h-64 w-64" />

      <h1 className="text-5xl font-bold tracking-tight">bop</h1>
      <p className="text-muted">Loosen your neck to the beat.</p>

      <Button variant="primary" size="lg" onClick={begin} disabled={leaving} className="mt-2">
        Begin
      </Button>

      <a
        href="#dev"
        aria-label="Dev diagnostics"
        title="Dev diagnostics"
        className="absolute bottom-4 left-4 inline-flex items-center text-muted transition hover:text-text"
      >
        <WrenchScrewdriverIcon className="h-5 w-5" />
      </a>
    </div>
  );
}
