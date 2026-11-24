// The cockpit on a phone (feat/cockpit-phone, stage 3; owner 2026-11-06: phones, landscape-first, never a blocking rotate screen).
// The layout picks (a desktop and a phone sideways get the 3D cockpit; an upright phone keeps its compact helm; a tablet its grid),
// the phone's lens (the hub and the cap on their shares, the instruments inside the frame), the hit cells spread to a finger, the
// left thumb's drag-anywhere steer, the one-time "turn your phone" line, and Android's landscape lock on entering full screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helmLayout, cockpitKind, spreadCells, overlaps } from '../classic/src/stations/sloop/helmStation.js';
import { cockpitView, cockpitConsts, COCKPIT, COCKPIT_PHONE } from '../classic/src/stations/sloop/cockpit3d.js';
import { SteerSlide, HELM_IN } from '../src/stations/sloop/helmInput.js';
import { turnLineDue, createTurnLine, TURN_KEY, TURN } from '../classic/src/ui/turnPhone.js';
import { createFullscreen, landscapeLock } from '../src/ui/fullscreen.js';
import { NOTES } from '../src/ui/skipper.js';
import { FOLLOW } from '../src/sim/boat/followCamera.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('the layout picks: a desktop and a phone sideways get the cockpit; an upright phone, a tablet do not', () => {
  const cases = [
    [{ w: 1920, h: 1080 }, 'desktop', true], [{ w: 1280, h: 720 }, 'desktop', true],
    [{ w: 844, h: 390, coarse: true }, 'phone-land', true], [{ w: 932, h: 430, coarse: true }, 'phone-land', true], [{ w: 667, h: 375, coarse: true }, 'phone-land', true],
    [{ w: 390, h: 844, coarse: true }, 'phone-port', false], [{ w: 430, h: 932, coarse: true }, 'phone-port', false],
    [{ w: 1180, h: 820, coarse: true }, 'tablet', false], [{ w: 820, h: 1180, coarse: true }, 'tablet', false],
  ];
  for (const [v, kind, ck] of cases) {
    const L = helmLayout(v);
    assert.equal(L.kind, kind, `${v.w}x${v.h}`);
    assert.equal(cockpitKind(L.kind), ck, `${v.w}x${v.h}: cockpit ${ck}`);
  }
  // the upright phone keeps today's compact helm: the wheel, the two winches and the keys
  const P = helmLayout({ w: 390, h: 844, coarse: true });
  assert.equal(P.form, 'keys');
  for (const k of ['wheel', 'jib', 'main', 'panel', 'thr']) assert.ok(P[k]?.w >= 44, k);
});

test('the phone lens: the hub and the cap on the phone\'s shares, the wheel big enough to read, the instruments inside the frame', () => {
  const C = cockpitConsts(true);
  assert.equal(C.hfov, COCKPIT_PHONE.hfov); assert.equal(C.hub.y, COCKPIT.hub.y, 'the same object: only the lens and shares');
  assert.equal(cockpitConsts(false), COCKPIT, 'a desktop: unchanged');
  for (const [w, h] of [[844, 390], [932, 430], [667, 375], [896, 414]]) {
    const v = cockpitView({ w, h, phone: true });
    assert.ok(Math.abs(v.hubY - C.hub.at * h) < 0.5 && Math.abs(v.capY - C.cap.at * h) < 0.5, `${w}x${h}: shares`);
    assert.ok(v.wheelPx > 0.32 * h, `${w}x${h}: wheel ${v.wheelPx.toFixed(0)} px`);
    // the instruments (x ±2.8 m at the facet, z ≈ −1): their faces (R 0.27 m) inside the screen
    const r = v.f * COCKPIT.inst.R / (COCKPIT.camZ + 1);
    for (const sx of [-1, 1]) { const x = v.x(sx * COCKPIT.x.inst, -1); assert.ok(x - r > 8 && x + r < w - 8, `${w}x${h}: instrument at ${x.toFixed(0)} ± ${r.toFixed(0)}`); }
    assert.ok(v.capY < h - 50, `${w}x${h}: the face stands ${(h - v.capY).toFixed(0)} px tall`);
  }
  // the desktop's own solve is untouched
  const d = cockpitView({ w: 1920, h: 1080 });
  assert.ok(Math.abs(d.hubY - COCKPIT.hub.at * 1080) < 0.5 && Math.abs(d.capY - COCKPIT.cap.at * 1080) < 0.5);
  assert.ok(FOLLOW.leadPhoneCockpit < FOLLOW.lead, 'the boat stands higher over the phone\'s cockpit');
});

test('the hit cells spread to a finger: none overlaps, each keeps its size and stays near its part', () => {
  const cells = { sails: { x: 575, y: 337, w: 44, h: 44 }, anchor: { x: 617, y: 339, w: 44, h: 44 }, reef: { x: 653, y: 343, w: 44, h: 44 }, engine: { x: 517, y: 333, w: 44, h: 44 },
    thr: { x: 502, y: 310, w: 44, h: 60 }, tack: { x: 287, y: 295, w: 48, h: 48 } };
  const s = spreadCells(cells), ids = Object.keys(cells);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.ok(!overlaps(s[ids[i]], s[ids[j]], -0.5), `${ids[i]} × ${ids[j]}`);
  for (const k of ids) {
    assert.equal(s[k].w, cells[k].w); assert.equal(s[k].h, cells[k].h); assert.equal(s[k].y, cells[k].y);
    assert.ok(Math.abs(s[k].x - cells[k].x) < 24, `${k} moved ${s[k].x - cells[k].x} px`);
  }
  assert.deepEqual(s.tack, cells.tack, 'a cell clear of the rest stays put');
  // the check can fail: the input overlaps
  assert.ok(overlaps(cells.sails, cells.anchor));
});

test('the drag-anywhere steer: a sideways slide turns the wheel as the top of its rim, from where it was; held; clamped', () => {
  const s = new SteerSlide(), lim = HELM_IN.rudderMax * HELM_IN.wheelPerRudder;
  s.press(100, { r: 75, wheel: 0 });
  assert.equal(s.command, 0); assert.ok(s.held);
  assert.ok(s.move(130) > 0, 'right: starboard');
  assert.ok(Math.abs(s.command - (30 / 75) / lim) < 1e-9);
  assert.ok(s.move(60) < 0, 'left of the press: port');
  assert.equal(s.move(100 + 75 * lim * 3), 1, 'clamped at full lock');
  s.release(); assert.equal(s.move(500), null); assert.ok(!s.held);
  // from the wheel's own angle at the press (no jump)
  s.press(10, { r: 75, wheel: 0.5 }); assert.ok(Math.abs(s.command - 0.5 / lim) < 1e-9);
});

test('the turn line: due only upright and sailing, said once, remembered, never repeated', () => {
  assert.equal(turnLineDue({ kind: 'phone-port', sailing: true }), true);
  for (const o of [{ kind: 'phone-land', sailing: true }, { kind: 'desktop', sailing: true }, { kind: 'tablet', sailing: true }, { kind: 'phone-port', sailing: false },
    { kind: 'phone-port', sailing: true, seen: true }, { kind: 'phone-port', sailing: true, able: false }]) assert.equal(turnLineDue(o), false, JSON.stringify(o));
  assert.equal(NOTES.turnPhone.text, 'Turn your phone for the full cockpit');
  assert.equal(NOTES.turnPhone.speak, 'Turn your phone for the full cockpit.');
  const store = mem(); let line = '', says = 0;
  const run = (kind, secs, sailing = true) => { const tl = createTurnLine({ storage: store, text: NOTES.turnPhone.text, say: () => { says++; line = NOTES.turnPhone.text; return true; }, shown: () => line });
    for (let i = 0; i < secs * 10; i++) tl.update(0.1, { kind, sailing }); return tl; };
  let tl = run('phone-land', 30);
  assert.equal(says, 0, 'sideways: nothing to say');
  tl = run('phone-port', 1);
  assert.equal(says, 0, 'a breath after the helm shows');
  tl = run('phone-port', TURN.afterS + 1);
  assert.equal(says, 1); assert.ok(tl.seen); assert.equal(store.getItem(TURN_KEY), '1');
  line = '';
  run('phone-port', 60);
  assert.equal(says, 1, 'remembered: never again, a later page too');
  // not seen on the line (another line took its place): said again after a while, and remembered only once it shows
  const st2 = mem(); let n = 0, on = '';
  const tl2 = createTurnLine({ storage: st2, text: NOTES.turnPhone.text, say: () => { n++; return true; }, shown: () => on });
  for (let i = 0; i < (TURN.afterS + TURN.retryS + 1) * 10; i++) tl2.update(0.1, { kind: 'phone-port', sailing: true });
  assert.equal(n, 2); assert.ok(!tl2.seen); assert.equal(st2.getItem(TURN_KEY), null);
  on = 'Turn your phone for the full cockpit'; tl2.update(0.1, { kind: 'phone-port', sailing: true });
  assert.ok(tl2.seen);
});

test('full screen on an Android phone locks landscape (a refusal ignored); an iPhone, a tablet, a desktop never ask', async () => {
  const UA_A = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  const UA_I = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  assert.equal(landscapeLock({ ua: UA_A, phone: true }), true);
  assert.equal(landscapeLock({ ua: UA_A, phone: false }), false, 'an Android tablet');
  assert.equal(landscapeLock({ ua: UA_I, phone: true }), false, 'an iPhone cannot lock');
  assert.equal(landscapeLock({ ua: 'Mozilla/5.0 (Macintosh)', phone: false }), false);
  const doc = () => { const d = { fullscreenElement: null, ls: {}, addEventListener(t, f) { this.ls[t] = f; }, removeEventListener() {} };
    d.documentElement = { requestFullscreen() { d.fullscreenElement = this; return Promise.resolve(); } }; d.exitFullscreen = () => { d.fullscreenElement = null; return Promise.resolve(); }; return d; };
  for (const [lockOn, refuse] of [[true, false], [true, true], [false, false]]) {
    const locks = [], scr = { orientation: { lock: (o) => { locks.push(o); return refuse ? Promise.reject(new Error('NotSupportedError')) : Promise.resolve(); } } };
    const fs = createFullscreen(doc(), undefined, { lock: () => lockOn, screen: scr });
    fs.toggle(); await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(locks, lockOn ? ['landscape'] : [], `lock ${lockOn}`);
    fs.toggle(); await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(locks, lockOn ? ['landscape'] : [], 'leaving asks nothing');
  }
  // no orientation API at all: entering still works
  const fs = createFullscreen(doc(), undefined, { lock: () => true, screen: {} });
  assert.ok(fs.toggle()); await new Promise((r) => setTimeout(r, 0)); assert.ok(fs.active());
});
