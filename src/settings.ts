// User settings: one small observable store, persisted to localStorage. Kept in
// plain TS (no React) so the engine/game can read `settings.get()` directly,
// while the UI subscribes through the useSettings hook. The store holds a single
// immutable Settings object and swaps it on every change, so getSnapshot returns
// a stable reference between changes (what useSyncExternalStore needs).

export type ThemePref = "light" | "dark" | "system";

export interface Settings {
  /** Master volume, 0..1. */
  volume: number;
  /** Selected music track id (see MUSIC_TRACKS). */
  music: string;
  /** Whether the breathing-pacing guide is shown. */
  breathing: boolean;
  /** Light/dark preference; "system" follows the OS. */
  theme: ThemePref;
}

// Placeholder track list — the game's audio layer will map these ids to real
// files + charts. Labels are what the menu shows.
export const MUSIC_TRACKS: { value: string; label: string }[] = [
  { value: "calm", label: "Calm" },
  { value: "upbeat", label: "Upbeat" },
  { value: "focus", label: "Focus" },
];

export const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const DEFAULTS: Settings = {
  volume: 0.8,
  music: "calm",
  breathing: true,
  theme: "system",
};

// Shared with the anti-flash inline script in index.html — keep in sync.
export const SETTINGS_STORAGE_KEY = "bop:settings";

function sanitize(s: Settings): Settings {
  return {
    ...s,
    volume: Math.min(1, Math.max(0, Number(s.volume) || 0)),
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // Merge over defaults so a stored object from an older version (missing
      // keys) still yields a complete, valid Settings.
      return sanitize({ ...DEFAULTS, ...parsed });
    }
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
