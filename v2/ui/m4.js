// M4's plug-in for v2/main.js: the cockpit's GPU side (declared with the other pipelines, before the first frame), the views
// (follow | helm, also for a headless ?view=helm capture), and on a live page Sail's UI (v2/ui/sail.js) with the cockpit's rig,
// and the front door's live half (v2/ui/front.js: v1's home card; v2 has no staged first minute, owner 2026-11-13).
// main.js calls it in a few marked blocks:
//   const m4 = createM4({ device, reg, … });             before reg.buildAll() (the cockpit's pipelines)
//   m4.attach({ B, windField, clock, terrain, canvas })  once the boat exists (live: the UI and the front door; headless: the views only)
//   m4.beforeStep(dt, hands) / m4.afterStep(dt)             around the boat's step (the station's hands; the station draws)
//   m4.camera(dt, followPose) → pose                     the views' camera chain (pos, target, up, fov, near)
//   m4.fill({ w, h, sun })                               the cockpit's uniforms for this frame
//   m4.drawOpaque(pass, c) first in the scene pass, m4.drawBlend(pass, c) last
//   m4.takeLook(hands)                                   main.js readHands: the drag goes to the binoculars while they are up
//   m4.afterFrame(canvas)                                after the frame is submitted (the logbook grabs a find's picture in
//                                                        the render's own task: the WebGPU canvas is readable only there)
import { createViews } from './views.js';
import { parseV2Flags } from '../engine/flags.js';
import { feature } from '../../src/core/features.js';   // the Tessie RPG's page: only where she is playable
import { exposureFactor } from '../sim/exposure.js';


// ?bino=1: the binoculars raised from the start; ?bino=228.4,1: raised and aimed at that bearing and pitch (degrees); ?bino=0: down
// (a ?filmui=1 page builds them only when the row is there: the golden v2-binoculars, tools/v2-captain-film.mjs)
export const binoFlag = (v) => { if (v == null || v === '' || v === '0') return false; const a = String(v).split(',').map(parseFloat); return a.length === 2 && a.every(Number.isFinite) ? a : true; };

export function createM4({ flags, P, errors = [], cockpit = null }) {
  let views = null, ui = null, rig = cockpit?.rig ?? null, B = null, front = null, log = null, first = null, lastPose = null, lastSun = null, aspect = 16 / 9, captain = null;
  const live = !P.headless;
  const frames = [];   // onAfterFrame's callbacks
  let failed = 0, uiReady = Promise.resolve(null), frontReady = Promise.resolve(null), logReady = Promise.resolve(null), captainReady = Promise.resolve(null), chartWanted = false;
  const fail = (e) => { if (failed++ < 3) { errors.push(`m4 ui: ${e?.stack ?? e}`); console.error(e); } };
  const chain = (dt, follow) => { const p = views ? views.pose(dt, follow, B.pose, B.helmLook) : follow; return B?.sea ? B.sea.camera(dt, p) : p; };   // #8: the anchoring's arrival (v1's wide shot) over the views
  const INTRO_HOLD = { state: 'intro' };   // not 'gone': the first-sail guide's quiet waits
  const m4 = {
    cinema: null,   // the cinematic intro (ui/cinematicIntro.js; main.js sets it)
    get ui() { return ui; }, get uiReady() { return uiReady; }, get captain() { return captain; }, get captainReady() { return captainReady; }, get logbook() { return log; }, get firstSail() { return first; }, get logReady() { return logReady; }, get front() { return front; }, get frontReady() { return frontReady; },
    mountChart({ plan = true } = {}) { chartWanted = true; const c = ui?.mountChart(); return plan ? c?.planReady ?? null : null; },   // plan false (a live page): the planner waits for the chart's first opening
    get views() { return views; }, get rig() { return rig; }, cockpit,   // mountChart → the passage plan's chunk and chart (a film waits for it)
    // M5e: sun() the frame's sun elevation (the theme), weather the Weather menu's state (the top bar's menu and Setup's row)
    attach({ B: b, windField, clock, terrain, canvas, exposure = () => 1, sun = () => 20, weather = null, audio = null, day = {}, music = null, quality = null, modes = null, world = {} }) {   // music: v2/audio/music.js; quality: main.js's Setup pin; modes: the page's mode switch (v2/cruise via main.js: { current, go(id) })   // day: the day clock's page facts (v2/ui/dayClock.js)
      B = b;
      views = createViews({ vessel: B.vessel, view: flags.view === 'helm' ? 'helm' : 'follow', followYaw: () => B.follow.yaw });
      B.viewOf = () => views.view;   // the hands' look goes to the camera that is the view (v2/sim/boat.js camera())
      B.onKdCut = () => views.cut('follow');   // K2: knocked down past 45°, the Helm view cuts to the Boat view (v2/sim/knockdownFx.js)
      if (!live) return m4;
      // the settings store and the front door (the home card and its welcome): their own chunk, fetched beside Sail's UI
      // so the card never waits for it; a page with no loading card (?noload) still gets the card as the in-play menu, as v1's
      const settingsP = import('./settingsStore.js').then((m) => m.pageSettings());
      const frontOn = typeof document !== 'undefined' && !!document.getElementById('lk-load') && parseV2Flags(location.search).menu !== false;   // ?menu=0: no shell (v1's row)
      if (frontOn) frontReady = Promise.all([import('./front.js'), settingsP]).then(([{ installFront }, settings]) => {
        front = installFront({ settings, B, windField, clock, views, weather, music, quality, modes });   // M5e: the Weather menu; Setup's rows (v2/ui/setup.js); Cruise: the card's modes
        if (ui) front?.wire(ui);
        return front;
      }).catch((e) => { errors.push(`front door: ${e?.stack ?? e}`); console.error(e); return null; });
      // the UI is its own chunk (v1's DOM modules, ≈ 118 kB gzip): loaded beside the first frame, never in its way
      uiReady = Promise.all([import('./sail.js'), settingsP]).then(([{ createSailUi }, settings]) => {
        ui = createSailUi({ B, windField, clock, cockpit, terrain, canvas, views, exposure, settings, sun, weather, day, music, world });   // world: the chart's kayakers, the practice marks' props (main.js)
        document.body.classList.add('m4ui');   // Sail's UI is up: no dev label (index.html #label; a comment had swallowed this call since b3b3415d, so the label sat behind the top bar on a noload page)
        if (chartWanted) ui.mountChart();
        front?.wire(ui);
        return ui;
      }).catch((e) => { errors.push(`m4 ui: ${e?.stack ?? e}`); console.error(e); return null; });
      // the logbook (v1's src/sail/logbook.js on v2: ui/logbook.js): its own chunk once Sail's UI is up; the card's LOG and the
      // Menu's LOG open it (front.js), L toggles it (its own key, as v1's). Not on a ?filmui=1 page (the goldens' hud frames, v1's
      // rule that captures never build it): its chunk landing mid-film moved the boat's readback timing (v2-hud-calm 0.29 %)
      logReady = uiReady.then((u) => (u && flags.filmui !== true ? import('./logbook.js') : null)).then((m) => {
        if (!m) return null;
        log = m.createV2Logbook({ ui, B, terrain, clock, windField, tessieRpg: flags.tessierpg === true && feature('playTessie').on, view: () => (lastPose ? { pos: lastPose.pos, target: lastPose.target, fov: lastPose.fov, aspect } : null), sun: () => lastSun });
        front?.home?.paint?.();   // LOG lit on the card
        return log;
      }).catch((e) => { errors.push(`logbook: ${e?.stack ?? e}`); console.error(e); return null; });
      // the first sail's lines and the island goal (#4: ui/firstSail.js, v1's src/ui/firstSailGuide.js): once Sail's UI and the
      // settings are in; not on a ?filmui=1 film (the goldens' hud frames: v1's captures never build it)
      if (flags.filmui !== true) Promise.all([uiReady, settingsP, import('./firstSail.js')]).then(([u, settings, { mountFirstSail }]) => {
        if (u) first = mountFirstSail({ ui: u, settings, menu: () => (m4.cinema?.playing ? INTRO_HOLD : front?.home ?? (frontOn ? { state: 'loading' } : null)), modes });   // the cinematic intro: the first line waits for its end (ui/cinematicIntro.js)   // the card not in yet: not quiet
      }).catch((e) => { errors.push(`first sail: ${e?.stack ?? e}`); console.error(e); });
      // the binoculars and the VHF (#5, #6: ui/captain.js, v1's captainTools on v2): their own chunk once Sail's UI is up (the
      // radio's clips only after that, and only while it is on). Not on a ?filmui=1 page unless ?bino=1 (the golden v2-binoculars):
      // the hud goldens stay as they were
      if (flags.filmui !== true || flags.bino != null) captainReady = uiReady.then((u) => (u ? Promise.all([import('./captain.js'), settingsP]) : null)).then((r) => {
        if (!r) return null;
        const [{ createCaptain }, settings] = r;
        captain = createCaptain({ B, windField, terrain, settings, audio, services: ui.services, hint: ui.hint, dial: ui.captain, canvas, bino: binoFlag(flags.bino),
          base: new URL('audio/vhf/', document.baseURI).href, auto: flags.filmui !== true });
        return captain;
      }).catch((e) => { errors.push(`captain: ${e?.stack ?? e}`); console.error(e); return null; });
      return m4;
    },
    // the UI never stops the frame: an error is kept once in __velia.errors and the UI steps aside
    beforeStep(dt, hands = null) { if (ui) try { ui.update(dt, hands); } catch (e) { fail(e); } if (log) try { log.update(); } catch (e) { fail(e); } if (first) try { first.update(); } catch (e) { fail(e); } if (captain) try { captain.update(dt); } catch (e) { fail(e); } },
    takeLook(hands) { if (captain) captain.takeLook(hands); return hands; },
    afterFrame(canvas) { if (log) try { log.afterFrame(canvas); } catch (e) { fail(e); } if (frames.length) for (const fn of frames.splice(0)) try { fn(canvas); } catch (e) { fail(e); } },
    onAfterFrame(fn) { frames.push(fn); },   // Cruise's Photo (src/ui/photo.js takePhoto's afterFrame): fn(canvas) after the next frame
    // Cruise's camera (v2/cruise: the rig's pose in place of the views'): the binoculars over it, as over the views
    overlay(dt, p) { return (lastPose = captain ? captain.camera(dt, p, lastSun) : p); },
    afterStep(dt, hands) { if (ui) try { ui.after(dt, hands); } catch (e) { fail(e); } },
    camera(dt, follow) { const p = chain(dt, follow); return (lastPose = captain ? captain.camera(dt, p, lastSun) : p); },   // #5: the binoculars over the views
    fill(o) { lastSun = o.sun; if (o.w && o.h) aspect = o.w / o.h; cockpit?.fill(o); },
    drawOpaque(pass, c) { cockpit?.drawOpaque(pass, c); },
    drawBlend(pass, c) { cockpit?.drawBlend(pass, c); },
    exposureFactor,
    phoneCockpit: () => typeof document !== 'undefined' && document.documentElement.classList.contains('lk-phone-l') && document.documentElement.classList.contains('lk-cockpit'),
  };
  return m4;
}
