// The stand-up paddleboarders' system for the kayaks' plug-in (v2/living/kayaks.js; its own pipeline 'sup-solid', declared with the kayaks'
// two): the region rows' `sups` (v2/living/busyLake.js residentSups) as a fleet (v2/sim/sup.js) drawn by v2/render/sup.js. Made only for a page
// that started in a region with its own level (South Lake: the region rule, v2/living/busyLake.js regionLoaded) on a tier that has boards
// (src/core/features.js paddleboards: full 4, lite 2, a phone none). Their blades splash through the kayaks' droplets (the fleet's own
// splash and tips lists), a Tessie splash within 20 m makes a board's paddler wobble, kneel and stand again (never into the water).
//   const U = createSupSystem({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, P, tier })
//   U.attach({ clock, water, storm, tessie, loaded })   once the clocks exist: the slots at the clock's hour, the fleet made
//   U.step(dt, kfleet)   each sim frame: the boards, Tessie's breaches near them, then the blades' splash into the kayak fleet's lists (if it is made)
//   U.fill(eye)  U.draw(pass, c)  U.spook(x, z, r)  U.marks()  U.stats()
import { createSupRender } from '../render/sup.js';
import { createSupFleet, SUP } from '../sim/sup.js';
import { REGIONS, residentSups } from './busyLake.js';
import { polyline } from '../../src/sim/kayaks/routes.js';
import { listBirthplaces } from '../sim/birthplace.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

export const SUP_MAX = Object.freeze({ full: 4, lite: 2 });
// does the page's loaded region own paddleboards (a region with a level of its own and `sups` rows)?
export const supsLoaded = (loaded, regions = REGIONS) => regions.some((r) => r.level && r.id === loaded && r.sups?.length);

export function createSupSystem({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier = 'full' }) {
  const R = createSupRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat });
  let fleet = null, tessieState = () => null, heightAt = () => 0;
  const self = {
    render: R, tier, on: true,   // the harness's A/B (hook.kayaks.sup.on: the boards' draws with and without, one page)
    get fleet() { return fleet; },
    attach({ clock, water, storm = () => false, tessie = () => null, loaded = null, seed = 1 }) {
      const slots = residentSups(REGIONS, listBirthplaces(CURRENT_WATERS), { seed, hour: clock.hour, polyline, loaded, max: SUP_MAX[tier] ?? SUP_MAX.full });
      heightAt = (x, z) => water.heightAt(x, z);
      fleet = createSupFleet({ slots, hour: () => clock.hour, storm, heightAt });
      tessieState = tessie;
      return self;
    },
    step(dt, kfleet = null) {
      if (!fleet) return;
      // Tessie's breaches near a board (the played Tessie's own splashes arrive through spook: living/tessiePlayer.js)
      const ev = tessieState()?.events;
      for (const e of ev ?? []) if ((e.type === 'breach' || e.type === 'break') && Number.isFinite(e.x)) fleet.spook(e.x, e.z, SUP.spookM);
      fleet.step(dt);
      if (kfleet?.splash) for (const e of fleet.splash) kfleet.splash.push(e);
      if (kfleet?.tips) for (const [k, v] of fleet.tips) kfleet.tips.set(k, v);
    },
    fill(eye) { if (fleet && self.on) R.update(fleet.boards, { eye, heightAt }); else R.update(null); },
    draw(pass, c) { if (self.on) R.draw(pass, c); },
    spook: (x, z, r) => fleet?.spook(x, z, r) ?? 0,
    marks: () => fleet?.marks() ?? [],
    stats: () => ({ ...(fleet ? fleet.stats() : { boards: 0 }), render: { ...R.stats } }),
  };
  return self;
}
