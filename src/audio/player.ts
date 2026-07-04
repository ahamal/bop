// The music player engine — plain TS, no React. Owns a single HTMLAudioElement,
// walks the playlist with auto-advance, and notifies subscribers only on coarse
// changes (track switch, play/pause), so the React shell just re-renders a
// label and an icon. Volume defaults to 50%.

import { TRACKS, type Track } from "./playlist.ts";

export interface PlayerState {
  track: Track;
  playing: boolean;
  volume: number;
}

type Listener = (s: PlayerState) => void;

class MusicPlayer {
  private audio = new Audio();
  private order: Track[];
  private index = 0;
  private listeners = new Set<Listener>();
  // The user-facing volume. The element's actual volume is base × duckFactor,
  // so a duck never disturbs the volume the slider shows/sets.
  private base = 0.5;
  private duckFactor = 1;
  private duckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(tracks: readonly Track[]) {
    this.order = shuffle(tracks);
    this.audio.volume = this.base;
    this.audio.preload = "none";
    this.audio.addEventListener("ended", () => this.next(true));
    this.audio.addEventListener("play", () => this.emit());
    this.audio.addEventListener("pause", () => this.emit());
  }

  get state(): PlayerState {
    return {
      track: this.order[this.index],
      playing: !this.audio.paused,
      volume: this.base,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Start playback (no-op if already playing). Safe to call from tracking
   *  callbacks — a blocked autoplay (no user gesture yet) fails silently. */
  play(): void {
    if (!this.audio.paused) return;
    if (!this.audio.src) this.load();
    this.audio.play().catch(() => {});
  }

  pause(): void {
    this.audio.pause();
  }

  /** Full stop: pause and rewind, so the next play starts the track fresh. */
  stop(): void {
    this.audio.pause();
    if (this.audio.src) this.audio.currentTime = 0;
  }

  toggle(): void {
    if (this.audio.paused) this.play();
    else this.pause();
  }

  next(autoplay = false): void {
    const wasPlaying = autoplay || !this.audio.paused;
    this.index += 1;
    // End of the shuffled queue → reshuffle for a fresh order, avoiding an
    // immediate repeat of the track that just finished.
    if (this.index >= this.order.length) {
      const last = this.order[this.order.length - 1];
      do {
        this.order = shuffle(this.order);
      } while (this.order.length > 1 && this.order[0] === last);
      this.index = 0;
    }
    this.load();
    if (wasPlaying) void this.audio.play();
    this.emit();
  }

  setVolume(v: number): void {
    this.base = Math.max(0, Math.min(1, v));
    this.apply();
    this.emit();
  }

  /** Briefly dip the music (for the celebration): ease down to `1 - depth`,
   *  hold, ease back. Restarting a duck mid-duck just retriggers it.
   *  Note depth cuts AMPLITUDE and loudness is logarithmic — 0.7 ≈ -10dB,
   *  which is what actually reads as "the music stepped back". */
  duck(depth = 0.7, holdMs = 1200): void {
    if (this.duckTimer) clearInterval(this.duckTimer);
    const DOWN_MS = 150;
    const UP_MS = 700;
    const STEP = 30;
    const start = performance.now();
    this.duckTimer = setInterval(() => {
      const t = performance.now() - start;
      if (t < DOWN_MS) {
        this.duckFactor = 1 - depth * (t / DOWN_MS);
      } else if (t < DOWN_MS + holdMs) {
        this.duckFactor = 1 - depth;
      } else if (t < DOWN_MS + holdMs + UP_MS) {
        this.duckFactor = 1 - depth * (1 - (t - DOWN_MS - holdMs) / UP_MS);
      } else {
        this.duckFactor = 1;
        clearInterval(this.duckTimer!);
        this.duckTimer = null;
      }
      this.apply();
    }, STEP);
  }

  private apply(): void {
    this.audio.volume = this.base * this.duckFactor;
  }

  private load(): void {
    this.audio.src = this.order[this.index].file;
  }

  private emit(): void {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }
}

// Fisher–Yates, non-mutating.
function shuffle(tracks: readonly Track[]): Track[] {
  const out = [...tracks];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The queue is shuffled on load and reshuffled each time it's exhausted.
export const musicPlayer = new MusicPlayer(TRACKS);
