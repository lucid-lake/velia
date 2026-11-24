// Compare a capture against its golden frame. Exit 1 when the differing pixels pass the tolerance.
//   node tools/diff.mjs --name dawn-A [--tolerance 0.5]   (tolerance = % of pixels allowed to differ)
//   node tools/diff.mjs --a <png> --b <png> [--name <n>]   a pair (an A/B of two captures; the diff goes to renders/captures/<n>.diff.png)
// Writes renders/captures/<name>.diff.png with the differences in red.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]] : []).filter((x) => x.length));
const name = args.name ?? 'dawn-A';
const tolerance = parseFloat(args.tolerance ?? '0.5');

const goldenPath = args.a ? resolve(args.a) : resolve(ROOT, 'golden', `${name}.png`);
const capPath = args.b ? resolve(args.b) : resolve(ROOT, 'renders/captures', `${name}.png`);
for (const p of [goldenPath, capPath]) if (!existsSync(p)) { console.error(`missing ${p}`); process.exit(2); }

const a = PNG.sync.read(readFileSync(goldenPath));
const b = PNG.sync.read(readFileSync(capPath));
if (a.width !== b.width || a.height !== b.height) { console.error(`size differs: golden ${a.width}x${a.height}, capture ${b.width}x${b.height}`); process.exit(2); }
const diff = new PNG({ width: a.width, height: a.height });
const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
writeFileSync(resolve(ROOT, 'renders/captures', `${name}.diff.png`), PNG.sync.write(diff));
const pct = (100 * n) / (a.width * a.height);
const ok = pct <= tolerance;
console.log(`${name}: ${n} px differ (${pct.toFixed(3)} %), tolerance ${tolerance} %  ${ok ? 'OK' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
