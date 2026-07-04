// The floating music player pill (bottom-right of the game screen). A thin
// React shell over the plain-TS musicPlayer engine: it renders the current
// track, a play/pause + skip control, animated EQ bars while playing, and a
// volume slider that slides open on hover. Only coarse state (track, playing,
// volume) crosses into React — no per-frame data.

import { useEffect, useState } from "react";
import { PauseIcon, PlayIcon, ForwardIcon, SpeakerWaveIcon } from "@heroicons/react/20/solid";
import { musicPlayer } from "../audio/player.ts";

const EQ_DELAYS = ["0s", "-0.35s", "-0.7s"];

const GHOST_BTN =
  "flex h-7 w-7 flex-none items-center justify-center rounded-full text-muted transition hover:bg-black/5 hover:text-text dark:hover:bg-white/10";

export function MusicPlayer() {
  const [{ track, playing, volume }, setState] = useState(musicPlayer.state);

  useEffect(() => musicPlayer.subscribe(setState), []);

  return (
    <div className="group flex items-center gap-2.5 rounded-full bg-panel py-1.5 pl-3.5 pr-1.5">
      {/* EQ bars — animate while playing, freeze when paused */}
      <div className="flex h-3 w-3 flex-none items-end justify-center gap-[2px]">
        {EQ_DELAYS.map((delay) => (
          <span
            key={delay}
            className="w-[2px] rounded-full bg-accent [animation:eq_0.9s_ease-in-out_infinite]"
            style={{ animationDelay: delay, animationPlayState: playing ? "running" : "paused" }}
          />
        ))}
      </div>

      <div className="min-w-0 max-w-36 leading-tight">
        <div className="truncate text-[0.7rem] font-medium text-text">{track.title}</div>
        <div className="truncate text-[0.6rem] text-muted">{track.artist}</div>
      </div>

      {/* volume — collapsed until the pill is hovered */}
      <div className="flex w-0 items-center gap-1.5 overflow-hidden opacity-0 transition-all duration-300 group-hover:w-24 group-hover:opacity-100">
        <SpeakerWaveIcon className="h-3.5 w-3.5 flex-none text-muted" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label="Music volume"
          onChange={(e) => musicPlayer.setVolume(e.target.valueAsNumber)}
          className="h-1 w-full accent-(--color-accent)"
        />
      </div>

      <button
        onClick={() => musicPlayer.toggle()}
        aria-label={playing ? "Pause music" : "Play music"}
        className={GHOST_BTN}
      >
        {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4 pl-px" />}
      </button>
      <button
        onClick={() => musicPlayer.next()}
        aria-label="Next track"
        className={`-ml-1.5 ${GHOST_BTN}`}
      >
        <ForwardIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
