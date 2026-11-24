// One door for sound files: Ogg Opus where the browser can play it, AAC (.m4a) where it cannot (Safari before 18.4
// cannot decode Ogg Opus in Web Audio). Every file under audio/ exists in both (tools/audio_m4a.sh makes the .m4a from
// the .opus). A file that will not decode in the preferred format tries the other; a missing one throws as before.
// The skipper's clips use the same rule in src/ui/skipperVoice.js.
import { toFlags } from './sim/core/flags.js';
let opus = null;
function opusPlayable(g = globalThis) {
  if (opus != null && g === globalThis) return opus;
  let ok = true;
  if (!toFlags(g.location?.search ?? '').opus) return false;   // ?opus=0: test the AAC path on any browser
  try { const a = typeof g.Audio === 'function' ? new g.Audio() : null; if (a?.canPlayType) ok = !!a.canPlayType('audio/ogg; codecs="opus"'); } catch { /* assume Opus */ }
  if (g === globalThis) opus = ok;
  return ok;
}
const asM4a = (url) => url.replace(/\.opus(\?.*)?$/, '.m4a$1');
const urlOrder = (url, ok = opusPlayable()) => (/\.opus(\?.*)?$/.test(url) ? (ok ? [url, asM4a(url)] : [asM4a(url), url]) : [url]);

// mono: fold a stereo clip to one channel after decoding (a phone's effects and beds, ctx.__lkMono: half the PCM; music
// passes mono: false and keeps its stereo)
function toMono(ctx, buf) {
  if (!buf || buf.numberOfChannels < 2 || typeof ctx?.createBuffer !== 'function') return buf;
  const n = buf.length, out = ctx.createBuffer(1, n, buf.sampleRate), o = out.getChannelData(0), C = buf.numberOfChannels;
  for (let c = 0; c < C; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) o[i] += d[i] / C; }
  return out;
}
export async function decodeFile(ctx, fetchFn, url, ok, { mono = !!ctx?.__lkMono } = {}) {
  let last = null;
  for (const u of urlOrder(url, ok)) {
    try {
      const r = await fetchFn(u);
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      return mono ? toMono(ctx, buf) : buf;
    } catch (e) { last = e; }
  }
  throw last ?? new Error(`${url}: no format`);
}

// iOS (fix/ios-start): the music streams through a media element instead of a decoded buffer. decodeAudioData keeps the
// raw PCM (≈ 60 MB for a 3-minute stereo piece at 48 kHz), and iOS ends a page's process near its memory limit without
// an error. streamFile() returns a stand-in buffer { streamed, url, duration } (the metadata only); sourceFor() gives the
// players an AudioBufferSourceNode for a real buffer, or for a stand-in a node with the same connect / start / stop /
// onended that plays a fresh <audio> element through a MediaElementSource (the same buses, the same ducks and fades).
export const isIOS = (nav = globalThis.navigator) => !!nav && (/iPhone|iPad|iPod/.test(nav.userAgent ?? '') || (/Macintosh/.test(nav.userAgent ?? '') && (nav.maxTouchPoints ?? 0) > 1));
// Velia v2 streams the music on every device (setStreamMusic(true), v2/audio/music.js: no piece decoded whole); v1 keeps iOS only
let streamAll = false;
export const setStreamMusic = (on) => { streamAll = !!on; return streamAll; };
export const streamsMusic = (g = globalThis) => (streamAll || isIOS(g.navigator)) && typeof g.Audio === 'function' && toFlags(g.location?.search ?? '').stream !== 'pcm';

export async function streamFile(url, { ok, Audio = globalThis.Audio, timeoutMs = 15000 } = {}) {
  let last = null;
  for (const u of urlOrder(url, ok)) {
    try {
      const duration = await new Promise((res, rej) => {
        const el = new Audio(); el.preload = 'metadata';
        const done = (f, v) => { clearTimeout(t); el.onloadedmetadata = el.onerror = null; el.removeAttribute?.('src'); f(v); };
        const t = setTimeout(() => done(rej, new Error(`${u}: no metadata`)), timeoutMs);
        el.onloadedmetadata = () => done(res, el.duration);
        el.onerror = () => done(rej, new Error(`${u}: will not play`));
        el.src = u;
      });
      if (!(duration > 0) || !Number.isFinite(duration)) throw new Error(`${u}: no duration`);
      return { streamed: true, url: u, duration };
    } catch (e) { last = e; }
  }
  throw last ?? new Error(`${url}: no format`);
}

// Velia v2 (fix/v2-ios-audio): an opt-in pool of media elements unlocked in a tap (v2/audio/elementPool.js: iOS lets an element
// play outside a gesture only once it has played inside one); sourceFor borrows one and gives it back when the piece ends.
// v1 sets none: a fresh element per piece, as before.
let elementPool = null;
export const setElementPool = (pool) => { elementPool = pool ?? null; return elementPool; };

export function sourceFor(ctx, buf, { Audio = globalThis.Audio, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout, pool = elementPool } = {}) {
  if (!buf?.streamed) return new AudioBufferSourceNode(ctx, { buffer: buf });
  const lent = pool?.take?.(ctx) ?? null;
  const el = lent?.el ?? new Audio();
  if (!lent) { el.preload = 'auto'; el.setAttribute?.('playsinline', ''); }
  el.src = buf.url;
  const node = lent?.node ?? ctx.createMediaElementSource(el);
  let startT = null, stopT = null, ended = false;
  const wait = (when) => Math.max(0, ((when ?? 0) - ctx.currentTime) * 1000);
  const src = {
    streamed: true, el, node, onended: null,
    connect(d) { node.connect(d); return d; },
    disconnect() { try { node.disconnect(); } catch { /* not connected */ } },
    start(when = 0, offset = 0) {
      try { el.currentTime = offset; } catch { /* before metadata: from the top */ }
      startT = setTimer(() => { el.play?.()?.catch?.(() => {}); }, wait(when));
    },
    stop(when) { clearTimer(stopT); stopT = setTimer(end, wait(when)); },
  };
  function end() {
    if (ended) return; ended = true;
    clearTimer(startT); clearTimer(stopT);
    try { el.pause(); } catch { /* gone */ }
    src.disconnect(); el.removeAttribute?.('src'); try { el.load?.(); } catch { /* released */ }
    if (lent) { el.onended = null; pool.give?.(lent); }
    src.onended?.();
  }
  el.onended = end;
  return src;
}
