// Vite for Velia v2: its own root, dev port (5174), dep cache and build folder (dist-v2/ at
// the repo root), so v1 on 5173 and dist/ are untouched. v2 imports the shared pure modules from ../src/ (day, flags, the
// lake profile) by relative path; Vite serves them from the workspace root. Nothing from three.js: v2/tests/no-three
// walks the import graph, and the build check below greps the bundle for three's signatures.
import { resolve, basename } from 'node:path';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, existsSync, statSync } from 'node:fs';
import { shippedFiles, shoreFiles } from './terrain/levels.js';
import { regionLevels, levelFiles } from './terrain/region.js';   // the regions' own detail levels (terrain/<dir>/), fetched only for a start there
import { stripHtmlComments, scrubBundle } from '../tools/build/scrub.mjs';   // the same production scrub as v1
import { packGlb, BOAT_MODELS } from '../tools/build/glb-pack.mjs';
import { turnKit, earlyTurn } from './ui/landscape.js';   // phones are landscape-only: the first paint's turn, inline   // M3b: v1's boat models, quantized + gzipped

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const IGNORE = ['/.worktrees/', '/.claude/', '/renders/', '/third_party/', '/node_modules/.vite', '/dist/', '/dist-v2/'];
const ignored = (p) => IGNORE.some((s) => (p.startsWith(ROOT) ? p.slice(ROOT.length) : p).includes(s));

// the built bundle carries nothing of three.js (a guard beside the import-graph test)
function noThreeInBundle() {
  return {
    name: 'velia-v2-no-three', apply: 'build',
    closeBundle() {
      const dir = resolve(ROOT, 'dist-v2/assets');
      let files = []; try { files = readdirSync(dir).filter((f) => f.endsWith('.js')); } catch { return; }
      for (const f of files) {
        const code = readFileSync(resolve(dir, f), 'utf8');
        for (const sig of ['WebGPURenderer', 'NodeMaterial', 'THREE.REVISION', 'three.module']) if (code.includes(sig)) throw new Error(`dist-v2/assets/${f} carries three.js (${sig})`);
      }
    },
  };
}

// phones are landscape-only (ui/landscape.js): the first paint's turn written at the end of <head>, after the page's own sheets, so
// an upright phone paints the turned, flipped page at once (dev and build; one source with the module)
function landscapeTurn() {
  return {
    name: 'velia-v2-landscape-turn',
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('<!-- lk-turn -->', `<script>(${earlyTurn})((${turnKit})())</script>`) },
  };
}

// M2: the terrain grids. v2 has no publicDir (v1's public/ and its 200 MB of assets stay out of dist-v2); the grids it
// streams are served from the repo's terrain/ in dev and copied into dist-v2/terrain/ in a build: both sets' height
// grids and the cover grids, the island's and the bay's shore-distance grids (the living lake), never the photo, the
// forest or anything else in terrain/.
const TERRAIN = resolve(ROOT, 'terrain');
const manifests = () => ['tahoe.json', 'tahoe-phone.json'].map((f) => JSON.parse(readFileSync(resolve(TERRAIN, f), 'utf8')));
// the living lake: the island's and the bay's shore-distance grids (v2/sim/lake.js: the kayaks' routes and minds)
const terrainFiles = () => ['tahoe.json', 'tahoe-phone.json', ...shippedFiles(...manifests()), ...shoreFiles(manifests()[0])];
// the regions' detail levels (src/waters/*.json regions[].level: terrain/south/ …): every file of each, served and shipped under its
// folder; a page fetches them only for a start in that region (v2/terrain/region.js)
const watersFiles = () => readdirSync(resolve(ROOT, 'src/waters')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(ROOT, 'src/waters', f), 'utf8')));
const regionFiles = () => [...new Set(watersFiles().flatMap((w) => regionLevels(w).flatMap((l) => levelFiles(l, (p) => JSON.parse(readFileSync(resolve(TERRAIN, p), 'utf8'))))))].sort();
const GROUND_FILES = ['albedo.webp', 'pack.webp', 'rock-albedo.webp', 'rock-pack.webp'];   // M5c: v1's detail set (src/ground-layout.js GROUND_TEXTURES); the close rock's two layers (render/ground.js ROCK_FILES, CC0)
function terrainGrids() {
  let build = false;
  return {
    name: 'velia-v2-terrain',
    configResolved(c) { build = c.command === 'build'; },
    configureServer(server) {
      const allowed = new Set(terrainFiles()), regional = new Set(regionFiles());
      server.middlewares.use('/terrain/', (req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        const name = basename(url);
        const rel = url.replace(/^\//, '');
        if (regional.has(rel)) {   // a region's level: its own folder (terrain/south/…)
          const file = resolve(TERRAIN, rel);
          res.setHeader('Content-Type', rel.endsWith('.json') ? 'application/json' : rel.endsWith('.webp') ? 'image/webp' : 'application/octet-stream');
          res.setHeader('Content-Length', statSync(file).size);
          return res.end(readFileSync(file));
        }
        // M5c: v1's two detail strips (terrain/ground/albedo.webp, pack.webp) ride along; nothing else from terrain/ground
        const ground = url.startsWith('/ground/') && GROUND_FILES.includes(name);
        if (!ground && !allowed.has(name)) return next();
        const file = ground ? resolve(TERRAIN, 'ground', name) : resolve(TERRAIN, name);
        res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : name.endsWith('.webp') ? 'image/webp' : 'application/octet-stream');
        res.setHeader('Content-Length', statSync(file).size);
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (!build) return;
      const out = resolve(ROOT, 'dist-v2');
      if (!existsSync(out)) return;
      mkdirSync(resolve(out, 'terrain'), { recursive: true });
      for (const f of terrainFiles()) copyFileSync(resolve(TERRAIN, f), resolve(out, 'terrain', f));
      for (const f of regionFiles()) { mkdirSync(resolve(out, 'terrain', f, '..'), { recursive: true }); copyFileSync(resolve(TERRAIN, f), resolve(out, 'terrain', f)); }
      // M5c: the detail strips and the photo tiles (v2/photo: cut by tools/v2-photo-tiles.mjs; served from v2's root in dev)
      mkdirSync(resolve(out, 'terrain/ground'), { recursive: true });
      for (const f of GROUND_FILES) copyFileSync(resolve(TERRAIN, 'ground', f), resolve(out, 'terrain/ground', f));
      cpSync(resolve(ROOT, 'v2/photo'), resolve(out, 'photo'), { recursive: true });
    },
  };
}

// M3b: v1's boat models for v2, packed (tools/build/glb-pack.mjs; models/boat/*.glb untouched): the dev server packs each
// on its first request (kept in memory), a build writes dist-v2/models/boat/<name>.glb.gz (tools/v2-boat-pack.mjs is the
// same step by hand, with the byte counts)
function boatModels() {
  let build = false;
  const cache = new Map();
  const packed = (name) => { if (!cache.has(name)) cache.set(name, packGlb(readFileSync(resolve(ROOT, 'models/boat', `${name}.glb`))).gz); return cache.get(name); };
  return {
    name: 'velia-v2-boat-models',
    configResolved(c) { build = c.command === 'build'; },
    configureServer(server) {
      server.middlewares.use('/models/boat/', (req, res, next) => {
        const m = /^\/?([a-z]+)\.glb\.gz$/.exec(decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!m || !BOAT_MODELS.includes(m[1])) return next();
        const body = packed(m[1]);
        res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', body.length);
        res.end(body);
      });
    },
    closeBundle() {
      if (!build) return;
      const out = resolve(ROOT, 'dist-v2');
      if (!existsSync(out)) return;
      mkdirSync(resolve(out, 'models/boat'), { recursive: true });
      for (const n of BOAT_MODELS) writeFileSync(resolve(out, 'models/boat', `${n}.glb.gz`), packed(n));
    },
  };
}

// M4: what v1's DOM UI fetches by absolute path (src/ui/tokens.js and the panels' CSS): the fonts and the dash and dial art,
// served from the repo in dev and copied into dist-v2/ in a build (≈ 1.3 MB; v1's public/ stays out). Only files, no
// directory listing; .woff2 and .webp only (the OFL texts and the TTF stay out)
// The front door (2026-11-13) adds what v1's loading shell and home card fetch: the favicon, the one golden still under the
// mark, the card's art and the studio mark (brand/stills/reel-golden-*, brand/card, brand/lucidlake: .webp, ≈ 0.6 MB). No
// reel (owner, 2026-11-13: v2 has no attract film; v1's public/reel stays v1's). Each row: the URL folder, the repo folder,
// the file names allowed.
const UI_DIRS = [
  ['fonts', 'fonts', /\.(woff2)$/], ['fonts/sub', 'fonts/sub', /\.(woff2)$/], ['brand/dash', 'brand/dash', /\.webp$/], ['brand/dial', 'brand/dial', /\.webp$/],
  ['brand', 'brand', /^favicon\.svg$/], ['brand/stills', 'brand/stills', /^reel-golden-\d+\.webp$/], ['brand/card', 'brand/card', /\.webp$/],
  ['brand/lucidlake', 'brand/lucidlake', /^lucidlake-g1-\d+\.webp$/],
  ['brand/social', 'brand/social', /^velia-share\.jpg$/],   //: the share card (og:image) once v2 is the public page (137 kB)
  ['brand/app', 'brand/app', /^(velia\.webmanifest|velia-icon-(180|192|512|maskable-512)\.png)$/],   //: the Home Screen's manifest and icons (≈ 22 kB)
];
const uiFiles = (d, re) => { try { return readdirSync(resolve(ROOT, d)).filter((f) => re.test(f)); } catch { return []; } };
const TYPES = { woff2: 'font/woff2', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', png: 'image/png', webmanifest: 'application/manifest+json' };
function uiAssets() {
  let build = false;
  return {
    name: 'velia-v2-ui-assets',
    configResolved(c) { build = c.command === 'build'; },
    configureServer(server) {
      for (const [url, d, re] of UI_DIRS) {
        const allowed = new Set(uiFiles(d, re));
        server.middlewares.use(`/${url}/`, (req, res, next) => {
          const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
          if (!allowed.has(name)) return next();
          const file = resolve(ROOT, d, name);
          res.setHeader('Content-Type', TYPES[name.split('.').pop()] ?? 'application/octet-stream');
          res.setHeader('Content-Length', statSync(file).size);
          res.end(readFileSync(file));
        });
      }
    },
    closeBundle() {
      if (!build) return;
      const out = resolve(ROOT, 'dist-v2');
      if (!existsSync(out)) return;
      for (const [url, d, re] of UI_DIRS) { mkdirSync(resolve(out, url), { recursive: true }); for (const f of uiFiles(d, re)) copyFileSync(resolve(ROOT, d, f), resolve(out, url, f)); }
    },
  };
}

// birds: v1's bird calls (audio/birds/*.opus + the .m4a twins, ≈ 0.4 MB; audio/sources.json "birds", ATTRIBUTION.md),
// served from the repo in dev and copied into dist-v2/audio/birds/ in a build; nothing else from audio/
const BIRD_AUDIO = 'audio/birds';
const birdAudioFiles = () => { try { return readdirSync(resolve(ROOT, BIRD_AUDIO)).filter((f) => /\.(opus|m4a)$/.test(f)); } catch { return []; } };
function birdAudio() {
  let build = false;
  return {
    name: 'velia-v2-bird-audio',
    configResolved(c) { build = c.command === 'build'; },
    configureServer(server) {
      const allowed = new Set(birdAudioFiles());
      server.middlewares.use(`/${BIRD_AUDIO}/`, (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
        if (!allowed.has(name)) return next();
        const file = resolve(ROOT, BIRD_AUDIO, name);
        res.setHeader('Content-Type', name.endsWith('.opus') ? 'audio/ogg' : 'audio/mp4');
        res.setHeader('Content-Length', statSync(file).size);
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (!build) return;
      const out = resolve(ROOT, 'dist-v2');
      if (!existsSync(out)) return;
      mkdirSync(resolve(out, BIRD_AUDIO), { recursive: true });
      for (const f of birdAudioFiles()) copyFileSync(resolve(ROOT, BIRD_AUDIO, f), resolve(out, BIRD_AUDIO, f));
    },
  };
}

// #6: the VHF's voice (v1's audio/vhf/: the forecast's and the harbour master's clips in one sprite, Ogg Opus 238 kB or its AAC twin
// 864 kB, and the clip table forecast.json 3.4 kB; Kokoro, Apache-2.0, ATTRIBUTION.md): served from the repo in dev and copied into
// dist-v2/audio/vhf/ in a build; fetched by the page only after the first frame and only while the radio is on (ui/captain.js)
const VHF_AUDIO = 'audio/vhf';
const vhfAudioFiles = () => { try { return readdirSync(resolve(ROOT, VHF_AUDIO)).filter((f) => /^forecast\.(opus|m4a|json)$/.test(f)); } catch { return []; } };
const VHF_TYPES = { opus: 'audio/ogg', m4a: 'audio/mp4', json: 'application/json' };
function vhfAudio() {
  let build = false;
  return {
    name: 'velia-v2-vhf-audio',
    configResolved(c) { build = c.command === 'build'; },
    configureServer(server) {
      const allowed = new Set(vhfAudioFiles());
      server.middlewares.use(`/${VHF_AUDIO}/`, (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
        if (!allowed.has(name)) return next();
        const file = resolve(ROOT, VHF_AUDIO, name);
        res.setHeader('Content-Type', VHF_TYPES[name.split('.').pop()]);
        res.setHeader('Content-Length', statSync(file).size);
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (!build) return;
      const out = resolve(ROOT, 'dist-v2');
      if (!existsSync(out)) return;
      mkdirSync(resolve(out, VHF_AUDIO), { recursive: true });
      for (const f of vhfAudioFiles()) copyFileSync(resolve(ROOT, VHF_AUDIO, f), resolve(out, VHF_AUDIO, f));
    },
  };
}

// The fireworks' sound and music (v1's audio/fireworks/: the bank files and Sail's evening piece, Ogg Opus and AAC,
// ≈ 4.3 MB; v2/audio/fireworks.js fetches them after the player's first gesture): served from the repo in dev and copied
// into dist-v2/audio/fireworks/ in a build. Nothing else from audio/
const FW_AUDIO = ['audio/fireworks', 'audio/fireworks/music'];
// Sail's piece only from music/ ("Over The Clouds"): Cruise's score and the radio's marches are not played on v2's page yet
// music: the evening's three pieces now (Sail's "Over The Clouds", Cruise's score "Full Moon", the boat radio's two Sousa marches)
const fwAudioFiles = (d) => { try { return readdirSync(resolve(ROOT, d)).filter((f) => /\.(opus|m4a)$/.test(f) && (!d.endsWith('/music') || /^(over_the_clouds|full_moon|radio_[a-z_]+)\./.test(f))); } catch { return []; } };
function fireworksAudio() {
  let build = false;
  return {
    name: 'velia-v2-fireworks-audio',
    configResolved(c) { build = c.command === 'build'; },
    configureServer(server) {
      for (const d of FW_AUDIO) {
        const allowed = new Set(fwAudioFiles(d));
        server.middlewares.use(`/${d}/`, (req, res, next) => {
          const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
          if (!allowed.has(name)) return next();
          const file = resolve(ROOT, d, name);
          res.setHeader('Content-Type', name.endsWith('.opus') ? 'audio/ogg' : 'audio/mp4');
          res.setHeader('Content-Length', statSync(file).size);
          res.end(readFileSync(file));
        });
      }
    },
    closeBundle() {
      if (!build) return;
      const out = resolve(ROOT, 'dist-v2');
      if (!existsSync(out)) return;
      for (const d of FW_AUDIO) { mkdirSync(resolve(out, d), { recursive: true }); for (const f of fwAudioFiles(d)) copyFileSync(resolve(ROOT, d, f), resolve(out, d, f)); }
    },
  };
}

// step 3 (hybrid, owner 2026-11-13): v1's recordings for the hull and water, the sails, the load and the controls, and the lake's
// lap and rain loops (v2/audio/recorded.js plays them through v1's own engines, after the first gesture): served from the repo
// by their v1 paths in dev and copied into dist-v2/audio/ in a build, Opus and the AAC twins. The wind is code (no file); the
// engine and the chain (#14, #8) came in with v2/audio/engine.js; v1's other lake loops stay out.
const BEDS_AUDIO = [
  ['audio/boat', ['hull_chuckle', 'hull_rush', 'sail_flutter', 'sail_flog', 'creak_rig', 'creak_sheet', 'sail_snap', 'engine_idle', 'engine_run', 'chain_run', 'hull_slap']],   // #14, #8: + v1's engine and chain (src/engineAudio.js); hull_slap: v2's recorded wave hits (?wavehit=rec)
  ['audio/sfx', ['winch_click', 'sheet_run', 'wheel_creak', 'page_turn', 'kayak_splash']],   // kayak_splash: a kayak capsizing (v2/living/kayaks-sound.js)
  ['audio', ['lake_lap', 'rain_water', 'birds_dawn', 'loon']],   // S1a: + v1's dawn chorus and loons
];
const bedsAudioFiles = (names) => names.flatMap((n) => [`${n}.opus`, `${n}.m4a`]);
function bedsAudio() {
  let build = false;
  return {
    name: 'velia-v2-beds-audio',
    configResolved(c) { build = c.command === 'build'; },
    configureServer(server) {
      for (const [d, names] of BEDS_AUDIO) {
        const allowed = new Set(bedsAudioFiles(names));
        server.middlewares.use(`/${d}/`, (req, res, next) => {
          const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
          if (!allowed.has(name)) return next();
          const file = resolve(ROOT, d, name);
          res.setHeader('Content-Type', name.endsWith('.opus') ? 'audio/ogg' : 'audio/mp4');
          res.setHeader('Content-Length', statSync(file).size);
          res.end(readFileSync(file));
        });
      }
    },
    closeBundle() {
      if (!build) return;
      const out = resolve(ROOT, 'dist-v2');
      if (!existsSync(out)) return;
      for (const [d, names] of BEDS_AUDIO) { mkdirSync(resolve(out, d), { recursive: true }); for (const f of bedsAudioFiles(names)) copyFileSync(resolve(ROOT, d, f), resolve(out, d, f)); }
    },
  };
}

// music (v2/audio/music.js): v1's ten pieces (audio/music/, Sail's pools and Cruise's playlist; the race score stays Regatta's) and
// the old skipper's spoken lines (audio/skipper/: manifest.json and the clips), Opus and the AAC twins: served from the repo by
// their v1 paths in dev and copied into dist-v2/audio/ in a build. The page streams the pieces after the first gesture and fetches
// the skipper's clips only once the sound runs (src/ui/skipperVoice.js prefetch)
export const MUSIC_PIECES = ['first_light_a', 'first_light_b', 'over_the_ridge_a', 'over_the_ridge_b', 'wind_rising_a', 'wind_rising_b', 'golden_hour_a', 'golden_hour_b', 'dusk_water_a', 'dusk_water_b'];
const MUSIC_AUDIO = [
  ['audio/music', () => MUSIC_PIECES.flatMap((n) => [`${n}.opus`, `${n}.m4a`])],
  ['audio/skipper', () => { try { return readdirSync(resolve(ROOT, 'audio/skipper')).filter((f) => /^([0-9a-f]+\.(opus|m4a)|manifest\.json)$/.test(f)); } catch { return []; } }],
  ['audio/skipper-v2', () => { try { return readdirSync(resolve(ROOT, 'audio/skipper-v2')).filter((f) => /^([0-9a-f]+\.(opus|m4a)|manifest\.json)$/.test(f)); } catch { return []; } }],   // v2's anchor lines (tools/v2-sea-voice.py)
];
const MUSIC_TYPES = { opus: 'audio/ogg', m4a: 'audio/mp4', json: 'application/json' };
function musicAudio() {
  let build = false;
  return {
    name: 'velia-v2-music-audio',
    configResolved(c) { build = c.command === 'build'; },
    configureServer(server) {
      for (const [d, list] of MUSIC_AUDIO) {
        const allowed = new Set(list());
        server.middlewares.use(`/${d}/`, (req, res, next) => {
          const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
          if (!allowed.has(name)) return next();
          const file = resolve(ROOT, d, name), size = statSync(file).size;
          res.setHeader('Content-Type', MUSIC_TYPES[name.split('.').pop()]); res.setHeader('Accept-Ranges', 'bytes');
          // a media element streams by ranges (Safari asks for bytes=0-1 first and refuses a source that ignores it)
          const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
          if (m) {
            const a = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]), b = m[1] !== '' && m[2] !== '' ? Math.min(size - 1, Number(m[2])) : size - 1;
            res.statusCode = 206; res.setHeader('Content-Range', `bytes ${a}-${b}/${size}`); res.setHeader('Content-Length', b - a + 1);
            return res.end(readFileSync(file).subarray(a, b + 1));
          }
          res.setHeader('Content-Length', size);
          res.end(readFileSync(file));
        });
      }
    },
    closeBundle() {
      if (!build) return;
      const out = resolve(ROOT, 'dist-v2');
      if (!existsSync(out)) return;
      for (const [d, list] of MUSIC_AUDIO) { mkdirSync(resolve(out, d), { recursive: true }); for (const f of list()) copyFileSync(resolve(ROOT, d, f), resolve(out, d, f)); }
    },
  };
}

// M5e: the night's maps (data/sky: NASA SVS's Milky Way, log-encoded, and its tint; v1's own files), served from the
// repo's data/sky in dev and copied into dist-v2/data/sky in a build; only these two (feat/v2-sky-v1-grade: v1's 4K map, as v1's
// desktop, in place of the 2K: the dust lanes' edges and the band's resolved stars; a phone never fetches it)
const SKY_FILES = ['milkyway-4k.webp', 'milkyway-tint.png'];
function skyMaps() {
  let build = false;
  return {
    name: 'velia-v2-sky-maps',
    configResolved(c) { build = c.command === 'build'; },
    configureServer(server) {
      server.middlewares.use('/data/sky/', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
        if (!SKY_FILES.includes(name)) return next();
        const file = resolve(ROOT, 'data/sky', name);
        res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : 'image/webp');
        res.setHeader('Content-Length', statSync(file).size);
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (!build) return;
      const out = resolve(ROOT, 'dist-v2');
      if (!existsSync(out)) return;
      mkdirSync(resolve(out, 'data/sky'), { recursive: true });
      for (const f of SKY_FILES) copyFileSync(resolve(ROOT, 'data/sky', f), resolve(out, 'data/sky', f));
    },
  };
}

export default {
  root: resolve(ROOT, 'v2'),
  cacheDir: resolve(ROOT, '.vite-v2'),
  publicDir: false,
  server: { host: '127.0.0.1', port: 5174, strictPort: true, watch: { ignored }, fs: { allow: [ROOT] } },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  build: { outDir: resolve(ROOT, 'dist-v2'), emptyOutDir: true, target: 'es2022', sourcemap: false, reportCompressedSize: true },
  plugins: [landscapeTurn(), noThreeInBundle(), terrainGrids(), boatModels(), uiAssets(), birdAudio(), vhfAudio(), fireworksAudio(), bedsAudio(), musicAudio(), skyMaps(), stripHtmlComments(), scrubBundle()],
  worker: { format: 'es', plugins: () => [scrubBundle()] },
};
