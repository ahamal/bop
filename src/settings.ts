// User settings: one small observable store, persisted to localStorage. Kept in
// plain TS (no React) so the engine/game can read `settings.get()` directly,
// while the UI subscribes through the useSettings hook. The store holds a single
// immutable Settings object and swaps it on every change, so getSnapshot returns
// a stable reference between changes (what useSyncExternalStore needs).
//
// Down to just the theme: music/volume moved into the music player itself and
// the old settings menu was removed with them (breathing guide went unused).

export type ThemePref = "light" | "dark" | "system";

export interface Settings {
  /** Light/dark preference; "system" follows the OS. */
  theme: ThemePref;
}

const THEMES: readonly ThemePref[] = ["light", "dark", "system"];

const DEFAULTS: Settings = {
  theme: "system",
};

// Shared with the anti-flash inline script in index.html — keep in sync.
export const SETTINGS_STORAGE_KEY = "bop:settings";

// Rebuild field-by-field: drops stale keys from older stored versions and
// falls back per-field on invalid values.
function sanitize(s: Partial<Settings>): Settings {
  return {
    theme: THEMES.includes(s.theme as ThemePref) ? (s.theme as ThemePref) : DEFAULTS.theme,
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return sanitize(JSON.parse(raw) as Partial<Settings>);
  } catch {
    // Malformed JSON or unavailable storage — fall back to defaults.
  }
  return { ...DEFAULTS };
}

class SettingsStore {
  private state = load();
  private listeners = new Set<() => void>();

  /** Current settings (stable reference until the next set()). */
  get = (): Settings => this.state;

  /** Merge a partial update, persist it, and notify subscribers. */
  set(patch: Partial<Settings>): void {
    this.state = sanitize({ ...this.state, ...patch });
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Quota or unavailable storage — keep the in-memory value anyway.
    }
    for (const l of this.listeners) l();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
}

export const settings = new SettingsStore();
