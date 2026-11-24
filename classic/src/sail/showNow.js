// Fireworks in one tap (owner, 2026-11-09: "in the sail mode I need to wait forever to the night to see the fireworks"; reach
// first): the clock menu's Fireworks row (no separate bar button: owner). From anywhere on the lake, at any hour: a short fade, then
// the clock on the first minute of the build (show s SHOW_AT, the sky already full), the boat at the close viewing spot (CRUISE_SPOT,
// about 250 m from the barges, src/fireworks/share.js: the one place the wow round and Cruise's trip use) facing the show, the sails
// down, the engine off and the anchor going down so she sits still. The evening is invited, so the show runs on its own clock
// (src/fireworks/evening.js). The boat is never moved back: a second pick, while the show runs, casts off (the anchor up, the sails up)
// and she keeps sailing from there, at night; the show goes on behind her until its end.
//   const sn = createShowNow({ core, phys, follow, sea, services, simT, interp, ground });
//   sn.go()      the pick: the fade, the jump, the show; while it runs, the cast-off
//   sn.update(dt)   once a frame (the fade, the camera's hold on the show)
//   sn.lit       the show is on
import { CRUISE_SPOT, SHARE_HEADING, shareSearch } from '../../../src/fireworks/share.js';
import { SHOW_START_HOUR } from '../../../src/fireworks/show.js';
import { hourJump } from '../../../src/ui/timeMenu.js';
import { showShot } from '../fireworks/shots.js';

export const SHOW_NOW = {
  showAt: 45,        // show s the clock lands on: inside the build (30 to 140 s: the pace and the variety rise), the sky is full at once
  pitchAdd: 3,       // deg up on the wow round's shots: the 10 to 12 inch shells' tops sit inside the frame with the water still in it
  portraitPitchAdd: 4,
  portraitFov: 110,  // the show camera's vertical field on an upright phone (84 deg on a wide screen: the bursts would be cut at the sides)
  graceS: 0.6,       // the frames after the jump in which the show's clock is still arriving: the follow view until it does
  outS: 0.4,         // the fade to navy, s of frame time
  inS: 1.0,          // and back
  showRate: 4,       // game s per real s in the show (evening.js showRate): show s = game s / 4
};
export const showNowHour = (showAt = SHOW_NOW.showAt) => SHOW_START_HOUR + showAt * SHOW_NOW.showRate / 3600;

export function createShowNow({ core, phys, follow, sea, services, simT = () => 0, interp = null, ground = null, doc = globalThis.document, G = SHOW_NOW } = {}) {
  const veil = doc.createElement('div');
  veil.style.cssText = 'position:fixed;inset:0;background:rgb(28 35 64);opacity:0;pointer-events:none;z-index:9;transition:opacity .4s cubic-bezier(.4,0,.6,1)';
  doc.body.appendChild(veil);
  let phase = 'idle', t = 0, chaseWas = null, camOn = false, grace = 0, foldWas = null, warmed = false;
  // refactor round 2 B4: the show's hidden objects (the barges, the spectators, the night lights: fireworks world.js warmRoots)
  // had no pipelines; the first bursts built 35 in one frame and more after (about 1.7 s of stalls in the show's first 3 s).
  // The tap starts their warm-up in play (core.warm, frame-safe, between frames) as the fade begins; once per page. Nothing
  // waits for it: what is not built by the first burst builds in its draw, as before. The picture is unchanged.
  const warmShow = () => {
    if (warmed || typeof core?.warm !== 'function') return null;
    const roots = fw()?.warmRoots?.() ?? [];
    if (!roots.length) return null;
    warmed = true;
    return Promise.resolve(core.warm(roots, { live: true })).catch(() => null);
  };
  // look round 2 (owner: the "Anchor going down" line sat on the bursts): while the show's camera holds, the subtitle line (statuses,
  // hints, the skipper) is off the screen (the class on <html>; src/ui/controlsHint.js fades .lk-hint); it returns with the player's view
  const quiet = (on) => doc.documentElement?.classList?.toggle('lk-showcam', on);
  const fw = () => services.get('fireworks');
  const running = () => { const p = fw()?.phase; return p === 'lapse' || p === 'show'; };

  function perform() {
    const f = fw(), s = phys.state, tk = sea.tackle;
    const hdg = SHARE_HEADING * Math.PI / 180;
    // the boat: on the spot, stopped, facing the show; a held anchor or a mooring let go first
    if (tk.mode !== 'free') { Object.assign(tk.state.anchor, { phase: 'stowed', out: 0 }); tk.state.mode = 'free'; }
    Object.assign(s, { x: CRUISE_SPOT[0], z: CRUISE_SPOT[1], heading: hdg, cog: hdg, u: 0, v: 0, sog: 0, yawRate: 0, heel: 0, pitch: 0, heave: 0 });
    phys.p = 0; phys.acc = 0;
    interp?.mark?.(s);
    ground?.reset?.();
    follow.c = [s.x, 0, s.z]; follow.cv = [0, 0, 0]; follow.yaw = hdg;
    // the show's own camera (the wow round's: low and close astern of the boat, the bursts overhead, the water's colours between),
    // the cockpit folded away for its length (not remembered: the fold is put back when the camera ends)
    camOn = true; grace = G.graceS; quiet(true);
    const calm = services.get('calm')?.clock;
    if (calm && foldWas == null) { foldWas = !!calm.fold; calm.setFold(true); }
    // the sails down, the engine off
    if ((sea.furlWant ?? 0) < 0.5) sea.actions.sails();
    phys.furlPos = 1;
    if (phys.engine?.on) sea.actions.engine();
    // the clock to the show, the evening on
    core.clock.setHour(hourJump(core.clock.hourAt(simT()), showNowHour()), simT());
    f.invite();
    // the anchor, so she sits still (nothing happens if the water is not 3 to 20 m: she drifts, sails down)
    sea.actions.anchor();
  }
  function endCam() {
    camOn = false; quiet(false);
    const calm = services.get('calm')?.clock;
    if (calm && foldWas != null) { calm.setFold(foldWas); }
    foldWas = null;
  }
  function castOff() {
    const tk = sea.tackle;
    if (tk.mode === 'anchor') sea.actions.anchor();   // weigh
    if ((sea.furlWant ?? 1) > 0.5) sea.actions.sails();   // sails up
  }

  return {
    get lit() { return running(); },
    get busy() { return phase !== 'idle'; },
    get cam() { return camOn; },
    get warmed() { return warmed; },   // the show's warm-up has started (B4)
    go() {
      if (phase !== 'idle') return 'busy';
      if (!fw()) { if (typeof location !== 'undefined') location.search = shareSearch(location.search); return 'share'; }   // no show on this page (another day): Cruise's share link
      if (running()) { castOff(); return 'cast-off'; }
      phase = 'out'; t = 0; veil.style.transition = `opacity ${G.outS}s cubic-bezier(.4,0,.6,1)`; veil.style.opacity = '1';
      warmShow();
      return 'show';
    },
    // The show's pose for this frame, or null (the follow camera): every shot is the boat's, framed from the boat's place and the
    // show's bearing, so it never turns with her on her anchor. The player's own look, zoom or a change of view ends it at once.
    camera({ x, z, heightAt = null, interrupt = false, aspect = 1.78 } = {}) {
      if (!camOn) return null;
      const p = interrupt ? null : showShot(fw()?.showTime, { boat: { x, z }, heightAt, boatOnly: true, pitchAdd: aspect < 1 ? G.portraitPitchAdd : G.pitchAdd });
      if (!p) { if (!interrupt && grace > 0) return null; endCam(); return null; }
      if (aspect < 1) p.fov = G.portraitFov;
      return p;
    },
    update(dt) {
      if (grace > 0) grace -= dt;
      if (phase === 'out') { t += dt; if (t >= G.outS) { perform(); phase = 'in'; t = 0; veil.style.transition = `opacity ${G.inS}s cubic-bezier(.4,0,.6,1)`; veil.style.opacity = '0'; } }
      else if (phase === 'in') { t += dt; if (t >= G.inS) phase = 'idle'; }
      // the camera holds its bearing on the show while it runs (the anchored boat swings to the wind; the view does not follow it away)
      sea.arrivalOff = running();
      if (running()) { if (chaseWas == null) { chaseWas = follow.chase; follow.chase = false; } }
      else if (chaseWas != null) { follow.chase = chaseWas; chaseWas = null; if (camOn) endCam(); }
    },
    dispose() { quiet(false); veil.remove(); },
  };
}
