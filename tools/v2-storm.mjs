// v1 vs v2: the storm (BACKLOG-v2 #18, 2026-11-14: the storm water's navy, the deck's undersides, the shelf cloud, the
// rain's curtains). Each pose is rendered in both apps with the same URL rows (and once more with ?clouds=0, so the
// deck's mask can be found: tools/cloud-colour-measure.mjs); the samples are medians of fixed regions (sRGB 0–255).
//   node tools/v2-storm.mjs capture --tag before [--apps v1,v2] [--poses follow,…] [--v1 url] [--v2 url] [--extra "k=v"] [--onlyon]
//   node tools/v2-storm.mjs table --tags v1:base,v2:before,v2:after
//   node tools/v2-storm.mjs stacks --rows v1:base,v2:before,v2:after   (960-wide stacks)
// Your own ports only (never 5173 / 5174). Writes under renders/v2-storm/.
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { measure } from './cloud-colour-measure.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'renders/v2-storm');
const RAW = resolve(OUT, 'raw');
const [cmd, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]] : [])).filter((x) => x.length));
const W = 1280, H = 720;
const STORM = 'weather=storm&cloudcov=0.6';

// the poses (147 s into the arc: between two strikes, the hero bolt at 150.27 s flashes the frame); regions are
// [x0, y0, x1, y1] as fractions of the frame (water: open water clear of the boat; sky: the top band)
export const POSES = [
  { name: 'follow', q: `hour=18.25&wind=2&start=2300,-1400&heading=330&${STORM}&stormref=2300,-1400&stormt=147&settle=8`, sail: true,
    water: [[0.02, 0.62, 0.22, 0.80], [0.80, 0.62, 0.98, 0.80]], sky: [0.05, 0.02, 0.95, 0.12], about: 'the storm golden pose, the follow camera' },
  { name: 'camE', q: `hour=18.25&cam=E&wind=2&${STORM}&stormref=1050,-820&stormt=147`,
    water: [[0.05, 0.70, 0.95, 0.95]], sky: [0.05, 0.02, 0.95, 0.12], about: 'cam E out of the mouth toward the open lake, the cell over the camera' },
  { name: 'dusk', q: `hour=20&wind=2&start=2300,-1400&heading=330&${STORM}&stormref=2300,-1400&stormt=147&settle=8`, sail: true,
    water: [[0.02, 0.62, 0.22, 0.80], [0.80, 0.62, 0.98, 0.80]], sky: [0.05, 0.02, 0.95, 0.12], about: 'a storm at dusk (20:00, the sun 4° up)' },
  // cam L (a boat's eye out of the mouth, looking north over the open lake) with the cell 6 km out along its look (the
  // ref placed so the cell's centre is there at 150 s): the shelf cloud and the rain's curtains under the core
  { name: 'cellL', q: `hour=17&cam=L&wind=2&${STORM}&stormref=3336,-8090&stormt=147`,
    water: [[0.05, 0.80, 0.95, 0.97]], sky: [0.05, 0.02, 0.95, 0.12], about: 'cam L, the cell 6 km out over the open lake: the anvil overhead, the curtains under the core' },
];
const poseList = () => (args.poses ? POSES.filter((p) => String(args.poses).split(',').includes(p.name)) : POSES);
const urlFor = (app, base, p, off) => `${base}/?${p.sail && app === 'v1' ? 'mode=sail&' : ''}${p.q}&seed=1&hud=0&birds=0${off ? '&clouds=0' : ''}${args.extra ? `&${args.extra}` : ''}&headless=1`;

async function capture() {
  const tag = args.tag ?? 'base', apps = String(args.apps ?? 'v1,v2').split(',');
  const bases = { v1: args.v1 ?? 'http://127.0.0.1:5491', v2: args.v2 ?? 'http://127.0.0.1:5492' };
  const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  mkdirSync(RAW, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
  try {
    for (const p of poseList()) for (const app of apps) for (const off of (args.onlyon ? [false] : [false, true])) {
      const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message ?? e).split('\n')[0]));
      await page.goto(urlFor(app, bases[app], p, off), { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction(() => (window.__lakeshore ?? window.__velia)?.renderOnce, null, { timeout: 240000 });
      const cam = await page.evaluate(async () => {
        const Hk = window.__lakeshore ?? window.__velia;
        for (let i = 0; i < 40; i++) await Hk.renderOnce();
        const c = Hk.camera;
        if (c.matrixWorld) { const m = c.matrixWorld.elements; return { fwd: [-m[8], -m[9], -m[10]], up: [m[4], m[5], m[6]], fov: c.fov }; }
        return { fwd: [...c.fwd], up: [0, 1, 0], fov: c.fov };
      });
      const file = resolve(RAW, `${p.name}-${app}-${tag}-${off ? 'off' : 'on'}`);
      await page.screenshot({ path: `${file}.png` });
      writeFileSync(`${file}.json`, JSON.stringify({ url: urlFor(app, bases[app], p, off), cam, errors }));
      console.error(`${p.name} ${app} ${tag} ${off ? 'off' : 'on'}${errors.length ? ` ERRORS: ${errors[0]}` : ''}`);
      await page.close();
    }
  } finally { await browser.close(); }
}

// the median sRGB of a list of regions
export function regionMedian(png, rects) {
  const ch = [[], [], []];
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = Math.floor(y0 * png.height); y < Math.floor(y1 * png.height); y++) for (let x = Math.floor(x0 * png.width); x < Math.floor(x1 * png.width); x++) {
      const i = (y * png.width + x) * 4; ch[0].push(png.data[i]); ch[1].push(png.data[i + 1]); ch[2].push(png.data[i + 2]);
    }
  }
  return ch.map((a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; });
}

// #18 r2: the rain's streaks in a fixed crop (open water left of the boat: x 4–34 %, y 45–95 %): each pixel's luminance
// over its 15 × 15 box mean; a streak pixel stands > 8 levels above it; streaks are 4-connected runs of ≥ 4 such pixels.
// → { px: streak pixels (% of the crop), n: streaks, hist: the streak pixels' excess in 8–16, 16–32, 32–64, 64–128, 128+
// (% of the crop), peak: their 99th-percentile luminance }
export const STREAK_CROP = [0.04, 0.45, 0.34, 0.95];
export function streaks(png, [x0f, y0f, x1f, y1f] = STREAK_CROP) {
  const x0 = Math.floor(x0f * png.width), y0 = Math.floor(y0f * png.height), w = Math.floor(x1f * png.width) - x0, h = Math.floor(y1f * png.height) - y0;
  const L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y + y0) * png.width + x + x0) * 4; L[y * w + x] = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]; }
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) I[(y + 1) * (w + 1) + x + 1] = L[y * w + x] + I[y * (w + 1) + x + 1] + I[(y + 1) * (w + 1) + x] - I[y * (w + 1) + x];
  const R = 7, mask = new Uint8Array(w * h), ex = new Float32Array(w * h), hist = [0, 0, 0, 0, 0], lum = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = Math.max(0, x - R), b = Math.max(0, y - R), c = Math.min(w, x + R + 1), d = Math.min(h, y + R + 1);
    const m = (I[d * (w + 1) + c] - I[b * (w + 1) + c] - I[d * (w + 1) + a] + I[b * (w + 1) + a]) / ((c - a) * (d - b));
    const e = L[y * w + x] - m; ex[y * w + x] = e; if (e > 8) mask[y * w + x] = 1;
  }
  const seen = new Uint8Array(w * h); let n = 0, px = 0; const stack = [];
  for (let k = 0; k < w * h; k++) {
    if (!mask[k] || seen[k]) continue;
    const comp = []; stack.push(k); seen[k] = 1;
    while (stack.length) { const q = stack.pop(); comp.push(q); const qx = q % w, qy = (q / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); } } }
    if (comp.length < 4) continue;
    n++; px += comp.length;
    for (const q of comp) { const e = ex[q]; hist[e < 16 ? 0 : e < 32 ? 1 : e < 64 ? 2 : e < 128 ? 3 : 4]++; lum.push(L[q]); }
  }
  lum.sort((p, q) => p - q);
  const pct = (v) => +(100 * v / (w * h)).toFixed(2);
  return { px: pct(px), n, hist: hist.map(pct), peak: lum.length ? Math.round(lum[Math.floor(lum.length * 0.99)]) : 0 };
}

function samples(p, app, tag) {
  const f = resolve(RAW, `${p.name}-${app}-${tag}`);
  if (!existsSync(`${f}-on.png`)) return null;
  const on = PNG.sync.read(readFileSync(`${f}-on.png`));
  const offF = [`${f}-off.png`, resolve(RAW, `${p.name}-${app}-${app === 'v1' ? 'base' : 'before'}-off.png`)].find(existsSync);
  const m = offF ? measure(`${f}-on.png`, offF, `${f}-on.json`) : null;
  return { water: regionMedian(on, p.water), under: m?.under ?? null, sky: regionMedian(on, [p.sky]), streaks: streaks(on) };
}

function table() {
  const tags = String(args.tags ?? 'v1:base,v2:before').split(',').map((t) => t.split(':'));
  const lines = [`| pose | region | ${tags.map(([a, t]) => (a === 'v1' ? 'v1' : `v2 ${t}`)).join(' | ')} |`, `|---|---|${tags.map(() => '---').join('|')}|`];
  const rows = {};
  for (const p of poseList()) {
    const m = tags.map(([a, t]) => samples(p, a, t));
    rows[p.name] = Object.fromEntries(tags.map(([a, t], i) => [`${a}:${t}`, m[i]]));
    for (const r of ['water', 'under', 'sky']) lines.push(`| ${p.name} | ${r === 'under' ? 'cloud undersides' : r} | ${m.map((x) => (x && x[r] ? x[r].join(', ') : '–')).join(' | ')} |`);
    lines.push(`| ${p.name} | streaks: count / % px / peak | ${m.map((x) => (x ? `${x.streaks.n} / ${x.streaks.px} / ${x.streaks.peak}` : '–')).join(' | ')} |`);
    lines.push(`| ${p.name} | streak excess 8–16 / 16–32 / 32–64 / 64–128 / 128+ (% px) | ${m.map((x) => (x ? x.streaks.hist.join(' / ') : '–')).join(' | ')} |`);
  }
  console.log(lines.join('\n'));
  if (args.json) writeFileSync(resolve(ROOT, args.json), JSON.stringify(rows, null, 1));
}

function stacks() {
  const rows = String(args.rows ?? 'v1:base,v2:before,v2:after').split(',').map((t) => t.split(':'));
  const made = [];
  for (const p of poseList()) {
    const files = rows.map(([a, t]) => resolve(RAW, `${p.name}-${a}-${t}-on.png`));
    if (!files.every(existsSync)) continue;
    const out = resolve(OUT, `${p.name}${args.suffix ?? (rows.at(-1)[1] === 'r2' ? '-r2' : '')}.png`);   // r2: <pose>-r2.png
    const labels = rows.map(([a, t]) => (a === 'v1' ? 'v1' : `v2 ${t}`));
    const parts = files.flatMap((f, i) => ['(', f, '-resize', '960x', '-gravity', 'NorthWest', '-font', process.env.LABEL_FONT ?? '/System/Library/Fonts/Supplemental/Arial.ttf', '-fill', 'white', '-undercolor', '#0008', '-pointsize', '22', '-annotate', '+8+6', `${labels[i]} · ${p.name}`, ')']);
    execFileSync('magick', [...parts, '-append', out]);
    made.push(out);
  }
  console.log(made.join('\n'));
}

const MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);   // imported by the lock test: no CLI
if (MAIN && cmd === 'capture') await capture();
else if (MAIN && cmd === 'table') table();
else if (MAIN && cmd === 'stacks') stacks();
else if (MAIN) console.log('node tools/v2-storm.mjs capture|table|stacks …');
