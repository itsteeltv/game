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
