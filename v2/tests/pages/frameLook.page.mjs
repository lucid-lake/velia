// fix(v2) frame look (2026-11-14): v1's camera on v2's frame (AgX, v1's LUT, the sky match and v1's polariser, v1's day
// exposure). Locks, at 1280 × 720:
//   the noon sky: noon cam E's clear sky beside the clouds and the sky 30° up (cam E pitched up) within 10 levels a channel of
//     v1's, measured as tools/v2-cloud-colour.mjs does (the deck's mask from a ?clouds=0 twin; v1 at bbe9b1a6: beside
//     45, 137, 184, 30° up 7, 114, 166). The camera before this read 48, 90, 151 and 32, 66, 125;
//   the navy: the follow camera's near deep water at noon (wind 3) keeps the value before the change in CIELAB: L* within 3,
//     chroma within 6 of 29, 39, 88 (L* 17.5, C 33.8, h −67°; the owner's ruling: the deep water stays navy), its hue between
//     today's and the brand's sampled noon lake (#183461, h −77°), 5° either side (v1's LUT turns a deep blue 10°
//     toward cyan; the water lands at −79°, on the brand's navy, not on v1's brighter blue). Read at the follow camera's pose of
//     that day (v1's orbit: ?campitch=20&camdist=3.5&camtilt=0): the owner's Boat view (8fc209dc, 2026-11-18: pitch 8°, 3.95
//     hull lengths, the 5.5° tilt) looks at that box at a grazing angle, where the water is mostly mirror (24, 65, 103 there);
//   ?look=v2 still draws the camera before it: noon cam E's clear sky reads the camera before's 48, 90, 151 within 10 levels
//     (a fixed camera, so the lock does not move with the Boat view), and the deep water differs from the default's.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/frameLook.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { measurePixels } from '../../../tools/cloud-colour-measure.mjs';
import { srgbToLab } from '../../render/grade.js';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
export const V1 = Object.freeze({ sky: [45, 137, 184], up30: [7, 114, 166] });
export const NAVY = Object.freeze([29, 39, 88]);
export const BEFORE = Object.freeze({ sky: [48, 90, 151] });   // ?look=v2, the camera before 2026-11-14, noon cam E
export const BRAND_NAVY = Object.freeze([0x18, 0x34, 0x61]);
const W = 1280, H = 720, TOL = 10;
export const V1_DECK = 0.6;   // v1's CLOUD_DECK coverage, the deck v1's samples (V1, BEFORE) were taken under
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const median = (png, [x0, y0, x1, y1]) => [0, 1, 2].map((c) => { const a = []; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a.push(png.data[4 * (y * W + x) + c]); a.sort((p, q) => p - q); return a[a.length >> 1]; });
try {
  const shot = async (q, calm = false) => {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    // v1's samples were taken under v1's deck (0.6); the default sky is clearer since 2026-11-19, so the
    // camera's match is checked under the deck it was fitted on (V1_DECK), not the page's default
    await page.goto(`${BASE}/?${q}&seed=1&hud=0&birds=0&headless=1&cloudcov=${V1_DECK}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
    const cam = await page.evaluate(async (calm) => { if (calm) { window.__velia.setWindFx?.({ tex: false, gust: false, lanes: false, caps: false }); window.__velia.gust?.setOn(false); } for (let i = 0; i < 40; i++) await window.__velia.renderOnce(); const c = window.__velia.camera; return { fwd: [...c.fwd], fov: c.fov }; }, calm);
    const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
    await page.close();
    check(!errors.length, `no page errors (${q}) ${errors.slice(0, 2).join(' | ')}`);
    return { png, cam };
  };
  const pair = async (q) => { const on = await shot(q), off = await shot(`${q}&clouds=0`); return measurePixels(on.png.data, off.png.data, on.cam, W, H); };
  const e = await pair('hour=13&cam=E');
  const up = await pair('hour=13&campos=1050,40,-820&camlook=4200,1500,-5200');
  for (const [name, m, v] of [['noon cam E sky beside the clouds', e.sky, V1.sky], ['the sky 30° up', up.up30, V1.up30]]) {
    const d = m ? m.map((x, i) => Math.abs(x - v[i])) : [999];
    check(Math.max(...d) <= TOL, `${name} ${m?.join(', ')} vs v1's ${v.join(', ')}: within ${TOL} (max ${Math.max(...d)})`);
  }
  const lab = (c) => { const [L, a, b] = srgbToLab(c.map((x) => x / 255)); return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) * 180 / Math.PI }; };
  const box = [60, 600, 200, 700];
  // the water's own colour, so the wind on the water is off (audit W1–W3: the Sail start's first gust line lies over this
  // box at 20 s and darkens it by design, v1's dark matte patch) and the follow camera does not lean (W4: the roll moves the box)
  // the follow camera's pose on 2026-11-14 (see the top), at v1's Sail start: the birthplaces (1e06d65b, 2026-11-18) moved the default
  // start, so the box looked at other water (5, 40, 77); the goldens pinned the same start then
  const POSE = 'hour=13&wind=3&settle=20&campitch=20&camdist=3.5&camtilt=0&start=1200,-1050&heading=251';
  const deep = median((await shot(POSE, true)).png, box), n = lab(deep), n0 = lab(NAVY), nb = lab(BRAND_NAVY);
  const hLo = Math.min(n0.h, nb.h) - 5, hHi = Math.max(n0.h, nb.h) + 5;
  check(Math.abs(n.L - n0.L) <= 3 && Math.abs(n.C - n0.C) <= 6 && n.h >= hLo && n.h <= hHi,
    `the deep water ${deep.join(', ')} stays navy: L* ${n.L.toFixed(1)} (${n0.L.toFixed(1)}), C ${n.C.toFixed(1)} (${n0.C.toFixed(1)}), h ${n.h.toFixed(0)}° in ${hLo.toFixed(0)}…${hHi.toFixed(0)}°`);
  const old = median((await shot(`${POSE}&look=v2`, true)).png, box);
  const ev2 = await pair('hour=13&cam=E&look=v2'), dv2 = ev2.sky ? ev2.sky.map((x, i) => Math.abs(x - BEFORE.sky[i])) : [999];
  check(Math.max(...dv2) <= TOL && old.some((x, i) => Math.abs(x - deep[i]) > 2),
    `?look=v2 draws the camera before: cam E's sky ${ev2.sky?.join(', ')} vs ${BEFORE.sky.join(', ')} within ${TOL} (max ${Math.max(...dv2)}); the deep water ${old.join(', ')}, not the default's ${deep.join(', ')}`);
} finally { await browser.close(); }
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log('all PASS');
