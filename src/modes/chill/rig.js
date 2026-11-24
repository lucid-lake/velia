// Cruise's camera rig (owner, 2026-10-30): the five views of cameras.js on one boat, one pose per frame.
//   const rig = createCameraRig({ terrain, follow, view, solid });           // solid: crownSolid() (src/forest/crowns.js), or later rig.setSolid(it)
//   const fp = rig.followStep(dt, state, { look, zoom });                 // the follow camera (the astern view, the director's follow shot)
//   const dp = director.update(dt, { …, follow: fp });
//   const pose = rig.pose(dt, { ride, state, fp, dp, look, zoom });       // the camera for this frame, a 1 s eased move after a switch
// `look` is this frame's drag [dx, dy] rad or null, `zoom` its wheel / pinch factor (1 = none). rig.set('helm') starts the move.
// Plain JS (no three.js, no DOM): tests/passenger.test.mjs drives it headless.
import { HelmCamera } from '../../sim/boat/helmCamera.js';
import { NIGHT_CAMERAS, CameraMove, LookOffset, IslandCam, AboveCam, MOVE_S, GLIDE, starsPose } from './cameras.js';

const withNear = (p, near = 0.5) => (p.near == null ? { ...p, near } : p);

// sky: () => the band's aim ({ dir, altDeg }) or null (src/core/milkyway.js aim()): the stars camera's direction
// helm: the craft's helm camera settings (craft.cameras(vessel).helm: its eye), the defaults when absent
export function createCameraRig({ terrain, follow, view = 'cinematic', solid = null, sky = () => null, helm = {} } = {}) {
  const helmCam = new HelmCamera(helm);
  const offs = { cinematic: new LookOffset(), island: new LookOffset(), stars: new LookOffset() };
  const island = new IslandCam({ ground: terrain.heightAt, shore: terrain.shoreDistance, solid: solid?.at ?? terrain.heightAt, open: solid?.open ?? null });
  const above = new AboveCam({ solid: solid?.at ?? terrain.heightAt });
  const move = new CameraMove();
  let cur = NIGHT_CAMERAS.includes(view) ? view : 'cinematic', last = null, switches = 0, islandHad = null, via = null, starsAim = null;

  const api = {
    helmCam, above, island, move, offs,
    // the forest arrives after the page starts (src/forest/crowns.js): the shore and the Above cameras see the crowns from then
    setSolid(sol) { island.setSolid(sol.at, sol.open); above.solid = sol.at; },
    get view() { return cur; }, get last() { return last; }, get switches() { return switches; },
    // switch to v; instant: no move (the first frame, a capture); returns the view now
    set(v, { instant = false } = {}) {
      if (!NIGHT_CAMERAS.includes(v) || v === cur) return cur;
      if (v === 'stars') starsAim = sky();   // the band's place when the camera is chosen: held, so the shot does not wander
      if (v === 'helm') helmCam.reset();
      if (v === 'above') above.yaw = 0;   // the map comes back north-up (or course-up) square; its height and orientation are kept
      offs.cinematic.reset(); offs.island.reset(); offs.stars.reset();
      if (instant || !last) move.begin(null); else move.begin(last, MOVE_S);
      if (v === 'island') island.invalidate();
      islandHad = null; via = null; island.justCut = false;
      cur = v; switches++;
      return cur;
    },
    followStep(dt, s, { look = null, zoom = 1 } = {}) {
      return follow.update(dt, s, cur === 'astern' ? { orbit: look, zoom } : {});
    },
    pose(dt, { ride, state: s, fp, dp, look = null, zoom = 1 }) {
      const mine = (v) => (cur === v ? { look, zoom } : {});
      // the cameras that carry state run every frame, so a move to one lands on a settled pose
      const helmP = helmCam.update(dt, ride, mine('helm')), aboveP = above.update(dt, s, mine('above'));
      offs.cinematic.update(dt, mine('cinematic')); offs.island.update(dt, mine('island')); offs.stars.update(dt, mine('stars'));
      let live;
      if (cur === 'astern') live = withNear(fp);
      else if (cur === 'helm') live = helmP;
      else if (cur === 'above') live = aboveP;
      else if (cur === 'stars') { starsAim ??= sky(); live = starsAim ? offs.stars.apply(starsPose(s, starsAim)) : withNear(fp); }
      else if (cur === 'island') {
        island.update(dt, s);
        const ip = island.pose(s);
        live = ip ? offs.island.apply(ip) : withNear(fp);
        // a vantage the eye cannot fly to (terrain all the way): ease back to the Boat view over 2 s, then out to the new one over 2 s
        if (island.justCut) { island.justCut = false; if (last) { via = 0; move.begin(last, GLIDE.minS); } }
        if (via === 0) { if (move.moving) live = withNear(fp); else { via = null; move.begin(last, GLIDE.minS); } }   // no shore in reach: the boat's own view
        // the first shore found (or the last one lost) is a 2 s ease between the boat's view and the shore's, never a hop
        if (islandHad !== null && islandHad !== !!ip && last) move.begin(last, GLIDE.minS);
        islandHad = !!ip;
      } else live = offs.cinematic.apply(withNear(dp));
      move.step(dt);
      last = withNear(move.pose(live));
      return last;
    },
  };
  return api;
}
