// The dev hub (#dev) — one page listing every dev-only tool/authoring page, so
// the home footer carries a single "Dev" link instead of one per tool. Hidden
// from production (the footer link is DEV-gated); the pages it points to are
// reachable by hash regardless, but this is the front door in development.

import { ThemeIconButton } from "./ThemeIconButton.tsx";
import { BackBar } from "./BackBar.tsx";

// Add a dev page here and it shows up in the hub — the single place to register
// internal tooling.
const DEV_PAGES: { hash: string; label: string; desc: string }[] = [
  {
    hash: "tracker",
    label: "Tracker",
    desc: "Live head-tracking diagnostics — landmarks, angles, and gesture states.",
  },
  {
    hash: "practice",
    label: "Practice",
    desc: "Calibrate once, then play any activity × level on demand — no director.",
  },
  {
    hash: "models",
    label: "Models",
    desc: "Per-move 3D pose viewer (a placeholder sphere until real assets land).",
  },
];

export function DevIndexScreen({ onExit }: { onExit: () => void }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <BackBar onBack={onExit} />
      <div className="absolute right-4 top-4">
        <ThemeIconButton />
      </div>

      <div className="mx-auto max-w-2xl px-6 pb-24 pt-16">
        <h1 className="mb-2 text-4xl font-bold tracking-tight">Dev</h1>
        <p className="mb-8 text-muted">Internal tools and authoring pages — not shipped to production.</p>

        <div className="grid gap-3 sm:grid-cols-2">
          {DEV_PAGES.map((p) => (
            <a
              key={p.hash}
              href={`#${p.hash}`}
              className="group rounded-2xl border border-black/10 p-5 transition hover:border-accent hover:bg-accent/5 dark:border-white/10"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-bold tracking-tight">{p.label}</span>
                <span className="text-muted transition group-hover:translate-x-0.5 group-hover:text-accent">
                  →
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">{p.desc}</p>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
