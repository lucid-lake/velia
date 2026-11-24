// v1's spume on the GPU (v2/render/spume.js): the WGSL lanes match the JS reference (MaterialX Perlin and v1's streakAt) at
// 512 points; on the live page at a pinned 17 m/s the spume shows on #56 M1's whitecaps (the frame
// with it differs from the frame without it, __velia.setSpume, in the open water left of the boat, and only brighter);
// at 8 m/s, under the 12 m/s onset even in a gust, the two frames are identical. The follow camera is pinned at its orbit
// before the owner's Boat view (?campitch=20&camdist=3.5&camtilt=0): the Boat view (8fc209dc, 2026-11-18: pitch 8°, the
// 5.5° tilt) sees this water at a grazing angle, where the streaks foreshorten (0.13-0.17 % of the crop move there, 0.29 %
// here); the check is the spume, not the camera.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/spume.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { SPUME_WGSL, laneAt } from '../../render/spume.js';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const W = 1280, H = 720;
const POSE = 'hour=16&winddir=200&start=2300,-1400&heading=330&settle=8&seed=1&hud=0&birds=0&headless=1&campitch=20&camdist=3.5&camtilt=0';
const CROP = [0.04, 0.45, 0.34, 0.95];   // open water left of the boat (tools/v2-spume.mjs)

// the parity points: around the start, several winds and headings, clocks
const PTS = Array.from({ length: 512 }, (_, i) => [2300 + ((i * 37) % 211) * 0.73 - 70, -1400 + ((i * 53) % 197) * 0.61 - 60, 12 + (i % 9), (i % 13) * 0.5, 40 + (i % 7) * 311.7]);

function cropDiff(a, b) {
  const x0 = Math.floor(CROP[0] * W), y0 = Math.floor(CROP[1] * H), x1 = Math.floor(CROP[2] * W), y1 = Math.floor(CROP[3] * H);
  let n = 0, darker = 0, max = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4, d = (a.data[i] + a.data[i + 1] + a.data[i + 2]) - (b.data[i] + b.data[i + 1] + b.data[i + 2]);
    if (d !== 0) n++; if (d < -6) darker++; max = Math.max(max, Math.abs(d));
  }
  return { pct: 100 * n / ((x1 - x0) * (y1 - y0)), darker, max };
}
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  // 1. the WGSL against the JS, on the GPU
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/?${POSE}&windspeed=17`, { waitUntil: 'load' });
    const got = await page.evaluate(async ([wgsl, pts]) => {
      const ad = await navigator.gpu.requestAdapter(), dev = await ad.requestDevice();
      const code = `struct Frame { viewProj: mat4x4f, cam: vec4f, res: vec4f, wind: vec4f, spume: vec4f }
@group(0) @binding(0) var<uniform> F: Frame;
const PI = 3.14159265359;
${wgsl}
@group(0) @binding(1) var<storage, read> P: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> O: array<f32>;
@group(0) @binding(3) var<storage, read> T: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= arrayLength(&O)) { return; }
  let p = P[i]; O[i] = spLane(p.xy, p.z, p.w, T[i]);
}`;
      const mod = dev.createShaderModule({ code });
      const info = await mod.getCompilationInfo();
      const errs = info.messages.filter((m) => m.type === 'error').map((m) => m.message);
      if (errs.length) return { errs };
      const n = pts.length;
      const P = new Float32Array(n * 4), Tm = new Float32Array(n);
      pts.forEach(([x, z, U, tr, t], i) => { P.set([x, z, U, tr], i * 4); Tm[i] = t; });
      const mk = (data, usage) => { const b = dev.createBuffer({ size: Math.max(16, data.byteLength), usage, mappedAtCreation: true }); new Float32Array(b.getMappedRange()).set(data); b.unmap(); return b; };
      const S = GPUBufferUsage.STORAGE;
      const bP = mk(P, S), bT = mk(Tm, S);
      const bO = dev.createBuffer({ size: n * 4, usage: S | GPUBufferUsage.COPY_SRC });
      const bR = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const pipe = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
      const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 1, resource: { buffer: bP } }, { binding: 2, resource: { buffer: bO } }, { binding: 3, resource: { buffer: bT } }] });
      const enc = dev.createCommandEncoder(); const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(n / 64)); pass.end();
      enc.copyBufferToBuffer(bO, 0, bR, 0, n * 4); dev.queue.submit([enc.finish()]);
      await bR.mapAsync(GPUMapMode.READ); const out = Array.from(new Float32Array(bR.getMappedRange())); bR.unmap();
      return { out };
    }, [SPUME_WGSL, PTS]);
    await page.close();
    if (got.errs) check(false, `the WGSL compiles (${got.errs.join(' | ')})`);
    else {
      let worst = 0, spread = 0;
      got.out.forEach((v, i) => { const [x, z, U, tr, t] = PTS[i]; const r = laneAt(x, z, U, tr, t); worst = Math.max(worst, Math.abs(v - r)); spread = Math.max(spread, Math.abs(r)); });
      check(worst < 2e-3 && spread > 0.5, `the GPU's lanes match the JS reference at ${PTS.length} points: worst ${worst.toExponential(2)} (values up to ${spread.toFixed(2)})`);
    }
  }
  // 2. the live page: on past the onset, nothing under it. A renderOnce steps the sim, so the frames with and without the
  // spume come from two pages that render the same steps (the capture is deterministic: goldens --twice at 0 px)
  const frameAt = async (U, on) => {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/?${POSE}&windspeed=${U}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
    const j0 = await page.evaluate(async (on) => { window.__velia.setSpume(on); for (let i = 0; i < 40; i++) await window.__velia.renderOnce(); return null; }, on);
    const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
    await page.close();
    return { png, j0, errors };
  };
  for (const [U, expectOn] of [[17, true], [8, false]]) {   // 8 m/s: under 12 even in a gust (≤ 1.25 ×; the spume reads the local wind)
    const a = await frameAt(U, true), b = await frameAt(U, false);
    check(!a.errors.length && !b.errors.length, `${U} m/s: no page errors (${[...a.errors, ...b.errors].slice(0, 2).join(' | ')})`);
    const d = cropDiff(a.png, b.png);
    if (expectOn) {
      check(d.pct > 0.2 && d.pct < 10 && d.darker === 0, `${U} m/s: the spume shows (${d.pct.toFixed(2)} % of the crop's pixels move, up to ${d.max} levels summed, none darker)`);
    } else {
      check(d.pct === 0, `${U} m/s: under the 12 m/s onset the frame is the same with the spume on and off (${d.pct.toFixed(3)} % differ)`);
    }
  }
} finally { await browser.close(); }
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log('all PASS');
