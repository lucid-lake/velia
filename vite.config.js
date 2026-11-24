// Vite for the main checkout.
// 1. Ignore teammates' worktrees (.worktrees/ and the agents' .claude/worktrees/, 1.9 GB on 2026-11-05), renders and third_party: their saves reloaded main's pages mid-capture
//    (2026-10-29). Globs were not honoured by this Vite's watcher, so a function.
// 2. Pre-bundle the heavy deps up front, so a first page load never hits "504 Outdated Optimize Dep" and reloads.
// 3. Production builds: the page fetches its assets by absolute URL (/models/…, /audio/…, /fonts/…, /brand/…), and
//    they live at the repo root (terrain/: the real Tahoe grids), not in a public/ folder; copy them into the build as they are, so the dev server
//    and the build serve the same paths. (The private music drafts under renders/ stay out of builds.)
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { stripHtmlComments, scrubBundle } from './tools/build/scrub.mjs';
import { basePathAssets } from './tools/build/base-path.mjs';

const IGNORE = ['/.worktrees/', '/.claude/', '/renders/', '/third_party/', '/node_modules/.vite/'];
const HERE = new URL('.', import.meta.url).pathname;   // a checkout that is itself a worktree must watch its own files (2026-10-30: edits were served stale)
const ignored = (p) => IGNORE.some((s) => (p.startsWith(HERE) ? p.slice(HERE.length - 1) : p).includes(s));
const STATIC = ['models', 'audio', 'fonts', 'brand', 'terrain', 'data'];   // data: the towns (src/towns-layout.js fetches /data/geo/…)

function copyStatic() {
  let root, outDir;
  return {
    name: 'lakeshore-static',
    apply: 'build',
    configResolved(c) { root = c.root; outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      for (const d of STATIC) if (existsSync(resolve(root, d))) cpSync(resolve(root, d), resolve(outDir, d), { recursive: true, filter: (f) => !f.endsWith('.md') && !f.endsWith('-foil.jpg') && !f.endsWith('sources.json') });   // notes stay out of the public build, and the 3 MB G1 original (the page uses its WebPs)
      gzipTwins(outDir);
    },
  };
}

// 3b. The big binary files' gzip twins (perf/slow-loading; src/fetchGz.js reads them): Pages compresses text only,
//    but the boat's models gzip to 26–38 % and the treetops to 58 %. `<file>.gz` beside each, level 9, no timestamp in the
//    header (gzipSync writes none), so a rebuild writes the same bytes.
const GZ_DIRS = [['models/boat', /\.glb$/], ['terrain/forest', /\.tps$/]];
function gzipTwins(outDir) {
  for (const [d, re] of GZ_DIRS) {
    const dir = resolve(outDir, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (re.test(f)) writeFileSync(resolve(dir, `${f}.gz`), gzipSync(readFileSync(resolve(dir, f)), { level: 9 }));
  }
}

// 5, 6. The production scrub (HTML comments, internal words, the code name spelled velia): tools/build/scrub.mjs, shared with v2.

// 7. The classic page: with VELIA_BASE=/classic/ (npm run build:classic) v1 is built to live under that path,
//    into dist-classic/: Vite's base moves the chunks and workers, tools/build/base-path.mjs prefixes v1's absolute asset URLs in
//    the output. No v1 source changes; without VELIA_BASE the build is the same as before (base '/', dist/).
const BASE = process.env.VELIA_BASE || '/';
const CLASSIC = BASE !== '/';

// the short build id shown at the foot of the What's new page (src/ui/news.js)
const BUILD_ID = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; } })();

export default {
  base: BASE,
  ...(CLASSIC ? { build: { outDir: 'dist-classic', emptyOutDir: true } } : {}),
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  publicDir: 'public',   // only public/basis (the Basis transcoder for KTX2, self-hosted; src/ktx2.js); everything else is at the repo root, see 3 above
  plugins: [copyStatic(), stripHtmlComments(), scrubBundle(), basePathAssets(BASE)],
  worker: { format: 'es', plugins: () => [scrubBundle(), basePathAssets(BASE)] },   // 4. the terrain worker uses top-level await; the default iife worker format cannot build it
  // warmup (fix/first-visit-reel): the module graph is transformed when the server starts, not by the first page that asks
  // (a fresh server's first load fetched its 370 modules in 2.4 s, a warm one in 0.9 s)
  server: { watch: { ignored }, warmup: { clientFiles: ['./classic/src/main.js', './src/ui/loading.js'] } },
  optimizeDeps: {
    entries: ['index.html'],
    include: [
      'three/webgpu', 'three/tsl', 'three/addons/loaders/GLTFLoader.js', 'three/addons/loaders/KTX2Loader.js',
      '@takram/three-atmosphere', '@takram/three-atmosphere/webgpu', '@takram/three-geospatial',
    ],
  },
};
