// The live chart's ground bake (Phase 2a): v2/ui/chart/ground.js run over the game's own terrain (v1's heightAt: the
// lidar land, the multibeam bed with the carved entrance channel, the full grid set, identical to v2's height field once its full grids
// are in) at the phones' size, day and night. Writes
//   v2/assets/chart/emerald-bay-day.webp, emerald-bay-night.webp   the phones' ground (and every device's first paint), GROUND.shipW wide
//   v2/ui/chart/groundData.js                                       GROUND_BAKE: the box, the size, each palette's raw-pixel sha-256 and
//                                                                   its WebP's sha-256 and bytes, the soundings
//   v2/assets/chart/<sheet>-day.webp, <sheet>-night.webp           the sheets past the bay (ground.js SHEETS: lake, south), over the
//                                                                   lake-wide grids with South Lake's own level (terrain/south) in them
//   v2/ui/chart/sheetData.js                                        SHEET_BAKE: each sheet's box, size, shas and bytes (the south's soundings)
// The bay's ground is baked from the game's terrain as before (its pixels and WebPs unchanged); the sheets from a sampler with the
// south level added (it lies east of the bay's box, so the bay's heights are the same either way).
// Deterministic: the same terrain and code give the same pixels (the raw sha); the WebP is cwebp's encoding of them.
//   node tools/v2-chart-bake.mjs            bake, encode (cwebp), write
//   node tools/v2-chart-bake.mjs --check    exit 1 if the committed bake is stale (pixels, WebPs or soundings); no encoder needed
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUND, SHEETS, bakeGround, groundSize, soundings } from '../v2/ui/chart/ground.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = resolve(ROOT, 'v2/ui/chart/groundData.js');
export const WEBP = (p, sheet = 'emerald-bay') => resolve(ROOT, `v2/assets/chart/${sheet}-${p}.webp`);
export const SHEET_DATA = resolve(ROOT, 'v2/ui/chart/sheetData.js');
export const SHIP_MPP = (GROUND.box.x1 - GROUND.box.x0) / GROUND.shipW;
const QUALITY = { day: 72, night: 70 };   // cwebp -q: about 90 kB a palette
const sha = (b) => createHash('sha256').update(b).digest('hex');

// the raw bake of both palettes and the soundings (the check's half: no encoder)
export async function bakeRaw() {
  const { heightAt } = await import('../src/sim/terrain.js');
  const out = {};
  for (const p of ['day', 'night']) { const g = bakeGround({ heightAt, mpp: SHIP_MPP, palette: p }); out[p] = { ...g, sha: sha(g.data) }; }
  return { ...out, soundings: soundings(heightAt) };
}

// the sampler the sheets are baked from: the game's grids (terrain/tahoe.json) with South Lake's level (the region table's south-lake
// row: terrain/south) set in before the basin's, finest first, as the page holds it on a south start
export async function sheetHeightAt() {
  const { loadTerrain, makeSampler } = await import('../src/sim/terrain-data.js');
  const { CURRENT_WATERS } = await import('../src/sim/waters/current.js');
  const { regionLevels } = await import('../v2/terrain/region.js');
  const base = await loadTerrain('full', CURRENT_WATERS), levels = [...base.levels];
  for (const L of regionLevels(CURRENT_WATERS)) {
    const dir = `${CURRENT_WATERS.terrain.dir}/${L.dir}`;
    const r = await loadTerrain('full', { ...CURRENT_WATERS, terrain: { ...CURRENT_WATERS.terrain, dir, full: L.full } });
    levels.splice(levels.findIndex((q) => q.step > r.levels[0].step), 0, ...r.levels);
  }
  return makeSampler({ manifest: base.manifest, levels }).height;
}
// the raw bake of every sheet, both palettes (the south's soundings with it)
export async function bakeSheetsRaw() {
  const heightAt = await sheetHeightAt(), out = {};
  for (const S of Object.values(SHEETS)) {
    out[S.id] = { soundings: S.lazy ? soundings(heightAt, { box: S.box }) : [] };
    for (const p of ['day', 'night']) { const g = bakeGround({ heightAt, mpp: S.mpp, palette: p, box: S.box }); out[S.id][p] = { ...g, sha: sha(g.data) }; }
  }
  return out;
}
export function sheetText(raw, webps) {
  const B = {};
  for (const S of Object.values(SHEETS)) {
    const { w, h } = groundSize(S.mpp, S.box), r = raw[S.id], wp = webps[S.id];
    B[S.id] = { box: S.box, w, h, mpp: S.mpp, day: { sha: r.day.sha, webp: wp.day.sha, bytes: wp.day.bytes }, night: { sha: r.night.sha, webp: wp.night.sha, bytes: wp.night.bytes }, soundings: r.soundings };
  }
  return `// The chart's sheets past the bay (tools/v2-chart-bake.mjs; v2/ui/chart/ground.js SHEETS over the lake-wide grids and South Lake's
// level). Do not edit by hand. Per sheet: box (world m), w × h px at mpp m a pixel, each palette's raw-pixel sha-256, its WebP's sha-256
// and bytes (v2/assets/chart/<sheet>-<palette>.webp); soundings: [x, z, depth m] for the closest zoom (a lazy sheet's, drawn once it is in).
export const SHEET_BAKE = ${JSON.stringify(B)};
`;
}
export async function staleSheets(raw = null) {
  const r = raw ?? await bakeSheetsRaw();
  if (!existsSync(SHEET_DATA)) return ['sheets'];
  const { SHEET_BAKE: B } = await import(`${SHEET_DATA}?t=${Date.now()}`);
  const bad = [];
  for (const S of Object.values(SHEETS)) {
    const b = B[S.id];
    if (!b) { bad.push(`${S.id} sheet`); continue; }
    for (const p of ['day', 'night']) {
      if (b[p].sha !== r[S.id][p].sha) bad.push(`${S.id} ${p} pixels`);
      const f = WEBP(p, S.id);
      if (!existsSync(f) || sha(readFileSync(f)) !== b[p].webp) bad.push(`${S.id} ${p} webp`);
    }
    const { w, h } = groundSize(S.mpp, S.box);
    if (b.w !== w || b.h !== h || b.mpp !== S.mpp || JSON.stringify(b.box) !== JSON.stringify(S.box)) bad.push(`${S.id} size`);
    if (JSON.stringify(b.soundings) !== JSON.stringify(r[S.id].soundings)) bad.push(`${S.id} soundings`);
  }
  return bad;
}

export function dataText(raw, webps) {
  const { w, h } = groundSize(SHIP_MPP);
  const B = { box: GROUND.box, w, h, mpp: SHIP_MPP,
    day: { sha: raw.day.sha, webp: webps.day.sha, bytes: webps.day.bytes }, night: { sha: raw.night.sha, webp: webps.night.sha, bytes: webps.night.bytes },
    soundings: raw.soundings };
  return `// The live chart's baked ground (tools/v2-chart-bake.mjs; v2/ui/chart/ground.js over the game's terrain). Do not edit by hand.
// box: world m (x east, z south, Fannette Island's summit 0, 0); w × h px at mpp m a pixel; each palette's raw-pixel sha-256, its WebP's
// sha-256 and bytes (v2/assets/chart/emerald-bay-<palette>.webp); soundings: [x, z, depth m] for the closest zoom.
export const GROUND_BAKE = ${JSON.stringify(B)};
`;
}

// the committed bake against a fresh one: [] when current, else the stale parts
export async function staleParts(raw = null) {
  const r = raw ?? await bakeRaw();
  const { GROUND_BAKE: B } = await import(`${DATA}?t=${Date.now()}`);
  const bad = [];
  for (const p of ['day', 'night']) {
    if (B[p].sha !== r[p].sha) bad.push(`${p} pixels`);
    const f = WEBP(p);
    if (!existsSync(f) || sha(readFileSync(f)) !== B[p].webp) bad.push(`${p} webp`);
  }
  if (JSON.stringify(B.soundings) !== JSON.stringify(r.soundings)) bad.push('soundings');
  const { w, h } = groundSize(SHIP_MPP);
  if (B.w !== w || B.h !== h || JSON.stringify(B.box) !== JSON.stringify(GROUND.box)) bad.push('size');
  return bad;
}

async function main() {
  if (process.argv.includes('--check')) {
    const bad = [...await staleParts(), ...await staleSheets()];
    if (bad.length) { console.error(`the chart's ground is stale (${bad.join(', ')}): node tools/v2-chart-bake.mjs`); process.exit(1); }
    console.log('chart ground current');
    return;
  }
  const { PNG } = await import('pngjs');
  const raw = await bakeRaw();
  const tmp = resolve(ROOT, 'renders/live-chart/tmp');
  mkdirSync(tmp, { recursive: true }); mkdirSync(dirname(WEBP('day')), { recursive: true });
  // the bay's ground: re-encoded only when its pixels or files changed (a current bake keeps its WebPs' bytes as they are)
  if ((await staleParts(raw)).length) {
  const webps = {};
  for (const p of ['day', 'night']) {
    const g = raw[p], png = new PNG({ width: g.w, height: g.h });
    png.data = Buffer.from(g.data.buffer, g.data.byteOffset, g.data.byteLength);
    const src = resolve(tmp, `ground-${p}.png`);
    writeFileSync(src, PNG.sync.write(png));
    execFileSync('cwebp', ['-quiet', '-q', String(QUALITY[p]), '-m', '6', '-metadata', 'none', src, '-o', WEBP(p)]);
    const b = readFileSync(WEBP(p));
    webps[p] = { sha: sha(b), bytes: b.length };
    console.log(`${p}: ${g.w} × ${g.h}, ${(b.length / 1024).toFixed(1)} kB`);
  }
  writeFileSync(DATA, dataText(raw, webps));
  console.log(`wrote ${DATA}: ${raw.soundings.length} soundings`);
  } else console.log('the bay\'s ground is current: its WebPs and data kept');
  // the sheets past the bay
  const sraw = await bakeSheetsRaw(), swebps = {};
  for (const S of Object.values(SHEETS)) {
    swebps[S.id] = {};
    for (const p of ['day', 'night']) {
      const g = sraw[S.id][p], png = new PNG({ width: g.w, height: g.h });
      png.data = Buffer.from(g.data.buffer, g.data.byteOffset, g.data.byteLength);
      const src = resolve(tmp, `${S.id}-${p}.png`);
      writeFileSync(src, PNG.sync.write(png));
      execFileSync('cwebp', ['-quiet', '-q', String(QUALITY[p]), '-m', '6', '-metadata', 'none', src, '-o', WEBP(p, S.id)]);
      const b = readFileSync(WEBP(p, S.id));
      swebps[S.id][p] = { sha: sha(b), bytes: b.length };
      console.log(`${S.id} ${p}: ${g.w} × ${g.h}, ${(b.length / 1024).toFixed(1)} kB`);
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(SHEET_DATA, sheetText(sraw, swebps));
  console.log(`wrote ${SHEET_DATA}: ${Object.keys(sraw).join(', ')}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
