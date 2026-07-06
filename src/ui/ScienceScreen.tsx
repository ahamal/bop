// The science page (#science) — a static, scrollable article on "tech neck":
// what it is, the physics of forward head flexion, the scale of the problem,
// and the evidence that exercise helps — plus the movements in bop's routine.
// Linked from the home screen tagline.

import { InfoPage, InfoSection as Section } from "./InfoPage.tsx";
import {
  GlyphNod,
  GlyphRoll,
  GlyphRotate,
  GlyphTilt,
  GlyphTuck,
  TechNeckDiagram,
} from "./scienceArt.tsx";

// One numbered reference: rendered in the References list and cited inline
// via <Cite n={...} />, which links down to it.
const REFERENCES = [
  {
    label:
      "Hansraj KK. Assessment of stresses in the cervical spine caused by posture and position of the head. Surg Technol Int. 2014;25:277-9.",
    href: "https://pubmed.ncbi.nlm.nih.gov/25393825/",
  },
  {
    label:
      "GBD 2021: Global, regional, and national burden of neck pain, 1990–2020, and projections to 2050. Lancet Rheumatol. 2024.",
    href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10897950/",
  },
  {
    label:
      "Alzhrani A, et al. Prevalence and interrelationships of screen time, visual disorders, and neck pain among university students. Healthcare. 2024;12(20):2067.",
    href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11507102/",
  },
  {
    label:
      "Ylinen J, et al. Active neck muscle training in the treatment of chronic neck pain in women: a randomized controlled trial. JAMA. 2003;289(19):2509-16.",
    href: "https://pubmed.ncbi.nlm.nih.gov/12759322/",
  },
  {
    label:
      "Louw S, et al. Effectiveness of exercise in office workers with neck pain: a systematic review and meta-analysis. S Afr J Physiother. 2017;73(1):392.",
    href: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6093121/",
  },
  {
    label:
      "Sterling M, et al. Best evidence rehabilitation for chronic pain part 4: neck pain. J Clin Med. 2019;8(8):1219.",
    href: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6723111/",
  },
] as const;

// Inline citation marker — superscript number that scrolls to the reference
// entry. Scrolls imperatively rather than via a #fragment href: the app's hash
// is the router's (an unknown hash would bounce us back to the home route).
function Cite({ n }: { n: number }) {
  return (
    <sup>
      <button
        onClick={() =>
          document
            .getElementById(`science-ref-${n}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" })
        }
        className="font-medium text-accent hover:underline"
      >
        [{n}]
      </button>
    </sup>
  );
}

export function ScienceScreen({ onExit }: { onExit: () => void }) {
  return (
    <InfoPage
      title="The science behind tech neck"
      subtitle="Why hours of looking down at screens hurt, and why moving your neck helps."
      onExit={onExit}
    >
          <Section title="A silent pandemic">
            <p>
              &ldquo;Tech neck&rdquo; (or &ldquo;text neck&rdquo;) is the neck pain, stiffness,
              and postural strain that comes from spending hours a day with your head bent
              forward over a phone or laptop. It rarely announces itself with an injury —
              it accumulates quietly, which is why clinicians have taken to calling it a
              silent pandemic of the screen era.
            </p>
            <p>
              The numbers back the name: the Global Burden of Disease study counted about{" "}
              <strong>206 million people</strong> living with neck pain in 2021 — nearly
              double the 1990 figure — and projects roughly 269 million by 2050.
              <Cite n={2} /> Among university students, heavy screen users report neck pain
              at rates of 48–78%, versus roughly 23% in the general population.
              <Cite n={3} />
            </p>
          </Section>

          <Section title="The physics: your head gets heavier">
            <p>
              An adult head weighs about 5&nbsp;kg (10–12&nbsp;lb). Held upright, that load
              sits balanced on top of the spine. Tilt it forward and the lever arm grows —
              your neck muscles and cervical discs have to resist a force far larger than
              the head&rsquo;s actual weight.
            </p>
            <p>
              A widely cited biomechanical model by spine surgeon Kenneth Hansraj estimated
              the effective load on the cervical spine at increasing flexion angles:
              <Cite n={1} />
            </p>
            <figure className="rounded-2xl bg-panel px-4 py-6 shadow-sm">
              <TechNeckDiagram />
              <figcaption className="mt-3 text-center text-xs text-muted">
                Effective load on the cervical spine by head-tilt angle — 60° is the typical
                phone-in-lap posture.
                <Cite n={1} />
              </figcaption>
            </figure>
            <p>
              These are model estimates, not direct measurements — the exact figures depend
              on head weight and spine geometry — but the pattern is well established:
              cervical load grows disproportionately as the angle increases. At two to four
              hours of head-down screen time a day, that adds up to 700–1,400 hours a year
              of excess stress on the cervical spine.
              <Cite n={1} />
            </p>
          </Section>

          <Section title="Movement is the treatment">
            <p>
              The good news: the best-supported remedy is cheap and simple. Across
              randomized trials and systematic reviews, <strong>exercise therapy</strong> —
              neck strengthening, mobility, and motor-control work — shows the strongest
              treatment effects for chronic and office-work-related neck pain.
              <Cite n={5} />
              <Cite n={6} /> A landmark randomized trial found that women with chronic neck
              pain who did regular neck-strengthening exercises had significant, lasting
              reductions in pain and disability, holding up at one-year follow-up.
              <Cite n={4} />
            </p>
            <p>
              That is what bop is for: short, guided neck-mobility routines that get you
              through the movements that counteract a day of looking down — tracked by your
              webcam so you actually do them, and do them fully.
            </p>
          </Section>

          <Section title="The fix: a few minutes of guided movement">
            <p>
              You don&rsquo;t need equipment or a gym — you need to regularly take your neck
              through its full range of motion and strengthen the muscles that hold your
              head up. These are the movements bop&rsquo;s routine walks you through:
            </p>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <GlyphTuck />
                <span>
                <strong>Chin tucks.</strong> The classic anti-tech-neck exercise: draw your
                chin straight back, making a &ldquo;double chin.&rdquo; This activates the
                deep neck flexors — the muscles that weaken with forward-head posture — and
                is the strengthening move most often prescribed in the trials that showed
                lasting pain relief.
                <Cite n={4} />
                </span>
              </li>
              <li className="flex items-start gap-3">
                <GlyphTilt />
                <span>
                <strong>Side tilts (ear to shoulder).</strong> Stretches the upper trapezius
                and the side of the neck, where screen-posture tension concentrates. Adding
                gentle hand-on-head overpressure once you&rsquo;re warmed up deepens the
                stretch safely.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <GlyphRotate />
                <span>
                <strong>Rotations (look over each shoulder).</strong> Restores the rotational
                range of motion that stiffens first when your head stays fixed on a screen
                for hours.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <GlyphNod />
                <span>
                <strong>Flexion and extension (chin to chest, then gently look up).</strong>{" "}
                Moves the cervical spine through the exact plane tech neck locks it in — but
                through its full range and both directions, instead of one sustained slump.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <GlyphRoll />
                <span>
                <strong>Slow neck rolls.</strong> A flowing cooldown that links the movements
                together and leaves the neck loose rather than braced.
                </span>
              </li>
            </ul>
            <p>
              The evidence points to consistency over intensity: short sessions, done
              regularly, beat occasional heroics.
              <Cite n={5} /> That&rsquo;s the point of a four-minute routine your webcam
              coaches you through — it&rsquo;s easy enough to actually do every day.
            </p>
          </Section>

          <Section title="References">
            <ol className="list-decimal space-y-2 pl-6 text-sm text-muted">
              {REFERENCES.map((ref, i) => (
                <li key={ref.href} id={`science-ref-${i + 1}`}>
                  <a
                    href={ref.href}
                    target="_blank"
                    rel="noreferrer"
                    className="transition hover:text-text"
                  >
                    {ref.label}
                  </a>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted">
              This page is for general information and isn&rsquo;t medical advice. If you
              have persistent or severe neck pain, see a clinician.
            </p>
          </Section>
    </InfoPage>
  );
}
