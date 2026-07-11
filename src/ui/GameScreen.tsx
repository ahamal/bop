// The game screen — a placeholder for now, with the theme toggle top-right.
// This is where the session, avatar, note highway, and React HUD will come
// together. The tracker page (#tracker) keeps the real tracking UI.

import { useState } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
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
      {/* The wordmark sits top-left as the brand mark; the theme toggle balances
          it top-right. Keeps the hero a clean avatar → headline stack. */}
      <span className="absolute left-5 top-4 text-xl font-bold tracking-tight">bop</span>
      <div className="absolute right-4 top-4">
        <ThemeIconButton />
      </div>

      <HeroAvatar className="h-60 w-60" />

      {/* The hero: the value prop is the single largest thing on the page. */}
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-balance text-center text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
          Fight{" "}
          <a href="#science" className="font-serif italic text-accent transition hover:opacity-80">
            tech neck
          </a>
        </h1>
        <p className="max-w-md text-center text-lg text-muted">
          Guided neck exercises tracked by webcam.
        </p>
      </div>

      <div className="mt-2 flex flex-col items-center gap-4">
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
          size="sm"
          onClick={() => leaveTo(onMinigames)}
          disabled={leaving}
          className="border-transparent!"
        >
          Play a quick game
        </Button>
      </div>

      {/* Footer nav: the static pages, as quiet text links. */}
      <nav className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-5 text-[0.65rem] font-semibold uppercase tracking-widest text-muted">
        {[
          ["about", "About"],
          ["science", "Science"],
          ["credits", "Credits"],
          // Dev hub — hidden from the production build; lists the internal tools.
          ...(import.meta.env.DEV ? ([["dev", "Dev"]] as const) : []),
        ].map(([hash, label]) => (
          <a key={hash} href={`#${hash}`} className="transition hover:text-text">
            {label}
          </a>
        ))}
        <a
          href="https://github.com/ahamal/bop"
          target="_blank"
          rel="noreferrer"
          className="transition hover:text-text"
        >
          GitHub
        </a>
      </nav>
    </div>
  );
}
