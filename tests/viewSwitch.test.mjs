// The view switch (src/ui/viewSwitch.js) and the camera's move between the views (src/boat/viewBlend.js): the
// switch's state, where it shows, the first-session nudge, and the move reaching both poses smoothly, both ways.
// Run: node --test tests/
import { mountSail } from './helpers/sail-controls.mjs';   // first: it primes the small test lake before src/terrain.js loads
import { installDom, computed, displayed } from './helpers/dom-cascade.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewBlend, blendPose, ease, VIEW_BLEND } from '../src/boat/viewBlend.js';
import { FollowCamera } from '../src/sim/boat/followCamera.js';
import { HelmCamera } from '../src/sim/boat/helmCamera.js';
import { switchVisible, Nudge, NUDGE, VIEW_ICONS, createViewSwitch } from '../src/ui/viewSwitch.js';
import { lockerMenu, LOCKER, ICONS } from '../src/ui/toolDock.js';
import { KEYMAP, PADMAP } from '../src/sail/keys.js';

// Sail's real controls in node (helpers/sail-controls.mjs), built once for the tests that read them, then put away
let sailM = null;
const sail = () => (sailM ??= mountSail());
const sailDone = () => { sailM?.dispose(); sailM = null; };
test.after(sailDone);
// the switch on its own page (dom-cascade.mjs): a view held by the test, a stand-in full screen
function bar({ w = 1280, h = 720, coarse = false, ...o } = {}) {
  const dom = installDom({ w, h, coarse });
  let v = 'follow';
  const said = [], fs = { supported: () => true, active: () => false, on() {}, toggle() {} };
  const vs = createViewSwitch({ view: () => v, set: (x) => { v = x; }, storage: null, once: false, fullscreen: fs, music: () => null, subtitle: (t) => said.push(t), ...o });
  vs.update(0.1);
  return { dom, vs, said, el: vs.el, env: { w, h, coarse }, get view() { return v; }, set view(x) { v = x; }, done() { vs.dispose(); dom.uninstall(); } };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dir = (p) => { const d = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]]; const l = Math.hypot(...d); return d.map((x) => x / l); };
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

// a boat sailing at 3 m/s on 251°, heeled 18°, and the two live cameras on it
function scene(orbitDeg = 0) {
  const heading = 251 * Math.PI / 180, state = { x: 1200, z: -1050, heading, heave: 0.05, sog: 3, heel: 18 * Math.PI / 180, pitch: 0.01 };
  const follow = new FollowCamera({ x: state.x, z: state.z, heading });
  const helm = new HelmCamera();
  for (let i = 0; i < 120; i++) follow.update(1 / 60, state);
  if (orbitDeg) follow.update(1 / 60, state, { orbit: [orbitDeg * Math.PI / 180, 0] });
  const f = follow.update(1 / 60, state, { orbit: [0, 0] }), h = helm.update(1 / 60, state);
  return { state, f: { ...f, near: 0.5 }, h };
}

test('the switch state: to(), step() and the view it reports, both ways and turned back mid-way', () => {
  const vb = new ViewBlend();
  assert.equal(vb.k, 0); assert.equal(vb.view, 'follow'); assert.equal(vb.moving, false);
  assert.equal(vb.to('follow'), 0, 'already there: no move');
  vb.to('helm'); assert.equal(vb.view, 'helm', 'the view is the goal from the press'); assert.equal(vb.moving, true);
  let t = 0; while (vb.moving && t < 5) { vb.step(1 / 60); t += 1 / 60; }
  assert.equal(vb.k, 1); assert.ok(t >= VIEW_BLEND.durMinS && t <= VIEW_BLEND.durMaxS + 0.02, `the move took ${t.toFixed(2)} s`);
  vb.to('follow'); for (let i = 0; i < 30; i++) vb.step(1 / 60);
  const mid = vb.k; assert.ok(mid > 0.3 && mid < 0.7, 'half-way back');
  vb.to('helm'); vb.step(1 / 60); assert.ok(vb.k > mid, 'a second press turns it round from where it is, no jump');
  assert.ok(vb.k - mid < 0.03);
  const j = new ViewBlend('helm'); assert.equal(j.k, 1); assert.equal(j.view, 'helm');
});

test('the move lasts 0.8–1.2 s and is eased: at rest at both ends, never past the ends', () => {
  assert.equal(ViewBlend.durFor(32), 1.0);
  assert.ok(ViewBlend.durFor(5) >= 0.8 && ViewBlend.durFor(200) <= 1.2);
  assert.ok(ViewBlend.durFor(32, Math.PI) > ViewBlend.durFor(32, 0) && ViewBlend.durFor(32, Math.PI) <= 1.2, 'a swing round from the bow takes longer');
  assert.equal(ease(0), 0); assert.equal(ease(1), 1); assert.equal(ease(0.5), 0.5);
  const h = 1e-4;
  assert.ok((ease(h) - ease(0)) / h < 1e-3 && (ease(1) - ease(1 - h)) / h < 1e-3, 'zero speed at both ends');
  for (let k = 0; k <= 1; k += 0.01) assert.ok(ease(k) >= 0 && ease(k) <= 1 && ease(k + 0.01) >= ease(k) - 1e-12, 'monotone, no overshoot');
});

for (const orbit of [0, 90, 180, -120]) {
  test(`the move reaches both poses exactly and flies smoothly between them (follow camera orbited ${orbit}°)`, () => {
    const { state, f, h } = scene(orbit);
    const at = { eye: h.pos, heading: state.heading };
    const p0 = blendPose(f, h, 0, at), p1 = blendPose(f, h, 1, at);
    assert.deepEqual(p0.pos, f.pos); assert.deepEqual(p0.target, f.target); assert.equal(p0.fov, f.fov); assert.equal(p0.near, 0.5);
    assert.deepEqual(p1.pos, h.pos); assert.deepEqual(p1.up, h.up); assert.equal(p1.fov, h.fov); assert.equal(p1.near, h.near);
    // continuous at both ends (the eased path meets the poses, nothing snaps on the last frame)
    const a = blendPose(f, h, 1e-4, at), b = blendPose(f, h, 1 - 1e-4, at);
    assert.ok(dist(a.pos, f.pos) < 0.05 && dist(b.pos, h.pos) < 0.05, 'the path meets both poses');
    assert.ok(angle(dir(a), dir(f)) < 0.01 && angle(dir(b), dir(h)) < 0.01, 'the look meets both looks');
    // a 1 s move at 60 fps: no frame jumps (the eased peak is 1.9 × the mean on a straight path; a swing round from
    // the bow at most 3 ×, and never over 4 m a frame), the look turns steadily, the camera stays
    // out of the hull and over the water, and it comes in from astern for the last metre
    const N = 60, path = [];
    for (let i = 0; i <= N; i++) path.push(blendPose(f, h, ease(i / N), at));
    const steps = path.slice(1).map((p, i) => dist(p.pos, path[i].pos)), mean = steps.reduce((s, x) => s + x, 0) / N;
    assert.ok(Math.max(...steps) < (Math.abs(orbit) > 45 ? 3 : 2.1) * mean && Math.max(...steps) < 4, `the largest step ${Math.max(...steps).toFixed(2)} m vs the mean ${mean.toFixed(2)} m`);
    const turns = path.slice(1).map((p, i) => angle(dir(p), dir(path[i])));
    assert.ok(Math.max(...turns) < 12 * Math.PI / 180, `the look turns at most ${(Math.max(...turns) * 57.3).toFixed(1)}° in a frame`);
    for (const p of path) {
      assert.ok(p.pos[1] > 0.6, 'above the water');
      assert.ok(p.fov >= Math.min(f.fov, h.fov) - 1e-9 && p.fov <= Math.max(f.fov, h.fov) + 1e-9);
      const up = p.up ?? [0, 1, 0];
      assert.ok(Math.abs(Math.hypot(...up) - 1) < 1e-9 && up[1] > 0.9, 'up stays up (the heel at most)');
      assert.ok(p.near <= 0.5 && p.near >= 0.08);
    }
    const astern = [-Math.sin(state.heading), 0, Math.cos(state.heading)];
    const last = path[N - 3], off = [last.pos[0] - h.pos[0], last.pos[1] - h.pos[1], last.pos[2] - h.pos[2]], lo = Math.hypot(...off);
    assert.ok((off[0] * astern[0] + off[2] * astern[2]) / lo > 0.9, 'the last metres come in from astern');
    // the whole move stays clear of the mast and the sails: never within 1.2 m of the mast's line (hull z −0.3 forward of the eye's 3.3)
    const fwd = [Math.sin(state.heading), 0, -Math.cos(state.heading)], mast = [h.pos[0] + fwd[0] * 3.6, 0, h.pos[2] + fwd[2] * 3.6];
    for (const p of path) assert.ok(Math.hypot(p.pos[0] - mast[0], p.pos[2] - mast[2]) > 1.2 || p.pos[1] > 14, 'clear of the mast');
  });
}

test('both directions take the same path: helm → follow retraces follow → helm', () => {
  const { state, f, h } = scene(30), at = { eye: h.pos, heading: state.heading };
  const vb = new ViewBlend(); vb.to('helm');
  const there = []; while (vb.moving) { vb.step(1 / 60); there.push(blendPose(f, h, vb.e, at).pos); }
  vb.to('follow');
  const back = []; while (vb.moving) { vb.step(1 / 60); back.push(blendPose(f, h, vb.e, at).pos); }
  assert.ok(dist(back.at(-1), f.pos) < 1e-9, 'back at the follow pose');
  assert.ok(dist(there.at(-1), h.pos) < 1e-9, 'at the helm pose');
  const mid = blendPose(f, h, 0.5, at).pos;
  assert.ok(Math.min(...back.map((p) => dist(p, mid))) < 0.6, 'the way back passes the same mid-point');
});

test('where the switch shows: Day Sail, the helm view included; not in Chill, the binoculars, a page or the loading card', () => {
  const on = { controls: true };
  assert.equal(switchVisible(on), true);
  assert.equal(switchVisible({ ...on, view: 'helm' }), true, 'the helm view');
  assert.equal(switchVisible({}), false, "Chill's cinematic camera: Day Sail's controls are not up");
  assert.equal(switchVisible({ ...on, bino: true }), false, 'the binoculars');
  for (const page of ['menu', 'logbook', 'chartBig']) assert.equal(switchVisible({ ...on, [page]: true }), false, page);
  assert.equal(switchVisible({ ...on, loading: true }), false, 'the loading card');
  // Sail's controls wire the same contexts: the bar leaves under each, and comes back
  const s = sail(), S = s.services, vs = s.c.viewSwitch;
  const shownWith = (on, off) => { on(); s.step(2); const a = vs.shown && !vs.el.classList.contains('off'); off(); s.step(2); return a; };
  s.step(2); assert.equal(vs.shown, true, 'Sail: the bar is up');
  const card = document.createElement('div'); card.id = 'lk-load'; card.dataset.state = 'up';
  assert.equal(shownWith(() => document.body.appendChild(card), () => card.remove()), false, 'the loading card');
  assert.equal(shownWith(() => { S.provide('menu', { isOpen: true }); }, () => { S.remove('menu'); }), false, 'the menu');
  assert.equal(shownWith(() => { S.provide('logbook', { logbook: { isOpen: true } }); }, () => { S.remove('logbook'); }), false, 'the logbook');
  assert.equal(shownWith(() => { S.provide('chart', { chart: { toggle: { big: true } } }); }, () => { S.remove('chart'); }), false, 'the enlarged chart');
  assert.equal(shownWith(() => s.tap('KeyB'), () => { s.tap('KeyB'); for (let i = 0; i < 60 && !vs.shown; i++) s.step(1, 0.1); }), false, 'the binoculars (B up, B again down)');
  assert.equal(vs.shown, true, 'and back each time');
});

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('the first-session nudge: one glow at ≈ 20 s if never used, then never again', () => {
  const st = mem(), n = new Nudge({ storage: st });
  let fired = 0, t = 0;
  for (; t < 60; t += 0.1) if (n.update(0.1, { shown: true, quiet: true })) fired++;
  assert.equal(fired, 1); assert.ok(Math.abs(n.firedAt - NUDGE.atS) < 0.15, `at ${n.firedAt} s`);
  assert.equal(new Nudge({ storage: st }).done, true, 'the next session: no nudge');
  // the glow rises and falls once; the line holds, then goes
  const m = new Nudge({ storage: mem() }); for (let i = 0; i < 201; i++) m.update(0.1);
  const lv = []; for (let i = 0; i < 100; i++) { m.update(0.1); lv.push(m.level()); }
  assert.ok(Math.max(...lv.map((l) => l.glow)) > 0.95, 'the glow reaches full');
  assert.equal(lv.at(-1).glow, 0); assert.equal(lv.at(-1).line, 0);
  const peaks = lv.map((l) => l.glow).filter((g, i, a) => i > 0 && i < a.length - 1 && g > a[i - 1] && g >= a[i + 1]);
  assert.equal(peaks.length, 1, 'one pulse, not a loop');
});

test('the nudge: used before 20 s → none; it waits for quiet hints (up to a cap); it counts only while shown', () => {
  const st = mem(), a = new Nudge({ storage: st });
  for (let t = 0; t < 10; t += 0.1) a.update(0.1);
  a.used();
  let f = 0; for (let t = 0; t < 60; t += 0.1) if (a.update(0.1)) f++;
  assert.equal(f, 0, 'used: no glow');
  assert.equal(JSON.parse(st.getItem(NUDGE.key)).used, true);
  const b = new Nudge({ storage: mem() }); let at = null;
  for (let t = 0; t < 80; t += 0.1) if (b.update(0.1, { shown: true, quiet: t > 25 }) && at == null) at = t;
  assert.ok(at > 25 && at < 25.3, `waited for the hints to be quiet (fired at ${at?.toFixed(1)} s)`);
  const c = new Nudge({ storage: mem() }); at = null;
  for (let t = 0; t < 120; t += 0.1) if (c.update(0.1, { shown: true, quiet: false }) && at == null) at = t;
  assert.ok(at != null && at <= NUDGE.atS + NUDGE.waitMaxS + 0.2, 'never waits for ever');
  const d = new Nudge({ storage: mem() }); for (let t = 0; t < 40; t += 0.1) d.update(0.1, { shown: false });
  assert.equal(d.firedAt, null, 'not under a page');
  const e = new Nudge({ storage: mem(), once: false }); assert.equal(e.storage, null, '?once=0: in memory only');
  const g = new Nudge({ storage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
  for (let t = 0; t < 30; t += 0.1) g.update(0.1); assert.ok(g.firedAt != null, 'a blocked storage still works');
});

test('the switch: icons, keys and inputs', () => {
  for (const k of ['boat', 'helm']) assert.match(VIEW_ICONS[k], /^<path|^<circle/);
  assert.ok(KEYMAP.some((k) => k.code === 'KeyC' && k.shift === false && /helm view/.test(k.action)), 'C in the key table');
  assert.ok(PADMAP.some((b) => b.button === 3 && /helm view/.test(b.action)), "the pad's Y");
  // Sail's real controls (controls.js): the dock's helm icon (C) and the pad's held Y go through the same switch
  const s = sail();
  try {
    const dock = window.__lakeshore.dock, segs = () => document.querySelectorAll('.lk-view .seg').map((x) => x.getAttribute('aria-pressed'));
    s.step(2);
    assert.equal(dock.spec('helm')?.key, 'C', "the dock's helm icon stays, its key C");
    dock.run('helm'); s.step(2);
    assert.equal(s.c.view, 'helm'); assert.deepEqual(segs(), ['false', 'true'], 'the bar follows');
    s.tap('KeyC'); s.step(2); assert.equal(s.c.view, 'follow', 'C: back to the boat');
    const pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    s.pads.push(pad);
    pad.buttons[3] = { pressed: true, value: 1 }; s.step(20, 1 / 30);   // Y held 0.67 s
    pad.buttons[3] = { pressed: false, value: 0 }; s.step(2);
    assert.equal(s.c.view, 'helm', "the pad's held Y switches the view"); assert.deepEqual(segs(), ['false', 'true']);
    assert.equal(s.c.viewSwitch.nudge.done, true, 'a switch by any input ends the first-session nudge');
    // the top bar's Wind picker sets the level through the controls (the same call as keys 1-4)
    document.querySelector('.lk-view .xt[data-x=wind]').click();
    document.querySelector('.lk-windpick button[data-level="1"]').click(); s.step(2);
    assert.equal(s.wind.calls.at(-1), 1, 'Wind 1 set'); assert.equal(s.c.level, 1);
    assert.equal(document.querySelector('.lk-view .xt[data-x=wind] .w').textContent, 'Light');
  } finally { sailDone(); }
  // the bar on a page: the tokens' stylesheet, the chrome ink, real buttons whose pressed state follows the view
  const b = bar();
  try {
    assert.ok(document.getElementById('lk-tokens'), 'the tokens are on the page (ensureTokens)');
    assert.equal(computed(b.el, b.env).color, 'var(--lk-chrome-ink)', 'the capsule is in the chrome ink');
    const segs = b.el.querySelectorAll('.seg');
    assert.deepEqual(segs.map((x) => x.dataset.view), ['follow', 'helm']);
    assert.ok(b.el.querySelectorAll('button').every((x) => x.type === 'button'), 'real buttons: focusable, Enter and Space work');
    assert.deepEqual(segs.map((x) => x.getAttribute('aria-pressed')), ['true', 'false']);
    const on = computed(b.el.querySelector('.seg.on'), b.env);
    assert.deepEqual([on.background, on.color], ['var(--lk-chrome-ink)', 'var(--lk-chrome-bg)'], 'the lit segment: chrome ink, its word in the chrome ground');
    segs[1].click(); b.vs.update(0.1);
    assert.equal(b.view, 'helm', 'a click on Helm sets the helm view');
    assert.deepEqual(segs.map((x) => x.getAttribute('aria-pressed')), ['false', 'true']);
    assert.ok(segs[1].classList.contains('on') && !segs[0].classList.contains('on'));
  } finally { b.done(); }
});

test('the capsule sits at the top centre below the safe area; the bar is always whole (round 4); the phone shows it icons only', () => {
  const b = bar();
  try {
    const c = computed(b.el, b.env);
    assert.deepEqual([c.position, c.left, c.right, c.top, c.transform], ['fixed', '0', '0', 'calc(var(--lk-sat,0px) + var(--lk-edge-gap))', 'none'],
      'top centre (a full-width row, no half-pixel translate), below the safe-area top (a phone\'s own island)');
    assert.equal(c.bottom, undefined, 'not at the bottom');
    // every item stays; the words show while the bar has room and all go together when it has not (.ico, set by the bar's measured
    // fit: tests/pages/barWords.page.mjs holds the width); no width or device rule hides a word on its own
    const items = b.el.querySelectorAll('.lay.full > button, .lay.full > .pill > button, .lay.full > .mus > button');
    const ws = b.el.querySelectorAll('.w');
    assert.ok(items.length >= 7 && ws.length >= 7);   // Menu, Boat, Helm, Music, Full, Setup (⏭ is in the Music menu)
    for (const ico of [false, true]) {
      b.el.classList.toggle('ico', ico);
      for (const w of [1440, 1280, 1200, 800, 390]) {
        const env = { w, h: 720 };
        for (const x of items) assert.ok(displayed(x, env), `${w} px: every item (${x.dataset.x ?? x.dataset.view ?? x.className})`);
        assert.ok(ws.every((x) => displayed(x, env) === !ico), `${w} px, ${ico ? 'no room: icons only' : 'room: every word'}`);
      }
    }
    b.el.classList.remove('ico');
    for (const x of items) assert.ok((x.getAttribute('aria-label') ?? '').length > 0, `a name for the icon alone (${x.dataset.x ?? x.dataset.view ?? x.className})`);
    assert.equal(b.el.querySelectorAll('.lay').length, 1, 'no island morph: one layer (no rest layer)');
    assert.equal(b.el.querySelectorAll('.rest').length, 0);
    // the keys' tip under it; reduced motion: no morph
    assert.match(computed(b.el.querySelector('.tip'), b.env).top, /^calc\(100%/, 'the keys\' tip under it');
    assert.equal(computed(b.el.querySelector('.isl'), { ...b.env, reducedMotion: true }).transition, 'none', 'reduced motion: no morph');
    // the first-session line is a subtitle line, never a pill under the bar
    for (let t = 0; t < 25; t += 0.1) b.vs.update(0.1);
    assert.equal(b.vs.nudge.firedAt != null, true, 'the nudge fired');
    assert.deepEqual(b.said, ['the helm'], 'its line went to the subtitle');
    assert.equal(b.el.querySelectorAll('.line').length, 0, 'no pill under the bar');
  } finally { b.done(); }
});

// The expand chevron (owner, 2026-11-11): one glyph on every bar button that opens a menu (aria-haspopup), on no
// other; open flips it by the button's own aria-expanded (no script state); the icon-only bar keeps it as a corner badge (no width).
test('the chevron: on every button with a menu (clock, Weather, Wind, Music), on none that acts at once; aria-expanded drives it', () => {
  const player = { off: false, paused: false, title: 'a song', songId: 1, nexts: 0, next() { this.nexts++; }, toggle() {}, setVolume() {}, turnOn() {} };
  const sky = { rows: [{ id: 'clear', name: 'Clear' }, { id: 'fair', name: 'Fair' }, { id: 'storm', name: 'Storm' }], current: () => 'fair', pick() {} };
  const clockMenu = { rows: [{ id: 'dawn', name: 'Dawn' }, { id: 'night', name: 'Night' }], current: () => null, pick() {} };
  const b = bar({ music: () => player, weatherMenu: sky, windPick: { level: () => 2, set() {} }, clock: { hour: () => 18.4, date: () => '2026-07-04' }, clockMenu });
  try {
    const btns = b.el.querySelectorAll('.lay.full button');
    const withMenu = btns.filter((x) => x.hasAttribute('aria-haspopup')), plain = btns.filter((x) => !x.hasAttribute('aria-haspopup'));
    const id = (x) => x.dataset.x ?? x.dataset.view ?? x.className.split(' ')[0];
    assert.deepEqual(withMenu.map(id).sort(), ['clk', 'sound', 'weather', 'wind'], 'the menu buttons: the clock, Weather, Wind, Music');
    for (const x of withMenu) {
      const cv = x.querySelectorAll('.cv');
      assert.equal(cv.length, 1, `${id(x)}: one chevron`);
      assert.equal(x.childNodes.filter((n) => n.nodeType === 1).at(-1), cv[0], `${id(x)}: after its word`);
      assert.equal(cv[0].getAttribute('aria-hidden'), 'true');
      assert.equal(x.getAttribute('aria-expanded'), 'false', `${id(x)}: closed at rest`);
    }
    assert.ok(plain.length >= 4 && plain.every((x) => !x.querySelector('.cv')), `no chevron on Menu, the views, Full, Setup (${plain.map(id).join(' ')})`);
    assert.equal(b.el.querySelector('[data-x=next]'), null, 'no ⏭ on the bar: it is the Music menu\'s first row');
    // opening each menu sets its button's aria-expanded, and the CSS flips the chevron by it
    for (const sel of ['.clk', '.xt[data-x=weather]', '.xt[data-x=wind]', '.xt[data-x=sound]']) {
      const x = b.el.querySelector(sel); x.click(); b.vs.update(0.1);
      assert.equal(x.getAttribute('aria-expanded'), 'true', `${sel} open`);
      x.click(); b.vs.update(0.1);
      assert.equal(x.getAttribute('aria-expanded'), 'false', `${sel} closed again`);
    }
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    assert.match(css, /\.lk-view button\[aria-expanded=true\] \.cv\{transform:rotate\(180deg\)\}/, 'open flips it');
    assert.match(css, /\.lk-view\.ico \.cv\{position:absolute/, 'the icon-only form is a corner badge (no width)');
    assert.doesNotMatch(css, /\.lk-phone \.lk-view \.cv\{position:absolute/, 'a sideways phone with its words keeps the chevron after the word');
    // the Music menu: Next song first; a press plays the next song and keeps the menu open
    const snd = b.el.querySelector('.lk-sndpick'), first = snd.querySelectorAll('button')[0];
    assert.equal(first.textContent.trim(), 'Next song');
    b.el.querySelector('.xt[data-x=sound]').click(); first.click();
    assert.equal(player.nexts, 1, 'Next song played the next one'); assert.equal(snd.hidden, false, 'the menu stays');
  } finally { b.done(); }
});

// Cruise's one bar (owner, 2026-11-11, 37c § 4): Menu | Cinematic ▾ · Take the helm | Music Full Setup | Wind Weather | clock
const CAMS = [['cinematic', VIEW_ICONS.cinematic, 'Cinematic'], ['astern', VIEW_ICONS.boat, 'Boat'], ['above', VIEW_ICONS.above, 'Above'], ['helm', VIEW_ICONS.helm, 'Helm'], ['island', VIEW_ICONS.island, 'Island']];
function cruiseBar(o = {}) {
  let cam = 'cinematic', takes = 0, level = 2;
  const b = bar({ segments: [], label: 'app', nudge: false, extras: ['wind', 'weather', 'sound', 'fullscreen', 'settings'],
    views: { cameras: CAMS, get: () => cam, set: (v) => { cam = v; } }, primary: { word: 'Take the helm', icon: VIEW_ICONS.take, label: 'Take the helm (A D)', go: () => { takes++; } },
    windPick: { level: () => level, set: (n) => { level = n; } }, weatherMenu: { rows: [{ id: 'clear', name: 'Clear' }, { id: 'fair', name: 'Fair' }, { id: 'storm', name: 'Storm' }], current: () => 'fair', pick() {} },
    clock: { hour: () => 18.4, date: () => '2026-07-04' }, clockMenu: { rows: [{ id: 'dawn', name: 'Dawn' }], current: () => null, pick() {} }, ...o });
  return Object.defineProperties(b, Object.getOwnPropertyDescriptors({ get cam() { return cam; }, set cam(v) { cam = v; }, get takes() { return takes; }, get level() { return level; } }));
}
const slots = (el) => el.querySelector('.lay.full').children.map((c) => (c.classList.contains('dv') ? '|' : c.classList.contains('mus') ? 'music' : c.classList.contains('clk') ? 'clock' : c.dataset.x ?? (c.classList.contains('mn') ? 'menu' : c.className)));

test('Cruise\'s bar: Menu | the camera ▾ · Take the helm | Music Full Setup | Wind Weather | clock; the camera menu sets the view', () => {
  const b = cruiseBar();
  try {
    assert.deepEqual(slots(b.el), ['menu', '|', 'views', 'take', '|', 'music', 'fullscreen', 'settings', '|', 'wind', 'weather', '|', 'clock']);
    const vw = b.el.querySelector('[data-x=views]'), take = b.el.querySelector('[data-x=take]');
    assert.equal(vw.querySelector('.w').textContent, 'Cinematic', 'named for the camera on screen');
    assert.equal(vw.getAttribute('aria-haspopup'), 'menu'); assert.ok(vw.querySelector('.cv'), 'a chevron: it opens');
    assert.equal(take.querySelector('.cv'), null, 'no chevron on Take the helm: it acts at once');
    vw.click(); b.vs.update(0.1);
    assert.equal(vw.getAttribute('aria-expanded'), 'true');
    const menu = b.el.querySelectorAll('.lk-timepick').find((m) => m.getAttribute('aria-label') === 'View');
    assert.equal(menu.hidden, false);
    assert.deepEqual(menu.querySelectorAll('button').map((x) => x.textContent), ['Cinematic', 'Boat', 'Above', 'Helm', 'Island']);
    assert.deepEqual(menu.querySelectorAll('button.on').map((x) => x.dataset.id), ['cinematic'], 'the camera on screen is lit');
    menu.querySelector('[data-id=above]').click(); b.vs.update(0.1);
    assert.equal(b.cam, 'above'); assert.equal(menu.hidden, true, 'a pick closes it'); assert.equal(vw.getAttribute('aria-expanded'), 'false');
    assert.equal(vw.querySelector('.w').textContent, 'Above'); assert.equal(vw.getAttribute('aria-label'), 'View · Above (C)');
    b.cam = 'helm'; b.vs.update(0.1); assert.equal(vw.querySelector('.w').textContent, 'Helm', 'C on the keys: the button follows');
    take.click(); assert.equal(b.takes, 1, 'Take the helm hands over');
    b.el.querySelector('[data-x=wind]').click(); document.querySelector('.lk-windpick button[data-level="4"]').click();
    assert.equal(b.level, 4, 'Wind: the four levels, as in Sail');
  } finally { b.done(); }
});

// The Locker (owner, 2026-11-11): one menu, Chart · Glasses · VHF · Logbook │ Photo, rows from the dock's registry,
// lit (amber) while their thing is on, the chart with the mark's name; a tool not registered yet is a dim row that does nothing.
test('the Locker: five rows from the dock (Chart · Glasses · VHF · Logbook │ Photo), lit rows for live states, a dim row until its tool exists', () => {
  const ran = [], specs = new Set(['chart', 'radio', 'logbook']);
  const dock = { spec: (id) => (specs.has(id) ? { id } : null), visible: (id) => specs.has(id), run: (id) => { ran.push(id); return true; } };
  const st = { mark: null, latched: false, radio: false, photos: 0, charts: 0 };
  const locker = lockerMenu({ dock, lit: { chart: () => !!st.mark, binoculars: () => st.latched, radio: () => st.radio },
    name: { chart: () => (st.mark ? `Chart · ${st.mark}` : 'Chart') }, go: { chart: () => { st.charts++; } },
    extra: [{ id: 'photo', name: 'Photo', icon: ICONS.photo, go: () => { st.photos++; } }] });
  assert.deepEqual(LOCKER.map(([id]) => id), ['chart', 'binoculars', 'radio', 'logbook']);
  assert.deepEqual(locker.rows.map((r) => [r.id, r.name, r.sep]), [['chart', 'Chart', false], ['binoculars', 'Glasses', false], ['radio', 'VHF', false], ['logbook', 'Logbook', false], ['photo', 'Photo', true]]);
  const b = cruiseBar({ locker });
  try {
    assert.deepEqual(slots(b.el), ['menu', '|', 'views', 'take', '|', 'locker', '|', 'music', 'fullscreen', 'settings', '|', 'wind', 'weather', '|', 'clock'], 'the Locker between the view slot and the app');
    const lk = b.el.querySelector('[data-x=locker]');
    assert.equal(lk.querySelector('.w').textContent, 'Locker'); assert.ok(lk.querySelector('.cv'), 'a chevron');
    lk.click(); b.vs.update(0.1);
    assert.equal(lk.getAttribute('aria-expanded'), 'true');
    const menu = b.el.querySelectorAll('.lk-timepick').find((m) => m.getAttribute('aria-label') === 'Locker');
    const rows = () => menu.querySelectorAll('button');
    assert.deepEqual(rows().map((x) => x.textContent), ['Chart', 'Glasses', 'VHF', 'Logbook', 'Photo']);
    assert.ok(rows().every((x) => x.querySelector('svg')), 'each with its icon');
    assert.ok(menu.querySelector('[data-id=photo]').classList.contains('sep'), 'Photo under the hairline');
    assert.deepEqual(rows().filter((x) => x.classList.contains('on')).map((x) => x.dataset.id), [], 'nothing on: nothing lit');
    assert.deepEqual(rows().filter((x) => x.classList.contains('dead')).map((x) => x.dataset.id), ['binoculars'], 'the glasses not loaded yet: dim');
    // states on: the lit rows follow, the chart says the mark
    st.mark = 'Fannette'; st.radio = true; specs.add('binoculars'); st.latched = true; b.vs.update(0.1);
    assert.deepEqual(rows().filter((x) => x.classList.contains('on')).map((x) => x.dataset.id), ['chart', 'binoculars', 'radio']);
    assert.equal(menu.querySelector('[data-id=chart]').textContent, 'Chart · Fannette');
    assert.equal(menu.querySelector('[data-id=radio]').getAttribute('aria-checked'), 'true');
    // presses: the chart its own go; Glasses, VHF and Logbook the dock's tools; Photo its go; each closes the menu
    for (const id of ['chart', 'binoculars', 'radio', 'logbook', 'photo']) {
      if (menu.hidden) { lk.click(); b.vs.update(0.1); }
      menu.querySelector(`[data-id=${id}]`).click();
      assert.equal(menu.hidden, true, `${id}: the pick closes the menu`); assert.equal(lk.getAttribute('aria-expanded'), 'false');
    }
    assert.deepEqual(ran, ['binoculars', 'radio', 'logbook']); assert.equal(st.charts, 1); assert.equal(st.photos, 1);
    specs.delete('radio'); assert.equal(locker.pick('radio'), false, 'a dead row does nothing');
  } finally { b.done(); }
});

