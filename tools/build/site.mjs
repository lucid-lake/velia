// The public Velia site: v2 at the root, v1 (frozen) under /classic/. Builds both, then
// assembles dist-site/ for one Pages upload; never uploads anything.
//   npm run build:site                 # build:v2 + build:classic, then dist-site/
//   node tools/build/site.mjs --no-build   # assemble from the existing dist-v2/ and dist-classic/
//   node tools/build/site.mjs --target next   # a private preview: also keep v2's robots noindex meta
//   (--target public, the default: the root drops v2's noindex meta; v1's /classic/ page has none)
// Layout: dist-site/ = dist-v2/ (index.html, assets/, terrain/, models/, audio/, brand/, fonts/, data/, photo/) +
// dist-site/classic/ = dist-classic/ (v1's index.html, assets/, and its static folders) + public/_headers at the root (both
// assets/ folders immutable, HTML left to the Pages default, revalidated; Pages reads _headers only at the root). The root drops v2's noindex unless --target next.
// Checks after assembly: both index.html files, v1's chunks under /classic/assets/, no unprefixed v1 asset URL in
// classic/assets/, no collision. Then run the scrub on it (bash tools/scrub_dist.sh dist-site).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSIC_DIRS } from './base-path.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const V2 = resolve(ROOT, 'dist-v2'), CL = resolve(ROOT, 'dist-classic'), OUT = resolve(ROOT, 'dist-site');
const die = (m) => { console.error(`build:site: ${m}`); process.exit(1); };

if (!argv.includes('--no-build')) {
  for (const s of ['build:v2', 'build:classic']) {
    console.log(`build:site: npm run ${s}`);
    const r = spawnSync('npm', ['run', s], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) die(`npm run ${s} failed (${r.status})`);
  }
}
if (!existsSync(join(V2, 'index.html'))) die('no dist-v2/index.html (npm run build:v2)');
if (!existsSync(join(CL, 'index.html'))) die('no dist-classic/index.html (npm run build:classic)');
if (existsSync(join(V2, 'classic'))) die('dist-v2/ has a classic/ folder: it would collide with v1');

// the output folder is exactly <repo>/dist-site (guard: never a computed empty or parent path)
if (relative(ROOT, OUT) !== 'dist-site') die(`refusing to clear ${OUT}`);
rmSync(OUT, { recursive: true, force: true });
cpSync(V2, OUT, { recursive: true });
cpSync(CL, join(OUT, 'classic'), { recursive: true });
rmSync(join(OUT, 'classic', '_headers'), { force: true });   // read only at the root; folded into the root's below
cpSync(resolve(ROOT, 'public/_headers'), join(OUT, '_headers'));   // the one headers file: /assets/* and /classic/assets/* immutable; HTML keeps the Pages default (revalidated)

// the root page is the public Velia: no noindex (unless asked for a private preview)
const idx = join(OUT, 'index.html');
let html = readFileSync(idx, 'utf8');
const TARGET = argv.includes('--target') ? argv[argv.indexOf('--target') + 1] : 'public';
if (!['public', 'next'].includes(TARGET)) die(`--target public | next, not ${TARGET}`);
const NOINDEX = /\s*<meta name="robots" content="noindex, nofollow"\s*\/?>/;
if (TARGET === 'public') { html = html.replace(NOINDEX, ''); writeFileSync(idx, html); }

// checks
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const fails = [];
const classicHtml = readFileSync(join(OUT, 'classic', 'index.html'), 'utf8');
if (!/src="\/classic\/assets\/[^"]+\.js"/.test(classicHtml)) fails.push('classic/index.html does not load /classic/assets/*.js');
if (!/src="\.?\/?assets\/[^"]+\.js"|src="\/assets\/[^"]+\.js"/.test(html)) fails.push('index.html does not load /assets/*.js');
if (!/href="\/classic\/"/.test(html)) fails.push('the root page has no link to /classic/');
if (TARGET === 'public' && (/name="robots"[^>]*noindex/.test(html) || /name="robots"[^>]*noindex/.test(classicHtml))) fails.push('a public page still carries noindex');
if (!existsSync(resolve(ROOT, 'functions/api/e.js'))) fails.push('functions/api/e.js is missing: deploy from the repo root so /api/e goes with the site');
// words a public build must never carry: password words, plus private host names from the untracked deny file
// (`internal: /<word>/<flags> ... host` lines, the scrub's format; absent on a contributor's machine)
const LOCAL = resolve(ROOT, '../.oss-deny-words');
const hostWords = existsSync(LOCAL) ? readFileSync(LOCAL, 'utf8').split('\n').map((l) => /^internal:\s*\/([\w.-]+)\/[a-z]*\s+.*\bhost\b/.exec(l.trim())).filter(Boolean).map((m) => m[1].toLowerCase()) : [];
for (const w of ['password', 'passwd', ...hostWords]) for (const f of walk(OUT).filter((p) => /\.(js|html|css)$/.test(p))) if (readFileSync(f, 'utf8').toLowerCase().includes(w)) fails.push(`${relative(OUT, f)} mentions "${w}"`);
const bad = new RegExp(`["'\`(]/(${CLASSIC_DIRS.join('|')})/`);
for (const f of walk(join(OUT, 'classic', 'assets')).filter((p) => /\.(js|css)$/.test(p))) {
  const code = readFileSync(f, 'utf8'), m = code.match(bad) ?? code.match(/`\/\$\{/);
  if (m) fails.push(`${relative(OUT, f)}: an unprefixed v1 asset URL (${m[0]}…)`);
}
const size = (d) => walk(d).reduce((s, p) => s + statSync(p).size, 0);
console.log(`build:site: dist-site/ ${(size(OUT) / 1048576).toFixed(1)} MB (root v2 ${(size(OUT) / 1048576 - size(join(OUT, 'classic')) / 1048576).toFixed(1)} MB, classic/ ${(size(join(OUT, 'classic')) / 1048576).toFixed(1)} MB, ${walk(OUT).length} files); target ${TARGET}: root noindex ${TARGET === 'next' ? 'kept' : 'dropped'}`);
if (fails.length) { for (const f of fails) console.error(`FAIL  ${f}`); process.exit(1); }
console.log('build:site: ok. Next: bash tools/scrub_dist.sh dist-v2; bash tools/scrub_dist.sh dist-classic; bash tools/scrub_dist.sh dist-site (unpiped, exit 0 each)');
