// The kayaks' plug-in for v2/main.js (one marked block there): v1's fleet (v2/sim/kayaks.js) on v1's lake terrain
// (v2/sim/lake.js: v2's heights + v1's shore-distance grids), drawn by v2/render/kayaks.js from the baked asset.
//   const K = createKayaksPlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, errors, flags, P, tBase, manifest, terrain })
//                                             before reg.buildAll(): the two pipelines
//   K.attach({ B, water, clock, windField, ui, start, evening, storm, firstPair }) once the boat exists (firstPair(): a live page lays
//                                             the opening's pair, v2/stage/acts.js's kayaks row has an opening; start: Sail's start pose; evening():
//                                             the July 4th show's evening, when v1 lays no first pair; storm(): a storm runs,
//                                             v1's fleet.js storm: the day's kayakers go home, the first pair stays)
//   await K.prime(view)                       a capture: the shore grids and the asset in, the fleet made, the pair laid (v1's capture start)
//   K.step(dt, view)                          each sim frame (after the camera): live, the loads start after the first frame
//                                             and the fleet is made once the terrain is whole (v1 sails on the whole land)
//   K.relay(pose)                             a birthplace's move: the meetings from the new pose; a new pair in the next view
//   K.again()                                 the stage director's random kayaks (v2/stage/act-kayaks.js): a new pair in the
//                                             last view, once play has started and the first pair is laid → its place or null
//   K.fill() in fill(); K.draw(pass, c) in the scene pass after the boat; K.stats()
//   (the water off the blades: living/kayaks-splash.js, its pipeline declared with the two, stepped after the fleet)
//   round B (attach): launch: { regions, race(), mode() } a pair launched from shore after 3 min with no kayaker near the player (with the
//                                             residents only: desktop and tablet; Sail and as Tessie; never in a race, at the show or at night:
//                                             v2/living/kayakLaunch.js); tessie: () → her sim (v2/sim/tessie.js state): the kayakers watch her and
//                                             back away (v2/sim/kayaks.js TESSIE_REACT); launch.player(): the played seam's place (engine/player.js: Tessie while you are her)
//   K.setAudio(audio)                         the page's sound (engine/audio.js): a capsize's splash (living/kayaks-sound.js)
// view: { eye: [x, y, z], fwd: [x, y, z], fovDeg, aspect }
import { createKayaksRender } from '../render/kayaks.js';
import { createKayakSplash } from './kayaks-splash.js';
import { createKayakSound } from './kayaks-sound.js';
import { createKayakFleet } from '../sim/kayaks.js';
import { createLauncher } from './kayakLaunch.js';
import { polyline } from '../../src/sim/kayaks/routes.js';
import { lakeTerrain, shoreSampler, loadShore } from '../sim/lake.js';
import { kayaksOn } from '../../src/sim/kayaks/on.js';
import { feature } from '../../src/core/features.js';
import { dayWind } from '../../src/sim/wind.js';
import { inflate, unpredict } from '../terrain/decode.js';

const KAYAK_URL = new URL('../assets/kayak/kayak.kyb.gz', import.meta.url);

export function createKayaksPlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, errors = [], flags, P, tBase, manifest, terrain, mirrors = false, under = false }) {   // under: phase 2a (src/core/features.js tessieUnder)
  if (!kayaksOn(flags.kayaks == null ? undefined : String(flags.kayaks))) return null;
  const R = createKayaksRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, errors, mirrors, under });
  const S = createKayakSplash({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, seed: P.seed });
  let B = null, water = null, clock = null, windField = null, ui = null, startPose = null, evening = () => false, storm = () => false, firstPair = () => true;
  let fleet = null, lake = null, shoreP = null, assetP = null, started = false, making = false, sound = null, residents = null, launch = null, tessieSim = () => null;   // residents: (hour) → the regions' kayak rows (attach)
  const phone = feature('kayaksTier').tier === 'lite';   // src/core/features.js: a phone, a tablet or L2–L3 (never a capture)
  const t = { shoreMs: null, assetMs: null, fleetMs: null, laidMs: null, planMs: null };
  const t0 = performance.now();
  let hold = null;
  // decode: in a worker on a page (the bay's grid is 1.26 M texels), inline in a capture (it waits anyway)
  let worker = null, wid = 0; const waits = new Map();
  function decode(bytes, w, h) {
    if (P.headless || typeof Worker === 'undefined') return inflate(bytes).then((p) => unpredict(p, w, h));
    if (!worker) {
      worker = new Worker(new URL('../sim/shore-worker.js', import.meta.url), { type: 'module', name: 'velia-shore' });
      worker.onmessage = (e) => { const r = waits.get(e.data.id); waits.delete(e.data.id); if (!r) return; if (e.data.error) r[1](new Error(e.data.error)); else r[0](e.data.codes); };
    }
    return new Promise((res, rej) => { const id = ++wid; waits.set(id, [res, rej]); worker.postMessage({ id, bytes, w, h }, [bytes.buffer]); });
  }
  const loadShoreOnce = () => (shoreP ??= loadShore({ base: tBase, manifest, decode }).then((r) => { t.shoreMs = +(performance.now() - t0).toFixed(1); worker?.terminate(); worker = null; return r; }));
  // v1's lake terrain on the whole land (call once the heights are whole): the kayaks' and the birds' (their places)
  const lakeOf = (shore) => (lake ??= lakeTerrain({ height: (x, z) => terrain.field.height(x, z), distance: shoreSampler(shore.levels).distance }));
  const loadAsset = () => (assetP ??= R.load(KAYAK_URL.href).then((c) => { t.assetMs = +(performance.now() - t0).toFixed(1); return c; }));
  const loadAll = () => {
    loadShoreOnce();
    loadAsset();
    return Promise.all([shoreP, assetP]);
  };
  // the day's wind as the kayakers read it (v1's fleet.js readWind: dayWind's habits, level 4 counts 1.6 ×)
  const windMs = () => { try { return dayWind(clock.hour, { seed: P.seed, advisory: !!windField?.day?.advisory }).speedMs * ((P.windLevel ?? 3) >= 4 ? 1.6 : 1); } catch { return 0; } };
  // the skipper's lines through Sail's hint (v1's say / spot)
  function say(text, kind) {
    const hint = ui?.()?.services?.get?.('controls')?.hint;
    if (kind === 'spot' && hint?.hushed && hint.note) return hint.note(text, '');
    if (hint?.flash) return hint.flash(text, { secs: kind === 'close' ? 3.5 : 4.5 }) ?? true;
    return false;
  }
  function makeFleet(shore) {
    const tp = performance.now();
    lakeOf(shore);
    fleet = createKayakFleet({
      terrain: lake, seed: P.seed, phone, say,
      boat: () => B?.state ?? null, start: { x: startPose.x, z: startPose.z, heading: startPose.headingDeg * Math.PI / 180 },   // v1: the meetings are timed from Sail's start
      heightAt: (x, z) => water.heightAt(x, z), hour: () => clock.hour, wind: windMs, storm: () => !!storm(), clips: R.clips, draft: R.json?.kayak.draft ?? 0.12,
      residents: residents ? residents(clock.hour) : [], dayOff: !!residents,   // the regions' own kayakers (main.js; v2/living/busyLake.js residentKayaks): they replace v1's day kayakers and the staged pairs
      // round B: the shore launch (with the residents only) and Tessie near
      launcher: residents && launch ? createLauncher({ regions: launch.regions, isWater: (x, z) => lake.heightAt(x, z) < -0.5, polyline, seed: P.seed }) : null,
      launchOk: () => !launch?.race?.() && (launch?.mode?.() ?? 'sail') === 'sail',
      player: () => launch?.player?.() ?? B?.state ?? null,   // the played seam (engine/player.js): the played thing's place, else the boat's
      tessie: herParts,
    });
    t.planMs = +(performance.now() - tp).toFixed(1); t.fleetMs = +(performance.now() - t0).toFixed(1);
  }
  // Tessie as the kayakers see her: her spine's frames at the surface (every 4th, nose within 1.2 m of it), and her head while played
  const herPts = [];
  function herParts() {
    const st = tessieSim(); if (!st?.visible || !st.spine) return null;
    const sp = st.spine, N = sp.length / 8; herPts.length = 0;
    for (let i = 0; i < N; i += 4) if (sp[i * 8 + 1] > -1.2) herPts.push([sp[i * 8], sp[i * 8 + 2]]);
    return herPts.length ? { pts: herPts } : null;
  }

  const camOf = (v) => ({ x: v.eye[0], z: v.eye[2], fwdX: v.fwd[0] / (Math.hypot(v.fwd[0], v.fwd[2]) || 1), fwdZ: v.fwd[2] / (Math.hypot(v.fwd[0], v.fwd[2]) || 1), hHalf: Math.atan(Math.tan(v.fovDeg * Math.PI / 360) * v.aspect) });
  const layView = (v) => { const c = camOf(v); return { x: c.x, z: c.z, yaw: Math.atan2(c.fwdX, -c.fwdZ), hHalf: c.hHalf }; };
  // play has started (v1's playNow): a capture at once; a live page once a loading card (v1's #lk-load) has gone, or none
  const playNow = () => {
    if (P.headless) return true;
    const st = globalThis.document?.getElementById?.('lk-load')?.dataset?.state;
    return st == null || st === 'out' || st === 'gone' || st === 'menu' || st === 'attract';
  };
  let lastView = null, relayDue = false;
  const self = {
    again() { if (!fleet || !fleet.laid || !lastView || !playNow() || evening()) return null; return fleet.again(layView(lastView)); },
    // a birthplace's move: the day's meetings are timed from the new pose (a fleet made later plans from it);
    // a first pair already laid gets a new pair in the first view after the move (the old pair stays where it was, out of sight)
    relay(pose) { startPose = { x: pose.x, z: pose.z, headingDeg: pose.headingDeg }; relayDue = !!fleet?.laid && !residents; },   // with residents nothing follows the move: the new place's kayakers were there all along
    render: R, get fleet() { return fleet; }, get lake() { return lake; },
    loadAsset,   // the paddler asset alone (the glass boat's paddlers: v2/living/tourBoat.js) → the clips
    lakeReady: () => loadShoreOnce().then(lakeOf),   // v1's lake terrain (the birds' places read its shore distance)
    attach(o) { ({ B, water, clock, windField } = o); ui = o.ui ?? null; hold = o.hold ?? null; startPose = o.start; evening = o.evening ?? (() => false); storm = o.storm ?? (() => false); firstPair = o.firstPair ?? (() => true); residents = o.residents ?? null; launch = o.launch ?? null; tessieSim = o.tessie ?? (() => null); return self; },
    async prime(view) {
      const [shore] = await loadAll();
      makeFleet(shore);
      if (evening() || residents) fleet.first.laid = true; else fleet.lay(layView(view)); t.laidMs = +(performance.now() - t0).toFixed(1);   // residents: no pair staged in a capture either
      fleet.step(1 / 60, camOf(view));   // v1's attach steps once
      S.step(1 / 60, fleet);
    },
    step(dt, view) {
      if (!B) return;
      if (!started && hold?.()) return;   // hold: the page asks the downloads to wait (perf/v2-phone-load: the cockpit's asset first)
      if (!started) { started = true; loadAll().catch((e) => errors.push(`kayaks: ${e?.message ?? e}`)); }
      if (!fleet) {
        // the fleet on the whole land (the stream's end), the shore grids and the asset in
        if (!making && terrain.stats.streamed && t.shoreMs != null && R.ready) { making = true; shoreP.then(makeFleet).catch((e) => errors.push(`kayaks: ${e?.message ?? e}`)); }
        return;
      }
      // play has started: the pair in the camera's view, once (v1's layFirst; a view it cannot be placed in drops it, as v1's)
      // (owner, 2026-11-18: "if the lake is truly busy, we don't need to stage the kayaks at the opening": with no opening row for the
      // kayaks' act (v2/stage/acts.js) a live page lays no first pair; the stage's random act lays pairs later, as before)
      if (!fleet.laid && playNow()) { if (evening() || !firstPair()) fleet.first.laid = true; else fleet.lay(layView(view)); t.laidMs = +(performance.now() - t0).toFixed(1); }
      if (relayDue && playNow() && !evening()) { relayDue = false; fleet.again(layView(view)); }   // the move's new pair, in the view at the new place
      lastView = view;
      const cam = camOf(view);
      fleet.step(dt, cam);
      S.step(dt, fleet);   // the splash at the blades' catches, the drips after their exits
      if (sound) for (const e of fleet.sfx) sound.play(e, cam);   // a capsize's splash, a righted hull's
    },
    fill(eye, focalPx) {
      if (!fleet) return;
      fleet.draws.camX = eye[0]; fleet.draws.camZ = eye[2];
      R.update(fleet.draws, focalPx);
      S.fill(focalPx);
    },
    on: true,   // the harness's A/B (the budget: alternating blocks of frames with and without the draws, one page)
    draw(pass, c) { if (fleet && self.on) { R.draw(pass, c); S.draw(pass, c); } },
    drawMirror(pass, c) { if (fleet && self.on) R.drawMirror(pass, c); },   // the kayakers in the water's mirror (after the water)
    splash: S,
    setAudio(audio) { if (!P.headless && audio) sound = createKayakSound({ audio }); },
    stats() { return { ...(fleet ? fleet.stats() : { out: 0 }), render: R.stats, splash: S.stats, ms: t }; },
  };
  return self;
}
