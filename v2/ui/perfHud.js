// The performance stats panel (2026-11-25): a small glass plate at the top-right, desktop only, while the cockpit is up in Sail and
// Regatta, so the player notices a slow frame as it happens. Calm, not shouting: the top bar's glass, cream ink, tabular numbers,
// six short lines. It follows ui/cockpitUp.js: hidden when the cockpit is folded (the tab, H), in Clear and Instruments, in Cruise,
// as Tessie, under a menu or a page; the helm view keeps it. Never on a tablet or a phone (src/core/features.js perfHud).
//   FPS      60 fps · 16.7 ms        the frames over the last second, and their mean interval; amber under 30 fps (the governor's line)
//   Worst    24.1 ms                 the longest frame interval of the last 5 s
//   Quality  L1 · 0.85×              the ladder's level and the governor's render scale (engine/quality.js, engine/governor.js)
//   Draws    312 · 4.4M tri · 86 pl  the last frame's draw calls and triangles (engine/frame.js counters), the pipelines built
//   Memory   412 MB                  the GPU memory v2 asked for (engine/device.js tallyMemory: an estimate, the swap chain aside)
//   GPU      Apple metal-3           the adapter (its description, else vendor and architecture), short
//   GPU time 2.6 ms                  only with ?diag (the GPU timer stays a diag and bench tool: v2/notes/perf.md)
// Cost: the frame feeds a fixed ring of 250 ms buckets (no allocation); the text is rebuilt 3 times a second, and only while shown.
// Setup › Screen › performance stats: off by default (2026-11-25); its own stored key (the v1 store is shared with /classic/). ?perfhud=1 shows it
// for one load whatever the stored value (captures, stills), ?perfhud=0 never. Off in a capture, a ?filmui film, a ?shot and an
// automated browser unless ?perfhud=1 (the goldens never see it). A small × in the plate's top-right corner closes it: the same as
// Setup's off (stored; the row repaints), and for this load even under ?perfhud=1. It sits in its own gutter right of the numbers.
//   const hud = createPerfHud({ read, shown, diag, onClose })   hud.tick(now, dtMs) each drawn frame; hud.state; hud.el; hud.dispose()
//   mountPerfRow(root, { settings })                     Setup's row
export const PERF_HUD = Object.freeze({
  hz: 3,            // text updates a second (2-4 asked)
  bucketMs: 250,    // the ring's bucket
  buckets: 20,      // 20 × 250 ms: the worst frame's 5 s
  fpsBuckets: 4,    // the last 4 closed buckets: about 1 s for the FPS
  amberFps: 30,     // under this the FPS line goes amber (the governor's slow line; never red, never flashing)
  top: 14,          // px: the top bar's own top (its island stands at 14 px at 1280 x 720)
  widthEm: 16.8,    // the plate's fixed width (it never breathes as the digits change), the × gutter aside
  closePx: 24,      // the ×'s hit area (a desktop pointer: 24 px or more); its gutter right of the numbers
  edge: 16,         // px from the right edge (the page's side gutter)
  adapterMax: 22,   // characters of the adapter's name
  key: 'lakeshore.v2.perfhud',
});

// whether the page may show it at all: the policy (desktop, not a capture), the URL, then the player's stored choice
export function perfHudAllowed({ policy = false, flag = null, stored = true } = {}) {
  if (!policy || flag === '0') return false;
  return flag === '1' ? true : stored !== false;
}
// the frame meter: fixed buckets of 250 ms (frames, the intervals' sum, the longest); no allocation in feed()
export function createFrameMeter({ bucketMs = PERF_HUD.bucketMs, buckets = PERF_HUD.buckets } = {}) {
  const n = new Uint16Array(buckets), sum = new Float64Array(buckets), max = new Float32Array(buckets);
  let i = 0, start = null, filled = 0;
  function roll(now) {
    while (now - start >= bucketMs) { start += bucketMs; i = (i + 1) % buckets; n[i] = 0; sum[i] = 0; max[i] = 0; filled = Math.min(buckets, filled + 1); if (now - start > bucketMs * buckets) { start = now; } }
  }
  return {
    feed(now, dtMs) {
      if (start == null) { start = now; }
      roll(now);
      if (!(dtMs > 0) || dtMs > 5000) return;   // a hidden tab's gap is not a frame
      n[i]++; sum[i] += dtMs; if (dtMs > max[i]) max[i] = dtMs;
    },
    // fps over the last k closed buckets (the open one when none is closed yet); the mean interval; the worst interval in the ring
    read(now, k = PERF_HUD.fpsBuckets) {
      if (start != null) roll(now);
      let fn = 0, fs = 0, worst = 0;
      const closed = Math.min(k, filled);
      for (let j = 1; j <= closed; j++) { const b = (i - j + buckets) % buckets; fn += n[b]; fs += sum[b]; }
      if (!closed) { fn = n[i]; fs = sum[i]; }
      for (let b = 0; b < buckets; b++) if (max[b] > worst) worst = max[b];
      return { fps: fs > 0 ? (1000 * fn) / fs : 0, ms: fn ? fs / fn : 0, worst };
    },
  };
}

// the adapter, short: its description when the browser gives one, else vendor and architecture ("Apple metal-3")
export function adapterName(info = {}, max = PERF_HUD.adapterMax) {
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  const d = String(info.description ?? '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const s = d || [cap(String(info.vendor ?? '').trim()), String(info.architecture ?? '').trim()].filter(Boolean).join(' ') || 'GPU name hidden';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
const big = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}k` : String(Math.round(x)));
// the lines as [label, value, warn]: pure (the tests read it). n: { fps, ms, worst, level, scale, draws, tris, pipes, mb, adapter, gpuMs }
export function perfLines(n) {
  const out = [
    ['FPS', `${Math.round(n.fps)} fps · ${n.ms.toFixed(1)} ms`, n.fps > 0 && n.fps < PERF_HUD.amberFps],
    ['Worst', `${n.worst.toFixed(1)} ms`, false],
    ['Quality', `L${n.level} · ${n.scale.toFixed(2)}×`, false],
    ['Draws', `${n.draws} · ${big(n.tris)} tri · ${n.pipes} pl`, false],
    ['Memory', `${Math.round(n.mb)} MB`, false],
    ['GPU', n.adapter, false],
  ];
  if (Number.isFinite(n.gpuMs)) out.push(['GPU time', `${n.gpuMs.toFixed(1)} ms`, false]);
  return out;
}

const CSS = `
.lk-perf{position:fixed;top:${PERF_HUD.top}px;right:calc(${PERF_HUD.edge}px + var(--lk-sar,0px));z-index:var(--lk-z-hud,10);pointer-events:none;user-select:none;
  display:grid;grid-template-columns:auto minmax(0,1fr);width:calc(${PERF_HUD.widthEm}em + ${PERF_HUD.closePx}px);column-gap:.7em;row-gap:.05em;padding:.5em calc(.8em + ${PERF_HUD.closePx}px - 6px) .5em .8em;box-sizing:border-box;
  font:var(--lk-regular,400) var(--lk-fs-caption,15px)/1.25 var(--lk-ui,sans-serif);font-variant-numeric:tabular-nums;letter-spacing:.01em;
  color:var(--lk-ink,rgb(244 244 242 / .94));background:var(--lk-glass,rgb(28 35 64 / .8));-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);
  border:var(--lk-line,1px) solid var(--lk-glass-edge,rgb(244 244 242 / .25));border-radius:var(--lk-glass-r,14px);box-shadow:var(--lk-glass-shadow);
  transition:opacity .3s linear,visibility 0s}
.lk-perf.gone{opacity:0;visibility:hidden;transition:opacity .3s linear,visibility 0s linear .3s}
.lk-perf .k{color:rgb(var(--lk-cream,244 244 242) / .8)}
.lk-perf .v{text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lk-perf .v.warn{color:rgb(var(--lk-amber,232 168 56))}
.lk-perf button.x{all:unset;position:absolute;top:3px;right:3px;width:${PERF_HUD.closePx}px;height:${PERF_HUD.closePx}px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
  border-radius:6px;cursor:pointer;pointer-events:auto;color:rgb(var(--lk-cream,244 244 242) / .7);transition:background-color .15s linear,color .15s linear}
.lk-perf.gone button.x{pointer-events:none}
.lk-perf button.x svg{width:10px;height:10px;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;fill:none}
.lk-perf button.x:is(:hover,:focus-visible){color:rgb(var(--lk-cream,244 244 242) / .95);background:rgb(var(--lk-cream,244 244 242) / .12)}
.lk-perf button.x:focus-visible{outline:2px solid rgb(var(--lk-amber,232 168 56) / .9);outline-offset:0}
@media (prefers-reduced-motion:reduce){.lk-perf,.lk-perf.gone,.lk-perf button.x{transition:none}}
`;

// read(): the live numbers (main.js), called only when the text is due; shown(): this frame's rule (cheap: booleans)
export function createPerfHud({ read, shown = () => false, onClose = () => {}, diag = false, hz = PERF_HUD.hz, doc = globalThis.document, clock = () => performance.now() } = {}) {
  if (!doc.getElementById('lk-perf-css')) { const st = doc.createElement('style'); st.id = 'lk-perf-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const el = doc.createElement('div');
  el.className = 'lk-perf gone'; el.dataset.perf = '';
  const rows = diag ? 7 : 6, ks = [], vs = [];
  for (let r = 0; r < rows; r++) { const k = doc.createElement('span'), v = doc.createElement('span'); k.className = 'k'; v.className = 'v'; k.setAttribute('aria-hidden', 'true'); v.setAttribute('aria-hidden', 'true'); el.append(k, v); ks.push(k); vs.push(v); }
  // the ×: closes the panel (the caller stores it as Setup's off); its own gutter, never over a number
  const x = doc.createElement('button');
  x.type = 'button'; x.className = 'x'; x.setAttribute('aria-label', 'Close performance stats');
  x.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5"/></svg>';
  x.addEventListener('pointerdown', (e) => e.stopPropagation());
  x.addEventListener('click', (e) => { e.stopPropagation(); x.blur?.(); onClose(); });
  el.appendChild(x);
  doc.body.appendChild(el);
  const meter = createFrameMeter();
  const every = 1000 / hz;
  let on = false, due = 0, paints = 0, ticks = 0, costMs = 0, paintMs = 0, last = null;
  function paint(now) {
    const n = read(); const m = meter.read(now);
    n.fps = m.fps; n.ms = m.ms; n.worst = m.worst;
    const lines = perfLines(n);
    for (let r = 0; r < rows; r++) {
      const L = lines[r];
      const kt = L ? L[0] : '', vt = L ? L[1] : '', w = !!L?.[2];
      if (ks[r].textContent !== kt) ks[r].textContent = kt;
      if (vs[r].textContent !== vt) vs[r].textContent = vt;
      if (vs[r].classList.contains('warn') !== w) vs[r].classList.toggle('warn', w);
    }
    last = lines; paints++;
  }
  return {
    el, close: x,
    tick(now, dtMs) {
      const t0 = clock();
      meter.feed(now, dtMs);
      const s = !!shown();
      if (s !== on) { on = s; el.classList.toggle('gone', !s); if (s) due = 0; }
      if (s && now >= due) { const p0 = clock(); paint(now); paintMs += clock() - p0; due = now + every; }
      ticks++; costMs += clock() - t0;
    },
    get shown() { return on; },
    // the panel's own cost: the mean ms a frame (the meter and the rule) and a paint (the text)
    get state() { return { shown: on, paints, ticks, msPerTick: ticks ? costMs / ticks : 0, msPerPaint: paints ? paintMs / paints : 0, hz, lines: last ? last.map((l) => [...l]) : null }; },
    dispose() { el.remove(); },
  };
}

// the stored choice (off by default, 2026-11-25): its own key, as tessieSettings.js; on(fn) hears each change (the row, the panel)
const pageStore = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
let shared = null;
export function perfHudSettings(store = pageStore()) {
  if (shared && shared.store === store) return shared;
  let memo = null;
  const read = () => {
    if (memo != null) return memo;
    let v = null; try { v = JSON.parse(store?.getItem?.(PERF_HUD.key) ?? 'null'); } catch { v = null; }
    memo = !!(v && typeof v === 'object' && v.on === true);
    return memo;
  };
  const fns = new Set();
  const api = {
    store,
    get on() { return read(); },
    set(v) { memo = !!v; try { store?.setItem?.(PERF_HUD.key, JSON.stringify({ on: memo })); } catch { /* private mode: this page only */ } for (const f of fns) f(memo); return memo; },
    listen(f) { fns.add(f); return () => fns.delete(f); },
    forget() { memo = null; },
  };
  shared = api;
  return api;
}

// Setup › Screen › performance stats: on · off (the home card's row style, homePages.js setRow / opt), after the text row
export function mountPerfRow(root, { settings = perfHudSettings(), doc = globalThis.document } = {}) {
  const tab = root?.querySelector?.('#tp-set-screen');
  if (!tab || tab.querySelector('[data-set="perfhud"]')) return null;
  const row = doc.createElement('div');
  row.className = 'set'; row.dataset.set = 'perfhud';
  row.innerHTML = '<span class="k">performance stats</span><span class="v"><button class="opt" type="button" role="radio" data-ph="on" aria-checked="false">on</button><button class="opt" type="button" role="radio" data-ph="off" aria-checked="false">off</button></span>';
  const after = tab.querySelector('[data-set="text"]');
  if (after?.nextSibling) tab.insertBefore(row, after.nextSibling); else tab.appendChild(row);
  const btns = [...row.querySelectorAll('[data-ph]')];
  const paint = () => { const v = settings.on ? 'on' : 'off'; for (const b of btns) b.setAttribute('aria-checked', String(b.dataset.ph === v)); };
  const click = (e) => { const b = e.target.closest?.('[data-ph]'); if (!b) return; e.stopPropagation(); settings.set(b.dataset.ph === 'on'); paint(); };
  row.addEventListener('click', click);
  const off = settings.listen?.(paint);   // the panel's × turns it off too
  paint();
  return { row, buttons: btns, paint, dispose() { off?.(); row.removeEventListener('click', click); row.remove(); } };
}
