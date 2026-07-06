// The about page (#about): what bop is, how the tracking works, and the
// privacy story. Static content on the shared InfoPage shell.

import { InfoPage, InfoSection as Section } from "./InfoPage.tsx";

export function AboutScreen({ onExit }: { onExit: () => void }) {
  return (
    <InfoPage
      title="About bop"
      subtitle="A neck-exercise coach that lives in your browser and watches you actually do the reps."
      onExit={onExit}
    >
      <Section title="What it is">
        <p>
          bop turns neck care into something you&rsquo;ll actually do. Instead of a PDF of
          stretches you skim once and forget, it&rsquo;s a guided routine: your webcam tracks
          your head, each movement only counts while you&rsquo;re really holding it, and an
          avatar mirrors you along the way. A full session takes about four minutes — short
          enough to fit between meetings, which is the whole point.
        </p>
        <p>
          When you&rsquo;d rather play than stretch, there&rsquo;s also an arcade of quick
          head-controlled minigames — same movements, disguised as games.
        </p>
      </Section>

      <Section title="How it works">
        <p>
          Everything runs in your browser. bop uses MediaPipe&rsquo;s face landmarker — a
          computer-vision model that finds hundreds of reference points on your face every
          frame — to work out where your head is pointing. When a session starts you hold
          still for a moment while it calibrates your neutral pose; after that, tilts,
          turns, nods, and chin tucks are measured as movement relative to that baseline,
          so it works with your posture, your chair, and your camera angle.
        </p>
        <p>
          Each exercise card asks for one movement and its timer only runs while
          you&rsquo;re holding the position — slack off and it pauses. That&rsquo;s the
          difference between doing a stretch and being near one.
        </p>
      </Section>

      <Section title="Privacy">
        <p>
          The camera feed never leaves your device. The face-tracking model runs entirely
          in your browser — no video is uploaded, no frames are stored, and there are no
          accounts. Close the tab and it&rsquo;s as if it never happened, except your neck
          feels better.
        </p>
      </Section>

      <Section title="Why we made it">
        <p>
          Most of us spend our days with our head bent toward a screen, and our necks pay
          for it — quietly, cumulatively. The fix is known and boring: move your neck
          through its range, regularly. bop exists to remove every excuse between you and
          those four minutes. Curious about the evidence? Read{" "}
          <a href="#science" className="underline underline-offset-2 transition hover:text-text">
            the science behind tech neck
          </a>
          .
        </p>
      </Section>
    </InfoPage>
  );
}
