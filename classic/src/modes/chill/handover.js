// Cruise's hand-over (refactor round 2, Phase C step 11: the third of start's three parts; src/modes/chill/index.js
// composes them): "take the helm" attaches Sail's controls in place on the same boat, clock and camera, with the skipper's
// trim (takeHelm); the ` key hands the boat back to the skipper (handBack, the shell's quickSwitch); while Sail's controls
// run, update(dt, dtRaw) drives them and eases the camera from the pose it was on. Moved from start in the same order.
//   const H = createHandover(core, v, cx, P, { coreOptions, kayaks });   // P: createPassenger's (passenger.js); kayaks: () → the fleet
//   → { takeHelm(o), handBack(), update(dt, dtRaw) → true while Sail's controls have the boat }
import * as THREE from 'three/webgpu';
import { DEFAULT_TIMERATE, dayClockSchedule, clockIsFlat } from '../../../../src/sim/timeOfDay.js';
import { handoverTrim } from '../../../../src/sim/ai/skipper.js';
import { sailCoreOptions } from '../../sail/options.js';
import { NOTES } from '../../../../src/ui/skipper.js';
import { setModeInPlace } from '../inPlace.js';
import { chillClock } from '../../../../src/sim/modes/chill/params.js';
import { WEATHER } from '../../../../src/sim/weather/weatherMenu.js';

export function createHandover(core, { sail, phys, nav, rig, ctl, pilot, trip, tackle, sim }, cx, { sched, makeMusic, down, helmPick, canvas, mods, mountPassenger, mountTools, unmountTools }, { coreOptions, kayaks = () => null }) {
  const { flags, camera, services } = core;
  // ---- the hand-over: Sail's controls take over in place --------------------------------------------------------
  // The skipper's pro trim stays as it is, the helm holds the heading the boat is on, the camera stays where it is (the
  // astern and helm views are Sail's own; the others ease into the boat view over 1 s), Sail's hints, dial and switch fade
  // in over 0.6 s, R. says it, and the shell is told with no veil (the 'setMode' service). The input that did it reaches the controls.
  const HANDOVER = { fadeS: 0.6, easeS: 1.0, easeSameS: 0.35 };
  async function takeHelm({ key = null, press = null } = {}) {   // key: the keydown; press: the pointerdown on the wheel or a winch; neither: the button or the pad
    if (cx.handed || cx.leaving) return;
    cx.leaving = true;
    const wasView = rig.view;
    const [{ attachControls }, { attachLogbook }, { attachChart }] = await mods();
    cx.handed = true; cx.leaving = false;
    if (core.sky) core.sky.stormS0 = null;   // the player's helm: Sail's landing second
    cx.tools?.setLatch?.(false);
    const track = unmountTools();
    cx.passenger.view.el.style.pointerEvents = 'none';
    const dead = cx.passenger; cx.passenger = null;
    dead.view.el.classList.add('off'); dead.dock.el.classList.remove('in');   // they fade out (their own transitions)
    dead.off.abort();   // its listeners end now; its bar and dock fade out and go with the hand-over's fade
    nav.clearDestination();
    // the fireworks trip ends with the hand-over: the anchor stowed (Sail's own tackle takes over), the crew's controls let go
    if (trip.active) { trip.cancel(); if (tackle.mode !== 'free') { Object.assign(tackle.state.anchor, { phase: 'stowed', out: 0 }); tackle.state.mode = 'free'; } ctl.throttle = null; ctl.engine = null; }
    cx.line.hide();
    const here = Object.create(core, { T0: { value: cx.simT } });
    if (clockIsFlat(flags) || flags.timerate) core.clock.setRate(DEFAULT_TIMERATE, cx.simT);
    else core.clock.setSchedule(dayClockSchedule({ base: DEFAULT_TIMERATE }), cx.simT);
    const startView = wasView === 'helm' ? 'helm' : 'follow';
    cx.controls = attachControls(here, sail, { handover: pilot ? { ...handoverTrim(pilot.skipper), rudder: ctl.rudder } : null, helmPick, helmCam: rig.helmCam, view: startView });
    cx.logbook = attachLogbook(here, sail, cx.controls, { track });
    cx.chartApi = attachChart(here, sail, cx.controls, cx.logbook, { plan: true });   // a route survives the hand-over: Sail's guidance takes it
    // the camera: from the pose on screen, an eased move into Sail's (the same pose when the view was astern or helm)
    cx.blend = { t: 0, dur: wasView === 'astern' || wasView === 'helm' ? HANDOVER.easeSameS : HANDOVER.easeS, pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
    // the UI: Sail's pieces fade in, the passenger's fade out
    const H = document.documentElement; H.classList.add('lk-handover');
    setTimeout(() => { H.classList.remove('lk-handover'); dead.dispose(); }, HANDOVER.fadeS * 1000 + 150);
    // R.'s line, quiet: text on the plate, and the voice once per browser (skipperVoice.js)
    cx.line.show(NOTES.helm.text.replace(/\{(\w+)\}/g, '$1'), 3200);   // "You have the helm"
    cx.controls.voice?.say?.(NOTES.helm.speak);
    // the input that did it acts in Sail
    if (key && down.has(key.code)) dispatchEvent(new KeyboardEvent('keydown', { code: key.code, key: key.key, shiftKey: key.shiftKey }));
    if (press) canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: press.clientX, clientY: press.clientY, button: 0, buttons: 1, pointerId: press.pointerId, pointerType: 'mouse', isPrimary: true, bubbles: true }));
    cx.music?.finish();
    if (sched) sched.next = core.time + 240;
    setModeInPlace(services, 'sail', sailCoreOptions(flags));   // Sail's options are in force with Sail's controls
    services.provide('quickSwitch', { ...(services.get('quickSwitch') ?? {}), cruise: handBack });
  }

  // ---- and back: "let her sail herself" -----------------------------------------------------------------------------
  async function handBack() {
    if (!cx.handed || !cx.controls) return false;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), q = camera.position;
    const from = { pos: [q.x, q.y, q.z], target: [q.x + fwd.x * 10, q.y + fwd.y * 10, q.z + fwd.z * 10], up: [camera.up.x, camera.up.y, camera.up.z], fov: camera.fov, near: camera.near };
    const view = cx.controls.view === 'helm' ? 'helm' : 'astern';
    cx.simT = cx.controls.simT; sim.t = cx.simT;   // the clock as Sail's controls left it
    // the skipper picks up the trim as the player left it
    if (pilot) {
      const o = pilot.skipper.out, c = cx.controls.ctl;
      Object.assign(o, { sheet: cx.controls.sheet ?? phys.state.mainSheet, traveller: c.traveller ?? 0, twist: c.twist ?? 0, backstay: c.backstay ?? phys.state.backstay ?? 0, jibLead: c.jibLead ?? 0 });
    }
    const track = cx.logbook?.track ? cx.logbook.track.slice() : null;
    cx.logbook?.dispose?.(); cx.chartApi?.dispose?.();
    cx.controls.dispose(); cx.controls = null; cx.logbook = cx.chartApi = null; cx.blend = null;
    cx.handed = false;
    if (core.sky) core.sky.stormS0 = WEATHER.cruiseS0;
    rig.set(view, { instant: true });
    rig.move.begin(from, 0.6);   // the camera on screen eases into the rig's (the same pose for the astern and helm views)
    cx.passenger = mountPassenger();
    const H = document.documentElement; H.classList.add('lk-handover'); setTimeout(() => H.classList.remove('lk-handover'), 800);
    core.clock.setSchedule(chillClock(flags), cx.simT);
    nav.pickNearest(phys.state.x, phys.state.z);
    cx.music = makeMusic(); cx.music?.start();
    if (sched) sched.next = Infinity;
    mountTools(track);
    cx.line.show('She sails herself. Sit back.', 3600);
    delete services.get('quickSwitch')?.cruise;
    setModeInPlace(services, 'cruise', coreOptions(flags));
    return true;
  }

  const eased = (f) => f * f * (3 - 2 * f);
  // one frame while Sail's controls have the boat: they step it; the camera eases from the pose it was on into Sail's, so nothing jumps
  function update(dt, dtRaw) {
    if (!cx.controls) return false;
    cx.controls.update(dtRaw); cx.logbook?.update(); cx.chartApi?.update(dtRaw);
    // the lake's kayakers paddle on, on the wall clock as in Sail (fix/kayaks-mode-switch: they froze at the hand-over, the
    // paddlers mid-stroke and every kayak held at its tier, so one met close stayed the plain mid or far model)
    kayaks()?.update(dt, dt);
    if (cx.blend) {   // the camera eases from the pose it was on into Sail's, so nothing jumps
      cx.blend.t += dt;
      if (cx.blend.t >= cx.blend.dur) cx.blend = null;
      else {
        const e = eased(cx.blend.t / cx.blend.dur);
        const pos = camera.position.clone(), quat = camera.quaternion.clone(), fov = camera.fov;
        camera.position.lerpVectors(cx.blend.pos, pos, e); camera.quaternion.slerpQuaternions(cx.blend.quat, quat, e);
        camera.fov = cx.blend.fov + (fov - cx.blend.fov) * e; camera.updateProjectionMatrix();
      }
    }
    return true;
  }

  return { takeHelm, handBack, update };
}

// Sail's UI fades in over 0.6 s on the hand-over (html.lk-handover for HANDOVER.fadeS + a beat): the hint row, the dial and
// Sail's own view switch; the passenger's pieces fade out by their own transitions.
export function handoverCss() {
  if (document.getElementById('lk-handover-css')) return;
  const st = document.createElement('style'); st.id = 'lk-handover-css';
  st.textContent = `@keyframes lk-ho-in{from{opacity:0}to{opacity:1}}
.lk-handover .lk-hint,.lk-handover .lk-cv,.lk-handover .lk-view:not(.cruisecam){animation:lk-ho-in .6s var(--lk-ease) both}
@media (prefers-reduced-motion:reduce){.lk-handover .lk-hint,.lk-handover .lk-cv,.lk-handover .lk-view:not(.cruisecam){animation:none}}`;
  document.head.appendChild(st);
}
