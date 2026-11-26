// The launch gate: the WebGPU check before the engine loads, the motion note's once-per-visitor rule, the helm
// camera's steady horizon and Reduce Motion (how much less the camera rolls and heaves) and v1's classic build under
// /classic/ (the asset paths prefixed, nothing else). No browser: the page half is v2/tests/pages/launchGate.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budget } from '../../tests/helpers/budget.mjs';
import { checkGpu, gateKind, GATE_TIMEOUT_MS } from '../engine/gpuCheck.js';
import { GATE_TEXT, CLASSIC_URL } from '../engine/device.js';
import { CALM, HORIZON, HORIZON_REDUCED, calmPose, reducedNow } from '../sim/steadyCamera.js';
import { SEA_TEXT } from '../ui/seaText.js';
import { V2_ROWS } from '../engine/flags.js';
import { readFileSync, readdirSync } from 'node:fs';
import { createViews } from '../ui/views.js';
import { FollowCamera } from '../../src/sim/boat/followCamera.js';
import { cameras as sloopCameras } from '../../src/sim/craft/sloop/cameras.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';
import { prefixAssetUrls, CLASSIC_DIRS } from '../../tools/build/base-path.mjs';


// --- the WebGPU check ------------------------------------------------------------------------------------------------------
test('gate: no navigator.gpu → the page (no-api), without asking for an adapter', async () => {
  const r = await checkGpu({ nav: {} });
  assert.equal(r.ok, false); assert.equal(r.kind, 'no-api'); assert.match(r.why, /navigator\.gpu is missing/);
  assert.equal(gateKind(r.kind), 'nogpu');
  assert.equal((await checkGpu({ nav: { gpu: {} } })).kind, 'no-api', 'a gpu object without requestAdapter is no API');
});

test('gate: a null adapter → the page (no-adapter); a throw → the page (error)', async () => {
  assert.deepEqual(await checkGpu({ nav: { gpu: { requestAdapter: async () => null } } }), { ok: false, kind: 'no-adapter', adapter: null, why: 'requestAdapter returned null (no usable GPU)' });
  const t = await checkGpu({ nav: { gpu: { requestAdapter: async () => { throw new Error('blocklisted'); } } } });
  assert.equal(t.kind, 'error'); assert.match(t.why, /blocklisted/);
  const s = await checkGpu({ nav: { gpu: { requestAdapter: () => { throw new Error('sync'); } } } });
  assert.equal(s.kind, 'error', 'a synchronous throw is caught too');
});

test('gate: an adapter that never answers stops at the timeout (no blank page)', async () => {
  const t0 = Date.now();
  const r = await checkGpu({ nav: { gpu: { requestAdapter: () => new Promise(() => {}) } }, timeoutMs: 60 });
  assert.equal(r.kind, 'timeout'); budget(Date.now() - t0, 1000, 'stopped near the timeout (60 ms asked)');
  assert.ok(GATE_TIMEOUT_MS >= 2000 && GATE_TIMEOUT_MS <= 8000, `the page's timeout ${GATE_TIMEOUT_MS} ms`);
});

test('gate: an adapter passes it on, asked with the device\'s own options', async () => {
  const adapter = { features: new Set() }; let opts = null;
  const r = await checkGpu({ nav: { gpu: { requestAdapter: async (o) => { opts = o; return adapter; } } } });
  assert.equal(r.ok, true); assert.equal(r.adapter, adapter); assert.deepEqual(opts, { powerPreference: 'high-performance' });
});

test('gate page: both texts are short and calm; the link is the classic page; a lost device is the failed text', () => {
  assert.equal(CLASSIC_URL, '/classic/');
  for (const k of ['nogpu', 'failed']) { assert.ok(GATE_TEXT[k].head.length <= 40, k); assert.ok(GATE_TEXT[k].msg.length <= 120, k); }
  assert.match(GATE_TEXT.failed.msg, /could not start/);
  assert.equal(gateKind('lost'), 'failed'); assert.equal(gateKind('failed'), 'failed'); assert.equal(gateKind('timeout'), 'nogpu');
});

// --- the sea-sickness watermark --------------------------------------------------------------------------------------------
test('watermark: one short calm line on the loading screen, at the first paint (static in index.html), with nothing to dismiss', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = /<p id="lk-sea"[^>]*>([^<]+)<\/p>/.exec(html);
  assert.ok(m, 'the line is in the page itself, outside the shell markers (no module needed to show it)');
  assert.equal(m[1].replace('&#8209;', '\u2011'), SEA_TEXT, 'the page and setupCalm.js say the same words');
  assert.ok(html.indexOf('id="lk-sea"') > html.indexOf('lk-load:body:end'), 'after the loading shell: v1\'s shell is untouched');
  assert.match(SEA_TEXT, /real boat/);  assert.ok(SEA_TEXT.length <= 110);
  assert.doesNotMatch(html, /<button[^>]*>[^<]*<\/button>\s*<\/p>\s*<!-- lk-sea/, 'no button');
});

// --- Reduce Motion and the steady horizon in the Helm view: no setting, no stored choice, no flag (owner 2026-11-19, 2026-11-25) ----
// a boat rolling ±12° at 0.18 Hz and pitching ±4° at 0.45 Hz, heaving ±0.5 m at 0.4 Hz (a 21 kn afternoon's beam sea);
// `s` scales the sea (a calm lake: 0.1)
const DEG = Math.PI / 180;
const boatAt = (t, s = 1) => ({ x: 0, z: 0, heading: 0, heel: s * 12 * DEG * Math.sin(2 * Math.PI * 0.18 * t), pitch: s * 4 * DEG * Math.sin(2 * Math.PI * 0.45 * t + 1), heave: s * 0.5 * Math.sin(2 * Math.PI * 0.4 * t), surf: t % 7 < 2 ? 1 : 0, sog: 3 });
// the camera's roll: the angle of its up vector about its forward axis, against the world's up
function rollOf(pose) {
  const f = pose.target.map((v, i) => v - pose.pos[i]), n = Math.hypot(...f), fw = f.map((v) => v / n);
  const u = pose.up ?? [0, 1, 0];
  // the world's up made square to forward (the level horizon's up), and the camera's up: the angle between them
  const wu = [0, 1, 0], d = wu[1] * fw[1], lv = wu.map((v, i) => v - d * fw[i]), ln = Math.hypot(...lv), L = lv.map((v) => v / ln);
  const du = u[0] * fw[0] + u[1] * fw[1] + u[2] * fw[2], cu = u.map((v, i) => v - du * fw[i]), cn = Math.hypot(...cu), C = cu.map((v) => v / cn);
  return Math.acos(Math.min(1, Math.max(-1, L[0] * C[0] + L[1] * C[1] + L[2] * C[2])));
}
const pitchOf = (pose) => { const f = pose.target.map((v, i) => v - pose.pos[i]); return Math.atan2(f[1], Math.hypot(f[0], f[2])); };
// the Helm view over `seconds` of a sea of scale `s`; `reduced`: the OS's switch (a function: it may change mid-run); measured after `from` s
function runHelm({ s = 1, reduced = false, seconds = 60, from = 30, dt = 1 / 60 } = {}) {
  const rd = typeof reduced === 'function' ? reduced : () => reduced;
  let t = 0;
  const V = createViews({ vessel: CURRENT_VESSEL, view: 'helm', reduced: () => rd(t) });
  let maxRoll = 0, minP = Infinity, maxP = -Infinity, minY = Infinity, maxY = -Infinity, jump = 0, prev = null;
  for (; t < seconds; t += dt) {
    const p = V.pose(dt, { pos: [0, 10, 30], target: [0, 0, 0], fov: 40 }, boatAt(t, s));
    const r = rollOf(p), pi = pitchOf(p);
    if (prev) jump = Math.max(jump, Math.abs(r - prev.r), Math.abs(pi - prev.p));
    prev = { r, p: pi };
    if (t < from) continue;
    maxRoll = Math.max(maxRoll, r); minP = Math.min(minP, pi); maxP = Math.max(maxP, pi);
    minY = Math.min(minY, p.pos[1]); maxY = Math.max(maxY, p.pos[1]);
  }
  return { V, roll: maxRoll / DEG, pitchSwing: (maxP - minP) / DEG, heaveSwing: maxY - minY, jump: jump / DEG };
}

test('the steady horizon: the Helm view keeps a small, slow share of the hull\'s heel and pitch; the eye\'s bob is taken out to a cap', () => {
  assert.ok(HORIZON.pitch <= 0.25 && HORIZON.roll <= 0.25 && HORIZON.tau >= 2 && HORIZON.tau <= 3, 'at most a quarter of the pitch and heel, low-passed over 2–3 s');
  const rough = runHelm({ s: 1 });
  // the old camera (v1's helm camera with 40–70 % cancelled, 0.1–0.35 s) rolled 3.6–7° and swung its pitch 3–5° on this sea
  assert.ok(rough.roll < 1.2, `roll ${rough.roll.toFixed(2)}° on a ±12° roll`);
  assert.ok(rough.pitchSwing < 1, `pitch swing ${rough.pitchSwing.toFixed(2)}° on a ±4° pitch`);
  assert.ok(rough.jump < 0.05, `no pop: ${rough.jump.toFixed(4)}° a frame at most`);
  console.log(`# helm view, 12° / 4° / 0.5 m sea: roll ${rough.roll.toFixed(2)}°, pitch swing ${rough.pitchSwing.toFixed(2)}°, eye heave ${rough.heaveSwing.toFixed(2)} m`);
});

test('the steady horizon: always on, no switch: the view has no setter; a steady heel tilts the view by its share only', () => {
  const V = createViews({ vessel: CURRENT_VESSEL, view: 'helm', reduced: () => false });
  assert.equal(V.setSteady, undefined, 'no steady-horizon switch');
  assert.equal(V.helmCam.horizon, HORIZON);
  let p = null; for (let t = 0; t < 20; t += 1 / 60) p = V.pose(1 / 60, { pos: [0, 10, 30], target: [0, 0, 0], fov: 40 }, { x: 0, z: 0, heading: 0, heel: 20 * DEG, pitch: 0, heave: 0 });
  assert.ok(Math.abs(rollOf(p) / DEG - 20 * HORIZON.roll) < 0.05, `a steady 20° heel: the view rolls ${(rollOf(p) / DEG).toFixed(2)}°`);
});

test('reduce motion: the Helm view holds HORIZON_REDUCED, steadier still, from the first frame; a live switch eases, never pops', () => {
  const V = createViews({ vessel: CURRENT_VESSEL, view: 'helm', reduced: () => true });
  V.pose(1 / 60, { pos: [0, 10, 30], target: [0, 0, 0], fov: 40 }, boatAt(0)); assert.equal(V.helmCam.horizon, HORIZON_REDUCED, 'Reduce Motion from the first frame');
  const off = runHelm({ s: 1, reduced: false }), on = runHelm({ s: 1, reduced: true });
  assert.ok(on.roll < off.roll && on.pitchSwing < off.pitchSwing && on.heaveSwing < off.heaveSwing, `steadier: roll ${off.roll.toFixed(2)}° → ${on.roll.toFixed(2)}°, pitch ${off.pitchSwing.toFixed(2)}° → ${on.pitchSwing.toFixed(2)}°, heave ${off.heaveSwing.toFixed(2)} → ${on.heaveSwing.toFixed(2)} m`);
  const sw = runHelm({ s: 1, reduced: (t) => t > 20 });
  assert.ok(sw.jump < 0.05, `switched at 20 s: ${sw.jump.toFixed(4)}° a frame at most`);
  console.log(`# helm view, 12° / 4° / 0.5 m sea: roll ${off.roll.toFixed(2)}° → reduce motion ${on.roll.toFixed(2)}°`);
});

test('reduce motion: the pose the Boat view sees keeps 35 % of the heave and no surf; the boat\'s own pose is untouched; reducedNow reads the OS live', () => {
  const p = boatAt(1.3);
  const q = calmPose(p, true);
  assert.ok(Math.abs(q.heave - p.heave * CALM.heave) < 1e-12); assert.equal(q.surf, 0); assert.equal(q.heel, p.heel, 'the roll is the helm view\'s steadying, not the pose');
  assert.equal(calmPose(p, false), p, 'off: the same object');
  const before = globalThis.matchMedia;
  try {
    let on = false; globalThis.matchMedia = (query) => ({ get matches() { return /reduce/.test(query) && on; } });
    assert.equal(reducedNow(), false); on = true; assert.equal(reducedNow(), true, 'live: no reload'); on = false; assert.equal(reducedNow(), false);
    delete globalThis.matchMedia; assert.equal(reducedNow(), false, 'no matchMedia: off');
    globalThis.matchMedia = () => { throw new Error('blocked'); }; assert.equal(reducedNow(), false);
  } finally { if (before) globalThis.matchMedia = before; else delete globalThis.matchMedia; }
});

test('the Boat view never rolls (v1\'s rule); the steady horizon leaves it alone and Reduce Motion gives it less heave and no surf breath', () => {
  const run = (calm) => {
    const F = new FollowCamera({ hull: sloopCameras(CURRENT_VESSEL).follow.hull });
    let minY = Infinity, maxY = -Infinity, minF = Infinity, maxF = -Infinity, roll = 0;
    for (let t = 0; t < 40; t += 1 / 60) {
      const p = F.update(1 / 60, calmPose(boatAt(t), calm));
      if (t < 5) continue;
      minY = Math.min(minY, p.pos[1]); maxY = Math.max(maxY, p.pos[1]); minF = Math.min(minF, p.fov); maxF = Math.max(maxF, p.fov); roll = Math.max(roll, rollOf(p));
    }
    return { heave: maxY - minY, fov: maxF - minF, roll: roll / DEG };
  };
  const off = run(false), on = run(true);
  assert.ok(off.roll < 1e-6 && on.roll < 1e-6, 'no roll either way');
  assert.ok(on.heave / off.heave < 0.45, `camera heave ${off.heave.toFixed(3)} → ${on.heave.toFixed(3)} m`);
  assert.ok(on.fov < off.fov * 0.2, `surf breath ${off.fov.toFixed(2)}° → ${on.fov.toFixed(2)}° of FOV swing`);
  console.log(`# boat view: camera heave ${off.heave.toFixed(3)} → ${on.heave.toFixed(3)} m, FOV swing ${off.fov.toFixed(2)}° → ${on.fov.toFixed(2)}°`);
});

test('no Calm camera setting: the front door and Setup name none, no ?calm flag (Reduce Motion is the one signal, sim/steadyCamera.js reducedNow)', () => {
  const root = new URL('..', import.meta.url).pathname;
  assert.doesNotMatch(readFileSync(`${root}index.html`, 'utf8'), /Calm camera/i, 'the front door\'s note names no setting');
  assert.doesNotMatch(SEA_TEXT, /Setup|Calm camera/i);
  assert.equal(V2_ROWS.some((r) => r.name === 'calm' || r[0] === 'calm'), false, 'no ?calm flag');
});

// --- the classic build's base path -------------------------------------------------------------------------------------------
test('classic: v1\'s absolute asset URLs get the /classic prefix in JS, CSS and HTML; nothing else moves', () => {
  const js = `fetch('/models/boat/hull.glb');const a="/audio/boat/";const b=\`/audio/music/\${n}.opus\`;fetch('/api/e');const r=/^\\/models\\//;x('/terrain/forest/treetops.tps')`;
  const out = prefixAssetUrls(js, '/classic/');
  assert.match(out, /'\/classic\/models\/boat\/hull\.glb'/); assert.match(out, /"\/classic\/audio\/boat\/"/); assert.match(out, /`\/classic\/audio\/music\//);
  assert.match(out, /'\/classic\/terrain\/forest\//); assert.match(out, /'\/api\/e'/, 'the metrics endpoint stays at the origin');
  assert.match(out, /\/\^\\\/models\\\/\//, 'a regex literal is not a URL');
  assert.equal(prefixAssetUrls('r(`/${dir}/${name}`)', '/classic/'), 'r(`/classic/${dir}/${name}`)', 'v1\'s terrain loader builds its path from the folder\'s name');
  const css = `src:url(/fonts/jost-latin.woff2) format('woff2');background:url("/brand/dash/a.webp")`;
  assert.equal(prefixAssetUrls(css, '/classic/'), `src:url(/classic/fonts/jost-latin.woff2) format('woff2');background:url("/classic/brand/dash/a.webp")`);
  const html = `<link rel="icon" href="/brand/favicon.svg"><img srcset="/brand/stills/a-960.webp 960w, /brand/stills/a-1280.webp 1280w">`;
  assert.equal(prefixAssetUrls(html, '/classic/'), `<link rel="icon" href="/classic/brand/favicon.svg"><img srcset="/classic/brand/stills/a-960.webp 960w, /classic/brand/stills/a-1280.webp 1280w">`);
  assert.equal(prefixAssetUrls(js, '/'), js, 'the root base changes nothing');
  assert.equal(prefixAssetUrls(prefixAssetUrls(css, '/classic/'), '/classic/'), prefixAssetUrls(css, '/classic/'), 'idempotent');
  assert.deepEqual([...CLASSIC_DIRS].sort(), ['audio', 'basis', 'brand', 'data', 'fonts', 'models', 'reel', 'terrain']);
});

// --- the play counts: v1's events and labels on v2 -----------------------------------------------------------------------
test('metrics: v2 maps its facts to v1\'s session_start labels (the server\'s enums), plus how the page was opened (display)', async () => {
  const { sessionProps, tierOf, deviceOf, guessDevice, displayOf } = await import('../ui/metrics.js');
  const { EVENTS } = await import('../../src/metrics.js');
  const p = sessionProps({ mode: 'sail', signals: { phone: true, vendor: 'apple' }, level: 2, firstVisit: true, lang: 'en', display: 'standalone' });
  assert.deepEqual(Object.keys(p).sort(), [...EVENTS.session_start].sort(), 'exactly the event\'s fields');
  assert.deepEqual(p, { mode: 'sail', device: 'phone', backend: 'webgpu', tier: 'low', first_visit: true, lang: 'en', gpu: 'apple', display: 'standalone' });
  assert.equal(sessionProps({}).display, 'browser');
  const win = (q, standalone) => ({ matchMedia: (s) => ({ matches: s === q }), navigator: { standalone } });
  assert.equal(displayOf({ win: win('(display-mode: fullscreen)') }), 'fullscreen');
  assert.equal(displayOf({ win: win('(display-mode: standalone)') }), 'standalone');
  assert.equal(displayOf({ win: win('', true) }), 'standalone', 'iOS navigator.standalone');
  assert.equal(displayOf({ win: win('', false) }), 'browser');
  assert.deepEqual([0, 1, 2, 3, null].map(tierOf), ['high', 'balanced', 'low', 'low', 'auto']);
  assert.equal(deviceOf({ tablet: true }), 'tablet'); assert.equal(deviceOf({}), 'desktop');
  assert.equal(guessDevice({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari' }), 'phone');
  assert.equal(guessDevice({ ua: 'Mozilla/5.0 (Macintosh)', touch: 5 }), 'tablet');
  assert.equal(guessDevice({ ua: 'Mozilla/5.0 (Windows NT 10.0)' }), 'desktop');
  for (const n of ['session_start', 'mode_change', 'gpu_lost', 'load_fail', 'regatta_finish', 'set_sail', 'session_end', 'js_error']) assert.ok(n in EVENTS, n);
});
