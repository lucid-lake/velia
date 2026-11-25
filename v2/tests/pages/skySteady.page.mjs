// The Boat view's sky holds still on the bigger sea (fix 2026-11-25: "the sky for both day and night is often shaking"; night off
// Ski Run, 16 kn, the Milky Way). The boat's speed, surf cue and heading move with every wave; the follow camera's lens, eye and aim
// read them, so the lens pumped 0.5° at the waves' period and the sky far from the frame's centre shook ±2.5 px at 720p while the
// horizon held. The camera now reads them slow (v2/sim/boat.js CAM_SLOW); the boat still heaves and pitches on screen.
//   1. the played page (the clock running), 5 s of the Boat view at 16 kn: a star 20° up ahead and one 30° to the side, the
//      horizon and the lens, as drawn (the camera's eye, aim, roll and lens each frame), their wave-period part (a 1.5 s centred
//      mean taken out: the chase's pan, a gust's breath) under bounds; the boat's bow on screen still moves with the waves
//   2. a capture (renderOnce, 1/120 s a frame) at night: the stars against the ridge, frame by frame (the sky never moves against
//      the land: no lag, no stale uniform, no precision step)
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/skySteady.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const W = 1280, H = 720, D = Math.PI / 180;
const PLACE = 'birth=ski-run&windspeed=8.23';   // the owner's: off Ski Run, 16 kn

// a direction (el, az from the camera's yaw, deg) on screen (px) for a camera row { f, fov, roll }
function proj(r, el, az) {
  const k = (H / 2) / Math.tan(r.fov * D / 2), p = Math.asin(r.f[1]);
  const d = [Math.cos(el * D) * Math.sin(az * D), Math.sin(el * D), Math.cos(el * D) * Math.cos(az * D)];
  const y1 = d[1] * Math.cos(p) - d[2] * Math.sin(p), z1 = d[1] * Math.sin(p) + d[2] * Math.cos(p);
  let x = k * d[0] / z1, y = k * y1 / z1; const c = Math.cos(r.roll), s = Math.sin(r.roll);
  [x, y] = [x * c + y * s, -x * s + y * c];
  return [W / 2 + x, H / 2 - y];
}
const shake = (a, t) => a.map((v, i) => { let s = 0, n = 0; for (let j = 0; j < a.length; j++) if (Math.abs(t[j] - t[i]) <= 0.75) { s += a[j]; n++; } return v - s / n; }).filter((_, i) => t[i] >= t[0] + 0.75 && t[i] <= t.at(-1) - 0.75);
const pp = (a) => Math.max(...a) - Math.min(...a);
const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  // ---- 1. the played page ----
  for (const hour of [13, 22]) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
    await page.goto(`${BASE}/?mode=sail&seed=1&noload=1&once=0&fv=1&hm=0&chatter=0&hour=${hour}&${PLACE}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
    await page.waitForTimeout(8000);   // the start's camera turn settled (the chase toward her heading)
    const rows = await page.evaluate(() => new Promise((ok) => {
      const V = window.__velia, c = V.camera, rows = []; const t0 = performance.now();
      const f = (now) => {
        rows.push({ t: (now - t0) / 1000, f: [...c.fwd], fov: c.fov, roll: V.gust?.roll ?? 0, view: V.m4?.views?.view, bow: V.introProbe?.()?.y?.[1] ?? null, sog: V.boat.sim.state.sog });
        if (now - t0 >= 5000) ok(rows); else requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    }));
    const t = rows.map((r) => r.t);
    const starY = shake(rows.map((r) => proj(r, 20, 0)[1]), t), sideY = shake(rows.map((r) => proj(r, 20, 30)[1]), t), sideX = shake(rows.map((r) => proj(r, 20, 30)[0]), t);
    const hor = shake(rows.map((r) => proj(r, 0, 0)[1]), t), fov = shake(rows.map((r) => r.fov), t), bow = shake(rows.map((r) => (1 - r.bow) * H / 2), t), sog = shake(rows.map((r) => r.sog), t);
    const msg = `${rows.length} frames, view ${rows[0].view}: star y pp ${pp(starY).toFixed(2)} px (sd ${sd(starY).toFixed(2)}), side y ${pp(sideY).toFixed(2)} x ${pp(sideX).toFixed(2)}, horizon ${pp(hor).toFixed(2)}, lens ${pp(fov).toFixed(3)}°; sog's wave part ${pp(sog).toFixed(2)} m/s; bow ${pp(bow).toFixed(1)} px`;
    check(rows[0].view === 'follow' && rows.length > 100, `hour ${hour}: the Boat view, played (${rows.length} frames)`);
    check(pp(starY) < 1.5 && pp(sideY) < 1.5 && pp(sideX) < 1.5 && pp(fov) < 0.12, `hour ${hour}: the sky holds (wave-period motion of the stars under 1.5 px at 720p, the lens under 0.12°): ${msg}`);
    check(pp(hor) < 0.4, `hour ${hour}: the horizon holds: ${msg}`);
    check(pp(bow) > 4, `hour ${hour}: the boat still heaves and pitches on screen (its bow's wave-period motion over 4 px): ${msg}`);
    check(!errors.length, `hour ${hour}: no page errors (${errors.join(' | ').slice(0, 200) || 'none'})`);
    await page.close();
  }

  // ---- 2. a capture at night: the stars against the ridge, frame by frame ----
  const cap = await browser.newPage({ viewport: { width: W, height: H } });
  await cap.goto(`${BASE}/?mode=sail&seed=1&headless=1&hour=22&wlook=clear&${PLACE}`, { waitUntil: 'load' });
  await cap.waitForFunction(() => window.__velia?.renderOnce && window.__velia.ready, null, { timeout: 240000 });
  const grey = async () => { const png = PNG.sync.read(await cap.screenshot()); const g = new Float32Array(W * H); for (let i = 0; i < W * H; i++) g[i] = (png.data[i * 4] + png.data[i * 4 + 1] + png.data[i * 4 + 2]) / 3; return g; };
  const frames = [];
  for (let i = 0; i < 16; i++) { await cap.evaluate(() => window.__velia.renderOnce()); frames.push(await grey()); }
  await cap.close();
  // the land: its rows round the ridge (found per column, where the land's light rises over the sky's), averaged across the frame
  // but the boat's middle (the camera pans across: the row profile holds), and each frame's vertical shift against the first by
  // the least squared difference of the profiles (0.01 px steps, linear between rows)
  const ridgeY = (g, x) => { for (let y = 120; y < H - 120; y++) if (g[(y + 3) * W + x] - g[(y - 2) * W + x] > 40) return y; return null; };
  const rys = []; for (let x = 20; x < W - 20; x += 4) { if (x > W * 0.38 && x < W * 0.62) continue; const y = ridgeY(frames[0], x); if (y != null) rys.push(y); }
  rys.sort((a, b) => a - b);
  const rMid = rys[rys.length >> 1] ?? H / 2, y0 = Math.max(10, rMid - 25), y1 = Math.min(H - 10, rMid + 30);
  const profile = (g) => { const p = new Float64Array(y1 - y0); for (let y = y0; y < y1; y++) { let s = 0, n = 0; for (let x = 20; x < W - 20; x++) { if (x > W * 0.38 && x < W * 0.62) continue; s += g[y * W + x]; n++; } p[y - y0] = s / n; } return p; };
  const at = (p, y) => { const i = Math.floor(y), f = y - i; return i < 0 || i + 1 >= p.length ? null : p[i] * (1 - f) + p[i + 1] * f; };
  const shiftOf = (p0, p) => { let best = 0, bestE = Infinity; for (let d = -3; d <= 3; d += 0.01) { let e = 0; for (let y = 5; y < p0.length - 5; y++) { const v = at(p, y + d); e += (v - p0[y]) ** 2; } if (e < bestE) { bestE = e; best = d; } } return best; };
  const p0 = profile(frames[0]), ridge = frames.map((g) => shiftOf(p0, profile(g)));
  const cols = rys;
  // the stars: bright points over the ridge, tracked by their centroids
  const g0 = frames[0], top = y0 - 10, stars = [];
  for (let y = 12; y < top; y++) for (let x = 12; x < W - 12; x++) { const v = g0[y * W + x]; if (v < 60) continue; let max = true, sum = 0; for (let dy = -4; dy <= 4 && max; dy++) for (let dx = -4; dx <= 4; dx++) { const u = g0[(y + dy) * W + x + dx]; if (u > v) { max = false; break; } sum += u; } if (max && v - sum / 81 > 30) stars.push([y, x]); }
  const cen = (g, y, x) => { let s = 0, sy = 0, sx = 0; const yi = Math.round(y), xi = Math.round(x); let bg = Infinity; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) bg = Math.min(bg, g[(yi + dy) * W + xi + dx]); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const w = Math.max(0, g[(yi + dy) * W + xi + dx] - bg); s += w; sy += w * dy; sx += w * dx; } return s > 0 ? [yi + sy / s, xi + sx / s] : null; };
  const tracks = stars.slice(0, 40).map(([y, x]) => { const tr = [cen(frames[0], y, x)]; for (let i = 1; i < frames.length; i++) { const p = tr.at(-1); tr.push(p && p[0] > 8 && p[1] > 8 && p[1] < W - 8 ? cen(frames[i], p[0], p[1]) : null); } return tr; }).filter((tr) => tr.every((p) => p));
  const skyY = frames.map((_, i) => tracks.reduce((s, tr) => s + tr[i][0], 0) / Math.max(1, tracks.length));
  const rel = skyY.map((v, i) => (v - skyY[0]) - (ridge[i] - ridge[0]));
  const steps = rel.slice(1).map((v, i) => v - rel[i]);
  check(tracks.length >= 8 && cols.length >= 40, `the capture: ${tracks.length} stars tracked, the ridge found in ${cols.length} columns (rows ${y0}–${y1})`);
  check(pp(rel) < 0.3 && Math.max(...steps.map(Math.abs)) < 0.15, `the stars never move against the ridge over 16 frames: pp ${pp(rel).toFixed(3)} px, largest step ${Math.max(...steps.map(Math.abs)).toFixed(3)} px (the ridge moved ${pp(ridge).toFixed(2)} px, the stars ${pp(skyY).toFixed(2)})`);
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
