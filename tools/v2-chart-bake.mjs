// The live chart's ground bake (Phase 2a): v2/ui/chart/ground.js run over the game's own terrain (v1's heightAt: the
// lidar land, the multibeam bed with the carved entrance channel, the full grid set, identical to v2's height field once its full grids
// are in) at the phones' size, day and night. Writes
//   v2/assets/chart/emerald-bay-day.webp, emerald-bay-night.webp   the phones' ground (and every device's first paint), GROUND.shipW wide
//   v2/ui/chart/groundData.js                                       GROUND_BAKE: the box, the size, each palette's raw-pixel sha-256 and
//                                                                   its WebP's sha-256 and bytes, the soundings
// Deterministic: the same terrain and code give the same pixels (the raw sha); the WebP is cwebp's encoding of them.
//   node tools/v2-chart-bake.mjs            bake, encode (cwebp), write
//   node tools/v2-chart-bake.mjs --check    exit 1 if the committed bake is stale (pixels, WebPs or soundings); no encoder needed
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUND, bakeGround, groundSize, soundings } from '../v2/ui/chart/ground.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = resolve(ROOT, 'v2/ui/chart/groundData.js');
export const WEBP = (p) => resolve(ROOT, `v2/assets/chart/emerald-bay-${p}.webp`);
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
    const bad = await staleParts();
    if (bad.length) { console.error(`the chart's ground is stale (${bad.join(', ')}): node tools/v2-chart-bake.mjs`); process.exit(1); }
    console.log('chart ground current');
    return;
  }
  const { PNG } = await import('pngjs');
  const raw = await bakeRaw();
  const tmp = resolve(ROOT, 'renders/live-chart/tmp');
  mkdirSync(tmp, { recursive: true }); mkdirSync(dirname(WEBP('day')), { recursive: true });
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
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(DATA, dataText(raw, webps));
  console.log(`wrote ${DATA}: ${raw.soundings.length} soundings`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
