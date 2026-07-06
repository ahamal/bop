// The credits page (#credits): music attribution (rendered from the playlist
// manifest so it can't drift from what actually ships), the open-source stack,
// and research credits.

import { ARCADE_TRACKS, TRACKS } from "../audio/playlist.ts";
import { InfoPage, InfoSection as Section } from "./InfoPage.tsx";

const STACK = [
  { name: "MediaPipe Tasks Vision", role: "in-browser face tracking", href: "https://ai.google.dev/edge/mediapipe" },
  { name: "React", role: "UI shell", href: "https://react.dev" },
  { name: "Three.js", role: "the avatar", href: "https://threejs.org" },
  { name: "Tailwind CSS", role: "styling", href: "https://tailwindcss.com" },
  { name: "Heroicons", role: "icons", href: "https://heroicons.com" },
  { name: "Vite", role: "build tooling", href: "https://vite.dev" },
] as const;

function TrackList({ tracks }: { tracks: readonly { title: string; artist: string }[] }) {
  return (
    <ul className="grid gap-x-8 gap-y-1 text-sm text-muted sm:grid-cols-2">
      {tracks.map((t) => (
        <li key={`${t.artist}-${t.title}`}>
          <span className="text-text">{t.title}</span> — {t.artist}
        </li>
      ))}
    </ul>
  );
}

export function CreditsScreen({ onExit }: { onExit: () => void }) {
  return (
    <InfoPage
      title="Credits"
      subtitle="The music, tools, and research bop is built on."
      onExit={onExit}
    >
      <Section title="Music">
        <p>
          All music comes from{" "}
          <a
            href="https://pixabay.com/music/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 transition hover:text-text"
          >
            Pixabay
          </a>{" "}
          and its generous artists, used under the Pixabay Content License. Routine
          sessions play these:
        </p>
        <TrackList tracks={TRACKS} />
        <p>And the arcade runs on its own chippier queue:</p>
        <TrackList tracks={ARCADE_TRACKS} />
      </Section>

      <Section title="Built with">
        <ul className="space-y-1 text-sm">
          {STACK.map((item) => (
            <li key={item.name}>
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline-offset-2 transition hover:underline"
              >
                {item.name}
              </a>{" "}
              <span className="text-muted">— {item.role}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Research">
        <p>
          The health claims bop makes are sourced from published research — the load
          figures, prevalence numbers, and exercise evidence are all cited on{" "}
          <a href="#science" className="underline underline-offset-2 transition hover:text-text">
            the science page
          </a>
          . Thanks to the researchers doing the unglamorous work of measuring necks.
        </p>
      </Section>
    </InfoPage>
  );
}
