// refactor round 3 C3: the played seam (engine/player.js). The boat is the default; Tessie's row adds her (living/lakePlugins.js TESSIE); a
// stub second played thing (a drone) swaps in and back through `player` and the readers follow it with no edit of theirs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../engine/player.js';
import { LAKE_PLUGINS } from '../living/lakePlugins.js';

const row = (id) => LAKE_PLUGINS.find((d) => d.id === id);
const boatState = { x: 10, z: -20, heading: 0 };

// a stub played thing: its own pose, camera and threat; its hands counted
function drone() {
  const d = {
    on: false, steps: 0,
    get active() { return d.on; },
    swap(entry) { if (d.on) return { ok: false, why: 'already' }; d.on = true; d.entry = entry; return { ok: true, entry }; },
    back() { if (!d.on) return false; d.on = false; return true; },
    camera: (dt, c) => (d.on ? { ...c, pos: [1, 30, 2], target: [1, 0, 2], fov: 50 } : c),
    step: () => { d.steps++; },
    pose: () => ({ x: 1, z: 2 }),
    threat: () => ({ x: 1, z: 2, heading: 0, u: 3, m: 20, seeM: 40 }),
    view: () => ({ alt: 30 }),
  };
  return d;
}

test('the boat is the default: as, pose, camera, threat, bubbles', () => {
  const player = createPlayer({ boat: () => boatState });
  const c = { pos: [0, 2, 0], target: [0, 0, -1], fov: 60 };
  assert.equal(player.as, 'boat'); assert.equal(player.played, false); assert.equal(player.drive(), 'boat');
  assert.equal(player.pose(), boatState);
  assert.equal(player.camera(1 / 60, c), c);   // nothing added: the boat's camera untouched (the same object)
  assert.equal(player.threat(), null); assert.equal(player.bubbles(1 / 60), null); assert.equal(player.view(), null);
  assert.equal(player.dives, false);
  assert.deepEqual(player.swap('boat'), { ok: false, why: 'already' });
  assert.throws(() => player.add('boat', drone()));
});

test('a second played thing (a drone) swaps in and back through player; the kayaks\' launch and the busy lake\'s threat read it', () => {
  const player = createPlayer({ boat: () => boatState });
  const D = player.add('drone', drone());
  assert.throws(() => player.add('drone', drone()));
  // the kayaks' launch (living/lakePlugins.js KAYAKS attach): "no kayaker near the player" reads player.pose()
  let o = null;
  const c = { B: {}, clock: { hour: 12 }, P: { seed: 1 }, feature: () => ({ on: false, tier: 'off' }), storm: {}, m4: {}, water: {}, windField: {}, player, plugins: { get: () => null }, modeNow: () => 'sail', pipeQ: { has: () => true } };
  row('kayaks').at.attach({ attach: (x) => { o = x; } }, c);
  assert.equal(o.launch.player(), boatState);
  const cam = { pos: [0, 2, 0], target: [0, 0, -1], fov: 60 };
  assert.deepEqual(player.swap('drone', 'menu'), { ok: true, entry: 'menu' });
  assert.equal(player.as, 'drone'); assert.equal(player.played, true); assert.equal(player.drive(), 'drone');
  assert.deepEqual(o.launch.player(), { x: 1, z: 2 });   // the launch now measures from the drone
  assert.deepEqual(player.camera(1 / 60, cam).pos, [1, 30, 2]);
  assert.equal(player.threat().seeM, 40);   // the busy lake's escape (BUSY_LAKE: c.player.threat())
  assert.deepEqual(player.view(), { alt: 30 });
  player.step(0.1); assert.equal(D.steps, 1);
  assert.deepEqual(player.swap('drone'), { ok: false, why: 'already' });
  assert.equal(player.back(), true);
  assert.equal(player.as, 'boat'); assert.equal(player.pose(), boatState); assert.equal(player.threat(), null);
  assert.equal(player.camera(1 / 60, cam), cam);
  assert.equal(player.back(), false);
});

// Tessie's row: her plug-in and her player made from her chunk (a fake one here), the player added to the seam as 'tessie'
function fakeChunk(log) {
  const sim = { state: { visible: true, nose: { x: 5, z: 6, psi: 0, speed: 2 }, spine: new Float32Array(16).fill(0).map((v, i) => (i === 0 ? 5 : i === 2 ? 6 : v)) }, L: 19 };
  const t = { sim, playing: false, attach: (a) => log.push(['attach', Object.keys(a).sort().join(',')]) };
  let as = 'boat';
  const P = {
    get active() { return as === 'tessie'; }, get as() { return as; }, view: 'third', cam: {}, ctl: { state: { lunge: null, sprint: false, climb: 0, nose: 1 } },
    become: (entry) => { as = 'tessie'; t.playing = true; log.push(['become', entry]); return { ok: true, entry }; },
    back: () => { as = 'boat'; t.playing = false; log.push(['back']); return true; },
    camera: (dt, c, orbit) => { log.push(['camera', orbit]); return as === 'tessie' ? { ...c, pos: [5, -1, 6] } : c; },
    step: (dt) => log.push(['step', dt]), threat: () => (as === 'tessie' ? { x: 5, z: 6 } : null), girthAt: () => 1,
  };
  return { mod: { createTessiePlugin: () => t, createTessiePlayer: (o) => { log.push(['player', typeof o.project]); return P; } }, t, P };
}

test('Tessie\'s row adds her to the seam (play as Tessie on): swap, camera, pose, bubbles, hooks', () => {
  const log = [], { mod, t, P } = fakeChunk(log), T = row('tessie');
  const player = createPlayer({ boat: () => boatState });
  const c = { B: { state: boatState }, P: { msaa: 1, headless: true }, terrain: { field: { height: () => -30 } }, water: { heightAt: () => 0 }, canvas: { width: 1280, height: 720 },
    feature: (n) => ({ on: n === 'playTessie' }), player, plugins: { get: () => null }, m4: {}, pipeQ: { has: () => true }, clock: { hour: 12 }, storm: {}, fovDeg: 60, boatOn: true, tessieOn: true };
  assert.equal(T.on(c), true);
  const inst = T.create(c, mod);
  assert.equal(inst, t);
  T.at.attach(inst, c);
  assert.deepEqual(log.map((l) => l[0]), ['attach', 'player']);
  assert.equal(player.dives, true); assert.equal(player.as, 'boat');
  const cam = { pos: [0, 2, 0], target: [0, 0, -1], fov: 60 };
  assert.equal(player.camera(1 / 60, cam, [0, 0]), cam);   // her camera runs on the boat too (the swap-back glide), passing it through
  assert.equal(player.bubbles(0.1), null);
  assert.deepEqual(player.swap('tessie', 'menu'), { ok: true, entry: 'menu' });
  assert.equal(player.as, 'tessie'); assert.equal(player.played, true);
  assert.deepEqual(player.pose(), { x: 5, z: 6 });   // her head (the spine's first frame)
  assert.deepEqual(player.camera(1 / 60, cam, [0.1, 0]).pos, [5, -1, 6]);
  assert.equal(player.bubbles(0.1).N, 2);
  assert.deepEqual(player.threat(), { x: 5, z: 6 });
  const h = T.hook(inst, c);
  assert.equal(h.tessie, t); assert.equal(h.tessiePlay, P);
  assert.equal(player.back(), true); assert.equal(player.as, 'boat');
  // a second played thing beside her: each camera in turn (hers passes the drone's through while it is the drone's turn)
  const D = player.add('drone', drone());
  player.swap('drone'); assert.equal(player.as, 'drone'); assert.deepEqual(player.camera(1 / 60, cam).pos, [1, 30, 2]);
  player.back(); assert.equal(D.active, false);
  // off: no plug-in, the hooks' and stats' off values
  assert.deepEqual(T.hook(null, c).tessiePlay, null);
  assert.deepEqual(T.stats(null, { tessieOn: false }), { tessie: { off: 'the registry: feature(tessie) off' } });
  assert.equal(T.on({ boatOn: true, tessieOn: false }), false);
});

test('play as Tessie off (a policy without playTessie): her plug-in only, nothing added to the seam', () => {
  const log = [], { mod } = fakeChunk(log), T = row('tessie');
  const player = createPlayer({ boat: () => boatState });
  const c = { B: { state: boatState }, P: { msaa: 1 }, terrain: { field: { height: () => -30 } }, feature: () => ({ on: false }), player, m4: {}, pipeQ: { has: () => true }, clock: {}, storm: {} };
  T.at.attach(T.create(c, mod), c);
  assert.deepEqual(log.map((l) => l[0]), ['attach']);
  assert.equal(player.dives, false); assert.deepEqual(player.ids, ['boat']);
});
