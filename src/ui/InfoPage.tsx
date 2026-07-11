// Shared shell for the static info pages (#science, #about, #credits): back
// button, theme toggle, centered prose column with a title and subtitle. Keeps
// the pages themselves pure content.

import type { ReactNode } from "react";
import { ThemeIconButton } from "./ThemeIconButton.tsx";
import { BackBar } from "./BackBar.tsx";

export function InfoPage({
  title,
  subtitle,
  onExit,
  children,
}: {
  title: string;
  subtitle: string;
  onExit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <BackBar onBack={onExit} />
      <div className="absolute right-4 top-4">
        <ThemeIconButton />
      </div>

      <div className="mx-auto max-w-2xl px-6 pb-32 pt-16">
        <h1 className="mb-2 text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mb-10 text-muted">{subtitle}</p>

        <div className="space-y-10 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

/** A titled prose section, shared by the info pages. */
export function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
