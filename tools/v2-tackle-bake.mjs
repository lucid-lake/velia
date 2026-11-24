// v2's ground tackle (#8): the piers, docks and breakwaters v1's tackle collides with and ties up to (src/sim/boat/tackle.js
// piersFrom, as src/sail/seamanship.js builds them on a v1 Sail page), on v1's own layouts and terrain:
//   src/towns-layout.js buildTownsLayout   the towns' decks and breakwaters (the shoreline's region skipped: townsDeckHidden)
//   src/shoreline-layout.js layoutShoreline the bay's piers (realPiers: the towns layout's osmPiers, as src/core/world.js)
//   src/harbour-layout.js harbourLayout     the marina's docks and breakwaters (src/harbour.js's plan)
// v1 has no mooring balls (src/shoreline-layout.js: "no floats", owner 2026-11-05), so there are none here either.
//   node tools/v2-tackle-bake.mjs [--check]   → v2/assets/towns/piers.json (rounded to 1 mm; --check demands the shipped bytes)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PIERS_FILE = resolve(ROOT, 'v2/assets/towns/piers.json');

const r3 = (v) => Math.round(v * 1000) / 1000;

export async function bakePiers() {
  const { makeTerrain } = await import('../src/sim/terrain.js');
  const { makeGeo } = await import('../src/sim/geo.js');
  const { CURRENT_WATERS } = await import('../src/sim/waters/current.js');
  const { loadTownsData, buildTownsLayout } = await import('../classic/src/towns-layout.js');
  const { layoutShoreline, SHORE_REGION } = await import('../src/shoreline-layout.js');
  const { harbourLayout } = await import('../src/harbour-layout.js');
  const { piersFrom, townsDeckHidden } = await import('../src/sim/boat/tackle.js');
  const terrain = makeTerrain({ seed: 1 });
  const towns = buildTownsLayout(await loadTownsData(), { heightAt: terrain.heightAt, lonLatToWorld: makeGeo(CURRENT_WATERS).lonLatToWorld });
  const shoreline = layoutShoreline(terrain, { seed: 1, realPiers: towns.osmPiers });
  const harbour = harbourLayout({ terrain, seed: 1 });
  const piers = piersFrom({ shoreline, harbour, towns, skip: townsDeckHidden(SHORE_REGION) });
  // compact: one row a pier, [ax, az, bx, bz, half, kind index] (v2/sim/seamanship.js piersOf turns them back into v1's records)
  const kinds = [...new Set(piers.map((p) => p.kind))];
  const out = { v: 1, note: 'v1 piersFrom (src/sim/boat/tackle.js) on v1 layouts; tools/v2-tackle-bake.mjs', balls: [], kinds,
    piers: piers.map((p) => [r3(p.a[0]), r3(p.a[1]), r3(p.b[0]), r3(p.b[1]), r3(p.half), kinds.indexOf(p.kind)]) };
  return JSON.stringify(out) + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await bakePiers();
  if (process.argv.includes('--check')) {
    const shipped = readFileSync(PIERS_FILE, 'utf8');
    if (shipped !== text) { console.error('piers.json differs from the bake'); process.exit(1); }
    console.log(`piers.json matches the bake (${JSON.parse(text).piers.length} piers)`);
  } else {
    mkdirSync(dirname(PIERS_FILE), { recursive: true });
    writeFileSync(PIERS_FILE, text);
    console.log(`v2/assets/towns/piers.json: ${JSON.parse(text).piers.length} piers, ${text.length} B`);
  }
}
