// Sail's logbook (D4): the page (src/ui/logbook.js) wired to the boat. Live pages only:
// with ?headless the logbook is never built, so captures and goldens are unchanged.
//   - the chart from the world's own shoreline and harbour layouts;
//   - your line: the boat's position and speed every 1.5 s of sim time (thinned to 20 m spacing past 1,200 points);
//   - the finds: discoveries.js on the state stream each frame; on a find, the frame just drawn is grabbed in the
//     render's own task (core.afterFrame) as a 300 × 188 centre crop; the treatment and the JPEG run in a worker
//     (treatWorker.js; main-thread slices if there is none), so a find costs the frame only the small copy;
//   - L toggles (the page's own key, never a steering key), Escape closes; the world and the helm keep running;
//   - a find is said in the subtitle line ("First gust — in the logbook", the L as a small cap; Cruise: its quiet line; a
//     touch screen: the words only), queued behind any note or status so lines never cut each other (findLine.js; owner,
//     2026-11-07: no navy toast); the hints hide while the page is open;
//   - ?logbook=reset clears the save first (testing). endSession() runs on pagehide (the page module listens).
//   - the sailor's words page: the terms the player has met (controls.words)
//   - the seamanship page: the skill model's mastered skills (controls.skills) and the challenges
//     (challenges.js, fed here from the same state stream on the world's clock), never announced: a result only
//     redraws the page. ?once=0 keeps the challenges in memory; ?challenges=reset clears their save.
import { MARGIN } from '../ui/skipper.js';   // the skipper's pencilled notes
import { createLogbook, ENTRIES, FIREWORKS_ENTRY, KAYAK_ENTRY, treatSteps } from '../ui/logbook.js';
import { isHighlightDay } from '../sim/day.js';
import { showOn } from '../fireworks/share.js';
import { kayaksOn } from '../sim/kayaks/on.js';
import { buildChart } from '../ui/logbookChart.js';
import { createDiscoveries, placesFrom, terrainLos } from './discoveries.js';
import { createFindLine } from './findLine.js';
import { SKILLS } from './skills.js';
import { CHALLENGES, createChallenges, coursesFrom } from './challenges.js';

const KEY = 'lakeshore.logbook.v1';
const TRACK_S = 1.5, TRACK_MAX = 1200, THIN_M = 20;
const TILE_W = 300, TILE_H = 188;

// opts.track: the line so far (Cruise's hand-over and hand-back keep it)
export function attachLogbook(core, { phys, sfx }, controls, { track: track0 = null, key: lKey = true } = {}) {   // lKey false (v2): no L key, no L cap on a find's line
  const { flags, terrain, shoreline, harbour, traffic, camera, sunWorld, HOUR, T0, services } = core;
  let storage = null;
  try { storage = globalThis.localStorage ?? null; if (flags.logbook === 'reset') storage?.removeItem(KEY); } catch { storage = null; }

  const H = harbour.layout.entrance.centre;
  const chart = buildChart(terrain, { shoreline: shoreline.layout, harbour: { x: H[0], z: H[1] } });
  const hint = controls?.hint ?? null;
  const skills = controls?.skills ?? null;
  let chStore = null;
  try { chStore = !flags.once ? null : globalThis.localStorage ?? null; if (flags.challenges === 'reset') chStore?.removeItem('lakeshore.challenges.v1'); } catch { chStore = null; }
  const challenges = createChallenges({ courses: coursesFrom(terrain.lake), storage: chStore });
  const seaState = () => ({ mastered: skills?.masteredAll ?? {}, bests: Object.fromEntries(Object.entries(challenges.bests).map(([k, v]) => [k, v.label])) });
  // the finds' voice: the sail hint's status line (newest wins, the line it cut comes back), else Cruise's one quiet line
  const cruiseLine = () => services.get('cruiseLine') ?? null;
  // mid-tack or gybe, or head to wind: the bow swinging fast, no line now
  let manoeuvring = false, lastHead = null, lastHeadT = 0;
  // the July 4th show's evening (S3): its own entry, only on a page with the show (src/fireworks/share.js showOn)
  const fireworksEvening = showOn(flags, isHighlightDay(core.waters ?? services.get('waters')));
  const findLine = createFindLine({
    show: (text, { key, secs }) => hint ? hint.flash(text, { key, secs, keyAfter: true }) : cruiseLine() ? (cruiseLine().show(text, Math.round(secs * 1000)), true) : false,
    busy: () => manoeuvring || (hint ? !hint.free : !!cruiseLine()?.text),
    key: lKey ? undefined : () => '',
  });
  const logbook = createLogbook({
    seamanship: { skills: SKILLS.map((k) => ({ ...k, note: MARGIN[k.id] })), challenges: CHALLENGES, state: seaState },
    key: lKey,
    words: controls?.words ?? null,   // the third page: the sailor's words met (ui/words.js)
    corners: controls?.corners ?? null,   // v2's fourth page: the cups' hunts (v2/regatta/hunts.js), absent on v1
    tessie: controls?.tessie ?? null,   // v2's Tessie page (the RPG's bounty, level and skills; behind ?tessierpg=1), absent on v1
    entries: [...ENTRIES, ...(fireworksEvening ? [FIREWORKS_ENTRY] : []), ...(kayaksOn(flags.kayaks) ? [KAYAK_ENTRY] : [])], chart, storage,
    position: () => ({ x: phys.state.x, z: phys.state.z, heading: phys.state.heading }),
    onPlay: (id) => core.audio?.postcard?.(id),   // the sounds come later (§ 8)
    onFind: (f) => findLine.push({ ...f }),
    onOpen: () => { findLine.clear(); if (hint) hint.el.style.opacity = '0'; sfx?.cue('page'); },   // one soft page turn
    onClose: () => { if (hint) hint.el.style.opacity = ''; },
  });
  if (hint) hint.el.style.transition = 'opacity .5s cubic-bezier(.4,0,.6,1)';
  const places = placesFrom({ terrain, shoreline: shoreline.layout, harbour: harbour.layout });
  // the binoculars' sight: the terrain clear between the glasses and the place (discoveries.js SIGHT)
  const disc = createDiscoveries({ places, isFound: (id) => logbook.found(id), los: terrainLos(terrain.heightAt) });
  skills?.onChange((ev) => { if (ev.type === 'mastered' && logbook.isOpen) logbook.refreshSeamanship(); });
  const results = [];   // every finished challenge this session (the probe reads them)
  let sloopAt = -Infinity, sloops = [];

  const simT = () => controls?.simT ?? core.time;
  // D2: the sun as the core last drew it (core.sun, updated every frame), read each frame, never a startup constant
  const sunElevDeg = () => core.sun?.elevationDeg ?? Math.asin(Math.max(-1, Math.min(1, sunWorld.y))) * 180 / Math.PI;
  const hourNow = () => core.sun?.hour ?? HOUR + (simT() - T0) / 3600;

  // ---- the track ----
  let track = track0 ? track0.slice() : [], lastTrack = -Infinity;
  if (track.length) logbook.setTrack(track);
  function pushTrack(t) {
    const s = phys.state;
    track.push({ x: s.x, z: s.z, v: s.sog, t });
    if (track.length > TRACK_MAX) {   // thin to one point per 20 m
      const out = [track[0]];
      for (const p of track.slice(1, -1)) { const q = out.at(-1); if (Math.hypot(p.x - q.x, p.z - q.z) >= THIN_M) out.push(p); }
      out.push(track.at(-1)); track = out;
    }
    logbook.setTrack(track);
  }

  // ---- the pictures: grab in the frame's task, treat later ----
  const timings = [];   // per find: the grab (in the frame), the main-thread tasks after it and the worker's time, ms (the probe reads them)
  const pending = [];
  let grabbing = false;
  function grab(canvas) {
    grabbing = false;
    const t0 = performance.now();
    const c = document.createElement('canvas'); c.width = TILE_W; c.height = TILE_H;
    const g = c.getContext('2d');
    const sw = canvas.width, sh = canvas.height, k = Math.max(TILE_W / sw, TILE_H / sh), cw = TILE_W / k, ch = TILE_H / k;
    g.drawImage(canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, TILE_W, TILE_H);
    const grabMs = performance.now() - t0;
    const finds = pending.splice(0);
    treatAndRecord(c, finds, grabMs, t0);
  }
  // the treatment: in a worker (createImageBitmap is async, so even the read-back leaves the main thread); without
  // one, in slices on the main thread, one task each, the first 50 ms later when the GPU has finished the frame.
  // A find's main-thread cost is the grab plus these tasks; the probe reads them.
  let worker = null, seq = 0;
  const waiting = new Map();
  try {
    worker = new Worker(new URL('./treatWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { const w = waiting.get(data.id); waiting.delete(data.id); w?.(data); };
    worker.onerror = () => { worker = null; for (const w of waiting.values()) w({ error: 'worker' }); waiting.clear(); };
  } catch { worker = null; }
  const later = (f, ms = 0) => new Promise((res) => setTimeout(() => { const t = performance.now(); const v = f(); res([v, performance.now() - t]); }, ms));
  async function inWorker(c) {
    const t = performance.now(), bitmap = await createImageBitmap(c), bitmapMs = performance.now() - t;
    const id = ++seq;
    const out = await new Promise((res) => { waiting.set(id, res); worker.postMessage({ id, bitmap }, [bitmap]); });
    if (out.error) throw new Error(out.error);
    return { jpeg: out.jpeg, rawMean: out.rawMean, how: 'worker', workerMs: +out.workerMs.toFixed(2), bitmapMs: +bitmapMs.toFixed(2), slicesMs: [] };
  }
  async function inSlices(c) {
    const it = treatSteps(c, { bands: 8 }), slices = [];
    let r, ms;
    do { [r, ms] = await later(() => it.next(), slices.length ? 0 : 50); slices.push(ms); } while (!r.done);
    const [jpeg, jpegMs] = await later(() => r.value.toDataURL('image/jpeg', 0.8));
    slices.push(jpegMs);
    return { jpeg, rawMean: r.value.rawMean, how: 'slices', slicesMs: slices };
  }
  async function treatAndRecord(c, finds, grabMs, at) {
    let res;
    try { res = worker ? await inWorker(c) : await inSlices(c); } catch { res = await inSlices(c); }
    for (const f of finds) {
      const [, saveMs] = await later(() => logbook.record(f.id, res.jpeg, { hour: f.hour, at: f.at, treated: true }));
      timings.push({ id: f.id, at, how: res.how, grabMs: +grabMs.toFixed(2), rawMean: +res.rawMean.toFixed(1), workerMs: res.workerMs ?? null, bitmapWaitMs: res.bitmapMs ?? null,
        slices: res.slicesMs.length, saveMs: +saveMs.toFixed(2), syncMs: +Math.max(...res.slicesMs, saveMs).toFixed(2) });
    }
  }

  const fwd = { x: 0, y: 0, z: -1 };
  // the Milky Way's best point on a clear dark night (src/core/milkyway.js), else null
  function skySample() { const mw = core.milkyway; if (!mw?.dark?.(0.8)) return null; const a = mw.aim(); return a ? { dir: a.dir } : null; }
  function camSample() {
    const q = camera.quaternion;   // (0, 0, −1) rotated by q
    const x = q.x, y = q.y, z = q.z, w = q.w;
    fwd.x = -(2 * (x * z + w * y)); fwd.y = -(2 * (y * z - w * x)); fwd.z = -(1 - 2 * (x * x + y * y));
    return { x: camera.position.x, y: camera.position.y, z: camera.position.z, fx: fwd.x, fy: fwd.y, fz: fwd.z, fovDeg: camera.fov, aspect: camera.aspect };
  }

  function update() {
    const t = simT(), s = phys.state;
    if (t - lastTrack >= TRACK_S) { lastTrack = t; pushTrack(t); }
    const ids = disc.update({ t, x: s.x, z: s.z, heading: s.heading, sog: s.sog, tws: s.trueWind.speed, twa: s.trueWind.angle,
      cam: camSample(), sky: skySample(), sunElevDeg: sunElevDeg(), anchored: services.get('seamanship')?.anchoredNow ?? false,
      // the binoculars (captainTools.js): their aim while fully raised; the dwell on the real clock; the far sloops
      bino: controls?.tools?.aim ?? null, rt: controls?.feel?.t, boats: controls?.tools?.aim ? (traffic?.sailboats ?? []).map((b) => b.poseAt(core.time)) : null });
    // aground (grounding.js): a quiet entry, the first time only: no find note, no vista
    // the show's finale seen (src/fireworks/world.js): a quiet entry, the logbook's own way
    if (fireworksEvening && services.get('fireworks')?.consumeMoment?.() && !logbook.found('fireworks')) pending.push({ id: 'fireworks', hour: +hourNow().toFixed(3), at: { x: Math.round(s.x), z: Math.round(s.z) } });
    // a kayak bumped (src/kayaks/fleet.js): a quiet entry, the first time only
    if (services.get('kayaks')?.consumeContact?.() && !logbook.found('kayak')) pending.push({ id: 'kayak', hour: +hourNow().toFixed(3), at: { x: Math.round(s.x), z: Math.round(s.z) } });
    if (controls?.grounding?.consumeAground() && !logbook.found('aground')) pending.push({ id: 'aground', hour: +hourNow().toFixed(3), at: { x: Math.round(s.x), z: Math.round(s.z) } });
    for (const id of ids) {
      pending.push({ id, hour: +hourNow().toFixed(3), at: { x: Math.round(s.x), z: Math.round(s.z) } });
      // a find: one warm wood note; and the arrival's swell, once per place, only into silence (src/audio.js vista)
      sfx?.cue('find');
      core.audio?.vista?.(core.time, id);
    }
    if (pending.length && !grabbing) { grabbing = true; core.afterFrame(grab); }
    // the challenges: the world's clock; the AI sloops at 2 Hz
    if (traffic?.sailboats && core.time - sloopAt >= 0.5) { sloopAt = core.time; sloops = traffic.sailboats.map((b) => { const p = b.poseAt(core.time); return { id: p.id, x: p.x, z: p.z, heading: p.heading }; }); }
    const done = challenges.update({ t, x: s.x, z: s.z, heading: s.heading, sog: s.sog, twa: s.trueWind.angle, windFrom: s.heading + s.trueWind.angle,
      level: controls?.level ?? null, surf: s.surf, roundUp: s.roundUp, sloops });
    if (done.length) { results.push(...done.map((d) => ({ ...d, t }))); if (logbook.isOpen) logbook.refreshSeamanship(); }
    { const now = performance.now() / 1000, h = s.heading;
      if (lastHead != null && now > lastHeadT) { const d = Math.abs(((h - lastHead + Math.PI * 3) % (Math.PI * 2)) - Math.PI) ; manoeuvring = d / (now - lastHeadT) > 0.14 || Math.abs(s.trueWind.angle) < 0.6; }
      lastHead = h; lastHeadT = now; }
    findLine.tick();
  }

  const api = { logbook, discoveries: disc, timings, challenges, results, get track() { return track; } };
  services.provide('logbook', api);
  return {
    update, get track() { return track; },   // the chartplotter draws the same line
    dispose() { worker?.terminate(); logbook.dispose(); if (hint) hint.el.style.opacity = ''; services.remove('logbook', api); },
  };
}
