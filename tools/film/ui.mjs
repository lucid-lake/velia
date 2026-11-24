// UI shots for the film runner (Learn): the live page with its UI on (?filmui=1: no
// wall-clock loop; the runner calls filmFrame(dt) per frame), scripted inputs on the shot's timeline, a soft cream touch
// dot where a finger or the pointer is, the frame captured in-page (page.screenshot, never a screen recording), and a
// macro crop around a part of the helm station when the format asks for one.
//
// A UI shot file adds to a film shot: "ui": true, and per format { "view": [w, h] css px, "dpr": n, "touch": bool,
// "pixelratio": n (the canvas density), "crop": { "around": "wheel" | "main" | "jib" | "thr" | "<css selector>", "h": css px,
// "dx": css px, "dy": css px } | null, "hide": [css selectors] }, and "inputs": [ ... ] at t (s from frame 0):
//   { "t", "key": "KeyD", "dur": s }                       a key held for dur
//   { "t", "drag": { "on": "wheel" | "main" | "jib" | "thr", "path": "arc" | "down" | "up", "deg" | "px", "dur" } }
//   { "t", "tap": "<css selector>" | "text=Sail" }         a tap or click on an element's centre (by its text: the card's picks)
//   { "t", "eval": "<js>" }                                anything else the page offers (a hint forced, a skipper line)
// "settle": s of play before frame 0 (no frames written), "waitFor": a JS expression the page must make true first,
// "settleDt": the settle's step (s), "settleMs": real ms to wait after it (CSS fades run on the wall clock), "storage": localStorage entries set before load,
// "css": film-only style rules (the card over the live render: the loading root made transparent).
import { resolve } from 'node:path';

const DOT = `#film-dot{position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;pointer-events:none;z-index:2147483647;
background:radial-gradient(circle,rgba(239,230,210,.92) 0 38%,rgba(239,230,210,.35) 62%,rgba(239,230,210,0) 72%);box-shadow:0 0 14px rgba(28,35,64,.35);opacity:0;transition:none}`;

export const uiQuery = (shot, F) => {
  const q = { mode: 'sail', seed: 1, once: 0, music: 0, metrics: 0, attract: 0, timerate: 0, speed: 1, quality: 'high', ...shot.url, filmui: 1, pixelratio: F.pixelratio ?? F.dpr ?? 1 };
  return Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
};

// the screen box of a named part (css px): the helm station's own rects, else a selector's bounding box
const boxOf = (page, on) => page.evaluate((on) => {
  const st = window.__lakeshore.station, r = st?.rects?.[on];
  if (r) return { x: r.x, y: r.y, w: r.w, h: r.h };
  // "text=Sail": the smallest visible button-like element whose text starts so (the card's picks, ENTER, a choice)
  const e = on.startsWith('text=') ? [...document.querySelectorAll('button,[role=button],a')].filter((b) => b.offsetParent && b.textContent.trim().toLowerCase().startsWith(on.slice(5).toLowerCase())).sort((a, b) => a.textContent.length - b.textContent.length)[0] : document.querySelector(on);
  if (!e) return null;
  const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height };
}, on);

export async function renderUiFormat({ browser, shot, fmt, port, dir, fps, total, scale = 1 }) {
  const F0 = shot.formats[fmt], F = scale === 1 ? F0 : { ...F0, dpr: Math.max(0.5, (F0.dpr ?? 1) * scale), pixelratio: Math.max(0.5, (F0.pixelratio ?? F0.dpr ?? 1) * scale) };   // --scale: a lighter preview
  const ctx = await browser.newContext({ viewport: { width: F.view[0], height: F.view[1] }, deviceScaleFactor: F.dpr ?? 1, hasTouch: !!F.touch, isMobile: !!F.touch });
  // the browser's own state for the shot (a welcomed New player: settings in localStorage), before any page script runs
  if (shot.storage) await ctx.addInitScript((st) => { try { for (const [k, v] of Object.entries(st)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* none */ } }, shot.storage);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const url = `http://127.0.0.1:${port}/?${uiQuery(shot, F)}`;
  const tLoad = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__lakeshore?.filmFrame, null, { timeout: 300000 });
  const dt = 1 / fps, step = () => page.evaluate((d) => window.__lakeshore.filmFrame(d), dt);
  // the first frames show the card or the play view; a wait condition (the station drawn, the card at home) on frames
  for (let k = 0; k < 600 && shot.waitFor && !(await page.evaluate(shot.waitFor)); k++) await step();
  // CSS transitions run on the page's wall clock (the card's fade-in): let them finish before frame 0
  if (shot.settleMs) await page.waitForTimeout(shot.settleMs);
  await page.addStyleTag({ content: DOT + (F.hide?.length ? `${F.hide.join(',')}{visibility:hidden !important}` : '') + (shot.css ?? '') });   // css: a shot's own film-only rules
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'film-dot'; document.body.appendChild(d); });
  // the settle: shot.settle s of play before frame 0, in steps of settleDt (0.1 s: a long sail-in renders few frames)
  { const sd = shot.settleDt ?? dt; for (let k = 0, n = Math.round((shot.settle ?? 2) / sd); k < n; k++) await page.evaluate((d) => window.__lakeshore.filmFrame(d), sd); }
  const loadS = (Date.now() - tLoad) / 1000;
  // the crop (css px), from the part's box as it stands after the settle
  let clip = null;
  if (F.crop) {
    const b = await boxOf(page, F.crop.around), cx = b.x + b.w / 2 + (F.crop.dx ?? 0), cy = b.y + b.h / 2 + (F.crop.dy ?? 0);
    const h = F.crop.h, w = h * F.w / F.h;
    clip = { x: Math.max(0, Math.min(F.view[0] - w, cx - w / 2)), y: Math.max(0, Math.min(F.view[1] - h, cy - h / 2)), width: w, height: h };
  }
  // the inputs on the timeline: keys, drags (pointer or touch), taps, page calls; the dot follows the hand
  const mouse = !F.touch, cdp = F.touch ? await ctx.newCDPSession(page) : null;
  const dot = (x, y, o) => page.evaluate(([x, y, o]) => { const d = document.getElementById('film-dot'); d.style.transform = `translate(${x}px,${y}px)`; d.style.opacity = o; }, [x, y, o]);
  const down = async (x, y) => { if (mouse) { await page.mouse.move(x, y); await page.mouse.down(); } else await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); };
  const move = async (x, y) => { if (mouse) await page.mouse.move(x, y); else await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); };
  const up = async () => { if (mouse) await page.mouse.up(); else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const live = [];   // inputs under way: { until, frame(t) }
  const inputs = [...(shot.inputs ?? [])].sort((a, b) => a.t - b.t);
  let next = 0;
  const tRender = Date.now(), log = [];
  for (let i = 0; i < total; i++) {
    const t = i * dt;
    while (next < inputs.length && inputs[next].t <= t + 1e-9) {
      const e = inputs[next++];
      if (e.key) { await page.keyboard.down(e.key); live.push({ until: e.t + (e.dur ?? 0.1), end: () => page.keyboard.up(e.key) }); }
      if (e.tap) { const b = await boxOf(page, e.tap); const x = b.x + b.w / 2, y = b.y + b.h / 2; await dot(x, y, 1); if (mouse) await page.mouse.click(x, y); else await page.touchscreen.tap(x, y); live.push({ until: e.t + 0.35, end: () => dot(x, y, 0) }); }
      if (e.eval) await page.evaluate(e.eval);
      if (e.drag) {
        const g = e.drag, b = await boxOf(page, g.on), c = [b.x + b.w / 2, b.y + b.h / 2], R = Math.min(b.w, b.h) * 0.4;
        // arc: from 3 o'clock round the rim by deg (clockwise +); down / up: a straight drag of px from the centre
        const at = (k) => g.path === 'arc' ? [c[0] + R * Math.cos(k * (g.deg ?? 60) * Math.PI / 180), c[1] + R * Math.sin(k * (g.deg ?? 60) * Math.PI / 180)]
          : [c[0], c[1] + (g.path === 'up' ? -1 : 1) * k * (g.pxFrac != null ? g.pxFrac * b.h : g.px ?? 60)];   // pxFrac: a share of the part's height (the same notch in every layout)
        const p0 = at(0); await down(p0[0], p0[1]); await dot(p0[0], p0[1], 1);
        const t0 = e.t, d = g.dur ?? 1;
        live.push({ until: t0 + d, frame: async (tt) => { const k = Math.min(1, (tt - t0) / d), e2 = k * k * (3 - 2 * k), p = at(e2); await move(p[0], p[1]); await dot(p[0], p[1], 1); }, end: async () => { await up(); const p = at(1); await dot(p[0], p[1], 0); } });
      }
    }
    for (const l of live) if (l.frame) await l.frame(t);
    for (const l of live.filter((l) => t >= l.until)) { await l.end(); live.splice(live.indexOf(l), 1); }
    await step();
    await page.screenshot({ path: resolve(dir, `f${String(i).padStart(5, '0')}.png`), type: 'png', ...(clip ? { clip } : {}) });
    if (i % 60 === 0) log.push({ i, t, state: await page.evaluate(() => { const s = window.__lakeshore.boat?.phys?.state; return s ? { heelDeg: +(s.heel * 57.3).toFixed(1), rudDeg: +(s.rudderAngle * 57.3).toFixed(1), sog: +s.sog.toFixed(2) } : null; }) });
  }
  const renderS = (Date.now() - tRender) / 1000;
  await ctx.close();
  return { url, loadS, renderS, errors, log, clip, drawn: clip ? [Math.round(clip.width * (F.dpr ?? 1)), Math.round(clip.height * (F.dpr ?? 1))] : [F.view[0] * (F.dpr ?? 1), F.view[1] * (F.dpr ?? 1)] };
}
