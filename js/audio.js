import { getSettings } from './storage.js';

let ctx = null;

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Autoplay policy parks the context until a gesture; every call site here is
  // downstream of a click or keypress, so resuming is safe and needed after tab-switches.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Short procedural beep. No audio files — Web Audio only. */
export function beep({ freq = 440, duration = 0.1, type = 'square', gain = 0.15 } = {}) {
  const settings = getSettings();
  if (!settings.sfx) return;

  const level = gain * settings.volume;
  // exponentialRampToValueAtTime cannot start from 0: at volume 0 this used to
  // produce an invalid ramp. Nothing to play anyway, so bail out first.
  if (level <= 0.0001) return;

  const ac = getCtx();
  if (!ac) return;

  try {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g).connect(ac.destination);

    const now = ac.currentTime;
    g.gain.setValueAtTime(level, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // A dead/closed context must never take the game loop down with it.
  }
}

const seq = (notes, step, opts) => notes.forEach((f, i) => setTimeout(() => beep({ freq: f, ...opts }), i * step));

export const sfx = {
  move: () => beep({ freq: 220, duration: 0.04, type: 'square', gain: 0.07 }),
  hit: () => beep({ freq: 150, duration: 0.12, type: 'sawtooth', gain: 0.18 }),
  score: () => beep({ freq: 660, duration: 0.12, type: 'triangle', gain: 0.18 }),
  clear: () => beep({ freq: 880, duration: 0.14, type: 'triangle', gain: 0.2 }),
  shoot: () => beep({ freq: 520, duration: 0.05, type: 'square', gain: 0.08 }),
  pickup: () => seq([660, 990], 70, { duration: 0.1, type: 'triangle', gain: 0.18 }),
  gameover: () => seq([300, 220, 150], 140, { duration: 0.24, type: 'sawtooth', gain: 0.2 }),
  win: () => seq([523, 659, 784, 1046], 110, { duration: 0.16, type: 'triangle', gain: 0.2 }),
};

/* --- Music: a tiny chiptune sequencer ------------------------------------ */
// Songs are data: voices of [note, beats] that loop. Every voice reads the same
// beat clock, so a tempo change (levels speed up) never lets them drift apart.

const SEMI = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
const freqOf = (n) => {
  const m = /^([A-G])(#?)(\d)$/.exec(n);
  return 440 * 2 ** ((SEMI[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12) / 12);
};

// "Korobeiniki", a 19th-century Russian folk song — public domain.
const kLead = [
  ['E5', 1], ['B4', .5], ['C5', .5], ['D5', 1], ['C5', .5], ['B4', .5], ['A4', 1], ['A4', .5], ['C5', .5],
  ['E5', 1], ['D5', .5], ['C5', .5], ['B4', 1.5], ['C5', .5], ['D5', 1], ['E5', 1], ['C5', 1], ['A4', 1], ['A4', 1], ['R', 1],
  ['R', .5], ['D5', 1], ['F5', .5], ['A5', 1], ['G5', .5], ['F5', .5], ['E5', 1.5], ['C5', .5], ['E5', 1], ['D5', .5], ['C5', .5],
  ['B4', 1], ['B4', .5], ['C5', .5], ['D5', 1], ['E5', 1], ['C5', 1], ['A4', 1], ['A4', 1], ['R', 1],
];
// Pumping octave bass, one root per bar.
const kBass = ['E2', 'A2', 'G#2', 'A2', 'D2', 'C2', 'E2', 'A2'].flatMap((root) => {
  const up = root.replace(/\d$/, (o) => Number(o) + 1);
  return [root, up, root, up, root, up, root, up].map((n) => [n, .5]);
});

export const SONGS = {
  korobeiniki: {
    bpm: 144,
    voices: [
      { notes: kLead, type: 'square', gain: 0.07, len: 0.85 },
      { notes: kBass, type: 'triangle', gain: 0.12, len: 0.7 },
    ],
  },
};

let music = null;

export function stopMusic() {
  if (!music) return;
  clearInterval(music.timer);
  try { music.out.gain.setTargetAtTime(0, music.ac.currentTime, 0.03); } catch { /* closed */ }
  music = null;
}

/** Loop a song. `rate` scales the tempo (1 = written tempo). */
export function playMusic(song, rate = 1) {
  stopMusic();
  const s = getSettings();
  if (!s.music || s.volume <= 0) return;
  const ac = getCtx();
  if (!ac) return;

  const out = ac.createGain();
  out.gain.value = s.volume;
  out.connect(ac.destination);

  let t0 = ac.currentTime + 0.08, b0 = 0;
  const spb = () => 60 / (song.bpm * rate);
  const timeOf = (b) => t0 + (b - b0) * spb();
  const voices = song.voices.map((v) => ({ ...v, i: 0, beat: 0 }));

  const tick = () => {
    const horizon = ac.currentTime + 0.2;   // schedule ahead: timers jitter, the audio clock doesn't
    for (const v of voices) {
      while (timeOf(v.beat) < horizon) {
        const [n, beats] = v.notes[v.i];
        const at = timeOf(v.beat), dur = beats * spb() * v.len;
        if (n !== 'R') {
          const osc = ac.createOscillator(), g = ac.createGain();
          osc.type = v.type;
          osc.frequency.value = freqOf(n);
          g.gain.setValueAtTime(v.gain, at);
          g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
          osc.connect(g).connect(out);
          osc.start(at);
          osc.stop(at + dur + 0.02);
        }
        v.beat += beats;
        v.i = (v.i + 1) % v.notes.length;
      }
    }
  };

  music = {
    ac, out,
    timer: setInterval(tick, 50),
    setRate(r) {
      const now = ac.currentTime;
      b0 = b0 + (now - t0) / spb(); t0 = now;   // re-anchor the clock at "now", then change speed
      rate = r;
    },
  };
  tick();
}

export function setMusicRate(r) { music?.setRate(r); }

/** The shared Web Audio context, for games that synthesise their own sound (Doom). */
export const audioContext = () => getCtx();
