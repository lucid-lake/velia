// The music's media elements, unlocked in a tap (fix/v2-ios-audio). v2 streams every piece through an <audio> element and a
// MediaElementSource (src/audioFormat.js sourceFor), and the element's play() runs after its metadata loads, outside the tap:
// Safari on iOS refuses that for a fresh element (NotAllowedError, swallowed), so a piece never sounds. An element that has once
// played inside a gesture may play later from any task, so the page keeps a few, plays a short silence on each in the taps
// (bless(), from v2/engine/audio.js's unlock) and lends them to sourceFor (take / give); each keeps its one MediaElementSource
// (an element takes only one). With none free, sourceFor makes a fresh element as before (the desktop's path).
//   const pool = createElementPool();  setElementPool(pool);   // v2/engine/audio.js
//   pool.bless()          // inside a tap: unlocks the elements not yet unlocked
//   pool.take(ctx)        // → { el, node } (node: the element's MediaElementSource on ctx) or null
//   pool.give(item)       // the piece ended: the element is free again
export const POOL_SIZE = 4;

// 0.1 s of 8 kHz mono 8-bit silence as a WAV data URL
let silentUrl = null;
export function silentWav() {
  if (silentUrl) return silentUrl;
  const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer), w = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  silentUrl = `data:audio/wav;base64,${globalThis.btoa(s)}`;
  return silentUrl;
}

export function createElementPool({ size = POOL_SIZE, Audio = globalThis.Audio } = {}) {
  const items = [];
  for (let i = 0; i < size; i++) {
    const el = new Audio(); el.preload = 'auto'; el.setAttribute?.('playsinline', '');
    items.push({ el, node: null, ctx: null, blessed: false, blessing: false, busy: false });
  }
  const idle = (it) => !it.busy && !it.blessing;
  function bless() {
    for (const it of items) {
      if (it.blessed || !idle(it)) continue;
      it.blessing = true;
      it.inTap = globalThis.navigator?.userActivation?.isActive ?? true;   // called inside a gesture (where the browser says)
      const settle = (ok) => {
        it.blessing = false;
        if (ok) it.blessed = true;
        if (!it.busy) { try { it.el.pause(); } catch { /* gone */ } it.el.removeAttribute?.('src'); }   // lent meanwhile: the piece's own
      };
      try {
        it.el.src = silentWav();
        const p = it.el.play?.();
        // a piece may take the element before the silence's play() settles (take: blessing counts): iOS unlocks an element at the
        // play() call inside the gesture, and the piece's new src then aborts the silence's promise, which is no refusal
        if (p && typeof p.then === 'function') p.then(() => settle(true), () => settle(it.busy));
        else settle(true);
      } catch { settle(false); }
    }
    return items.filter((it) => it.blessed).length;
  }
  // an element is lent once blessed, or while its blessing play() (called inside the tap) is still pending: on a busy phone the
  // first piece's metadata can arrive before that promise settles, and a fresh element then was refused (iosAudio, 2026-11-15)
  function take(ctx) {
    const it = items.find((x) => (x.blessed || (x.blessing && x.inTap)) && !x.busy && (x.ctx === null || x.ctx === ctx));
    if (!it) return null;
    if (!it.node) {
      try { it.node = ctx.createMediaElementSource(it.el); it.ctx = ctx; } catch { return null; }
    }
    it.busy = true;
    return it;
  }
  function give(it) { if (items.includes(it)) it.busy = false; }
  return {
    bless, take, give,
    stats: () => ({ size: items.length, blessed: items.filter((x) => x.blessed).length, busy: items.filter((x) => x.busy).length }),
  };
}
