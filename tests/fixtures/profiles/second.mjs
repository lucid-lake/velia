// The test-only second lake and second boat (tests/profiles.test.mjs): profiles in the shipped shape that no registry
// lists, so they never ship. MINI_LAKE: tests/fixtures/profiles/mini-lake.json on its own tiny terrain (make-mini-lake.mjs).
// TEST_BOAT: the default boat renamed, smaller (a 24-footer's spec, a shorter rig, lighter) and with its own polar
// (the default's at 85 %).
import { readFileSync } from 'node:fs';

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
export const MINI_LAKE = json('./mini-lake.json');

const base = json('../../../src/vessels/halcyon.json');
export const TEST_BOAT = {
  ...base,
  id: 'test-teal', name: 'Teal', short: '24-ft sailboat', plate: [['Length overall', '24 ft', '7.3 m']],
  spec: { ...base.spec, loa: 24, lwl: 20, beam: 8.5, draftFin: 4, displacementLb: 5200, ballastLb: 2000, I: 30, J: 9, P: 26, E: 9 },
  hull: { ...base.hull, freeboard: 0.8, stemZ: -3.5, rudderZ: 2.8, wheelZ: 2.1, transomZ: 3.5, anchorRoller: [0.1, 1.0, -3.8] },
  rig: { ...base.rig, jibLP: 2.8, capTang: 8.8, spreaders: [{ y: 2.8, length: 0.75 }, { y: 5.9, length: 0.55 }] },
  sails: { main: { areaFt2: 120 }, jib: { areaFt2: 140 } },
  physics: { ...base.physics, gm: 1.0, izz: 14000, ixx: 6000, rudder: { ...base.physics.rudder, maxDeg: 30 } },
  engine: { ...base.engine, hp: 15, bollardN: 950 },
  polar: { ...base.polar, kn: base.polar.kn.map((r) => r.map((v) => +(v * 0.85).toFixed(3))) },
  sockets: { wheel: [0, 1.05, 2.2] },
};
