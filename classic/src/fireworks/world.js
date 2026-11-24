// The fireworks in the world (stage S2): the show in the real game, on the highlight day, behind ?fireworks=1
// until the owner OKs it (the default game is unchanged). The core attaches it after the mode starts (src/core/index.js)
// and runs it as a frame system; the post chain's fireworks stage (src/fireworks/composite.js) and the evening's blue
// twilight (src/core/milkyway.js) come on with the same flag on the highlight day.
//   const fw = await attachFireworks(core)   → { frame(), seek(t), step(dt), stats(), showTime, … } (also the 'fireworks' service)
// The staging (src/fireworks/stage.js): two barges inside Emerald Bay 250 m from the viewing spot, each with a pusher tug,
// patrol boats on the 110 m zone, in the evening only (20:30–23:30, after sunset: src/fireworks/presence.js, never popping into view;
// towed in up the bay if the camera never looks away); two anchored sailboats from 20:30 (src/fireworks/spectators.js);
// all of them solid for our boat (src/fireworks/solids.js; fix/barge-collision, owner 2026-11-09: "the boat just sails
// through it like a ghost"); the real South Lake show and Tahoe City small on the horizon.
// The evening (S3, src/fireworks/evening.js): hints, the chart's mark at the viewing spot, the time-lapse to 21:44 once the
// boat is settled at the mouth after dark (or at 21:35 wherever it is), then the game's clock at 4 game s per real s, so
// the show clock (show s = game s since 21:44 / 4) and the game clock agree; after the show the day clock comes back.
// During the show Sail's follow camera tilts up and widens a little (eased; the player can still move it). ?fwt=<s> pins
// the show time (captures and films step it themselves); drive(dt) runs the evening frame by frame for a film.
// ?fwlook=<deg> tilts Sail's follow camera up (the captures; the bench's baseline).
// S5 (owner 2026-11-08): on by default (?fireworks=0 off); Cruise's anchorage inside the mouth counts as a viewing
// spot (src/fireworks/cruise.js CRUISE_SPOT) and carries the chart's mark in Cruise; invite() is the Cruise button (the
// evening's lapse waits only for the boat settled at a spot); "Full Moon" is Cruise's show score (the playlist hushed from
// 20 s before the show); the share link (?show=fireworks) starts in the show's phase and holds the clock while the home
// card is up (its Enter is the gesture that starts the sound).
import { createFireworks } from './engine.js';
import { makeShow, SHOW_LENGTH, SHOW_START_HOUR } from '../../../src/fireworks/show.js';
export { SHOW_START_HOUR };
import { createBarges } from './barges.js';
import { createSpectators, SPECTATORS, sailboatSpots } from './spectators.js';
import { createSolids, blocked } from './solids.js';
import { createPresence } from './presence.js';
import { Frustum, Matrix4, Sphere } from 'three/webgpu';
import { VIEW, bargesWorld, SCALE, SHOW_FRAME, wowShow, farStage } from '../../../src/fireworks/stage.js';
import { Sprite, SpriteNodeMaterial, AdditiveBlending } from 'three/webgpu';
import { uniform, vec3, vec4 } from 'three/tsl';
import { createEvening, perScene } from '../../../src/fireworks/evening.js';
import { createFireworksSound } from '../../../src/fireworks/sound.js';
import { createFireworksMusic } from '../../../src/fireworks/music.js';
import { Vector3 } from 'three/webgpu';
import { FW } from './light.js';
import { FLAGS } from '../../../src/sim/core/flags.js';
import { afterReady } from '../../../src/ui/deferLoad.js';
import { kayaksOn } from '../../../src/sim/kayaks/on.js';
import { modeId } from '../../../src/modeNames.js';
import { SHOW_CENTRE, isShare } from './cruise.js';

// the chart's mark at the viewing spot: one short name, on the enlarged chart and (its label) on the small round one
export const MARK = { name: 'Fireworks', label: 'Fireworks' };
// show seconds per game second before S3's evening clock: the show's 20 game minutes as its 5-minute script
export const SHOW_GAME_RATE = 4;
// the show time (s) for a game hour, or null outside the show (and its smoke) window
export function showTimeAt(hour) {
  const t = ((hour - SHOW_START_HOUR) * 3600) / SHOW_GAME_RATE;
  return t > -600 && t < SHOW_LENGTH + 120 ? t : null;
}

// ?fwlook=<deg> on a headless page: Sail's follow camera, tilted up, posed from the boat every frame (also without the show:
// the GPU bench's baseline frames the same sky)
export function followLook(core) {
  const player = core.services.get('player'), look = core.flags.fwlook != null ? parseFloat(core.flags.fwlook) : null;
  if (look == null || !player?.follow) return Object.assign(() => {}, { active: false });
  player.follow.look = look * Math.PI / 180;
  return Object.assign(() => {
    if (!core.headless || !player.phys) return;
    const p = player.follow.update(1 / 60, player.phys.state);
    core.camera.position.set(...p.pos); core.camera.lookAt(...p.target);
    if (p.fov) { core.camera.fov = p.fov; core.camera.updateProjectionMatrix(); }
  }, { active: true });
}

export async function attachFireworks(core) {
  const { flags, scene, camera, renderer, services } = core;
  const tier = core.tier?.name === 'low' || core.tier?.phone ? 'phone' : 'desktop';
  const BARGES = bargesWorld();
  const mid = SHOW_CENTRE;
  const wind = () => { const w = core.wind?.sample?.(mid[0], mid[1], core.time ?? 0); return w ? [w.vx * 1.4, 0, w.vz * 1.4] : [0, 0, 0]; };
  const seed = Number(core.SEED) || 1;
  const fw = createFireworks({ renderer, camera, tier, show: wowShow(makeShow, seed, { tall: camera.aspect < 1 }), barges: BARGES, scale: SCALE, wind, mrt: true });   // an upright phone: the tall layout (stage.js SPREAD_TALL)
  scene.add(fw.group);
  const props = createBarges({ barges: BARGES, toward: VIEW, wet: core.terrain?.heightAt ? (x, z) => core.terrain.heightAt(x, z) < -0.5 : null });
  scene.add(props.group);
  let far = null, fs = null;
  if (tier !== 'phone') {
    const { lonLatToWorld } = await import('../../../src/sim/geo.js');
    fs = farStage(seed, lonLatToWorld);
    far = createFireworks({ renderer, camera, tier: 'far', show: fs.show, barges: fs.barges, scale: 1, wind, smoke: false, bank: false });
    scene.add(far.group);
  }
  // S4, the sound (src/fireworks/sound.js) and the evening's music (src/fireworks/music.js): on live pages, on the core's
  // audio (silent until the player's first gesture); a capture builds the plan only (its offline render: films).
  // ?fwsound=0 silences both; Cruise plays the show score (S5).
  const audioLive = !core.headless && flags.fwsound !== false ? core.audio ?? null : null;
  // the mode now (the shell's 'mode' service follows Cruise's hand-over to Sail and back), else the page's
  const modeNow = () => services.get('mode') ?? modeId(flags.mode ?? FLAGS.mode) ?? 'sail';
  const music = createFireworksMusic({ audio: audioLive, mode: modeNow, score: () => modeNow() === 'cruise',
    radioOn: () => !!services.get('settings')?.get?.('boatRadio') });
  const sound = createFireworksSound({ audio: audioLive, show: fw.show ?? wowShow(makeShow, seed, { tall: camera.aspect < 1 }), barges: BARGES, scale: SCALE, far: fs, seed, phone: tier === 'phone',
    onBang: (when, gain) => music.duck(when, gain),
    fetchFn: (url, opts) => afterReady().then(() => fetch(url, opts)) });   // the show's 0.44 MB of sounds after the first live frame, never in the start's bandwidth (perf/slow-loading)
  const camDir = new Vector3();
  const listenerNow = () => { camera.getWorldDirection(camDir); return { x: camera.position.x, y: camera.position.y, z: camera.position.z, fx: camDir.x, fz: camDir.z }; };
  const player = services.get('player');   // what the player drives (src/core/player.js)
  // our boat's anchor light (wow round, the close film's): a white point at the masthead (the mast step 1.46 m + the mast
  // 10.76 m, 0.74 m forward of the hull's origin: src/boat/dims.js), lit after dusk from 20:30 to the show's end, at rest
  const uAnchor = uniform(0), anchorMat = new SpriteNodeMaterial({ sizeAttenuation: false, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  anchorMat.colorNode = vec4(vec3(1, 0.96, 0.9).mul(uAnchor), 1);
  const anchorLight = new Sprite(anchorMat); anchorLight.scale.setScalar(0.006); anchorLight.position.set(0, 12.3, -0.74); anchorLight.name = 'anchor-light';
  if (player?.group?.isObject3D) player.group.add(anchorLight);
  // the spectators (the kayaks on, the default, in a mode that has the fleet (Sail, Cruise): the live fleet's kayakers rest at these spots for
  // the evening, src/kayaks/fleet.js: the static ones stand down; Regatta and ?kayaks=0 keep the static ones)
  const liveKayaks = kayaksOn(flags.kayaks) && !!services.get('kayaks');
  const only = liveKayaks ? { ...SPECTATORS, kayaks: [] } : SPECTATORS;
  const crowd = await createSpectators(core, { from: VIEW, boat: player?.group ?? null, list: only });
  scene.add(crowd.group);
  // the props are solid for our boat (src/fireworks/solids.js, fix/barge-collision): the barges and tugs, the patrol boats,
  // the spectators' sailboats, inside the boat's own physics tick (the player's physics post, every mode); a bump thuds
  const sailboats = player?.group ? sailboatSpots(VIEW, only) : [];
  const solids = createSolids({ barges: BARGES, toward: VIEW, wet: core.terrain?.heightAt ? (x, z) => core.terrain.heightAt(x, z) < -0.5 : null, sailboats,
    onBump: (e) => player?.cue('thud', { v: e.j / 3765, mat: 'rock' }) });
  { const sb = solids.bodies.filter((b) => b.kind === 'sail'); crowd.items.filter((it) => it.kind === 'sail').forEach((it, k) => { it.solid = sb[k] ?? null; }); }
  const offPost = player?.addPost((st, dt, t) => solids.post(st, dt, t)) ?? null;
  // when they are in the world (src/fireworks/presence.js): the evening window, never popping into view (a cut sets them;
  // else out of the camera's view, or the barges towed in up the bay)
  const spots = BARGES.map((b) => ({ x: b.x, z: b.z, yaw: Math.atan2(b.axis[0], b.axis[1]) }));
  const presence = createPresence({ spots });
  const crowdAt = sailboats.map((b) => [b.x, b.z]);
  const frustum = new Frustum(), m4 = new Matrix4(), sphere = new Sphere();
  const inView = (x, z, r) => {
    if (Math.hypot(x - camera.position.x, z - camera.position.z) > 6000) return false;   // past the haze: under a pixel
    sphere.center.set(x, 4, z); sphere.radius = r;
    return frustum.intersectsSphere(sphere);
  };
  let presenceOut = null, cutNext = false;

  const poseCam = followLook(core);
  const pin = flags.fwt != null ? parseFloat(flags.fwt) : null;
  const hourNow = () => core.clock?.hourOfDay?.(core.time) ?? core.sun?.hour ?? 0;
  let showT = pin ?? showTimeAt(hourNow()) ?? -1e9, lastTime = core.time, started = false;
  // the evening (src/fireworks/evening.js): live pages without a pinned show time or clock; a film drives it (drive())
  const live = pin == null && !core.headless && !flags.timerate;
  // the share link: the evening starts in the show's phase; its clock waits while the home card is up (once it has gone,
  // a menu opened later never holds it)
  const share = isShare(flags);
  let cardGone = false;
  const cardUp = () => {
    if (cardGone || core.headless || flags.noload != null || typeof document === 'undefined') return false;   // no card on a capture
    const el = document.getElementById('lk-load');
    const up = !!el && el.isConnected && getComputedStyle(el).display !== 'none' && ['company', 'home', 'menu', 'attract'].includes(el.dataset.state);
    if (!up) cardGone = true;
    return up;
  };
  const evening = createEvening({ phase: share ? 'show' : 'before', held: () => share && cardUp() });   // the spot: stage.js VIEW (every mode)
  let lastPos = null, sogSeen = 0, driving = false, controlling = false, lastRate = null, bias = null, momentPending = false, momentSaid = false, marked = false;
  const lines = [];   // the lines said (the captures show the last one)
  const seekAll = (t) => { showT = t; fw.seek(t); far?.seek(t); started = true; cutNext = true; };   // a seek is a cut: the props as the hour has them
  const expo = () => core.sun?.exposure ?? 2172;
  function lightAll(dt) {
    const e = expo(), night = Math.min(1, Math.max(0, (-(core.sun?.elevationDeg ?? 30) - 2) / 6));
    fw.setExposure(e); far?.setExposure(e);
    FW.night.value = night;   // the post stage's far-land silhouette: after dusk only (src/fireworks/light.js)
    FW.active.value = fw.active && (pin != null || showTimeAt(hourNow()) != null) ? 1 : 0;   // the bloom's passes: only with the show in the air
    props.update(showT, { exposure: e, showOn: showT > -60 ? 1 : 0, night });
    // the spectators come out for the evening (from 20:30 to 22:40); the barges are towed in for it (wow round: they lie
    // 250 m off the anchorage inside the bay, in Cruise's and the sloops' water, so not all day: from 20:30, after sunset, to 23:30), each
    // coming and going out of the camera's view (presence.js)
    const h = hourNow();
    camera.updateMatrixWorld(); m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(m4);
    const st = player?.phys?.state;
    presenceOut = presence.step({ hour: h, dt, cut: cutNext, inView, boatAt: st && Number.isFinite(st.x) ? [st.x, st.z] : null, crowdAt });
    cutNext = false;
    if (presenceOut.changed.barges || presenceOut.towing) presenceOut.poses.forEach((p, i) => solids.setBargePose(i, p));
    solids.setOn({ barges: presenceOut.shown, crowd: presenceOut.crowd });
    props.setPoses(solids.bodies);
    props.group.visible = presenceOut.shown;
    const atRest = (player?.phys?.state?.sog ?? 1) < 0.4;   // an anchor light only at rest (under way she shows her running lights)
    uAnchor.value = atRest && h > 20.5 && h < 22.3 ? 3.0 * night / Math.max(e, 1e-6) : 0;
    crowd.group.visible = presenceOut.crowd; if (crowd.group.visible) crowd.update(dt, core.time ?? 0, e, camera.position);
  }
  if (showT > -600) seekAll(showT);
  // the show clock follows the game's (show s = game s since 21:44 / 4): small steps play, a jump seeks
  function syncShow() {
    const target = showTimeAt(hourNow());
    if (target == null) return;
    if (!started || Math.abs(target - showT) > 0.3) { if (target > -30) seekAll(target); else showT = target; return; }
    const d = target - showT;
    if (d > 0) { fw.update(d); far?.update(d); }
    showT = target;
  }
  // during the show Sail's follow camera frames the bursts and the water together: tilted up and wider (SHOW_FRAME: the
  // finale's top inside the frame with headroom, the horizon in its lower eighth), eased in and out over ≈ 1.5 s; the
  // player's own drag still adds to it (followCamera.js lookBias, fovBias)
  function frameShow(dt) {
    const want = showT > -3 && showT < SHOW_LENGTH + 10 && !poseCam.active ? 1 : 0;   // ?fwlook pins the camera (the bench)
    bias = bias == null ? want : bias + (want - bias) * (1 - Math.exp(-dt / 1.5));   // a page loaded inside the show starts framed
    if (player?.follow) { player.follow.lookBias = SHOW_FRAME.look * bias; player.follow.fovBias = SHOW_FRAME.fov * bias; }
  }
  function tick(dt) {
    const st = player?.phys?.state ?? { x: 0, z: 0 };
    // the speed over the ground from the boat's own track (smoothed over ≈ 1 s): what the eye sees, on any page
    if (lastPos && dt > 0) { const v = Math.hypot(st.x - lastPos[0], st.z - lastPos[1]) / dt; sogSeen += (v - sogSeen) * (1 - Math.exp(-dt / 1)); }
    lastPos = [st.x, st.z];
    const out = evening.step(dt, { hour: hourNow(), sunDeg: core.sun?.elevationDeg ?? 0, x: st.x, z: st.z, sog: sogSeen });
    // the clock: held at the evening's rate (re-anchored only on a change of over 1 %), then handed back to the day clock
    // the evening's rates are game s per REAL s (the show's clock: show s = game s / 4, so 4 is real time); the clock's are per scene
    // second, and Sail's scene runs at its game speed (2x), which made the show and its lapse twice as fast in Sail (owner, 2026-11-09)
    if (out.rate != null) {
      const rate = perScene(out.rate, services.get('controls')?.timeScale ?? 1);
      if (lastRate == null || Math.abs(rate - lastRate) > 0.01 * lastRate) { core.clock?.setRate(rate, core.time); lastRate = rate; }
      controlling = true;
    } else if (controlling) {
      const o = services.get('modeOptions') ?? {};
      if (o.timeSchedule) core.clock?.setSchedule(o.timeSchedule, core.time); else core.clock?.setRate(o.timeRate ?? 0, core.time);
      controlling = false; lastRate = null;
    }
    // the skipper's lines: the subtitle (controlsHint note), never a pop-up
    const hint = services.get('hint');
    for (const text of out.lines) { lines.push({ text, hour: +hourNow().toFixed(3) }); hint?.note?.(text, '', null); }
    // the chart's mark at the viewing spot, from the afternoon hint until the show ends
    // the 'chart' service publishes the chartplotter as .chart (src/sail/chart.js); S3 called the service itself, which has no
    // setDestination: the throw stopped this frame system (and the systems after it) on live pages from 20:15
    const chart = services.get('chart')?.chart;
    // (realism round: one viewing spot for Sail and Cruise, stage.js VIEW, Cruise's anchorage inside the mouth)
    const wantMark = hourNow() >= 20.25 && out.phase !== 'after';
    const spot = VIEW;
    if (chart && wantMark !== marked) { chart.setDestination(wantMark ? { x: spot[0], z: spot[1], name: MARK.name, label: MARK.label } : null); marked = wantMark; }
    syncShow();
    // the logbook's moment: the finale seen (src/sail/logbook.js reads consumeMoment)
    if (!momentSaid && showT > 250 && showT < SHOW_LENGTH) { momentPending = true; momentSaid = true; }
    return out;
  }
  // one frame (a system in the core's 'scene' phase): the evening (live), the camera, the lights
  function frame() {
    const dt = Math.min(0.1, Math.max(0, (core.time ?? 0) - (lastTime ?? 0))); lastTime = core.time;
    if (live) tick(dt);
    frameShow(dt || (core.headless ? 1e3 : 0));   // a still capture (its clock frozen) is framed at once; a film (its clock running) eases in
    poseCam();
    if (core.headless && !poseCam.active && player?.follow && player.phys && bias > 0.001 && modeNow() !== 'cruise') {   // a capture: the follow camera's own show framing (Cruise: its own shots, src/fireworks/shots.js)
      const p = player.follow.update(1 / 60, player.phys.state); camera.position.set(...p.pos); camera.lookAt(...p.target);
      if (p.fov) { camera.fov = p.fov; camera.updateProjectionMatrix(); }
    }
    lightAll(dt);
    // the sound follows the show clock (inside its window) and the camera; the music the hour
    const inShow = showT > -600 && showT < SHOW_LENGTH + 120;
    sound.update(inShow ? showT : null, listenerNow(), dt || 1 / 60);
    const h = hourNow();
    music.update({ showT: inShow ? showT : null, hour: h }); music.prefetch(h);
  }
  const api = {
    fw, far, props, crowd, solids, presence, get present() { return presenceOut; }, blocked: (x, z) => blocked(solids.bodies, x, z), dispose: () => offPost?.(), barges: BARGES, frame, evening, lines, sound, music, listenerNow, farStage: fs,
    get showTime() { return showT; },
    // what the evening shows and the day hides (the barges and their lights, the spectators, the stars and the smoke, the
    // boat's anchor light and nav lights, the towns' night lights): refactor round 2 B4, src/sail/showNow.js warms them on the tap
    warmRoots: () => [props.group, crowd?.group, fw.group, far?.group, player?.group, core.scene?.getObjectByName?.('towns')].filter(Boolean),
    seek: (t) => seekAll(t),
    step: (dt) => { showT += dt; fw.step(dt); far?.step(dt); lightAll(dt); },
    // a film of the evening: the scene clock forward by dt, then the evening's step (the clock, the lines, the show)
    drive: (dt) => {
      // a capture's clock is frozen (rate 0): the film runs the mode's own day clock from its first step
      if (!driving) {
        driving = true;
        if (!(core.clock?.rate > 0)) { const o = services.get('modeOptions') ?? {}; if (o.timeSchedule) core.clock?.setSchedule(o.timeSchedule, core.time); else core.clock?.setRate(o.timeRate || 12, core.time); }
      }
      core.setTime((core.time ?? 0) + dt);
      return tick(dt);
    },
    consumeMoment() { const v = momentPending; momentPending = false; return v; },
    // the Cruise button (src/modes/chill/index.js): this evening's lapse waits only for the boat settled at a spot
    invite: () => evening.invite(),
    get phase() { return evening.state.phase; },
    share,
    stats: () => ({ showT, hour: +hourNow().toFixed(4), phase: evening.state.phase, ...fw.stats(), far: far?.stats() ?? null }),
  };
  services.provide?.('fireworks', api);
  lightAll(0);
  return api;
}
