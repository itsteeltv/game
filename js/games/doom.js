// Freedoom on the Doom engine. The engine is doomgeneric (GPL-2.0), compiled to
// WebAssembly by tools/doom/build.sh; the game data is Freedoom (BSD), a complete
// and free replacement for the original's four episodes. A player who owns the
// original can load their own DOOM.WAD instead — it stays on their device.
//
// Everything the engine can't do in a browser happens here: drawing frames,
// routing keys and touch buttons, playing its sound lumps through Web Audio,
// synthesising its MIDI music, and keeping save games in IndexedDB.
import createDoom from './doom/engine.js';
import { audioContext } from '../audio.js';
import { getSettings } from '../storage.js';

// Engine key codes (doomkeys.h).
const K = {
  RIGHT: 0xae, LEFT: 0xac, UP: 0xad, DOWN: 0xaf, STRAFE_L: 0xa0, STRAFE_R: 0xa1,
  USE: 0xa2, FIRE: 0xa3, ESC: 27, ENTER: 13, TAB: 9, BACKSPACE: 0x7f, PAUSE: 0xff,
  RSHIFT: 0x80 + 0x36, RALT: 0x80 + 0x38, EQUALS: 0x3d, MINUS: 0x2d,
};
const FKEYS = [0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44, 0x57, 0x58].map((k) => 0x80 + k);

/** Keyboard → engine key, vanilla layout (Ctrl fires, Space opens, Shift runs). */
function keyFor(e) {
  const named = {
    ArrowUp: K.UP, ArrowDown: K.DOWN, ArrowLeft: K.LEFT, ArrowRight: K.RIGHT,
    Control: K.FIRE, ' ': K.USE, Shift: K.RSHIFT, Alt: K.RALT, Escape: K.ESC, Enter: K.ENTER,
    Tab: K.TAB, Backspace: K.BACKSPACE, Pause: K.PAUSE, ',': K.STRAFE_L, '.': K.STRAFE_R,
    '<': K.STRAFE_L, '>': K.STRAFE_R, '=': K.EQUALS, '+': K.EQUALS, '-': K.MINUS,
  };
  if (named[e.key] !== undefined) return named[e.key];
  const f = /^F(\d{1,2})$/.exec(e.key);
  if (f) return FKEYS[Number(f[1]) - 1];
  // Digits by physical key, so an AZERTY row still picks weapons 1–7.
  const d = /^Digit(\d)$/.exec(e.code);
  if (d) return 48 + Number(d[1]);
  if (e.key.length === 1) return e.key.toLowerCase().charCodeAt(0) & 0xff;
  return null;
}

/* --- Sound effects: DMX lumps straight into Web Audio --------------------- */

function makeSfx(ac, out) {
  const buffers = new Map();   // lump number → AudioBuffer
  const chans = [];

  function decode(lump, bytes) {
    if (buffers.has(lump)) return buffers.get(lump);
    let buf = null;
    // Format 3, rate, length; DMX skips 16 padding bytes at each end.
    if (bytes.length > 8 && bytes[0] === 3 && bytes[1] === 0) {
      const rate = bytes[2] | (bytes[3] << 8);
      const len = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
      if (len > 48 && len <= bytes.length - 8 && rate >= 3000) {
        const n = len - 32;
        buf = ac.createBuffer(1, n, rate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < n; i++) ch[i] = (bytes[8 + 16 + i] - 128) / 128;
      }
    }
    buffers.set(lump, buf);
    return buf;
  }

  const level = (vol) => (vol / 127) * 0.8;
  const pan = (sep) => Math.max(-1, Math.min(1, (sep - 128) / 127));

  return {
    play(ch, lump, bytes, vol, sep) {
      this.stop(ch);
      const buf = decode(lump, bytes);
      if (!buf) return;
      const src = ac.createBufferSource(), g = ac.createGain(), p = ac.createStereoPanner();
      src.buffer = buf;
      g.gain.value = level(vol);
      p.pan.value = pan(sep);
      src.connect(g).connect(p).connect(out);
      const c = { src, g, p, playing: true };
      src.onended = () => { c.playing = false; };
      src.start();
      chans[ch] = c;
    },
    params(ch, vol, sep) {
      const c = chans[ch];
      if (!c) return;
      c.g.gain.setTargetAtTime(level(vol), ac.currentTime, 0.02);
      c.p.pan.setTargetAtTime(pan(sep), ac.currentTime, 0.02);
    },
    stop(ch) {
      const c = chans[ch];
      if (c?.playing) { try { c.src.stop(); } catch { /* already stopped */ } }
      chans[ch] = null;
    },
    playing: (ch) => !!chans[ch]?.playing,
    stopAll() { chans.forEach((_, i) => this.stop(i)); },
  };
}

/* --- Music: a small General MIDI synthesiser ----------------------------- */
// Doom's scores were written for FM cards; oscillators and noise get close in spirit.

function parseMidi(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const str = (n) => String.fromCharCode(...bytes.subarray(p, p + n));
  if (str(4) !== 'MThd') return null;
  const division = v.getUint16(12);
  const ntracks = v.getUint16(10);
  p = 8 + v.getUint32(4);
  const events = [];
  for (let t = 0; t < ntracks && p < bytes.length; t++) {
    if (str(4) !== 'MTrk') break;
    const end = p + 8 + v.getUint32(p + 4);
    p += 8;
    let tick = 0, status = 0;
    const vlq = () => { let n = 0, b; do { b = bytes[p++]; n = (n << 7) | (b & 0x7f); } while (b & 0x80); return n; };
    while (p < end) {
      tick += vlq();
      let b = bytes[p];
      if (b & 0x80) { status = b; p++; } else b = status;   // running status
      const type = status & 0xf0, ch = status & 0x0f;
      if (status === 0xff) {
        const meta = bytes[p++], len = vlq();
        if (meta === 0x51) events.push({ tick, kind: 'tempo', us: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2] });
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
      } else if (type === 0xc0 || type === 0xd0) {
        const a = bytes[p++];
        if (type === 0xc0) events.push({ tick, kind: 'program', ch, a });
      } else {
        const a = bytes[p++], c = bytes[p++];
        if (type === 0x90 && c > 0) events.push({ tick, kind: 'on', ch, a, c });
        else if (type === 0x80 || type === 0x90) events.push({ tick, kind: 'off', ch, a });
        else if (type === 0xb0) events.push({ tick, kind: 'cc', ch, a, c });
        else if (type === 0xe0) events.push({ tick, kind: 'bend', ch, a: ((c << 7) | a) - 8192 });
      }
    }
    p = end;
  }
  events.sort((x, y) => x.tick - y.tick);

  // Ticks → seconds through the tempo map, then pair each note with its release.
  let us = 500000, lastTick = 0, time = 0;
  const notes = [], open = new Map(), state = Array.from({ length: 16 }, () => ({ prog: 0, vol: 100, expr: 127, bend: 0 }));
  for (const e of events) {
    time += ((e.tick - lastTick) * us) / division / 1e6;
    lastTick = e.tick;
    const s = state[e.ch];
    if (e.kind === 'tempo') us = e.us;
    else if (e.kind === 'program') s.prog = e.a;
    else if (e.kind === 'bend') s.bend = e.a;
    else if (e.kind === 'cc') { if (e.a === 7) s.vol = e.c; if (e.a === 11) s.expr = e.c; }
    else if (e.kind === 'on') {
      const n = { t: time, end: time + 0.5, ch: e.ch, key: e.a, vel: e.c, prog: s.prog, gain: (s.vol / 127) * (s.expr / 127), bend: s.bend };
      notes.push(n);
      open.set(e.ch * 128 + e.a, n);
    } else if (e.kind === 'off') {
      const n = open.get(e.ch * 128 + e.a);
      if (n) { n.end = Math.max(time, n.t + 0.02); open.delete(e.ch * 128 + e.a); }
    }
  }
  return { notes, length: Math.max(time, ...notes.map((n) => n.end), 1) };
}

function makeMusic(ac, out) {
  const songs = [];
  let bus = ac.createGain();
  bus.connect(out);
  let volume = 0.7, current = null;
  let noise = null;

  function noiseBuffer() {
    if (noise) return noise;
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  }

  // A timbre per General MIDI family; the distorted guitars get a saw through a filter.
  function voice(n, at, dur) {
    const g = ac.createGain();
    const amp = (n.vel / 127) * n.gain * 0.16;
    if (n.ch === 9) {   // percussion
      const k = n.key;
      if (k === 35 || k === 36) {
        const o = ac.createOscillator();
        o.frequency.setValueAtTime(140, at);
        o.frequency.exponentialRampToValueAtTime(40, at + 0.12);
        g.gain.setValueAtTime(amp * 2.2, at);
        g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
        o.connect(g).connect(bus); o.start(at); o.stop(at + 0.2);
        return;
      }
      const src = ac.createBufferSource(), f = ac.createBiquadFilter();
      src.buffer = noiseBuffer();
      const hat = [42, 44, 46].includes(k), cym = [49, 51, 52, 55, 57, 59].includes(k);
      f.type = hat || cym ? 'highpass' : 'bandpass';
      f.frequency.value = hat ? 7000 : cym ? 5000 : 1800;
      const len = hat ? (k === 46 ? 0.25 : 0.06) : cym ? 0.7 : 0.16;
      g.gain.setValueAtTime(amp * (hat ? 0.8 : 1.6), at);
      g.gain.exponentialRampToValueAtTime(0.001, at + len);
      src.connect(f).connect(g).connect(bus); src.start(at, Math.random() * 0.5); src.stop(at + len + 0.02);
      return;
    }
    const fam = n.prog >> 3;
    const type = [
      'triangle', 'sine', 'square', 'sawtooth', 'triangle', 'sawtooth', 'sawtooth', 'sawtooth',
      'square', 'triangle', 'square', 'triangle', 'sawtooth', 'triangle', 'triangle', 'sine',
    ][fam];
    const slow = fam === 5 || fam === 6 || fam === 11;      // strings, ensembles, pads swell in
    const o = ac.createOscillator(), f = ac.createBiquadFilter();
    o.type = type;
    o.frequency.value = 440 * 2 ** ((n.key - 69) / 12);
    o.detune.value = (n.bend / 8192) * 200;
    f.type = 'lowpass';
    f.frequency.value = fam === 3 ? 2400 : fam === 4 ? 900 : 5000;   // guitars bite, basses stay low
    const a = slow ? 0.08 : 0.006, r = slow ? 0.25 : 0.08;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(amp, at + a);
    g.gain.setTargetAtTime(amp * 0.7, at + a, 0.3);
    g.gain.setTargetAtTime(0.0001, at + dur, r / 3);
    o.connect(f).connect(g).connect(bus);
    o.start(at); o.stop(at + dur + r + 0.05);
  }

  function schedule() {
    const s = current;
    if (!s) return;
    const horizon = ac.currentTime + 0.25;
    while (true) {
      if (s.i >= s.song.notes.length) {
        if (!s.loop) return;
        s.t0 += s.song.length; s.i = 0;   // next pass starts where this one ends
      }
      const n = s.song.notes[s.i];
      const at = s.t0 + n.t;
      if (at > horizon) return;
      if (at >= ac.currentTime - 0.05) voice(n, Math.max(at, ac.currentTime), n.end - n.t);
      s.i++;
    }
  }

  return {
    register(bytes) { songs.push(parseMidi(bytes)); return songs.length; },
    play(id, loop) {
      this.stop();
      const song = songs[id - 1];
      if (!song || !song.notes.length) return;
      current = { song, loop, i: 0, t0: ac.currentTime + 0.1, timer: setInterval(schedule, 60) };
      bus.gain.value = volume;
      schedule();
    },
    stop() {
      if (!current) return;
      clearInterval(current.timer);
      current = null;
      // Notes already queued fade out on the old bus instead of cutting with a click.
      const old = bus;
      old.gain.setTargetAtTime(0, ac.currentTime, 0.05);
      setTimeout(() => old.disconnect(), 600);
      bus = ac.createGain();
      bus.gain.value = volume;
      bus.connect(out);
    },
    volume(v) { volume = (v / 127) * 0.9; bus.gain.setTargetAtTime(volume, ac.currentTime, 0.05); },
    pause(p) {
      if (!current) return;
      if (p) { clearInterval(current.timer); current.pausedAt = ac.currentTime; bus.gain.setTargetAtTime(0, ac.currentTime, 0.05); }
      else if (current.pausedAt !== undefined) {
        current.t0 += ac.currentTime - current.pausedAt;
        delete current.pausedAt;
        bus.gain.setTargetAtTime(volume, ac.currentTime, 0.05);
        current.timer = setInterval(schedule, 60);
      }
    },
  };
}

export function createGame(canvas, host, opts = {}) {
  // 320 × 200 drawn at the 4:3 shape a CRT gave it.
  canvas.width = 640; canvas.height = 480;
  const ctx = canvas.getContext('2d');
  const frame = document.createElement('canvas');
  frame.width = 320; frame.height = 200;
  const fctx = frame.getContext('2d');
  const image = fctx.createImageData(320, 200);

  let mod = null, running = false, paused = false, raf = 0, lastTic = 0, syncTimer = 0, dead = false;
  let sfx = null, music = null, master = null;
  let weapon = 1;
  const coarse = matchMedia('(pointer: coarse)').matches;

  function message(lines, sub = '') {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, 640, 480);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FF4D1F';
    ctx.font = '700 28px ui-monospace, Consolas, monospace';
    [].concat(lines).forEach((l, i) => ctx.fillText(l, 320, 220 + i * 36));
    ctx.fillStyle = '#8E8A98';
    ctx.font = '500 16px ui-monospace, Consolas, monospace';
    if (sub) ctx.fillText(sub, 320, 300);
    ctx.textAlign = 'start';
  }

  const key = (down, k) => { if (mod && k !== null) mod._dg_key(down ? 1 : 0, k); };

  const bridge = {
    frame(ptr, w, h) {
      const src = mod.HEAPU8.subarray(ptr, ptr + w * h * 4), d = image.data;
      for (let i = 0; i < d.length; i += 4) {   // engine pixels are 0x00RRGGBB, little-endian
        d[i] = src[i + 2]; d[i + 1] = src[i + 1]; d[i + 2] = src[i]; d[i + 3] = 255;
      }
      fctx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(frame, 0, 0, 640, 480);
    },
    title() {},
    sfxPlay(ch, lump, ptr, len, vol, sep) { sfx?.play(ch, lump, mod.HEAPU8.subarray(ptr, ptr + len), vol, sep); },
    sfxParams(ch, vol, sep) { sfx?.params(ch, vol, sep); },
    sfxStop(ch) { sfx?.stop(ch); },
    sfxPlaying: (ch) => sfx?.playing(ch) ?? false,
    songRegister: (ptr, len) => music?.register(mod.HEAPU8.slice(ptr, ptr + len)) ?? 0,
    songPlay(id, loop) { music?.play(id, loop); },
    songStop() { music?.stop(); },
    songVolume(v) { music?.volume(v); },
    songPause(p) { music?.pause(p); },
  };

  async function loadWad() {
    if (opts.file) {
      message('LECTURE DU WAD…', opts.file.name);
      return { name: opts.file.name.toLowerCase().replace(/[^a-z0-9._-]/g, ''), bytes: new Uint8Array(await opts.file.arrayBuffer()) };
    }
    let res;
    try { res = await fetch(new URL('./doom/freedoom1.wad', import.meta.url)); }
    catch { throw Object.assign(new Error('offline'), { offline: true }); }   // first launch needs the network
    if (!res.ok) throw new Error(`freedoom1.wad: ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 28795076;
    const reader = res.body.getReader();
    const bytes = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > bytes.length) throw new Error('WAD plus grand que prévu');
      bytes.set(value, got);
      got += value.length;
      message('CHARGEMENT', `${Math.round((got / total) * 100)} %  ·  ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} Mo`);
    }
    return { name: 'freedoom1.wad', bytes: bytes.subarray(0, got) };
  }

  function syncSaves() {
    if (mod) mod.FS.syncfs(false, () => {});
  }

  async function boot() {
    message('CHARGEMENT');
    const ac = audioContext();
    if (ac) {
      master = ac.createGain();
      const s = getSettings();
      master.gain.value = s.sfx ? s.volume : 0;
      master.connect(ac.destination);
      sfx = makeSfx(ac, master);
      music = s.music ? makeMusic(ac, master) : null;
    }
    const wad = await loadWad();
    if (dead) return;

    mod = await createDoom({
      doom: bridge,
      locateFile: (p) => new URL(`./doom/${p}`, import.meta.url).href,
      print: (t) => console.info('[doom]', t),
      printErr: (t) => console.warn('[doom]', t),
    });
    if (dead) return;
    bridge.mod = mod;

    mod.FS.mkdir('/wads');
    mod.FS.writeFile(`/wads/${wad.name}`, wad.bytes);
    // Saves and settings live in IndexedDB, so a run survives closing the tab.
    mod.FS.mkdir('/save');
    mod.FS.mount(mod.IDBFS, {}, '/save');
    await new Promise((r) => mod.FS.syncfs(true, () => r()));
    mod.FS.chdir('/save');

    try {
      mod.callMain(['-iwad', `/wads/${wad.name}`]);
    } catch (e) {
      return fail(e);
    }
    if (coarse) key(true, K.RSHIFT);   // thumbs can't hold Shift: always run on touch
    syncTimer = setInterval(syncSaves, 5000);
    running = true;
    raf = requestAnimationFrame(loop);
  }

  function fail(e) {
    running = false;
    const quit = e && e.name === 'ExitStatus';
    if (e?.offline) message('CONNEXION REQUISE', 'Premier lancement : 29 Mo à télécharger');
    else message(quit ? 'PARTIE QUITTÉE' : 'LE MOTEUR S’EST ARRÊTÉ', quit ? 'Recommencer pour relancer' : String(e?.message || e).slice(0, 60));
    syncSaves();
    music?.stop(); sfx?.stopAll();
  }

  // Run the engine at its own 35 Hz, whatever the display's refresh rate.
  function loop(t) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (paused) return;
    const tic = Math.floor((t * 35) / 1000);
    if (tic === lastTic) return;
    lastTic = tic;
    try { mod._dg_tick(); } catch (e) { fail(e); }
  }

  const onKey = (e) => {
    if (e.target.closest?.('input')) return;
    // A button or link reached with Tab keeps Enter and Space, and Shift+Tab hands the keyboard back to the page.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('a, button') && e.target.matches(':focus-visible')) return;
    if (e.key === 'Tab' && e.shiftKey) return;
    const k = keyFor(e);
    if (k === null) return;
    e.preventDefault();   // no page scroll on Space, no focus jump on Tab
    if (!e.repeat) key(e.type === 'keydown', k);
  };

  return {
    ownsKeyboard: true,
    start() {
      running = false; paused = false; dead = false;
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
      boot().catch(fail);
    },
    togglePause() { return this.setPaused(!paused); },
    setPaused(v) {
      paused = v;
      music?.pause(v);
      if (v) sfx?.stopAll();
      return paused;
    },
    input(a, down) {
      if (a === 'up') key(down, K.UP);
      else if (a === 'down') key(down, K.DOWN);
      else if (a === 'left') key(down, K.LEFT);
      else if (a === 'right') key(down, K.RIGHT);
      else if (a === 'action') {
        // One big button: fires in play, confirms in menus, answers "y" to prompts.
        key(down, K.FIRE); key(down, K.ENTER); key(down, 121);
      } else if (a === 'hold') key(down, K.USE);
      else if (a === 'menu') key(down, K.ESC);
      else if (a === 'weapon' && down) {
        weapon = (weapon % 7) + 1;
        key(true, 48 + weapon); key(false, 48 + weapon);
      }
    },
    destroy() {
      dead = true; running = false;
      cancelAnimationFrame(raf);
      clearInterval(syncTimer);
      syncSaves();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      music?.stop(); sfx?.stopAll();
      master?.disconnect();
      mod = null;
    },
  };
}
