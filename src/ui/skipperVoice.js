// The old skipper's voice: the hint lines, spoken once each. Kokoro-82M `bm_george`, rendered ahead
// (tools/skipper_voice.py) into audio/skipper/<hash>.opus and .m4a, listed in audio/skipper/manifest.json.
//
//   const voice = createSkipperVoice({ audio, storage });      // audio: src/audio.js; its 'voice' bus joins at the first gesture
//   voice.say(text)      → Promise<'spoken' | why not>: the text is what lineText() / NOTES[…].speak gave (skipperText.js)
//   voice.setEnabled(on) // the Settings row "skipper's voice"; off stops a line at once and fetches nothing
//   voice.stop(); voice.dispose();
//
// The rules (each has a test, tests/skipperVoice.test.mjs):
//  * once per exact line per browser ('lakeshore.hints.spoken.v1' in the hint's own storage); the second time is text only.
//    A line that was not spoken (off, muted, no gesture yet, late, interrupted before it began) is not marked seen.
//  * no sound before the browser's first gesture: the audio context exists only after audio.start(), and has to be running.
//  * the master sound off, or the voice off, or the hints hidden: nothing is fetched or played.
//  * lazy: a clip is fetched and decoded when its line first shows, then kept. Not ready in loadMs: text only, never late.
//    prefetch: true (Sail) fetches the clips' bytes in the background once the context runs, one at a time (about 0.65 MB
//    of Opus; decoded only when a line shows, about 20 ms): fix/regressions 2026-10-30, a clip fetched only when its
//    line showed missed the 400 ms deadline while the world streamed in, so the subtitle showed with no voice.
//  * never overlaps: a newer line stops the older one (a short fade); the harbour master's call (blocked()) wins over a hint.
//  * while it speaks the music bus ducks by duckDb (-8 dB), down over 0.3 s and back over 1.2 s.
// Format: Ogg Opus 24 kb/s where the browser says it can play it, else AAC (m4a); a clip that will not decode tries the other.
import { hashText } from './skipperText.js';
import { cardFetch } from './deferLoad.js';

const SEEN_KEY = 'lakeshore.hints.spoken.v1';
const FADE_S = 0.08;

function preferredExts() {
  let opus = true;
  try { const a = typeof Audio === 'function' ? new Audio() : null; if (a?.canPlayType) opus = !!a.canPlayType('audio/ogg; codecs="opus"'); } catch { /* assume Opus */ }
  return opus ? ['opus', 'm4a'] : ['m4a', 'opus'];
}

export function createSkipperVoice({ audio = null, storage = globalThis.localStorage, base = '/audio/skipper/', fetchFn = cardFetch,   // on a phone, once the card is live (src/ui/deferLoad.js)
  enabled = true, blocked = () => false, loadMs = 400, duckDb = -8, duckAttackS = 0.3, duckReleaseS = 1.2, exts = null, timers = globalThis,
  prefetch = false, prefetchGapMs = 150, prefetchFirst = Infinity, prefetchRestGapMs = prefetchGapMs } = {}) {
  let ctx = null, bus = null, on = !!enabled, manifestP = null, req = 0, cur = null, disposed = false;
  const buffers = new Map();      // hash -> Promise<AudioBuffer | null>
  const bytes = new Map();        // hash -> Promise<{ ext, ab } | null>: prefetched, not yet decoded
  const seen = new Set();
  try { for (const h of JSON.parse(storage?.getItem(SEEN_KEY) ?? '[]')) seen.add(String(h)); } catch { /* private mode or corrupt: start clean */ }
  const persist = () => { try { storage?.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* memory only */ } };
  const order = exts ?? preferredExts();
  const log = [];
  const stats = { spoken: 0, skipped: {} };

  const skip = (why) => { stats.skipped[why] = (stats.skipped[why] ?? 0) + 1; return why; };
  const manifest = () => (manifestP ??= fetchFn(`${base}manifest.json`).then((r) => (r.ok ? r.json() : null)).then((m) => m?.clips ?? null).catch(() => null));

  const fetchBytes = async (h, ext) => { const r = await fetchFn(`${base}${h}.${ext}`); return r.ok ? { ext, ab: await r.arrayBuffer() } : null; };
  // the background fetch: the first format only (the fallback is fetched if it fails to decode), lowest priority, one at a time
  async function prefetchAll() {
    const clips = await manifest();
    let n = 0;   // prefetchFirst (phones: 3) at the usual pace, the rest slowly behind them (prefetchRestGapMs)
    for (const h of Object.keys(clips ?? {})) {
      if (disposed || !on) return;
      if (!seen.has(h) && !bytes.has(h) && !buffers.has(h)) {
        const p = fetchBytes(h, order[0]).catch(() => null); bytes.set(h, p); await p;
        const gap = ++n < prefetchFirst ? prefetchGapMs : prefetchRestGapMs;
        if (gap) await new Promise((res) => timers.setTimeout(res, gap));
      }
    }
  }
  async function fetchBuffer(h) {
    const clips = await manifest();
    if (!clips?.[h]) return null;
    const pre = await bytes.get(h); bytes.delete(h);
    if (pre) { try { return await ctx.decodeAudioData(pre.ab); } catch { /* try the formats in order */ } }
    for (const ext of order) {
      try {
        const r = await fetchFn(`${base}${h}.${ext}`);
        if (!r.ok) continue;
        return await ctx.decodeAudioData(await r.arrayBuffer());
      } catch { /* this format will not decode here: try the other */ }
    }
    return null;
  }
  const load = (h) => { if (!buffers.has(h)) buffers.set(h, fetchBuffer(h)); return buffers.get(h); };
  const timeout = (ms) => new Promise((res) => timers.setTimeout(() => res('late'), ms));

  const ready = () => !disposed && on && ctx && ctx.state === 'running' && !audio?.muted;

  function release(c) {
    if (cur !== c) return;
    cur = null;
    audio?.duck?.(0, { releaseS: duckReleaseS });
  }
  function halt(c, fade = FADE_S) {
    if (!c) return;
    try {
      const t = ctx.currentTime;
      c.gain.gain.cancelScheduledValues(t); c.gain.gain.setValueAtTime(c.gain.gain.value, t); c.gain.gain.linearRampToValueAtTime(0, t + fade);
      c.src.stop(t + fade + 0.01);
    } catch { /* already ended */ }
    release(c);
  }

  async function say(text) {
    if (!text) return skip('empty');
    if (!on) return skip('off');
    if (disposed || !ctx || !bus) return skip('no-gesture');
    if (ctx.state !== 'running') return skip('no-gesture');
    if (audio?.muted) return skip('muted');
    const h = hashText(text);
    if (seen.has(h)) return skip('seen');
    if (blocked()) return skip('busy');
    const mine = ++req;                    // a newer line cancels any older one still loading or playing
    halt(cur);
    const buf = await Promise.race([load(h), timeout(loadMs)]);
    if (mine !== req) return skip('superseded');
    if (!buf || buf === 'late') return skip(buf === 'late' ? 'late' : 'no-clip');
    if (!ready() || blocked()) return skip('gone');
    // play
    const src = ctx.createBufferSource(); src.buffer = buf;
    const gain = ctx.createGain();
    src.connect(gain); gain.connect(bus);
    const c = { src, gain, h };
    cur = c;
    src.onended = () => release(c);
    src.start();
    audio?.duck?.(duckDb, { attackS: duckAttackS });
    seen.add(h); persist();
    stats.spoken++; log.push({ h, text, dur: buf.duration });
    return 'spoken';
  }

  // the context joins here, after everything it may call (attach runs fn at once when the context exists already)
  audio?.attach?.(({ ctx: c, master }) => { ctx = c; bus = master; if (prefetch) prefetchAll(); }, 'voice');

  return {
    say, stop() { req++; halt(cur); },
    setEnabled(v) { on = !!v; if (!on) { req++; halt(cur); } return on; },
    dispose() { disposed = true; req++; halt(cur); },
    get enabled() { return on; }, get speaking() { return !!cur; }, get stats() { return { ...stats, skipped: { ...stats.skipped } }; }, get log() { return log; },
    get seen() { return new Set(seen); }, hasSeen: (text) => seen.has(hashText(text)), forget() { seen.clear(); persist(); },
  };
}
