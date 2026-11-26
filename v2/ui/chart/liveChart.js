// The live chart (Phase 2a): one chart component, 2D canvas only (no WebGPU pipeline, nothing for the
// build gate), at three sizes: the card's map, the full-window menu map and the in-play chart. The ground is Emerald Bay in the engraved
// N3 manner (v2/ui/chart/ground.js: relief, granite, forest, sand, depth as soft tone, the channel lighter, Fannette Island); the names
// are set quietly into the land and the water (Jost small caps letter-spaced 0.14 em, 55 % on the water, 68 % on the land, no chips),
// fading in and out by three zoom classes; zoom is continuous (the wheel about the pointer, a pinch, + and −, the 1 · 2 · 3 bookmarks),
// a drag pans (and un-follows the boat; the ⌖ chip, Home or a double-tap re-centres); hover or focus lifts a name and rings its point; a
// click, a tap or Enter selects it: a small glass card with its name, one line and one action (Sail from here · Set as target · Anchor
// here · Start a race here), wired to the page's services. The boat, her track and the wind (one quiet arrow) are drawn over it all.
// Cost: the dynamic layer under 1.5 ms a frame while open at 1280 × 720 (stats()), nothing while hidden (no frame loop).
//
// API (Phase 2a; the Phase 2b panel, the entrance zoom-in, the in-game menu's glass and the phone layout build on it):
//   const chart = createChart({
//     el,                      the host element (sized by its owner; the chart fills it)
//     size: 'card' | 'menu' | 'play',    the zoom range, the name classes, whether the view follows the boat (chartModel.js SIZES)
//     mode: 'entrance' | 'play' | 'hub', which action a point offers (chartModel.js actionFor)
//     services,                the page's service registry (get(name)): 'birthplace' (the pins, Sail from here: pick() at the entrance,
//                              moveTo() in play), 'chartTarget' ({ set(p), anchor(p) }: Set as target, Anchor here), 'chart' (its
//                              course.lay(kind): Start a race here)
//     sources: { boat, track, wind, night, anchorages, aids, places, areas, channel, barges, raceMarks, racePins },   getters, each optional:
//                              boat() → { x, z, heading, sog, cog, trueWind: { angle, speed } } | null; track() → [{ x, z }];
//                              wind() → { fromRad, kn } | null (default: the boat's true wind); night() → 0…1; the rest as buildPois' src
//     actions,                 optional overrides of the default service calls: { sail(row), target(row, aim), anchor(row, aim), race(row) }
//                              → { ok, why? } or its promise
//     ground: { heightAt, ready, live },  a desktop's live bake from the terrain (live true; ready() once the full grids are in); without
//                              it, the shipped WebP (the phones; every device's first paint)
//     insets: { left, right, top, bottom },   px the owner covers (2b's panel: left 320): re-centring keeps the boat in what is left
//     touch: () => bool, reduced: () => bool,  a finger device (44 px targets, hit radius 24 px, names A and B); reduced motion (no glides)
//     hint: { seen(): bool, done(): void },   the one-time line near the zoom buttons ("Scroll to zoom · drag to move"; "Pinch…" on a finger): shown on the first
//                              open while !seen(), marked done at once, fades after 4 s or on the first zoom or drag
//     view: { center: { x, z }, mpp },        the first view (default: the boat, else the whole bay)
//     ux: null | { wake, layers, cursor },'s mock behind ?mapux=1 (mapUx.js): the eased crosshair, the layer toggles, your
//                              wake (a createWakeStore); null (the default) leaves the chart exactly as it was
//   });
//   chart.on('select' | 'action' | 'hover' | 'view' | 'close' | 'mark', fn) → off()
//       water: a single tap on empty water with no card open (the menu closes on it); select: the row (or null when the card closes); action: { row, action, result }; hover: the row or null; view: { cx, cz, mpp,
//       following }; close: Esc with no card open (the owner closes the chart); mark: { x, z } (a double-tap on the water: Sail's mark)
//   chart.focus(id)                 glide to a point (a row id, e.g. 'bp-tessie', or a birthplace id) and open its card
//   chart.select(id | null)         open or close a point's card where it is
//   chart.setView({ center, mpp, animate, duration })   center { x, z }; mpp metres per pixel (1.2 a cove … 6.5 the whole bay); duration s
//   chart.setGlass(a)               the ground at opacity a (0.9: the menu over the live lake; the host blurs what is behind, mapScreen.js)
//   chart.recentre()                follow the boat again (0.4 s glide)
//   chart.show(on), chart.setMode(mode), chart.setInsets(insets), chart.resize()
//   chart.state, chart.stats(), chart.toClient(x, z), chart.destroy()
import { TOKENS, FONT, UI, ensureTokens } from '../../../src/ui/tokens.js';
import { GROUND, SHEETS, GROUND_PALETTES, groundSteps, groundSize } from './ground.js';
import { GROUND_BAKE } from './groundData.js';
import { SHEET_BAKE } from './sheetData.js';
import { REFUSALS } from '../birthplaceCard.js';
import { SIZES, BOOKMARKS, INK, NIGHT_INK, HIT_PX, ACTION_WORDS, namesFor, chartView, zoomAbout, panBy, clampView, zoomRange, centreFor, classVisible,
  fadeTo, buildPois, aimOf, poiShown, hitTest, walkOrder, layoutLabels, ease, sheetWanted } from './chartModel.js';
import { mountMapUx, drawWake, UX } from './mapUx.js';   // ?mapux=1 only ('s mock): the eased crosshair, the layers, your wake

const GROUND_URLS = Object.freeze({
  day: new URL('../../assets/chart/emerald-bay-day.webp', import.meta.url).href,
  night: new URL('../../assets/chart/emerald-bay-night.webp', import.meta.url).href,
});
// the sheets past the bay (ground.js SHEETS), drawn under the bay's ground: the lake's at once, the south's when sheetWanted says
const SHEET_URLS = Object.freeze({
  lake: Object.freeze({ day: new URL('../../assets/chart/lake-day.webp', import.meta.url).href, night: new URL('../../assets/chart/lake-night.webp', import.meta.url).href }),
  south: Object.freeze({ day: new URL('../../assets/chart/south-day.webp', import.meta.url).href, night: new URL('../../assets/chart/south-night.webp', import.meta.url).href }),
});
const WATER_WORDS = Object.freeze({ sailHere: 'Sail here', waterTarget: 'Set as target', waypoint: 'Add waypoint', setCourse: 'Set course', clearRoute: 'Clear route', clearTarget: 'Clear target' });
export const CHART_TIMING = Object.freeze({ zoomS: 0.25, glideS: 0.4, focusS: 0.5, hz: 10, sliceMs: 4, tapPx: 6, dblMs: 320, trackMin: 20 });

const CSS = `
.lkc{position:relative;overflow:hidden;background:rgb(var(--lk-brand-navy));touch-action:none;user-select:none;-webkit-user-select:none;outline:none;-webkit-tap-highlight-color:transparent}
.lkc>canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
/* the night: the map is moonlit (owner, 2026-11-18: "too dark to read"; NIGHT_INK), so its own glass and ink stay the moonlight cream on a
   cool navy, not the instruments' night red (src/ui/tokens.css :root[data-lk-theme=night] turns every ink red: the zoom pair, the layer pill
   and the cards drew red over a blue chart). A lit state keeps the night's amber */
:root[data-lk-theme=night] .lkc{--lk-cream:214 222 236;--lk-brand-navy:12 18 30;--lk-ink:rgb(214 222 236 / .94);--lk-ink-soft:rgb(214 222 236 / .84);
  --lk-ink-faint:rgb(214 222 236 / .8);--lk-rest:rgb(214 222 236 / .7);--lk-hair:rgb(214 222 236 / .5);--lk-glass:rgb(12 18 30 / .86);--lk-glass-dense:rgb(12 18 30 / .93);
  --lk-glass-edge:rgb(214 222 236 / .3);--lk-shade:4 6 12}
.lkc[data-glass]{background:transparent}
.lkc:focus-visible{box-shadow:inset 0 0 0 2px rgb(var(--lk-cream) / .42)}
.lkc .lkc-card{position:absolute;z-index:2;box-sizing:border-box;width:220px;display:flex;flex-direction:column;gap:7px;padding:12px 14px 14px;
  color:var(--lk-ink);background:var(--lk-glass-dense);border:var(--lk-line,1px) solid var(--lk-glass-edge);border-radius:14px;box-shadow:0 6px 24px rgb(var(--lk-shade) / .5)}
.lkc .lkc-card[hidden]{display:none}
.lkc .lkc-card .t{font:500 15px/1.2 var(--lk-font);letter-spacing:.02em}
.lkc .lkc-card .w{font:400 15px/1.3 var(--lk-ui);color:var(--lk-ink-soft)}
.lkc .lkc-card .w:empty{display:none}
.lkc .lkc-card .go{appearance:none;align-self:flex-start;min-height:32px;font:500 15px/1 var(--lk-ui);color:rgb(var(--lk-amber));background:none;
  border:1px solid rgb(var(--lk-amber) / .95);border-radius:999px;padding:0 1em;cursor:pointer;letter-spacing:.01em}
.lkc .lkc-card .go[hidden]{display:none}
.lkc .lkc-card .go:hover,.lkc .lkc-card .go:focus-visible{background:rgb(var(--lk-amber) / .14);outline:none}
.lkc .lkc-card .say{font:italic 400 15px/1.3 var(--lk-ui);color:rgb(var(--lk-amber))}
.lkc .lkc-card .say:empty{display:none}
.lkc[data-touch] .lkc-card .go{min-height:44px}
.lkc .lkc-card .more{display:flex;flex-wrap:wrap;gap:2px 14px}
.lkc .lkc-card .more:empty{display:none}
.lkc .lkc-card .more button{appearance:none;background:none;border:0;padding:0;min-height:28px;cursor:pointer;font:500 15px/1 var(--lk-ui);color:var(--lk-ink-soft);
  text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgb(var(--lk-cream) / .35)}
.lkc .lkc-card .more button:hover,.lkc .lkc-card .more button:focus-visible{color:var(--lk-ink);outline:none;text-decoration-color:rgb(var(--lk-cream) / .8)}
.lkc[data-touch] .lkc-card .more button{min-height:44px}
.lkc>canvas{cursor:crosshair}
.lkc[data-drag]>canvas{cursor:grabbing}
.lkc .lkc-ctl{position:absolute;z-index:1;right:16px;bottom:52px;display:flex;flex-direction:column;align-items:center;gap:8px}
.lkc .lkc-zb{width:32px;height:32px;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;font:400 20px/1 var(--lk-ui);
  color:var(--lk-ink);background:var(--lk-glass-dense);border:1px solid var(--lk-glass-edge);border-radius:50%}
.lkc .lkc-zb:hover,.lkc .lkc-zb:focus-visible{border-color:rgb(var(--lk-cream) / .6);outline:none}
.lkc[data-touch] .lkc-zb{width:44px;height:44px;font-size:24px}
.lkc .lkc-hint{position:absolute;z-index:1;right:64px;bottom:40px;white-space:nowrap;pointer-events:none;font:italic 400 15px/1 var(--lk-font);letter-spacing:.03em;
  color:var(--lk-ink-soft);text-shadow:0 0 6px rgb(var(--lk-shade) / .85);opacity:0;transition:opacity .6s var(--lk-ease)}
.lkc .lkc-hint[data-on]{opacity:1}
.lkc[data-touch] .lkc-hint{bottom:18px}
.lkc .lkc-rc{position:static;width:32px;height:32px;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;
  color:var(--lk-ink);background:var(--lk-glass-dense);border:1px solid var(--lk-glass-edge);border-radius:50%}
.lkc .lkc-rc[hidden]{display:none}
.lkc .lkc-rc svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6}
.lkc .lkc-rc:hover,.lkc .lkc-rc:focus-visible{border-color:rgb(var(--lk-cream) / .6);outline:none}
.lkc[data-touch] .lkc-rc{width:44px;height:44px}
`;
const RC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none;width:18px;height:18px"><circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>';

import { clampT as clamp } from '../../../src/sim/core/math.js';
const rgba = (c, a) => `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0} / ${(+a).toFixed(3)})`;
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const now = () => performance.now();
const canvas2d = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

// the default service calls behind the four actions; mode() reads where the chart is open
export function chartActions(services, mode = () => 'play') {
  const get = (n) => services?.get?.(n) ?? null;
  return {
    async sail(row) {
      const s = get('birthplace');
      if (!s) return { ok: false, why: 'unknown' };
      if (mode() === 'entrance') return s.pick(row.ref) ? { ok: true, picked: row.ref } : { ok: false, why: 'unknown' };
      return (await s.moveTo(row.ref)) ?? { ok: false, why: 'unknown' };
    },
    target(row, aim) { const t = get('chartTarget'); return t?.set ? (t.set({ ...aim, name: row.name }) ?? { ok: true }) : { ok: false, why: 'unknown' }; },
    anchor(row, aim) { const t = get('chartTarget'); return t?.anchor ? (t.anchor({ ...aim, name: row.name }) ?? { ok: true }) : { ok: false, why: 'unknown' }; },
    async raceHere(row) { const f = get('raceHere'); return f ? ((await f(row.ref)) ?? { ok: true }) : { ok: false, why: 'unknown' }; },   // a place race's pin: the page's raceHere(id) → R.racePlace(id)
    async beTessie() { const t = get('tessiePlay'); return t?.fromChart ? ((await t.fromChart()) ?? { ok: true }) : { ok: false, why: 'unknown' }; },   // play as Tessie: the veil, then you are her in her water
    race() { const c = get('chart')?.course; if (!c?.lay) return { ok: false, why: 'unknown' }; c.lay('windward-leeward'); return { ok: true }; },
    // the open water's card (sail.js's chartTarget: the checks and their plain refusals are its own)
    // Sail here (the chart's routing, 2026-11-25): the target and the pilot on it at once, the chart left open (sail.js chartTarget.sailHere)
    sailHere(row, aim) { const t = get('chartTarget'); const p = row.kind === 'water' ? { x: row.x, z: row.z } : { ...aim, name: row.name }; return t?.sailHere ? (t.sailHere(p) ?? { ok: true }) : { ok: false, why: 'unknown' }; },
    waterTarget(row) { const t = get('chartTarget'); return t?.setWater ? t.setWater({ x: row.x, z: row.z }) : { ok: false, why: 'unknown' }; },
    waypoint(row) { const t = get('chartTarget'); return t?.addWaypoint ? t.addWaypoint({ x: row.x, z: row.z }) : { ok: false, why: 'unknown' }; },
    setCourse() { const t = get('chartTarget'); return t?.setCourse ? t.setCourse() : { ok: false, why: 'unknown' }; },
    clearRoute() { const t = get('chartTarget'); return t?.clearRoute ? t.clearRoute() : { ok: false, why: 'unknown' }; },
    clearTarget() { const t = get('chartTarget'); return t?.clearTarget ? t.clearTarget() : { ok: false, why: 'unknown' }; },
  };
}

// a name drawn once into a sprite in the engraved manner: small caps (each word's first letter full height, the rest at 0.78), letter-
// spaced 0.14 em, italic on the water; the sprite carries full ink, the frame draws it at the name's alpha
function nameSprite(text, { fs, italic, ink, dpr, halo = null }) {
  const sc = 0.78, track = 0.14 * fs, font = (s) => `${italic ? 'italic ' : ''}400 ${s}px ${FONT}`;
  const meas = canvas2d(1, 1).getContext('2d');
  const glyphs = [];
  let w = 0;
  for (const word of String(text).split(' ')) {
    if (glyphs.length) { meas.font = font(fs); w += meas.measureText(' ').width + track; }
    [...word].forEach((ch) => {
      const big = ch !== ch.toLowerCase() || /[0-9]/.test(ch), s = big ? fs : fs * sc, c = ch.toUpperCase();
      meas.font = font(s);
      const cw = meas.measureText(c).width;
      glyphs.push({ c, s, x: w }); w += cw + track;
    });
  }
  w = Math.max(1, w - track);
  const h = Math.ceil(fs * 1.4), cv = canvas2d(Math.ceil((w + 4) * dpr), Math.ceil(h * dpr)), g = cv.getContext('2d');
  g.scale(dpr, dpr); g.textBaseline = 'alphabetic'; g.fillStyle = rgba(ink, 1);
  if (halo) { g.shadowColor = rgba(halo, NIGHT_INK.haloA); g.shadowBlur = Math.max(2, fs * 0.22); }   // the night's soft halo: the name reads on the bright sand
  if (halo) {   // the night's halo: a soft dark rim under every glyph, so a name reads on the brightest ground (the sand)
    g.strokeStyle = rgba(halo, NIGHT_INK.haloA); g.lineWidth = Math.max(2.5, fs * 0.24); g.lineJoin = 'round';
    for (const q of glyphs) { g.font = font(q.s); g.strokeText(q.c, 2 + q.x, fs * 1.05); }
    g.shadowBlur = 0;
  }
  for (const q of glyphs) { g.font = font(q.s); g.fillText(q.c, 2 + q.x, fs * 1.05); }
  return { cv, w: w + 4, h };
}

export function createChart({ hint = null, el, size = 'play', mode = 'play', services = null, sources = {}, actions = null, ground = {}, insets = {},
  touch = () => false, reduced = () => false, view: view0 = null, ux = null } = {}) {
  if (!el) throw new Error('createChart: an el is needed');
  ensureTokens();
  if (!document.getElementById('lk-livechart-css')) { const st = document.createElement('style'); st.id = 'lk-livechart-css'; st.textContent = CSS; document.head.appendChild(st); }
  el.classList.add('lkc');
  el.tabIndex = 0;
  el.setAttribute('role', 'application');
  el.setAttribute('aria-label', 'Chart of Emerald Bay and South Lake: drag or arrow keys to pan, wheel or plus and minus to zoom, Tab walks the places, Enter opens one');
  const cv = document.createElement('canvas'); el.appendChild(cv);
  const card = document.createElement('div'); card.className = 'lkc-card'; card.hidden = true; card.setAttribute('role', 'dialog');
  card.innerHTML = '<b class="t"></b><span class="w"></span><button type="button" class="go"></button><span class="more"></span><i class="say" role="status" aria-live="polite"></i>';
  el.appendChild(card);
  const rc = document.createElement('button'); rc.type = 'button'; rc.className = 'lkc-rc'; rc.hidden = true; rc.innerHTML = RC_SVG;
  rc.title = 'Back to the boat (Home)'; rc.setAttribute('aria-label', 'Back to the boat');
  const zb = (txt, label) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'lkc-zb'; b.textContent = txt; b.setAttribute('aria-label', label); b.title = label; return b; };
  const zin = zb('+', 'Zoom in'), zout = zb('\u2212', 'Zoom out');
  const ctl = document.createElement('div'); ctl.className = 'lkc-ctl'; ctl.append(zin, zout, rc); el.appendChild(ctl);   // + and − stacked over the recentre chip (bottom right)
  const hintEl = document.createElement('p'); hintEl.className = 'lkc-hint'; hintEl.setAttribute('role', 'status'); el.appendChild(hintEl);
  const cardT = card.querySelector('.t'), cardW = card.querySelector('.w'), cardGo = card.querySelector('.go'), cardSay = card.querySelector('.say'), cardMore = card.querySelector('.more');

  let S = SIZES[size] ?? SIZES.play, curMode = mode, ins = { left: 0, right: 0, top: 0, bottom: 0, ...insets };
  const listeners = new Map();
  const emit = (type, e) => { for (const fn of [...(listeners.get(type) ?? [])]) { try { fn(e); } catch (err) { console.error(err); } } };
  const act = { ...chartActions(services, () => curMode), ...(actions ?? {}) };
  const WORDS = { ...ACTION_WORDS, ...WATER_WORDS };
  const src = (k, d) => { try { return sources[k]?.() ?? d; } catch { return d; } };
  const boat = () => src('boat', null);
  const maxClass = () => (touch() && S.maxClass === 'C' ? 'B' : S.maxClass);

  // ---- the size and the view ----
  let W = 0, H = 0, dpr = 1;
  let view = { cx: 700, cz: -500, mpp: 6.5 }, following = S.follow, anim = null, dirty = true;
  const visView = () => chartView({ ...view, w: W, h: H });
  function layout() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1, d = Math.min(2, globalThis.devicePixelRatio || 1);
    if (w === W && h === H && d === dpr) return false;
    W = w; H = h; dpr = d; cv.width = Math.round(w * d); cv.height = Math.round(h * d); sprites.clear(); dirty = true;
    view = clampView(view, { w: W, h: H, size });
    return true;
  }
  const sprites = new Map();
  let nightNow = 0, glass = 1;   // glass: the ground's opacity (1 opaque; 0.9 over the live lake,: the host blurs what is behind)
  function setViewNow(v, { user = false } = {}) {
    view = clampView(v, { w: W, h: H, size }); dirty = true;
    if (user && following) following = false;
    emit('view', { ...view, following });
  }
  // glide to v over s seconds (reduced motion: at once)
  function glide(v, s = CHART_TIMING.zoomS) {
    const to = clampView(v, { w: W, h: H, size });
    if (reduced() || s <= 0 || !W) { setViewNow(to); anim = null; return; }
    anim = { from: { ...view }, to, t0: now(), dur: s * 1000 };
    dirty = true;
  }
  function stepAnim() {
    if (!anim) return false;
    const k = ease(clamp((now() - anim.t0) / anim.dur, 0, 1)), f = anim.from, t = anim.to;
    // zoom in log space, the centre so the zoom's own fixed point stays (a plain lerp of both reads well at these spans)
    const mpp = Math.exp(Math.log(f.mpp) + (Math.log(t.mpp) - Math.log(f.mpp)) * k);
    view = clampView({ cx: f.cx + (t.cx - f.cx) * k, cz: f.cz + (t.cz - f.cz) * k, mpp }, { w: W, h: H, size });
    if (k >= 1) { anim = null; emit('view', { ...view, following }); }
    dirty = true;
    return true;
  }
  const followTarget = (mpp = view.mpp) => { const b = boat(); return b ? { ...centreFor(b.x, b.z, mpp, ins), mpp } : null; };

  // ---- the ground: the shipped WebP at once; a desktop's live bake swaps in when its slices finish ----
  const imgs = { day: null, night: null }, live = { day: null, night: null };
  const bakeMs = { day: 0, night: 0, slices: 0, maxSliceMs: 0 };
  let baking = null, destroyed = false;
  function loadImg(p) {
    if (imgs[p] || typeof Image === 'undefined') return;
    const im = new Image(); im.decoding = 'async'; im.src = GROUND_URLS[p];
    imgs[p] = im; im.onload = () => { dirty = true; };
  }
  function bakeLive(p) {
    if (live[p] || baking || !ground?.live || !ground.heightAt || !(ground.ready?.() ?? true)) return;
    const { w, h } = groundSize(GROUND.liveMpp), c = canvas2d(w, h), g = c.getContext('2d'), img = g.createImageData(w, h);
    const it = groundSteps({ heightAt: ground.heightAt, mpp: GROUND.liveMpp, palette: p, out: img.data, rowsPerStep: 4 });
    const t0 = now();
    baking = p;
    const run = () => {
      if (destroyed) return;
      const t = now();
      let done = false;
      while (now() - t < CHART_TIMING.sliceMs) { if (it.next().done) { done = true; break; } }
      bakeMs.slices++; bakeMs.maxSliceMs = Math.max(bakeMs.maxSliceMs, now() - t);
      if (done) { g.putImageData(img, 0, 0); live[p] = c; bakeMs[p] = now() - t0; baking = null; dirty = true; return; }
      setTimeout(run, 0);
    };
    setTimeout(run, 0);
  }
  // the sheets: { [id]: { day, night } } images, each fetched once (a lazy sheet only when wanted)
  const sheetImgs = Object.fromEntries(Object.keys(SHEETS).map((id) => [id, { day: null, night: null }]));
  function loadSheet(id, p) {
    if (sheetImgs[id][p] || typeof Image === 'undefined') return;
    const im = new Image(); im.decoding = 'async'; im.src = SHEET_URLS[id][p];
    sheetImgs[id][p] = im; im.onload = () => { dirty = true; };
  }
  const sheetOf = (id, p) => { const im = sheetImgs[id][p]; return im?.complete && im.naturalWidth ? im : null; };
  const litAt = () => { const r = rows.find((q) => q.kind === 'birthplace' && q.lit); return r ? (r.at ? { x: r.at[0], z: r.at[1] } : { x: r.x, z: r.z }) : null; };
  function wantSheets(night) {
    const v = { ...view }, lit = litAt();
    for (const S of Object.values(SHEETS)) {
      if (!sheetWanted(S, v, { w: W, h: H, lit })) continue;
      loadSheet(S.id, 'day'); if (night > 0.02) loadSheet(S.id, 'night');
    }
  }
  const groundOf = (p) => (live[p] ? { src: live[p], mpp: GROUND.liveMpp, kind: 'live' } : imgs[p]?.complete && imgs[p].naturalWidth ? { src: imgs[p], mpp: GROUND_BAKE.mpp, kind: 'webp' } : null);

  // ---- the points of interest and the names ----
  let rows = [];
  function refreshRows() {
    const bp = services?.get?.('birthplace');
    const list = bp ? bp.list().filter((r) => !r.locked) : [];
    rows = buildPois({ birthplaces: list, current: bp?.current ?? null, anchorages: src('anchorages', []), aids: src('aids', []), places: src('places', []),
      areas: src('areas', []), channel: src('channel', null), barges: src('barges', []), raceMarks: src('raceMarks', []), racePins: src('racePins', []), corners: curMode === 'entrance' ? [] : src('corners', []) }, { mode: curMode });   // the hunts' corners in play and the hub, not at the entrance (no lake yet)
    uxApi?.setRaces?.(rows.some((r) => r.kind === 'racePin'));   //: the Races layer is in the bar only while the page has pins (Regatta)
    if (uxApi) rows = rows.filter((r) => r.lit || uxApi.visible(r));   // the layers (?mapux=1); a lit point (the chosen pin, the cue) always shows
  }
  const sailHereOn = () => { const ct = services?.get?.('chartTarget'); return curMode === 'play' && !!ct?.sailHere && ct.mode?.() !== 'cruise'; };   // Sail here: Sail only (Cruise keeps its one mark)
  let ownBoat = true;   // the sloop glyph; setOwnBoat(false) while the Coach's boat is laid over the map (sail.js, mapBoat.js)
  let waterRow = null;   // the open water's card (a click or a tap on the water in play): Set as target, Add waypoint (owner, 2026-11-18)
  const rowById = (id) => (id === 'water' ? waterRow : rows.find((r) => r.id === id || r.ref === id) ?? null);
  // a point's name: its own label in NAMES when it has one (the area, the places), else set off its mark (a pin's)
  const LABEL_OF = { 'pl-vikingsholm': 'n-vikingsholm', 'pl-falls': 'n-falls', 'pl-fannette': 'n-fannette' };
  function names() {
    const out = namesFor(rows.filter((r) => r.kind === 'birthplace')).map((n) => ({ ...n }));
    for (const r of rows) {
      if (LABEL_OF[r.id]) continue;
      // a pin's name: class A at the entrance (the pins are what the first view is for: every birthplace, so the far zoom keeps them), the
      // lit one first; in play and the hub class B but the lit one
      if (r.kind === 'birthplace') out.push({ id: `n-${r.id}`, text: r.name, x: r.x, z: r.z, cls: r.lit || curMode === 'entrance' ? 'A' : 'B', pri: r.lit ? -2 : curMode === 'entrance' ? -1.5 : 0, kind: 'water', dx: 13, dy: 0, align: 'left', poi: r.id, altPx: [[0, 19, 'center'], [0, -19, 'center'], [13, 19, 'left'], [13, -19, 'left'], [-13, 0, 'right']] });   // a pin's name: right, else below, above, left before it yields (hover or focus always shows it)
      else if (r.kind === 'anchorage') out.push({ id: `n-${r.id}`, text: r.name, x: r.x, z: r.z, cls: 'B', kind: 'water', dx: 11, dy: 0, align: 'left', poi: r.id });
      else if (r.kind === 'racePin') out.push({ id: `n-${r.id}`, text: r.name, x: r.x, z: r.z, cls: 'A', kind: 'water', dx: 14, dy: 0, align: 'left', poi: r.id, altPx: [[0, 20, 'center'], [0, -20, 'center'], [-14, 0, 'right']] });
      else if (r.kind === 'place') out.push({ id: `n-${r.id}`, text: r.name, x: r.x, z: r.z, cls: r.zoomClass, kind: 'land', dx: 9, dy: 0, align: 'left', poi: r.id });
    }
    return out;
  }
  const alphas = new Map();   // name id → its alpha now (the 0.2 s fades)
  let hover = null, focusId = null, selId = null;
  const hot = (id) => id && (id === hover || id === focusId || id === selId);

  // ---- drawing ----
  const stats = { draws: 0, ms: [], max: 0 };
  const drawn = { pois: [], labels: [], ground: 'none', sheets: [] };
  const P = [0, 0];
  function fontSize(n) {
    const t = touch();
    if (n.id === 'n-bay') return t ? 19 : 17;
    return n.cls === 'A' ? (t ? 17 : 15) : n.cls === 'B' ? (t ? 15 : 13) : (t ? 15 : 12);
  }
  function spriteOf(n, ink) {
    const key = `${n.id}|${n.text}|${dpr}|${ink.join(',')}|${touch() ? 1 : 0}|${nightNow > 0.5 ? 1 : 0}`;
    let s = sprites.get(key);
    if (!s) { s = nameSprite(n.text, { fs: fontSize(n), italic: n.kind === 'water', ink, dpr, halo: nightNow > 0.5 ? NIGHT_INK.halo : null }); sprites.set(key, s); if (sprites.size > 200) sprites.delete(sprites.keys().next().value); }
    return s;
  }
  function drawGround(g, v, night) {
    const deep = mix3(GROUND_PALETTES.day.water.at(-1)[1], GROUND_PALETTES.night.water.at(-1)[1], night);
    if (glass < 1) g.clearRect(0, 0, W, H);
    g.fillStyle = rgba(deep, glass); g.fillRect(0, 0, W, H);
    let kind = 'none';
    const sheets = [];
    // one raster over its box at mpp m a pixel: the visible part only (a cove's zoom draws a small crop, scaled)
    const raster = (src, B, mpp, a) => {
      const k = mpp / v.mpp;
      const [wx0, wz0] = v.toWorld(0, 0), [wx1, wz1] = v.toWorld(W, H);
      const sx0 = clamp((wx0 - B.x0) / mpp - 1, 0, src.width), sy0 = clamp((wz0 - B.z0) / mpp - 1, 0, src.height);
      const sx1 = clamp((wx1 - B.x0) / mpp + 1, 0, src.width), sy1 = clamp((wz1 - B.z0) / mpp + 1, 0, src.height);
      if (sx1 - sx0 < 1 || sy1 - sy0 < 1) return false;
      v.toPx(B.x0 + sx0 * mpp, B.z0 + sy0 * mpp, P);
      g.globalAlpha = a * glass;
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = k > 1.5 ? 'high' : 'medium';
      g.drawImage(src, sx0, sy0, sx1 - sx0, sy1 - sy0, P[0], P[1], (sx1 - sx0) * k, (sy1 - sy0) * k);
      g.globalAlpha = 1;
      return true;
    };
    for (const [p, a] of [['day', 1], ['night', night]]) {
      if (a <= 0.01) continue;
      // the sheets past the bay first (the lake's overview, then the south's detail), the bay's own ground over them
      for (const S of Object.values(SHEETS)) { const im = sheetOf(S.id, p); if (im && raster(im, S.box, S.mpp, a) && p === 'day') sheets.push(S.id); }
      const gd = groundOf(p);
      if (!gd) continue;
      kind = gd.kind;
      raster(gd.src, GROUND.box, gd.mpp, a);
    }
    drawn.sheets = sheets;
    if (kind === 'none' && sheets.length) kind = 'sheet';
    drawn.ground = kind;
    if (kind === 'none') { g.font = `400 15px ${UI}`; g.textAlign = 'center'; g.fillStyle = rgba(TOKENS.cream, 0.7); g.fillText('charting…', W / 2, H / 2); }
  }
  function drawPoi(g, r, x, y, I, A, bg, lifted) {
    g.lineCap = 'round'; g.lineJoin = 'round'; g.setLineDash([]);
    switch (r.kind) {
      case 'birthplace': {   // a small compass-point mark; the chosen one brass with a filled heart
        const c = r.lit ? A : I;
        g.beginPath(); g.arc(x, y, 6.5, 0, Math.PI * 2); g.fillStyle = rgba(bg, 0.55); g.fill();
        g.lineWidth = 1.3; g.strokeStyle = c(0.95); g.beginPath(); g.arc(x, y, 4.6, 0, Math.PI * 2); g.stroke();
        g.beginPath(); for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { g.moveTo(x + dx * 4.6, y + dy * 4.6); g.lineTo(x + dx * 8, y + dy * 8); } g.lineWidth = 1; g.stroke();
        g.beginPath(); g.arc(x, y, r.lit ? 2.4 : 1.6, 0, Math.PI * 2); g.fillStyle = c(0.95); g.fill();
        break;
      }
      case 'anchorage': {   // a chart's anchorage symbol, in the ink; lit (the anchorage cue): a size up with a fine amber ring
        const s = r.lit ? 6.8 : 5.2;
        if (r.lit) { g.beginPath(); g.arc(x, y, s * 1.25 + 2.5, 0, Math.PI * 2); g.lineWidth = 1.2; g.strokeStyle = A(0.9); g.stroke(); }
        g.strokeStyle = I(0.85); g.lineWidth = 1.1; g.beginPath();
        g.arc(x, y - s * 0.74, s * 0.2, 0, Math.PI * 2); g.moveTo(x, y - s * 0.54); g.lineTo(x, y + s * 0.74);
        g.moveTo(x - s * 0.42, y - s * 0.3); g.lineTo(x + s * 0.42, y - s * 0.3);
        g.moveTo(x - s * 0.68, y + s * 0.18); g.quadraticCurveTo(x - s * 0.52, y + s * 0.84, x, y + s * 0.74); g.quadraticCurveTo(x + s * 0.52, y + s * 0.84, x + s * 0.68, y + s * 0.18);
        g.stroke();
        break;
      }
      case 'buoy': {   // the lateral buoys in port red and starboard green, the no-wake buoy cream: a small leaning body on a ring
        const col = r.colour === 'red' ? TOKENS.port : r.colour === 'green' ? TOKENS.stbd : TOKENS.cream;
        g.beginPath(); g.moveTo(x + 0.6, y); g.lineTo(x + 3.6, y - 6.5); g.lineTo(x + 5.2, y - 5.8); g.lineTo(x + 2.4, y + 0.4); g.closePath();
        g.fillStyle = rgba(col, 0.9); g.fill();
        g.beginPath(); g.arc(x, y, 1.4, 0, Math.PI * 2); g.fillStyle = rgba(bg, 0.9); g.fill(); g.strokeStyle = I(0.8); g.lineWidth = 0.8; g.stroke();
        break;
      }
      case 'racePin': {   // a numbered brass ring on the navy, the number in the ring; lifted: a cream fill
        g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fillStyle = rgba(bg, lifted ? 0.95 : 0.82); g.fill();
        g.strokeStyle = rgba([201, 162, 75], 0.96); g.lineWidth = 1.6; g.stroke();
        g.font = `500 12px ${UI}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = rgba([201, 162, 75], 1); g.fillText(String(r.no ?? ''), x, y + 0.5); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        break;
      }
      case 'corner': {   // a hunt's corner: a small brass diamond, open until found, filled once found
        const s = 4.6, br = [201, 162, 75];
        g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.closePath();
        g.fillStyle = r.found ? rgba(br, 0.95) : rgba(bg, 0.6); g.fill(); g.strokeStyle = rgba(br, r.found ? 1 : 0.9); g.lineWidth = 1.2; g.stroke();
        break;
      }
      case 'raceMark': { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fillStyle = rgba([255, 106, 26], 0.95); g.fill(); g.strokeStyle = rgba(bg, 0.9); g.lineWidth = 1; g.stroke(); break; }
      case 'area': if (!lifted) return; g.beginPath(); g.arc(x, y, Math.max(10, r.r / visView().mpp), 0, Math.PI * 2); g.strokeStyle = I(0.32); g.lineWidth = 1; g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]); return;
      case 'channel': if (!lifted) return; break;
      default: { g.beginPath(); g.rect(x - 1.6, y - 1.6, 3.2, 3.2); g.strokeStyle = I(0.75); g.lineWidth = 1; g.stroke(); }
    }
    if (lifted) { g.beginPath(); g.arc(x, y, r.kind === 'birthplace' ? 11.5 : r.kind === 'racePin' ? 13 : 9.5, 0, Math.PI * 2); g.strokeStyle = rgba(TOKENS.amber, 0.95); g.lineWidth = 1.1; g.stroke(); }
  }
  // the scale bar's length in nautical miles (the nearest of ¼, ½, 1 … to 110 px) and its place, with north beside it, bottom-right
  function scaleGeo(mpp) {
    const nmM = 1852, opts = [0.1, 0.25, 0.5, 1], target = 110 * mpp, nm = opts.reduce((a, o) => (Math.abs(o * nmM - target) < Math.abs(a * nmM - target) ? o : a), opts[0]);
    const bar = (nm * nmM) / mpp, x1 = W - ins.right - 18, x0 = x1 - bar, y = H - ins.bottom - 20;
    return { nm, x0, x1, y, nx: x0 - 70 };
  }
  let lastT = now();
  function draw(dt, t0 = now()) {
    const v = visView(), g = cv.getContext('2d');
    const night = clamp(+src('night', 0) || 0, 0, 1);
    nightNow = night;
    const ink = mix3(TOKENS.cream, NIGHT_INK.ink, night), amber = mix3(TOKENS.amber, TOKENS.night.amber, night), bg = mix3(TOKENS.brandNavy, NIGHT_INK.halo, night);
    const I = (a) => rgba(ink, Math.min(1, a * (1 + 0.25 * night))), A = (a) => rgba(amber, a);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGround(g, v, night);
    const mpp = v.mpp, mc = maxClass(), inView = (x, z, pad = 40) => { v.toPx(x, z, P); return P[0] > -pad && P[0] < W + pad && P[1] > -pad && P[1] < H + pad; };

    // your wake (?mapux=1): every water sailed on this device, a faint broad band under today's track
    if (uxApi?.wakeOn()) drawWake(g, v, uxApi.wake.voyages, { rgba, ink, deep: bg, mpp });
    // her track: a thin cream line fading over the last CHART_TIMING.trackMin minutes of points (oldest faintest)
    const tr = src('track', []);
    if (tr.length > 1) {
      const n = tr.length, keep = Math.min(n, Math.round(CHART_TIMING.trackMin * 60 / 1.5)), parts = 4;
      g.lineWidth = 1.2; g.setLineDash([]);
      for (let p = 0; p < parts; p++) {
        const a0 = n - keep + Math.floor((keep * p) / parts), a1 = n - keep + Math.floor((keep * (p + 1)) / parts);
        if (a1 - a0 < 1) continue;
        g.beginPath(); v.toPx(tr[Math.max(0, a0 - 1)].x, tr[Math.max(0, a0 - 1)].z, P); g.moveTo(P[0], P[1]);
        for (let i = a0; i < a1; i++) { v.toPx(tr[i].x, tr[i].z, P); g.lineTo(P[0], P[1]); }
        g.strokeStyle = I(0.18 + 0.5 * ((p + 1) / parts)); g.stroke();
      }
    }
    // the passage plan's route (dashed ink: from the boat, through each waypoint, numbered) and Sail's mark (a brass ring: the beacon)
    const rt = src('route', null), bNow = boat();
    if (rt?.pts?.length) {
      const pts = rt.pts, from = rt.active ? Math.max(0, rt.leg ?? 0) : 0;
      g.save(); g.setLineDash([6, 5]); g.lineWidth = 1.5; g.strokeStyle = I(0.82); g.beginPath();
      let started = false;
      if (bNow) { v.toPx(bNow.x, bNow.z, P); g.moveTo(P[0], P[1]); started = true; }
      for (let i = from; i < pts.length; i++) { v.toPx(pts[i].x, pts[i].z, P); if (started) g.lineTo(P[0], P[1]); else { g.moveTo(P[0], P[1]); started = true; } }
      g.stroke(); g.restore();
      g.font = `500 11px ${UI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      pts.forEach((w, i) => {
        v.toPx(w.x, w.z, P);
        g.beginPath(); g.arc(P[0], P[1], 7, 0, Math.PI * 2); g.fillStyle = rgba(bg, i < from ? 0.5 : 0.85); g.fill(); g.lineWidth = 1.2; g.strokeStyle = I(i < from ? 0.4 : 0.9); g.stroke();
        g.fillStyle = I(i < from ? 0.5 : 0.95); g.fillText(String(i + 1), P[0], P[1] + 0.5);
      });
    }
    const mk = src('mark', null);
    if (mk && Number.isFinite(mk.x)) {
      v.toPx(mk.x, mk.z, P);
      g.beginPath(); g.arc(P[0], P[1], 8, 0, Math.PI * 2); g.fillStyle = rgba(bg, 0.55); g.fill(); g.lineWidth = 1.4; g.strokeStyle = A(0.95); g.stroke();
      g.beginPath(); g.arc(P[0], P[1], 2.6, 0, Math.PI * 2); g.fillStyle = A(0.95); g.fill();
      g.beginPath(); g.arc(P[0], P[1], 12.5, 0, Math.PI * 2); g.lineWidth = 1; g.strokeStyle = A(0.4); g.stroke();
    }
    // the points
    const pois = [], keep = [];
    for (const r of rows) {
      if (!poiShown(r, mpp, mc) || !inView(r.x, r.z)) continue;
      const x = P[0], y = P[1];
      drawPoi(g, r, x, y, I, A, bg, hot(r.id));
      pois.push({ id: r.id, kind: r.kind, px: +x.toFixed(1), py: +y.toFixed(1) });
      const kr = { birthplace: 8, anchorage: 6, place: 4, buoy: 5, raceMark: 5, barge: 6, racePin: 10, corner: 5 }[r.kind];   // a point's own mark, kept clear of names
      if (kr && !LABEL_OF[r.id]) keep.push([x - kr, y - kr, x + kr, y + kr]);   // a place with its own name nearby (the island): its name may pass close
    }
    drawn.pois = pois;
    // the boat (kept clear of names)
    const b = boat();
    if (b) { v.toPx(b.x, b.z, P); keep.push([P[0] - 13, P[1] - 13, P[0] + 13, P[1] + 13]); }
    // the scale and north (bottom-right, drawn last) keep their corner clear of names too
    const sc = scaleGeo(mpp);
    keep.push([sc.nx - 12, sc.y - 32, sc.x1 + 4, sc.y + 6]);
    // the names: laid out by class, then nearest the centre; each fades to its target over 0.2 s; a lifted name at 94 %
    const nl = names(), meas = (n) => { const s = spriteOf(n, ink); return { w: s.w, h: s.h }; };
    const lay = layoutLabels(nl, (x, z, o) => v.toPx(x, z, o), meas, { w: W, h: H, mpp, maxClass: mc, keep, cx: v.cx, cz: v.cz });
    // the soundings, the closest zoom only: italic numerals in the ink at half alpha, never under a name or a point (a sounding inside
    // "Fannette Island" or "Emerald Bay" garbled both, most of all in the night's brighter ink: the panel helper's night menu, 2026-11-18)
    if (classVisible('C', mpp, mc) && !touch()) {
      const boxes = keep.slice();
      for (const L of lay) {
        if (!L.shown || !Number.isFinite(L.x)) continue;
        const n = nl.find((q) => q.id === L.id), al = L.align ?? n?.align, x0 = al === 'left' ? 0 : al === 'right' ? -L.w : -L.w / 2, a = ((n?.angle ?? 0) * Math.PI) / 180;
        const cs = Math.cos(a), sn = Math.sin(a), pts = [[x0, -L.h / 2], [x0 + L.w, -L.h / 2], [x0, L.h / 2], [x0 + L.w, L.h / 2]].map(([px, py]) => [L.x + px * cs - py * sn, L.y + px * sn + py * cs]);
        boxes.push([Math.min(...pts.map((q) => q[0])) - 6, Math.min(...pts.map((q) => q[1])) - 4, Math.max(...pts.map((q) => q[0])) + 6, Math.max(...pts.map((q) => q[1])) + 4]);
      }
      g.font = `italic 400 11px ${UI}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = rgba(ink, INK.sounding + (NIGHT_INK.sounding - INK.sounding) * night);
      const south = sheetOf('south', 'day') ? SHEET_BAKE.south?.soundings ?? [] : [];   // the south's numerals once its sheet is in
      for (const [x, z, d] of [...GROUND_BAKE.soundings, ...south]) {
        if (!inView(x, z, 10)) continue;
        const sx = P[0], sy = P[1];
        if (boxes.some((bx) => sx + 8 > bx[0] && sx - 8 < bx[2] && sy + 6 > bx[1] && sy - 6 < bx[3])) continue;
        g.fillText(String(d), sx, sy);
      }
    }
    let fading = false;
    const out = [];
    for (const L of lay) {
      const n = nl.find((q) => q.id === L.id), poiId = n.poi ?? Object.keys(LABEL_OF).find((k) => LABEL_OF[k] === n.id);
      const lifted = poiId && hot(poiId);
      const target = L.shown || lifted ? 1 : 0, a0 = alphas.get(L.id) ?? 0, a = reduced() ? target : fadeTo(a0, target, dt);
      if (a !== target) fading = true;
      alphas.set(L.id, a);
      out.push({ id: L.id, shown: L.shown, alpha: +a.toFixed(3), x: Math.round(L.x), y: Math.round(L.y), w: Math.round(L.w), h: Math.round(L.h) });
      if (a <= 0.003 || !Number.isFinite(L.x)) continue;
      const s = spriteOf(n, n.poi && rows.find((r) => r.id === n.poi)?.lit ? amber : ink), base = lifted ? INK.lifted : (n.kind === 'land' ? INK.land + (NIGHT_INK.land - INK.land) * night : INK.water + (NIGHT_INK.water - INK.water) * night);
      g.save(); g.globalAlpha = a * base * (n.poi && rows.find((r) => r.id === n.poi)?.lit ? 1.15 : 1);
      g.translate(L.x, L.y); if (n.angle) g.rotate((n.angle * Math.PI) / 180);
      const al = L.align ?? n.align; g.drawImage(s.cv, al === 'left' ? 0 : al === 'right' ? -s.w : -s.w / 2, -s.h / 2, s.w, s.h);
      g.restore();
    }
    // a lifted point with no name of its own on the chart (a buoy, the channel, a race mark): its name beside it at 94 % while lifted
    for (const r of rows) {
      if (!hot(r.id) || LABEL_OF[r.id] || nl.some((n) => n.poi === r.id)) continue;
      if (!inView(r.x, r.z, 0)) continue;
      const n = { id: `n-${r.id}`, text: r.name, cls: 'C', kind: r.kind === 'channel' || r.kind === 'buoy' ? 'water' : 'land' }, s = spriteOf(n, ink);
      g.globalAlpha = INK.lifted; g.drawImage(s.cv, P[0] + 12, P[1] - s.h / 2, s.w, s.h); g.globalAlpha = 1;
      out.push({ id: n.id, shown: true, alpha: 1 });
    }
    drawn.labels = out;
    // the boat: the sloop in binnacle amber on a dark under-stroke, the one-minute vector ahead
    if (b) {
      v.toPx(b.x, b.z, P);
      const hd = b.heading ?? 0, [hx, hy] = v.dirPx(hd), [cx, cy] = v.dirPx(b.cog ?? hd), vv = ((b.sog ?? 0) * 60) / mpp;
      if (vv > 3) { g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(P[0] + cx * vv, P[1] + cy * vv); g.strokeStyle = rgba(bg, 0.7); g.lineWidth = 3.4; g.stroke(); g.strokeStyle = A(0.9); g.lineWidth = 1.4; g.stroke(); }
      if (ownBoat) { g.save(); g.translate(P[0], P[1]); g.rotate(Math.atan2(hx, -hy));
      const k = touch() ? 1.5 : 1.3;
      g.beginPath(); g.moveTo(0, -7.5 * k); g.bezierCurveTo(3.6 * k, -3.5 * k, 3.4 * k, 3 * k, 2.4 * k, 5.5 * k); g.lineTo(-2.4 * k, 5.5 * k); g.bezierCurveTo(-3.4 * k, 3 * k, -3.6 * k, -3.5 * k, 0, -7.5 * k); g.closePath();
      g.strokeStyle = rgba(bg, 0.85); g.lineWidth = 3.6; g.stroke(); g.fillStyle = A(0.3); g.fill(); g.strokeStyle = A(1); g.lineWidth = 1.6; g.stroke();
      g.restore(); }   // ownBoat false: the map's boat layer (mapBoat.js) draws her instead
    }
    // the wind: one quiet arrow in the top-left corner (past the owner's inset), the knots beside it in tabular numerals at 60 %
    const tw = b?.trueWind, wind = src('wind', null) ?? (tw ? { fromRad: (b.heading ?? 0) + tw.angle, kn: tw.speed / 0.514444 } : null);
    if (wind) {
      const ax = ins.left + 30, ay = ins.top + 30, [ux, uy] = v.dirPx(wind.fromRad), L2 = 18;
      const bx = ax + ux * L2 / 2, by = ay + uy * L2 / 2, hx = ax - ux * L2 / 2, hy = ay - uy * L2 / 2, px = -uy, py = ux;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(hx, hy); g.moveTo(hx + ux * 4.5 + px * 3.2, hy + uy * 4.5 + py * 3.2); g.lineTo(hx, hy); g.lineTo(hx + ux * 4.5 - px * 3.2, hy + uy * 4.5 - py * 3.2);
      g.strokeStyle = I(0.6); g.lineWidth = 1.5; g.stroke();
      g.font = `500 13px ${UI}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = I(0.6); g.fillText(`${Math.round(wind.kn)} kn`, ax + 18, ay + 0.5);
    }
    // the scale in nautical miles and north, bottom-right
    {
      const { nm, x0, x1, y, nx } = sc;
      g.beginPath(); g.moveTo(x0, y - 5); g.lineTo(x0, y); g.lineTo(x1, y); g.lineTo(x1, y - 5); g.strokeStyle = I(0.7); g.lineWidth = 1.2; g.stroke();
      g.font = `500 12px ${UI}`; g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillStyle = I(0.66);
      g.fillText(`${nm === 0.25 ? '¼' : nm === 0.5 ? '½' : nm} nm`, x0 - 8, y + 1);
      const ny = y;
      g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx, ny - 14); g.moveTo(nx - 3.5, ny - 9); g.lineTo(nx, ny - 14); g.lineTo(nx + 3.5, ny - 9); g.strokeStyle = I(0.66); g.lineWidth = 1.2; g.stroke();
      g.textAlign = 'center'; g.fillText('N', nx, ny - 18);
    }
    const ms = now() - t0;
    stats.draws++; stats.ms.push(ms); if (stats.ms.length > 300) stats.ms.shift(); stats.max = Math.max(stats.max, ms);
    return fading;
  }

  // ---- the card ----
  let busy = false;
  function placeCard() {
    if (card.hidden) return;
    const r = rowById(selId);
    if (!r) { closeCard(); return; }
    const v = visView(); v.toPx(r.x, r.z, P);
    const cw = card.offsetWidth || 220, ch = card.offsetHeight || 110, b = boat();
    let x = P[0] + 14, y = clamp(P[1] - 20, 8, Math.max(8, H - ch - 8));
    const covers = (xx) => { if (!b) return false; const q = v.toPx(b.x, b.z, [0, 0]); return q[0] > xx - 12 && q[0] < xx + cw + 12 && q[1] > y - 12 && q[1] < y + ch + 12; };
    if (x + cw > W - ins.right - 8 || covers(x)) x = P[0] - 14 - cw;
    if (x < ins.left + 8) x = Math.min(W - cw - 8, P[0] + 14);
    card.style.left = `${Math.round(x)}px`; card.style.top = `${Math.round(y)}px`;
  }
  // a place's card in play offers Sail here before Set as target (Sail only: the chart's routing; Cruise and the entrance as before)
  const actsOf = (r) => { const a = r.actions ?? (r.action ? [r.action] : []); return a[0] === 'target' && r.kind !== 'water' && sailHereOn() ? ['sailHere', ...a] : a; };
  function openCard(r0) {
    const a0 = actsOf(r0), r = a0 !== (r0.actions ?? null) && a0[0] === 'sailHere' ? { ...r0, action: null, actions: a0 } : r0;
    selId = r.id; focusId = r.id;
    cardT.textContent = r.name; cardW.textContent = r.line ?? ''; cardSay.textContent = '';
    const first = r.action ?? r.actions?.[0] ?? null;
    cardGo.hidden = !first; cardGo.textContent = first ? WORDS[first] : ''; cardGo.dataset.act = first ?? '';
    cardMore.replaceChildren(...(r.actions ?? []).slice(1).map((a) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.act = a; b.textContent = WORDS[a]; return b; }));
    card.setAttribute('aria-label', r.name); card.hidden = false; dirty = true;
    placeCard();
    if (first) cardGo.focus({ preventScroll: true });
    emit('select', r);
  }
  function closeCard() {
    if (card.hidden) return;
    card.hidden = true; selId = null; waterRow = null; dirty = true;
    if (card.contains(document.activeElement)) el.focus({ preventScroll: true });
    emit('select', null);
  }
  async function runAction(r, which = null) {
    const action = which ?? r?.action ?? r?.actions?.[0];
    if (!action || busy) return null;
    busy = true;
    const b = boat(), aim = aimOf(r, b);
    let result;
    const slow = setTimeout(() => { cardSay.textContent = 'One moment\u2026'; }, 300);   // the passage plan's chart may still be loading
    try { result = await act[action](r, aim); } catch { result = { ok: false, why: 'unknown' }; }
    clearTimeout(slow); cardSay.textContent = '';
    busy = false;
    result = result ?? { ok: false, why: 'unknown' };
    emit('action', { row: r, action, result });
    if (result.ok) { closeCard(); refreshRows(); dirty = true; } else cardSay.textContent = result.text ?? REFUSALS[result.why] ?? REFUSALS.unknown;
    return result;
  }
  // the open water's card (owner, 2026-11-18: "I can no longer set a target on the map"): its depth in the line; Set as target (Sail's
  // mark: the beacon, NAV), Add waypoint (the passage plan), and with a route Set course and Clear route. In play only.
  function openWater(px, py) {
    const ct = services?.get?.('chartTarget');
    if (curMode !== 'play' || !ct?.setWater) return false;
    // a tap on the target itself: its own card, Clear target (as a tap on the mark let it go on the old chart)
    const mk = src('mark', null), mq = mk && Number.isFinite(mk.x) ? visView().toPx(mk.x, mk.z, [0, 0]) : null;
    if (mq && Math.hypot(mq[0] - px, mq[1] - py) <= (touch() ? 24 : 16)) {
      waterRow = { id: 'water', kind: 'water', x: mk.x, z: mk.z, name: 'Your target', line: '', actions: ['clearTarget'] };
      openCard(waterRow);
      return true;
    }
    const [x, z] = visView().toWorld(px, py), d = ct.depth?.(x, z), rt = src('route', null);
    const land = Number.isFinite(d) && d <= 0, shoal = Number.isFinite(d) && d > 0 && d < 2;
    const acts = ['waterTarget'];   // Cruise: its navigator's one mark (no route)
    if (sailHereOn()) acts.unshift('sailHere');   // Sail: Sail here first (the target and the pilot on it)
    if (ct.mode?.() !== 'cruise') { acts.push('waypoint'); if (rt?.pts?.length) { if (!rt.active) acts.push('setCourse'); acts.push('clearRoute'); } }
    waterRow = { id: 'water', kind: 'water', x, z, name: land ? 'The shore' : shoal ? 'Shallows' : 'Open water',
      line: !Number.isFinite(d) ? '' : land ? 'Dry land.' : `${d < 10 ? d.toFixed(1) : Math.round(d)} m of water.`, actions: acts };
    openCard(waterRow);
    return true;
  }
  cardGo.addEventListener('click', (e) => { e.stopPropagation(); runAction(rowById(selId), cardGo.dataset.act || null); });
  cardMore.addEventListener('click', (e) => { const a = e.target?.dataset?.act; if (!a) return; e.stopPropagation(); runAction(rowById(selId), a); });
  for (const ty of ['pointerdown', 'pointerup', 'click', 'wheel', 'dblclick']) card.addEventListener(ty, (e) => e.stopPropagation(), { passive: ty !== 'wheel' });

  // ---- input ----
  const hitR = () => (touch() ? HIT_PX.touch : uxApi ? UX.snapPx : HIT_PX.mouse);   // ?mapux=1: a click takes the point the crosshair snapped to
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hitAt = (px, py) => hitTest(rows, (x, z, o) => visView().toPx(x, z, o), px, py, hitR(), view.mpp, maxClass());
  function setHover(r) { const id = r?.id ?? null; if (id === hover) return; hover = id; cv.style.cursor = id ? 'pointer' : ''; dirty = true; emit('hover', r ?? null); }
  const fingers = new Map();
  let press = null, pinch = null, lastTap = null, lastPin = null;
  function onDown(e) {
    e.stopPropagation();   // the page's own outside-click rules never see a press on the chart
    if (e.button != null && e.button > 0) return;
    el.focus({ preventScroll: true });
    try { cv.setPointerCapture(e.pointerId); } catch { /* a synthetic event */ }
    fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (fingers.size === 2) {
      const [a, b] = [...fingers.values()], [px, py] = local({ clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 });
      pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, v0: { ...view }, px, py }; press = null; anim = null; return;
    }
    const [px, py] = local(e);
    press = { id: e.pointerId, px, py, cx: e.clientX, cy: e.clientY, v0: { ...view }, moved: false, type: e.pointerType };
  }
  function onMove(e) {
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && fingers.size >= 2) {
      const [a, b] = [...fingers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, [px, py] = local({ clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 });
      const z = zoomAbout({ ...pinch.v0, w: W, h: H }, pinch.px, pinch.py, pinch.v0.mpp * (pinch.d0 / d));
      setViewNow(panBy({ ...z, w: W, h: H }, px - pinch.px, py - pinch.py), { user: true }); hideHint();
      return;
    }
    if (press && e.pointerId === press.id) {
      if (!press.moved && Math.hypot(e.clientX - press.cx, e.clientY - press.cy) > CHART_TIMING.tapPx) { press.moved = true; anim = null; setHover(null); el.setAttribute('data-drag', ''); hideHint(); }
      if (press.moved) setViewNow(panBy(press.v0, e.clientX - press.cx, e.clientY - press.cy), { user: true });
      return;
    }
    if (e.pointerType !== 'touch') { const [px, py] = local(e); setHover(hitAt(px, py)); }
  }
  function onUp(e) {
    fingers.delete(e.pointerId); el.removeAttribute('data-drag');
    if (pinch) { if (fingers.size < 2) pinch = null; press = null; return; }
    if (!press || e.pointerId !== press.id) return;
    const p = press; press = null;
    if (p.moved) return;
    const r = hitAt(p.px, p.py);
    if (r) {
      // a double click or double tap on a pin that offers Sail from here is that action; a single one selects and opens the card (owner, 2026-11-19)
      const t2 = now(), twice = lastPin && lastPin.id === r.id && t2 - lastPin.t < CHART_TIMING.dblMs;
      lastTap = null; lastPin = twice ? null : { id: r.id, t: t2 };
      if (twice && (r.action ?? r.actions?.[0]) === 'sail') { if (card.hidden || selId !== r.id) openCard(r); runAction(r, 'sail'); return; }
      openCard(r); return;
    }
    if (!card.hidden) { closeCard(); lastTap = null; return; }
    const t = now();
    if (lastTap && t - lastTap.t < CHART_TIMING.dblMs && Math.hypot(lastTap.px - p.px, lastTap.py - p.py) < 24) {
      lastTap = null;
      const w = visView().toWorld(p.px, p.py);
      emit('mark', { x: w[0], z: w[1] });
      return;
    }
    lastTap = { t, px: p.px, py: p.py };
    setTimeout(() => { if (lastTap && lastTap.t === t && card.hidden && !destroyed) { lastTap = null; if (!openWater(p.px, p.py)) emit('water', null); } }, CHART_TIMING.dblMs + 30);   // a single tap on empty water: in play its card (Set as target, Add waypoint); else 'water'
  }
  function onWheel(e) {
    e.preventDefault(); e.stopPropagation(); hideHint();
    const [px, py] = local(e), base = anim?.to ?? view;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const mpp = base.mpp * Math.pow(2, clamp(dy, -240, 240) * 0.004);
    const from = anim ? { ...anim.to, w: W, h: H } : { ...view, w: W, h: H };
    following = false;
    glide(zoomAbout(from, px, py, mpp));
  }
  const PAN_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.code, handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'Escape') { if (!card.hidden) { handled(); closeCard(); } else emit('close', null); return; }
    if (PAN_KEYS[k]) { handled(); const [dx, dy] = PAN_KEYS[k], f = e.shiftKey ? 0.5 : 0.1, base = anim?.to ?? view; following = false; glide({ cx: base.cx + dx * f * W * base.mpp, cz: base.cz + dy * f * H * base.mpp, mpp: base.mpp }); return; }
    if (k === 'Equal' || k === 'NumpadAdd' || k === 'Minus' || k === 'NumpadSubtract') {
      handled(); const base = anim?.to ?? view, inn = k === 'Equal' || k === 'NumpadAdd';
      glide(zoomAbout({ ...base, w: W, h: H }, W / 2, H / 2, base.mpp * (inn ? 1 / 1.5 : 1.5))); return;
    }
    if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') { handled(); const mpp = BOOKMARKS[+k.slice(5) - 1], base = anim?.to ?? view; glide(zoomAbout({ ...base, w: W, h: H }, W / 2, H / 2, mpp)); return; }
    if (k === 'Home') { handled(); recentre(); return; }
    if (k === 'Tab') {
      const order = walkOrder(rows, view.cx, view.cz, view.mpp, maxClass());
      if (!order.length) return;
      const i = order.findIndex((r) => r.id === focusId), n = i + (e.shiftKey ? -1 : 1);
      if (i >= 0 && (n < 0 || n >= order.length)) { focusId = null; dirty = true; return; }   // past the ends: the page's own Tab
      handled(); focusId = order[i < 0 ? (e.shiftKey ? order.length - 1 : 0) : n].id; dirty = true; emit('hover', rowById(focusId));
      return;
    }
    if ((k === 'Enter' || k === 'Space' || k === 'NumpadEnter') && focusId && card.hidden) { handled(); const r = rowById(focusId); if (r) openCard(r); }
  }
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !press) setHover(null); });
  cv.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('keydown', onKey);
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  rc.addEventListener('pointerdown', (e) => e.stopPropagation());
  rc.addEventListener('click', (e) => { e.stopPropagation(); recentre(); });

  function recentre() {
    const t = followTarget(view.mpp);
    following = true;
    if (t) glide(t, CHART_TIMING.glideS);
    dirty = true;
  }

  // ---- the frame loop: only while shown ----
  let shown = false, raf = 0, since = 1;
  function frame() {
    raf = 0;
    if (!shown || destroyed) return;
    const t = now(), dt = Math.min(0.1, (t - lastT) / 1000); lastT = t; since += dt;
    if (layout()) placeCard();
    const night = clamp(+src('night', 0) || 0, 0, 1);
    loadImg('day'); if (night > 0.02) loadImg('night');
    wantSheets(night);
    bakeLive('day'); if (night > 0.02 && live.day) bakeLive('night');
    const animating = stepAnim();
    if (following && !animating && !press && !pinch) { const f = followTarget(); if (f && (Math.abs(f.cx - view.cx) > 0.01 || Math.abs(f.cz - view.cz) > 0.01)) { view = clampView(f, { w: W, h: H, size }); dirty = true; } }
    const rcWant = !following && !!boat();
    if (rc.hidden === rcWant) rc.hidden = !rcWant;
    if (dirty || animating || fadingNow || (boat() && since >= 1 / CHART_TIMING.hz)) { since = 0; dirty = false; const t0 = now(); refreshRows(); fadingNow = draw(dt, t0); placeCard(); }   // the frame's whole cost (the points, the draw) in stats()
    raf = requestAnimationFrame(frame);
  }
  let fadingNow = false;
  function show(on) {
    on = !!on;
    if (on === shown) return;
    shown = on;
    uxApi?.show(on);
    if (on) {
      lastT = now(); layout(); refreshRows();
      if (S.follow && following) { const f = followTarget(); if (f) view = clampView(f, { w: W, h: H, size }); }
      dirty = true; raf = requestAnimationFrame(frame); showHint();
    } else { hideHint(); if (raf) cancelAnimationFrame(raf); raf = 0; closeCard(); setHover(null); focusId = null; press = null; pinch = null; fingers.clear(); }
  }

  // the zoom pair and the one-time hint (owner, 2026-11-18: help users who do not know the map scrolls and drags)
  let hintT = 0;
  function hideHint() { clearTimeout(hintT); hintEl.removeAttribute('data-on'); }
  function showHint() {
    if (!hint || hint.seen?.()) return;
    hintEl.textContent = touch() ? 'Tap the water to sail there \u00b7 pinch to zoom' : 'Click the water to sail there \u00b7 scroll to zoom';   // the chart's routing, taught in the hint it already had (2026-11-25)
    hint.done?.(); hintEl.setAttribute('data-on', ''); clearTimeout(hintT); hintT = setTimeout(hideHint, 4000);
  }
  const stepZoom = (f) => { hideHint(); const base = anim?.to ?? view, cx = (W + ins.left - ins.right) / 2; glide(zoomAbout({ ...base, w: W, h: H }, cx, H / 2, base.mpp * f)); };
  zin.addEventListener('click', (e) => { e.stopPropagation(); stepZoom(1 / 1.5); });
  zout.addEventListener('click', (e) => { e.stopPropagation(); stepZoom(1.5); });
  for (const b of [zin, zout]) for (const ty of ['pointerdown', 'pointerup', 'wheel', 'dblclick']) b.addEventListener(ty, (e) => e.stopPropagation(), { passive: ty !== 'wheel' });

  // the first view: the caller's, else the boat, else the whole bay
  layout();
  {
    const b = boat(), r = zoomRange(W, H, size);
    if (view0?.center) view = clampView({ cx: view0.center.x, cz: view0.center.z, mpp: view0.mpp ?? r.max }, { w: W, h: H, size });
    else if (b && S.follow) view = clampView({ ...centreFor(b.x, b.z, Math.min(3.2, r.max), ins), mpp: Math.min(3.2, r.max) }, { w: W, h: H, size });
    else view = clampView({ cx: 700, cz: -560, mpp: r.max }, { w: W, h: H, size });
  }
  if (touch()) el.dataset.touch = ''; else delete el.dataset.touch;
  //'s mock (?mapux=1): mounted only when asked; reads the chart through these few calls
  let uxApi = null, uxTimer = 0;
  if (ux) {
    uxApi = mountMapUx({ el, rgba, uiFont: UI, touch, reduced, insets: () => ins, boat, toWorld: (px, py) => visView().toWorld(px, py), points: () => drawn.pois,
      ink: () => mix3(TOKENS.cream, NIGHT_INK.ink, nightNow), halo: () => mix3(TOKENS.brandNavy, NIGHT_INK.halo, nightNow), hover: () => {}, redraw: () => { refreshRows(); dirty = true; } }, ux);
    uxApi.setInset(ins.left);
    if (ux.wake) { let ver = -1; uxTimer = setInterval(() => { if (shown && ux.wake.version !== ver) { ver = ux.wake.version; dirty = true; } }, 1000); }
  }
  refreshRows();

  const api = {
    el,
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type)?.delete(fn); },
    focus(id) {
      refreshRows();
      const r = rowById(id);
      if (!r) return false;
      following = false;
      const mpp = Math.min(view.mpp, r.zoomClass === 'C' ? 2.4 : r.zoomClass === 'B' ? 5 : view.mpp);
      glide({ ...centreFor(r.x, r.z, mpp, ins), mpp }, CHART_TIMING.focusS);
      openCard(r);
      return true;
    },
    select(id) { if (id == null) { closeCard(); return true; } refreshRows(); const r = rowById(id); if (!r) return false; openCard(r); return true; },
    setView({ center = null, mpp = null, animate = true, duration = null } = {}) {   // duration: seconds of the glide (default 0.25; the entrance's zoom-in is 0.9)
      following = false;
      const to = { cx: center?.x ?? view.cx, cz: center?.z ?? view.cz, mpp: mpp ?? view.mpp };
      if (animate) glide(to, duration ?? CHART_TIMING.zoomS); else setViewNow(to);
    },
    setOwnBoat(on) { ownBoat = !!on; dirty = true; },
    setGlass(a = 1) { glass = clamp(+a || 0, 0.5, 1); el.toggleAttribute('data-glass', glass < 1); dirty = true; },   // the ground at this opacity (the host's CSS blurs the lake behind it)
    get following() { return following; },
    recentre,
    show,
    setMode(m) { curMode = m; refreshRows(); closeCard(); dirty = true; },
    setSize(s) { size = s; S = SIZES[s] ?? SIZES.play; view = clampView(view, { w: W, h: H, size }); dirty = true; },
    setInsets(o = {}) { ins = { ...ins, ...o }; uxApi?.setInset(ins.left); dirty = true; },
    get ux() { return uxApi; },
    resize() { layout(); placeCard(); dirty = true; },
    runAction: (id) => runAction(rowById(id) ?? rowById(selId)),
    toClient(x, z) { const r = cv.getBoundingClientRect(), q = visView().toPx(x, z); return { x: r.left + q[0], y: r.top + q[1] }; },
    get shown() { return shown; },
    openWater: (x, z) => { const q = visView().toPx(x, z); return openWater(q[0], q[1]); },   // a test's and a probe's way to the water card
    get state() {
      return { water: waterRow ? { x: +waterRow.x.toFixed(1), z: +waterRow.z.toFixed(1), actions: [...waterRow.actions] } : null, size, mode: curMode, view: { ...view }, following, hover, focus: focusId, selected: selId, card: card.hidden ? null : { name: cardT.textContent, action: cardGo.hidden ? null : cardGo.textContent, say: cardSay.textContent },
        ground: drawn.ground, sheets: [...drawn.sheets], sheetsLoaded: Object.keys(SHEETS).filter((id) => !!sheetImgs[id].day), live: { day: !!live.day, night: !!live.night }, pois: drawn.pois.map((p) => ({ ...p })), labels: drawn.labels.map((l) => ({ ...l })), w: W, h: H, insets: { ...ins }, zoom: zoomRange(W, H, size) };
    },
    stats() {
      const a = [...stats.ms].sort((x, y) => x - y), pct = (p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
      return { draws: stats.draws, drawMsMean: +(a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)).toFixed(3), drawMsP95: +pct(0.95).toFixed(3), drawMsMax: +stats.max.toFixed(3),
        bake: { day: +bakeMs.day.toFixed(1), night: +bakeMs.night.toFixed(1), slices: bakeMs.slices, maxSliceMs: +bakeMs.maxSliceMs.toFixed(2) } };
    },
    destroy() {
      destroyed = true; show(false);
      el.removeEventListener('keydown', onKey);
      clearInterval(uxTimer); uxApi?.destroy(); cv.remove(); card.remove(); rc.remove(); el.classList.remove('lkc'); el.removeAttribute('tabindex'); listeners.clear();
    },
  };
  return api;
}
