// Tiny synthesized UI sounds — plain Web Audio, no files. The context is
// created lazily on first use (by then the user has long since interacted, so
// autoplay policy is satisfied) and shared across all effects.
//
// Everything here is deliberately NON-tonal — short filtered-noise taps and a
// low thump, no pitched notes — so it reads as neutral feedback and never
// clashes with whatever music track happens to be playing.

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noise(ac: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** A short noise tap through a bandpass — a soft "tk". */
function tap(at: number, freq: number, dur: number, gain: number): void {
  const ac = audioCtx();
  const t = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** A soft airy sweep — bandpass noise rising through the spectrum, like a
 *  breathy "swish up". Adds a sense of lift/completion without any pitch. */
function swish(at: number, gain: number): void {
  const ac = audioCtx();
  const t = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(1600, t);
  bp.frequency.exponentialRampToValueAtTime(6500, t + 0.22);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.3);
}

/** Card completed: two quick rising taps (the tick's bigger sibling) capped
 *  with a soft upward swish — "done, moving on", no thump, no melody. */
export function playDone(): void {
  tap(0, 2400, 0.035, 0.45);
  tap(0.07, 3400, 0.04, 0.55);
  swish(0.05, 0.25);
}

/** One credited second of hold progress: a very quiet "tk". Slightly brighter
 *  and firmer for the last few seconds ("almost there"). */
export function playTick(nearEnd = false): void {
  tap(0, nearEnd ? 3000 : 2200, 0.03, nearEnd ? 0.4 : 0.25);
}

/** Microgame lost: a rounded low "duh" — a smaller, darker cousin of the
 *  celebrate foomp, capped with a dull knock. Reads instantly as "life gone"
 *  next to the bright rising playDone, still melody-free. */
export function playFail(): void {
  const ac = audioCtx();
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.16);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.32, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + 0.3);
  tap(0.02, 700, 0.06, 0.3);
}

/** A single confetti "pop" — like tap() but panned, so the crackle spreads
 *  across the stereo field. */
function pop(at: number, freq: number, gain: number, pan: number): void {
  const ac = audioCtx();
  const t = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  // Offset the start so simultaneous pops don't all replay the same samples.
  const offset = Math.random() * 0.15;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = 1.8;
  const p = ac.createStereoPanner();
  p.pan.value = pan;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  src.connect(bp).connect(g).connect(p).connect(ac.destination);
  src.start(t, offset);
  src.stop(t + 0.07);
}

/** The popper firing: a rounded low "foomp" — dropping sine body plus a soft
 *  lowpassed air puff. The only low end in the palette; reserved for the
 *  celebration so it lands as an event, not furniture. */
function foomp(): void {
  const ac = audioCtx();
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + 0.25);

  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 350;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.25, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  src.connect(lp).connect(ng).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.12);
}

/** Routine complete (the confetti burst), in three acts:
 *    launch  — the low foomp of the popper firing;
 *    burst   — two upward swishes + ~14 stereo-scattered pops rising in
 *              brightness over ~0.7s;
 *    glitter — a sparse, very quiet tail of bright micro-pops fading out over
 *              ~2.5s while the paper flutters down.
 *  Still melody-free end to end. */
export function playCelebrate(): void {
  foomp();
  swish(0, 0.35);
  swish(0.12, 0.2);
  for (let i = 0; i < 14; i++) {
    const at = Math.random() * 0.7;
    // Later pops trend brighter (2–7kHz) and quieter — the burst "opens up".
    const freq = 2000 + at * 4000 + Math.random() * 1500;
    const gain = 0.3 + Math.random() * 0.25 - at * 0.2;
    pop(at, freq, Math.max(0.12, gain), Math.random() * 1.6 - 0.8);
  }
  for (let i = 0; i < 10; i++) {
    const at = 0.6 + Math.random() * 2.2;
    const fade = 1 - (at - 0.6) / 2.4; // later glints are quieter
    pop(at, 4500 + Math.random() * 3500, 0.04 + 0.08 * fade, Math.random() * 1.8 - 0.9);
  }
}
