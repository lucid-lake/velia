// Run under `node --import tests/fixtures/profiles/install-second.mjs` (tests/profiles.test.mjs): what the game's
// modules resolve for the page's lake and boat when they are the test-only second ones. Prints one JSON line.
const ter = await import('../../src/sim/terrain.js');
const { ORIGIN, Y0 } = await import('../../src/sim/geo.js');
const { PLACE } = await import('../../src/sim/place.js');
const { START, FIRST_GUST, sailCoreOptions } = await import('../../classic/src/sail/options.js');
const { GOAL, ARRIVAL } = await import('../../src/ui/profile.js');
const { STOPS } = await import('../../src/sim/modes/chill/navigator.js');
const { CHART_BOUNDS } = await import('../../src/ui/logbookChart.js');
const { ROOT, FINE } = await import('../../classic/src/terrain-lod.js');
const { WindField } = await import('../../src/sim/wind.js');
const { DEFAULT_DIMS } = await import('../../src/sim/boat/dims.js');
const { BOAT, BoatPhysics } = await import('../../src/sim/boat.js');
const { ENGINE } = await import('../../src/sim/boat/engine.js');
const { BOAT_LENGTH_M } = await import('../../src/sim/race/course.js');
const { BOATS } = await import('../../classic/src/modes/regatta/session.js');
const { BOAT_MODELS } = await import('../../src/ui/loading.js');
const { polarKn } = await import('../../src/sim/boat/groove.js');
const { WATERS: REGATTA_WATERS } = await import('../../classic/src/modes/regatta/index.js');

const T = ter.makeTerrain(), wind = new WindField({ seed: 1 });
const { parseFlags } = await import('../../src/sim/core/flags.js');
const o = sailCoreOptions(parseFlags(''));
console.log(JSON.stringify({
  watersId: T.waters.id, island: ter.LAKE.island, landmarks: ter.LANDMARKS, hIsland: ter.heightAt(0, 0), hLake: ter.heightAt(200, 0),
  origin: ORIGIN, y0: Y0, place: PLACE, start: START, firstGust: FIRST_GUST, goal: GOAL, arrival: ARRIVAL, stops: Object.keys(STOPS),
  chart: CHART_BOUNDS, root: ROOT, fine: FINE, bay: wind.bay, wakeHas: typeof o.createWake, regattaWaters: REGATTA_WATERS,
  dims: { loa: DEFAULT_DIMS.HULL.loa, mastTop: DEFAULT_DIMS.RIG.mastTop }, boat: { mass: BOAT.mass, rudderMax: BOAT.rudder.maxDeg },
  phys: new BoatPhysics({}).vessel.id, engineHp: ENGINE.hp, boatLength: BOAT_LENGTH_M, regattaName: BOATS[0].name,
  models: BOAT_MODELS, polar10x45: polarKn(10, 45),
}));
