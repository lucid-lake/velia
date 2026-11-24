// Keep the previous builds' hashed chunks in each upload (perf/phone-load).
// A Cloudflare Pages deploy replaces the whole site: a visitor whose page loaded the old index.html a second before the
// upload then asks for old chunks (/assets/<name>-<oldhash>.js) that the new deploy no longer has, and the page fails
// ("Importing a module script failed", 2 of the 11 phone load_fails of 2026-11-04/06). This copies every hashed file
// of the last builds that the new dist lacks into it, so both builds' pages keep working for a while:
//   node tools/keep_assets.mjs --dist dist --archive renders/deploys/velia-assets [--days 14] [--dry]
// It (1) copies into dist/assets/ each archived file the new build lacks and that was last shipped within --days,
// (2) archives the new build's own assets/ (a file's date = the last upload that shipped it), (3) prunes archive files
// past --days. The archive is git-ignored (renders/), local to the uploading Mac. Hashed names never clash: same name,
// same bytes. Run it after the build and before the scrub and the upload; the files it adds were scrubbed when first shipped.
import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const DIST = resolve(arg('dist', 'dist')), ARCHIVE = resolve(arg('archive', 'renders/deploys/velia-assets'));
const DAYS = parseFloat(arg('days', '14')), DRY = argv.includes('--dry');
const HASHED = /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;   // Vite's <name>-<8 char hash>.<ext>

export function plan({ dist, archived, now, days }) {
  // dist: names in the new build; archived: { name: lastShippedMs }. Returns what to copy in, what to (re)date, what to prune.
  const have = new Set(dist), keepMs = days * 86400e3;
  const copyIn = Object.entries(archived).filter(([n, t]) => !have.has(n) && now - t <= keepMs).map(([n]) => n).sort();
  const prune = Object.entries(archived).filter(([n, t]) => !have.has(n) && now - t > keepMs).map(([n]) => n).sort();
  return { copyIn, stamp: dist.filter((n) => HASHED.test(n)).sort(), prune };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const distAssets = join(DIST, 'assets');
  if (!existsSync(distAssets)) { console.error(`no ${distAssets}: build first`); process.exit(2); }
  mkdirSync(ARCHIVE, { recursive: true });
  const indexFile = join(ARCHIVE, 'shipped.json');
  const archived = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
  for (const n of Object.keys(archived)) if (!existsSync(join(ARCHIVE, n))) delete archived[n];
  const dist = readdirSync(distAssets).filter((n) => statSync(join(distAssets, n)).isFile());
  const now = Date.now();
  const p = plan({ dist, archived, now, days: DAYS });
  let bytes = 0;
  for (const n of p.copyIn) { bytes += statSync(join(ARCHIVE, n)).size; if (!DRY) copyFileSync(join(ARCHIVE, n), join(distAssets, n)); }
  if (!DRY) {
    for (const n of p.stamp) { copyFileSync(join(distAssets, n), join(ARCHIVE, n)); archived[n] = now; }
    for (const n of p.prune) { rmSync(join(ARCHIVE, n), { force: true }); delete archived[n]; }
    writeFileSync(indexFile, JSON.stringify(archived, null, 1));
  }
  console.log(`${DRY ? '(dry) ' : ''}kept ${p.copyIn.length} earlier files (${(bytes / 1048576).toFixed(1)} MB) in ${distAssets}; archived ${p.stamp.length}; pruned ${p.prune.length} older than ${DAYS} d`);
}
