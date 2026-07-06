// The game screen — a placeholder for now, with the theme toggle top-right.
// This is where the session, avatar, note highway, and React HUD will come
// together. The dev page (#dev) keeps the real tracking UI.

import { useState } from "react";
import { ChevronRightIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import { ThemeIconButton } from "./ThemeIconButton.tsx";
import { Button } from "./Button.tsx";
import { HeroAvatar } from "../avatar/HeroAvatar.tsx";

const FADE_MS = 500;

export function GameScreen({
  onBegin,
  onMinigames,
}: {
  onBegin: () => void;
  onMinigames: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  // Fade the home out, then hand off to the next screen (app state, not a
  // route) so it fades in — a crossfade rather than an instant cut.
  const leaveTo = (next: () => void): void => {
    setLeaving(true);
    setTimeout(next, FADE_MS);
  };

  return (
    <div
      className={`relative flex min-h-screen flex-col items-center justify-center gap-6 bg-bg pb-24 text-text transition-opacity duration-500 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Just the theme toggle — the full settings menu lives where its
          options apply (the play screen). */}
      <div className="absolute right-4 top-4">
        <ThemeIconButton />
      </div>

      <HeroAvatar className="h-64 w-64" />

      <h1 className="text-5xl font-bold tracking-tight">bop</h1>
      <p className="text-muted">Guided neck exercises, tracked by your webcam.</p>

      <div className="mt-2 flex flex-col items-center gap-3">
        <Button
          variant="primary"
          size="md"
          onClick={() => leaveTo(onBegin)}
          disabled={leaving}
          className="group inline-flex items-center gap-1.5"
        >
          Start a 4-minute routine
          <ChevronRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
        </Button>
        <Button
          size="md"
          onClick={() => leaveTo(onMinigames)}
          disabled={leaving}
          className="group inline-flex items-center gap-1.5"
        >
          Play a quick game
          <ChevronRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
        </Button>
      </div>

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
