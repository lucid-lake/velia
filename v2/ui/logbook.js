// Sail's logbook on v2 (fix(v2): LOG, owner 2026-11-13: "click Log button nothing happen"): v1's src/sail/logbook.js
// (attachLogbook) as it is, on a core made of v2's parts. It is three-free, so v1's own code records here what it records on v1:
//   the finds        the places and moments (discoveries.js on the boat's state stream each frame; the first tack, the first
//                    gust, round the island, past sunset, aground …), each with its picture: the frame just drawn, grabbed in
//                    the render's own task (main.js calls m4.afterFrame(canvas) after the frame is submitted) and treated in
//                    v1's worker; the find said in the skipper's line ("First tack — in the logbook", the L as a small cap)
//   today's line     the boat's position and speed every 1.5 s of sim time (the chart page's line, "today · n nm"); kept as
//                    the faint "last sail" on pagehide
//   seamanship       the skill model's mastered skills (the skipper's pencilled margin notes, signed) and the challenges
//   sailor's words   the terms met (ui.words)
// The same store as v1 (localStorage 'lakeshore.logbook.v1', 'lakeshore.challenges.v1'; the skills and words keep theirs), so one
// origin's log is one log. ?logbook=reset and ?challenges=reset as v1's. Live pages only (a headless capture never builds it).
// What v1's world gives the logbook and v2 does not build (the lake's landmarks, the traced shoreline, the harbour's plan) is v1's
// own result baked once (logbookWorld.json, tools/v2-logbook-bake.mjs); the heights and the line of sight read v2's terrain.
// The binoculars' sight finds (the ruin, the waterfall, the house, the light, the harbour held 1 s in the glasses' middle) come from
// ui/captain.js's aim, as v1's. Not on v2 yet (each is v1's and checks for its system): the far sails (no traffic),
// the Milky Way (no milkyway aim), the July 4th show and a kayak bump (their systems come later:
// the entries show on v1's rules), the postcards' sounds and the page turn (no audio).
//   const log = createV2Logbook({ ui, B, terrain, clock, windField, view, sun });
//   each frame: log.update(); after each frame is submitted: log.afterFrame(canvas)
import { attachLogbook } from '../../src/sail/logbook.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { FLAGS } from '../../src/sim/core/flags.js';
import WORLD from './logbookWorld.json' with { type: 'json' };
import { createTessieBounty } from '../sim/tessieBounty.js';   // the Tessie RPG's page (tessieRpg: ?tessierpg=1 where she is playable)
import { tessiePage } from './tessieLog.js';

export { WORLD };

// a camera's quaternion from its forward (the shortest arc from v1's −z): v1's camSample turns it back into the forward; the
// roll is not read (discoveries.js builds its own up)
export function quatFromForward(f, out = { x: 0, y: 0, z: 0, w: 1 }) {
  const l = Math.hypot(f[0], f[1], f[2]) || 1, fx = f[0] / l, fy = f[1] / l, fz = f[2] / l;
  if (fz > 1 - 1e-9) { out.x = 0; out.y = 1; out.z = 0; out.w = 0; return out; }   // looking down +z: a half turn about y
  let x = fy, y = -fx, z = 0, w = 1 - fz;   // cross((0, 0, −1), f), 1 + dot((0, 0, −1), f)
  const n = Math.hypot(x, y, z, w); x /= n; y /= n; z /= n; w /= n;
  out.x = x; out.y = y; out.z = z; out.w = w; return out;
}

// v1's terrain object as the logbook reads it: v2's heights, v1's baked lake and landmarks
export function terrainFor(heightAt, world = WORLD) {
  const T = world.terrain;
  return { heightAt, lake: T.lake, landmarks: T.landmarks, mouth: T.mouth, waterfall: () => T.waterfall };
}

// aground (v1's grounding.js consumeAground): the bottom's mode turning 'aground', read from the ground's state, never its event
// queue (that is the grounding's own when v2 has it)
export function groundWatch(ground) {
  let was = ground?.state?.mode ?? 'afloat', pending = false;
  return {
    tick() { const m = ground?.state?.mode ?? 'afloat'; if (m === 'aground' && was !== 'aground') pending = true; was = m; },
    consumeAground() { const v = pending; pending = false; return v; },
  };
}

// The logbook on the right, the chart page's mirror (owner, 2026-11-17: "The log page should appear on the right, the same size and
// location, symmetric to the chart page"): v1's card (src/ui/logbook.js) keeps its navy board and cream ink, moved from the lower
// left corner to the chart page's box mirrored: inset from the right as the enlarged chart is from the left (clamp(28px, 6vw,
// 96px)), centred upright, --bz square (chartplotter.js's formula); its type scales with the box (--s = --bz / 430, v1's card
// width), the body takes the height left. v2 only (a phone, data-screen narrow, keeps v1's bottom card; /classic/ v1's corner card). sail.js keeps it and the chart page one at a time.
export const LOG_SIDE_CSS = `
:root:not([data-screen~=narrow]) .lk-log{--sz:min(clamp(140px,30.6vh,340px),40vw);--bz:min(calc(var(--sz) * 2.5),80vh,92vw);--s:calc(var(--bz) / 430)}
:root:not([data-screen~=narrow]) .lk-log .card{left:auto;right:clamp(28px,6vw,96px);bottom:auto;top:50%;width:var(--bz);height:var(--bz);display:flex;flex-direction:column;
  transform:translateY(calc(-50% + var(--lk-rise)))}
:root:not([data-screen~=narrow]) .lk-log[data-state=open] .card,:root:not([data-screen~=narrow]) .lk-log[data-state=opening] .card{transform:translateY(-50%)}
:root:not([data-screen~=narrow]) .lk-log .card > .body{flex:1 1 auto;height:auto;min-height:calc(256*var(--s))}
:root:not([data-screen~=narrow]) .lk-log .grid{height:100%;grid-template-rows:repeat(4,minmax(calc(58*var(--s)),1fr));align-content:space-between}
@media (prefers-reduced-motion:reduce){:root:not([data-screen~=narrow]) .lk-log .card{transform:translateY(-50%)}}
`;
function sideCss(doc = globalThis.document) {
  if (!doc || doc.getElementById('v2-log-side')) return;
  const st = doc.createElement('style'); st.id = 'v2-log-side'; st.textContent = LOG_SIDE_CSS; doc.head.appendChild(st);
}

// ui: Sail's UI (sail.js: services, hint, skills, words); B: the boat (v2/sim/boat.js); view(): the camera now { pos, target, fov,
// aspect }; sun(): { elevDeg }
export function createV2Logbook({ ui, B, terrain, clock, windField = null, view = () => null, sun = () => null, flags = FLAGS, world = WORLD, now = () => performance.now(), tessieRpg = false, storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })() }) {
  const frames = [];   // core.afterFrame's callbacks, run with the canvas after the next frame
  const quat = { x: 0, y: 0, z: 0, w: 1 }, pos = { x: 0, y: 0, z: 0 }, fwd = [0, 0, -1];
  const camera = {
    get quaternion() { const v = view(); if (v) { fwd[0] = v.target[0] - v.pos[0]; fwd[1] = v.target[1] - v.pos[1]; fwd[2] = v.target[2] - v.pos[2]; } return quatFromForward(fwd, quat); },
    get position() { const v = view(); if (v) { pos.x = v.pos[0]; pos.y = v.pos[1]; pos.z = v.pos[2]; } return pos; },
    get fov() { return view()?.fov ?? 50; }, get aspect() { return view()?.aspect ?? 16 / 9; },
  };
  const elev = () => sun()?.elevDeg ?? null;
  const core = {
    flags, services: ui.services, waters: CURRENT_WATERS,
    terrain: terrainFor((x, z) => terrain.field.height(x, z), world),
    shoreline: { layout: world.shoreline }, harbour: { layout: world.harbour },
    traffic: null, camera, audio: null, milkyway: null,
    get time() { return B.t; },
    get sun() { const e = elev(); return e == null ? null : { elevationDeg: e, hour: clock.hour }; },
    get sunWorld() { const e = elev() ?? 30; return { y: Math.sin(e * Math.PI / 180) }; },
    get HOUR() { return clock.hour; }, T0: 0,
    afterFrame: (fn) => { frames.push(fn); },
  };
  const ground = groundWatch(B.ground);
  const controls = {
    hint: ui.hint, skills: ui.skills, words: ui.words, grounding: ground,
    // #5: the binoculars (ui/captain.js, 'captainTools'): their aim while fully raised, for v1's sight finds; the dwell on the real clock
    get tools() { return ui.services.get('captainTools') ?? null; }, feel: { get t() { return now() / 1000; } },
    get simT() { return B.t; }, get level() { return windField?.level ?? null; }, get pro() { return ui.pro; },
    // the cups' hunts: the Logbook's corners page, read from the page's 'hunts' service when shown
    corners: { pages: () => ui.services.get('hunts')?.pages?.() ?? [] },
    // the Tessie RPG (phase 1): a fifth page, her bounty, level and skills, read from her save each time it is shown
    tessie: tessieRpg ? tessiePage({ bounty: createTessieBounty({ storage }) }) : null,
  };
  const att = attachLogbook(core, { phys: B.phys, sfx: null }, controls, { key: false });   // no L key on v2: Menu › Logbook, the wind dial
  sideCss();   // after v1's own CSS (its card rules), so the side card's win at the same weight
  const api = ui.services.get('logbook');
  return {
    get logbook() { return api.logbook; }, get api() { return api; }, get track() { return att.track; }, core,
    update() { ground.tick(); att.update(); },
    afterFrame(canvas) { if (!frames.length) return; for (const fn of frames.splice(0)) fn(canvas); },
    dispose() { att.dispose(); },
  };
}
