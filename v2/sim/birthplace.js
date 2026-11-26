// Birthplaces (owner, 2026-11-18): the named places a sail starts from, a row each in the waters file's
// region table (each region row's `birthplaces`, v2/sim/regions.js; refactor round 3 C5) (`start` stays for v1 and ?start=). The wind sets the heading, never the file: a reach, BIRTH.offDeg (105°) off
// the live wind, on the tack that puts the row's hero feature (`look`) nearest the bow (a tie: starboard), with a BIRTH.probeM
// (400 m) land probe along it (toward the hero itself it stops 200 m short of it) (land inside it: the other tack; both blocked: the pick stands, flagged `blocked`, a data bug the
// check tool fails on). A 55° turn either way from 105° off is still sailing: never in irons on the first touch. The fireworks
// evening faces the show instead, turned out to BIRTH.showIronsDeg (50°) off the wind when the show lies closer to it.
// Pure: no DOM, no GPU, no Math.random, no wall clock.
//   listBirthplaces(waters, { unlocked, all })  → [{ id, name, x, z, look: [x, z], region, unlock, why, mark, locked }]   (mark: a small word on the pin, 'Tessie' Off Fannette)
//   chooseBirthplace(rows, pick)              → a row: the id's, else the first
//   birthPose(row, { windDeg, depthAt, showDeg, speed }) → { id, x, z, headingDeg, speed, tack, offWindDeg, blocked, camYawDeg, rule }
//   resolveStart({ flags, settings, waters, seed }) → { id, pick, source: 'url' | 'flag' | 'saved' | 'first' } | null (null: the
//                                                  URL's ?start= / ?heading= pin today's pose, as before)
//   createBirthplaces({ … })                   the service the UI calls (below): list, current, pick, pose, moveTo, on('moved')

import { birthplaceRows } from './regions.js';

export const BIRTH = Object.freeze({
  offDeg: 105,        // the reach: degrees off the true wind
  probeM: 400,        // the land probe along the heading, m
  probeStepM: 20,     // its step, m
  lookConeDeg: 60,    // a heading this near the hero feature's bearing probes only up to lookShortM short of it
  lookShortM: 200,    // m
  lookMinM: 150,      // m: the shortest probe
  keelM: 2.6,         // water under this depth is land to the probe (the keel's 1.6 m and 1 m under it: planChart's LANE_DEPTH)
  camOffDeg: 35,      // the hero feature further off the bow than this: the follow camera starts turned toward it
  camMaxDeg: 90,      // at most this far
  camHoldS: 3,        // s of sim the camera holds on the hero before its chase brings it back behind her (followCamera.js FOLLOW.chaseRate)
  showIronsDeg: 50,   // the fireworks evening's heading never closer to the wind than this
  speed: 2.75,        // m/s: she has way on (today's start)
  first: 'fannette',   // the first visit's row (owner, 2026-11-25: Off Fannette; Tessie's water joined it, her small mark on the pin)
  quietS: 15,         // the stage's quiet after a move (v2/stage/director.js quiet)
  // the move's veil: the time pick's (v2/ui/dayClock.js FADE; v2/tests/birthplace.test.mjs holds them equal), real s
  veil: Object.freeze({ outS: 0.35, holdS: 0.05, inS: 0.45 }),
});

const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const norm360 = (d) => ((d % 360) + 360) % 360;
const bearing = (x0, z0, x1, z1) => norm360(Math.atan2(x1 - x0, -(z1 - z0)) * 180 / Math.PI);   // compass, x east, z south

export function listBirthplaces(waters, { unlocked = ['always'], all = false } = {}) {
  const rows = birthplaceRows(waters);
  return rows.map((r) => {
    const unlock = r.unlock ?? 'always', locked = !unlocked.includes(unlock);
    return { id: r.id, name: r.name, x: r.x, z: r.z, look: r.look ? [r.look[0], r.look[1]] : null, region: r.region ?? null, unlock, why: r.why ?? '', ...(r.mark ? { mark: r.mark } : {}), locked };
  }).filter((r) => all || !r.locked);
}

// pick: an id, or anything else (an old saved 'random' too: the first row)
export function chooseBirthplace(rows, pick) {
  if (!rows.length) return null;
  return rows.find((r) => r.id === pick) ?? rows.find((r) => r.id === BIRTH.first) ?? rows[0];
}

// the land probe: true when water under keelM lies within probeM along headingDeg from (x, z)
export function landAhead(x, z, headingDeg, depthAt, { probeM = BIRTH.probeM, stepM = BIRTH.probeStepM, keelM = BIRTH.keelM } = {}) {
  if (!depthAt) return false;
  const h = headingDeg * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h);
  for (let d = stepM; d <= probeM + 1e-6; d += stepM) { const dep = depthAt(x + fx * d, z + fz * d); if (!(dep >= keelM)) return true; }
  return false;
}

// windDeg: the true wind's FROM direction at the row, compass degrees (live: the WindField's sample there now); depthAt(x, z): m
// of water (positive), for the land probe; showDeg: the fireworks evening's facing (sim/fireworksSite.js facingShow) or null
export function birthPose(bp, { windDeg, depthAt = null, showDeg = null, speed = BIRTH.speed, S = BIRTH } = {}) {
  const W = norm360(windDeg);
  const look = bp.look ?? null, toLook = look ? bearing(bp.x, bp.z, look[0], look[1]) : null;
  let headingDeg, tack, blocked = false, rule = 'reach';
  if (showDeg != null && Number.isFinite(showDeg)) {
    // the show wins (owner, 2026-11-18), out of irons: at least showIronsDeg off the wind, on the show's side of it
    rule = 'show';
    const off = wrap180(showDeg - W);
    headingDeg = Math.abs(off) >= S.showIronsDeg ? norm360(showDeg) : norm360(W + (off < 0 ? -1 : 1) * S.showIronsDeg);
    tack = wrap180(W - headingDeg) > 0 ? 'starboard' : 'port';
  } else {
    // the two reaches: W − off has the wind over the starboard side (starboard tack), W + off over the port side
    const stbd = norm360(W - S.offDeg), port = norm360(W + S.offDeg);
    let first = 'starboard';
    if (toLook != null) {
      const ds = Math.abs(wrap180(toLook - stbd)), dp = Math.abs(wrap180(toLook - port));
      if (dp < ds - 1e-6) first = 'port';   // a tie: starboard
    }
    const order = first === 'starboard' ? [['starboard', stbd], ['port', port]] : [['port', port], ['starboard', stbd]];
    // toward the hero (within lookConeDeg of it) the probe stops lookShortM short of it: sailing at the island or the castle is
    // the point, a shore before it is still caught (the probe's floor: lookMinM)
    const dLook = look ? Math.hypot(look[0] - bp.x, look[1] - bp.z) : Infinity;
    const probeFor = (h) => (toLook != null && Math.abs(wrap180(toLook - h)) <= S.lookConeDeg ? Math.min(S.probeM, Math.max(S.lookMinM, dLook - S.lookShortM)) : S.probeM);
    const clear = order.find(([, h]) => !landAhead(bp.x, bp.z, h, depthAt, { ...S, probeM: probeFor(h) }));
    if (clear) [tack, headingDeg] = clear; else { [tack, headingDeg] = order[0]; blocked = true; }
  }
  let camYawDeg = 0;
  if (toLook != null) { const d = wrap180(toLook - headingDeg); if (Math.abs(d) > S.camOffDeg) camYawDeg = Math.max(-S.camMaxDeg, Math.min(S.camMaxDeg, d)); }
  return { id: bp.id, x: bp.x, z: bp.z, headingDeg, speed, tack, offWindDeg: Math.abs(wrap180(headingDeg - W)), blocked, camYawDeg, rule };
}

// which row this page starts at. flags: ?birth=<id> wins for one load (never saved); ?start= or ?heading= alone pin today's
// fixed pose (null here: the captures, the goldens and the page tests that assume it); else the saved pick (settings 'birthplace');
// else the first visit's row
export function resolveStart({ flags = {}, settings = null, waters, seed = 1 } = {}) {
  const rows = listBirthplaces(waters);
  if (!rows.length) return null;
  const birth = flags.birth != null && flags.birth !== '' ? String(flags.birth) : null;
  if (!birth && (flags.start != null || flags.heading != null)) return null;
  let pick = birth, source = 'flag';
  if (!pick) { const saved = settings?.get?.('birthplace'); if (typeof saved === 'string' && saved) { pick = saved; source = 'saved'; } }
  if (!pick) { pick = BIRTH.first; source = 'first'; }
  const row = chooseBirthplace(rows, pick);
  return { id: row.id, pick, source };
}

// The service the UI calls (the card's mini chart, the chart's pins, "Sail from here"):
//   const bp = createBirthplaces({ waters, settings, seed, current, windAt, depthAt, showAt, place, veil, reduced, canMove });
//   bp.list()              the unlocked rows: { id, name, x, z, look, region, why, locked }
//   bp.current             the row id she started at or last moved to (null: a URL pose)
//   bp.chosen              the saved pick: an id (an old 'random' reads as the first row)
//   bp.pick(id)            remember it (settings 'birthplace'; the next load starts there): → the row, or null for an unknown id
//   bp.pose(id)            the pose from that row now (the live wind)
//   bp.moveTo(id, { instant }) the move under the time pick's veil (0.35 s out, 0.05 s held, 0.45 s in; reduced motion or no veil:
//                          at once): → a promise of { ok, id, pose } or { ok: false, why } ('race', 'knockdown', 'moving', 'unknown')
//   bp.on('moved' | 'pick', fn) → off()   moved: { id, name, pose, from }; pick: { id, pick }
//   bp.step(dt)            each real frame (the veil's timing), before the frame draws
//   bp.moving              a move's veil is under way
// windAt(x, z) → the true wind's FROM degrees there now; depthAt(x, z) → m; showAt(x, z) → the show's facing or null (outside its
// window); place(pose) does the move (main.js: B.place and the fan-out); veil(opacity, s) the page's veil (null, or hasVeil() false: no fade);
// canMove() → null or the reason a move is refused now;
export function createBirthplaces({ waters, settings = null, seed = 1, current = null, windAt, depthAt = null, showAt = () => null,
  place, veil = null, hasVeil = () => !!veil, reduced = () => false, canMove = () => null } = {}) {
  const rows = () => listBirthplaces(waters);
  const listeners = { moved: new Set(), pick: new Set() };
  const emit = (type, e) => { for (const fn of [...listeners[type]]) { try { fn(e); } catch { /* a listener's fault stays its own */ } } };
  let cur = current, move = null;
  const poseOf = (row) => birthPose(row, { windDeg: windAt(row.x, row.z), depthAt, showDeg: showAt(row.x, row.z) });
  const rowFor = (id) => rows().find((r) => r.id === id) ?? null;
  function land(m) {
    const pose = poseOf(m.row), from = cur;
    place(pose);
    cur = m.row.id;
    emit('moved', { id: m.row.id, name: m.row.name, pose, from });
    m.resolve({ ok: true, id: m.row.id, pose });
  }
  const self = {
    list: () => rows().map((r) => ({ ...r, look: r.look ? [...r.look] : null })),
    get current() { return cur; },
    get chosen() { const s = settings?.get?.('birthplace'); return typeof s === 'string' && rows().some((r) => r.id === s) ? s : BIRTH.first; },   // an unknown or old value ('random') reads as the first row
    get moving() { return !!move; },
    pick(id) {
      if (!rows().some((r) => r.id === id)) return null;
      settings?.set?.('birthplace', id);
      emit('pick', { id, pick: id });
      return rows().find((r) => r.id === id);
    },
    pose(id) { const r = rows().find((x) => x.id === id); return r ? poseOf(r) : null; },
    moveTo(id, { instant = false } = {}) {   // instant: no veil (the first card: the world is under the loading shell, nobody sees the move)
      if (move) return Promise.resolve({ ok: false, why: 'moving' });
      const why = canMove();
      if (why) return Promise.resolve({ ok: false, why });
      const row = rowFor(id);
      if (!row) return Promise.resolve({ ok: false, why: 'unknown' });
      settings?.set?.('birthplace', id);   // the last pick is remembered
      return new Promise((resolve) => {
        const m = { row, resolve, phase: 'out', s: 0 };
        if (instant || !veil || !hasVeil() || reduced()) { land(m); return; }
        move = m; veil(1, BIRTH.veil.outS);
      });
    },
    on(type, fn) { listeners[type]?.add(fn); return () => listeners[type]?.delete(fn); },
    step(dt) {
      const m = move;
      if (!m || !(dt >= 0)) return;
      m.s += dt;
      if (m.phase === 'out') { if (m.s >= BIRTH.veil.outS + BIRTH.veil.holdS) { land(m); m.phase = 'dark'; m.s = 0; } return; }
      if (m.phase === 'dark') { m.phase = 'in'; m.s = 0; veil(0, BIRTH.veil.inS); return; }   // one frame drawn dark at the new place, then up
      if (m.s >= BIRTH.veil.inS) move = null;
    },
  };
  return self;
}
