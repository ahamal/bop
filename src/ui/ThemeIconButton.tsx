// Borderless icon button toggling the EFFECTIVE theme light↔dark. Only ever a
// sun or a moon, so it reads as "theme" at a glance; a persisted "system"
// preference is honored until the first click, which pins an explicit choice.
// (A pref cycle was rejected: a computer icon for "system" doesn't signal
// theme. This replaced the settings menu — theme was its only live setting.)

import { SunIcon, MoonIcon } from "@heroicons/react/24/outline";
import { settings } from "../settings.ts";
import { useSettings } from "./useSettings.ts";
import { resolveTheme } from "./theme.ts";

export function ThemeIconButton() {
  const s = useSettings();
  const resolved = resolveTheme(s.theme);
  const IconCmp = resolved === "dark" ? MoonIcon : SunIcon;
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      onClick={() => settings.set({ theme: next })}
      className="rounded-full p-2 text-muted outline-none transition hover:bg-black/5 hover:text-text focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/10"
    >
      <IconCmp className="h-5 w-5" />
    </button>
  );
}
