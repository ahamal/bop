// Light/dark theming. The effective theme is applied by toggling a `.dark` class
// on <html>; all colors are CSS variables that switch under that class (see
// index.css), so both the game UI and the dev page follow along. "system"
// resolves from the OS and tracks live changes.

import { useEffect } from "react";
import type { ThemePref } from "../settings.ts";

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)");

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "system") return prefersDark().matches ? "dark" : "light";
  return pref;
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.classList.toggle("dark", resolveTheme(pref) === "dark");
}

/** Apply the preference and, while it's "system", follow OS theme changes. */
export function useApplyTheme(pref: ThemePref): void {
  useEffect(() => {
    applyTheme(pref);
    if (pref !== "system") return;
    const mq = prefersDark();
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
}
