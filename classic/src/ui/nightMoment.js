// The night moment (owner, 2026-11-07, on the Milky Way over the dark ridge: "This view is stunning. How can we make users
// see it?"): on the first clear, dark night of a session the follow camera glides down and tilts up to the band over the
// ridge (≈ 3 s), holds a composed sky with the boat low in the frame (8 s), then eases back. R. says it once: "Look up."
// Any input ends it at once (the first stage's director: a 0.35 s ease back). Once a session; ?nightmoment=0 turns it off.
// It waits for the staged first visit (its hush and its moments), the menu, the helm view, the binoculars and the logbook;
// the line waits for a free subtitle line (the find line's queue, src/sail/findLine.js), else the camera goes alone.
//   const nm = attachNightMoment({ services, menu, enabled }); each frame: nm.update(); nm.force() starts it (films, probes)
import { createDirector } from './firstStage.js';

// the helm's urgent lines (src/ui/controlsHint.js): the sails shaking or stalled, in irons, a tack, mid-tack. While one is up
// R.'s notes wait (controlsHint holds them), so the moment waits for a calm helm too (round 5: "Look up." was never seen)
export const URGENT = new Set(['pull', 'ease', 'irons', 'tack', 'keep']);
export const NIGHT_MOMENT = {
  inS: 3, holdS: 8, outS: 2.5,   // the glide down and up, the hold, the ease back (s)
  waitS: 6,                      // the night must hold this long (s of real time) before it starts: never mid-time-lapse
  minLevel: 0.8,                 // the band's level (src/core/milkyway.js state.level: the sun's fade × the moon's dimming)
  maxCoverage: 0.6,              // the main cloud deck's coverage at most (the fair-weather deck; a storm never)
  backM: 26, eyeM: 3.0,          // the camera: this far from the boat, on the side away from the band, this high
  fov: 55, liftDeg: 12, minPitchDeg: 8, maxPitchDeg: 30,   // the view: the band this far over the centre, the boat low
  line: 'Look up.',
};

// The pose: from behind the boat (away from the band's bearing), low, looking along the bearing and tilted up so the band
// stands over the ridge with the boat low in the frame. s: the boat's state { x, z }; aim: { dir: [x, y, z], altDeg }.
export function nightPose(s, aim, N = NIGHT_MOMENT) {
  const h = Math.hypot(aim.dir[0], aim.dir[2]) || 1, hx = aim.dir[0] / h, hz = aim.dir[2] / h;
  const pitch = Math.min(N.maxPitchDeg, Math.max(N.minPitchDeg, aim.altDeg - N.liftDeg)) * Math.PI / 180;
  const pos = [s.x - hx * N.backM, N.eyeM, s.z - hz * N.backM];
  const c = Math.cos(pitch);
  return { pos, target: [pos[0] + hx * c * 60, pos[1] + Math.sin(pitch) * 60, pos[2] + hz * c * 60], fov: N.fov };
}

// may it start now? (pure: tests/nightMoment.test.mjs)
export function nightReady(o, N = NIGHT_MOMENT) {
  return !!(o.enabled && !o.done && o.dark && o.aim && (o.coverage ?? 0) <= N.maxCoverage && !o.storm
    && o.view === 'follow' && !o.bino && !o.logbook && o.menuGone && !o.stageBusy && !o.introOn && !o.urgent);
}

export function attachNightMoment({ services, menu = null, enabled = true, N = NIGHT_MOMENT }) {
  const core = () => services.get('core');
  const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const director = createDirector({ intro: null, reduced, done: () => true });
  const S = { done: false, playing: false, heldS: 0, aim: null, startedAt: null, said: false, log: [] };
  let lastNow = null;
  const state = () => {
    const c = core(), mw = c?.milkyway, ctl = services.get('controls');
    const stage = services.get('firstStage');
    const deck = c?.clouds?.layers?.at?.(-1);
    return {
      enabled, done: S.done, dark: !!mw?.dark?.(N.minLevel), aim: mw?.aim?.() ?? null,
      coverage: deck?.coverage?.value ?? 0, storm: !!c?.storm?.running,
      view: ctl?.view ?? null, bino: !!(ctl?.tools?.k > 0), logbook: !!services.get('logbook')?.logbook?.isOpen,
      menuGone: !menu || menu.state === 'gone', stageBusy: !!stage && !stage.stage?.state?.done, introOn: !!ctl?.introOn,
      urgent: URGENT.has(ctl?.hint?.current),
    };
  };
  function start(aim) {
    const ctl = services.get('controls'); if (!ctl?.setIntro) return false;
    S.aim = aim; S.done = true; S.playing = true; S.startedAt = performance.now(); S.log.push(['start', +aim.altDeg.toFixed(1), +aim.azDeg.toFixed(0)]);
    director.play('night', { inS: N.inS, holdS: N.holdS, outS: N.outS }, (f, s) => nightPose(s, S.aim, N));
    ctl.setIntro((dt, f, s, o) => { const p = director.update(dt, f, s, o); if (p === null) { S.playing = false; S.log.push(['end']); } return p; });
    sayLine();
    return true;
  }
  // R.'s line, once: a note of R.'s, so it takes the line from a status (a luff's "Sails shaking" would hold it all night),
  // never from another of R.'s notes (it waits for that, up to the glide's end)
  function sayLine() {
    if (S.said || !S.playing || performance.now() - S.startedAt > (N.inS + N.holdS - 3) * 1000) return;
    const hint = services.get('controls')?.hint;
    if (hint?.note && hint.current !== 'note' && !URGENT.has(hint.current)) S.said = hint.note(N.line, '', null);
  }
  // any input hands the camera back at once (steering, trim, a drag, a tap)
  const hand = () => { if (S.playing) { director.cancel(); S.log.push(['cancel']); } };
  for (const k of ['keydown', 'pointerdown', 'wheel', 'touchstart']) globalThis.addEventListener?.(k, hand, { capture: true, passive: true });
  function update() {
    const now = performance.now(), dt = lastNow == null ? 0 : Math.min(0.25, (now - lastNow) / 1000); lastNow = now;
    if (S.done) { sayLine(); return; }
    const st = state();
    S.heldS = nightReady(st, N) ? S.heldS + dt : 0;
    if (S.heldS >= N.waitS) start(st.aim);
  }
  // force(): start now if the band is up and the view is the follow camera (films, probes)
  const force = () => { if (S.playing) return true; const st = state(); return st.aim && st.view === 'follow' ? start(st.aim) : false; };
  return { update, force, state: S, ready: () => nightReady(state(), N) };
}
