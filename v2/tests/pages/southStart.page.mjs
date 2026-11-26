// A region's detail level loads only on selection (v2/terrain/region.js; owner, 2026-11-24: every birthplace outside the bay loads when
// it is selected). The page's own network requests, recorded:
//   desktop, Emerald Bay start (Off Fannette)   0 bytes of terrain/south/; the bay's level (bay-h, bay-c, bay-d, its photo) fetched
//   desktop, ?birth=ski-run                       only the south files of the region levels (south.json, the photo manifest, south-h,
//                                                 south-c, south-d, the 4 m photo tiles), about 2.26 MB; none of the bay's detail; the
//                                                 live sampler reads 22.85 m at the pin, its finest level 4 m; she starts there
//   phone (?terrain=phone), ?birth=ski-run        the 8 m set (south-phone.json, south-h2, south-c, south-d2, 8 m tiles), about 0.75 MB
//   the south shore's piers                       assets/towns/shore-south.vsh.gz (about 84 kB) is fetched on the Ski Run starts (desktop and phone) and
//                                                 merged into the shore (towns.stats.sets); the bay start never requests it
//   the home card                                 a pick of the Ski Run pin reloads the page onto South Lake's level, she starts there
// Captures (?headless=1) take every stage, the photo and the shore before the first frame, so the lists are whole.
// Run by `npm run test:pages:v2 -- southStart` (LAKESHORE_BASE set), or node v2/tests/pages/southStart.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const DESK = { viewport: { width: 1280, height: 720 } };
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
// a returning player (set once: the reload keeps the saved pick)
const WELCOMED = () => { try { if (!localStorage.getItem('lakeshore.settings.v1')) localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };

const pathOf = (u) => new URL(u).pathname.replace(/^\//, '');
const isBay = (p) => /^terrain\/bay-/.test(p) || /^photo\/(full|phone)\/bay\//.test(p);
// a capture's whole load: every request's path and its body's bytes
async function load(device, query) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const got = new Map();
  const piers = []; page.on('response', (r) => { if (/assets\/towns\/shore-south[^?]*$/.test(r.url())) piers.push(pathOf(r.url())); });   // not Vite's own ?import module of the URL
  const breaks = []; page.on('response', (r) => { if (/assets\/shore\/shore[^?]*\.vsf\.gz$/.test(r.url())) breaks.push(pathOf(r.url()).replace(/^.*assets\/shore\//, '')); });   // the shore-break field (South Lake's look: the level's own bake)
  page.on('response', async (r) => { const p = pathOf(r.url()); if (!/^(terrain|photo)\//.test(p)) return; try { got.set(p, (await r.body()).length); } catch { got.set(p, Number(r.headers()['content-length'] ?? 0)); } });
  await page.goto(`${BASE}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready === true, null, { timeout: 240000, polling: 200 });
  await page.waitForFunction(() => window.__velia.ground?.stats?.done === true, null, { timeout: 120000, polling: 200 }).catch(() => {});
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => { const v = window.__velia, s = v.boat?.state; return { sets: v.towns?.stats?.sets ?? null, instances: v.towns?.stats?.instances ?? 0, level: v.terrainLevel, depth: -v.terrain.field.height(11800, -875), spacing: v.terrain.field.spacing(11800, -875), boat: s ? { x: s.x, z: s.z } : null, grids: v.terrain.grids, photo: v.ground?.stats?.region ?? null, rocks: v.stats?.().rocks?.box ?? null, forest: v.stats?.().forest?.region ?? null, shore: v.stats?.().shore?.tiles ?? 0 }; });
  const files = [...got.keys()].sort(), south = files.filter((f) => f.startsWith('terrain/south/'));
  const bytes = (fs) => fs.reduce((s, f) => s + got.get(f), 0);
  await ctx.close();
  return { piers, breaks, files, south, southBytes: bytes(south), bay: files.filter(isBay), bayBytes: bytes(files.filter(isBay)), info, errors };
}
const Q = 'mode=sail&hour=15&seed=1&attract=0&music=0&headless=1';
try {
  {
    const r = await load(DESK, `?${Q}&birth=fannette`);
    check(r.south.length === 0 && r.southBytes === 0, `bay start: 0 bytes of terrain/south/ (${r.south.length} files)`);
    check(JSON.stringify(r.breaks) === '["shore.vsf.gz"]' && r.info.rocks === 'bay' && r.info.forest?.[0] === -4608, `bay start: the bay's shore-break field alone, the bay's rocks box and forest region (${JSON.stringify(r.breaks)}, ${r.info.rocks}, ${JSON.stringify(r.info.forest)})`);
    check(['terrain/bay-h.lsh', 'terrain/bay-c.lsh', 'terrain/bay-d.lsh'].every((f) => r.files.includes(f)) && r.bay.some((f) => f.startsWith('photo/full/bay/')), `bay start: the bay's level and photo fetched (${(r.bayBytes / 1e6).toFixed(2)} MB)`);
    check(r.info.level?.key === 'bay', `bay start: the page holds the bay's level (${JSON.stringify(r.info.level?.key)})`);
    check(r.piers.length === 0 && r.info.sets?.length === 0, `bay start: the south piers never requested (${r.piers.length} requests, sets ${JSON.stringify(r.info.sets)})`);
    check(r.errors.length === 0, `bay start: no page errors (${r.errors.slice(0, 2).join(' | ')})`);
    console.log(`  bay start: ${r.files.length} terrain/photo files; the bay's detail ${r.bay.length} files, ${r.bayBytes} B`);
  }
  {
    const r = await load(DESK, `?${Q}&birth=ski-run`);
    const want = ['terrain/south/south.json', 'terrain/south/photo/manifest.json', 'terrain/south/south-h.lsh', 'terrain/south/south-c.lsh', 'terrain/south/south-d.lsh'];
    check(want.every((f) => r.south.includes(f)) && r.south.every((f) => want.includes(f) || f.startsWith('terrain/south/photo/full/south/')), `Ski Run, desktop: only the 4 m set's files (${r.south.length} files)`);
    check(r.southBytes > 2.2e6 && r.southBytes < 2.32e6, `Ski Run, desktop: ${r.southBytes} B of terrain/south/ (about 2.26 MB)`);
    check(r.bay.length === 0, `Ski Run, desktop: none of the bay's detail (${r.bay.slice(0, 3).join(', ')})`);
    check(r.info.level?.key === 'south-lake' && r.info.photo === 'south', `Ski Run: the page holds South Lake's level and photo (${JSON.stringify({ key: r.info.level?.key, photo: r.info.photo })})`);
    check(Math.abs(r.info.depth - 22.85) < 0.1 && r.info.spacing === 4, `Ski Run: the live sampler reads ${r.info.depth.toFixed(2)} m at the pin on the ${r.info.spacing} m level`);
    check(r.info.boat && Math.hypot(r.info.boat.x - 11800, r.info.boat.z + 875) < 150 && r.info.boat.x > 11800, `Ski Run: she started at the pin and sails east on the afternoon's reach (${JSON.stringify(r.info.boat)})`);
    check(r.piers.length === 1 && JSON.stringify(r.info.sets) === '["south"]', `Ski Run, desktop: the south piers fetched once and merged (${r.piers.length} request, sets ${JSON.stringify(r.info.sets)}, ${r.info.instances} instances)`);
    check(JSON.stringify(r.breaks) === '["shore-south.vsf.gz"]' && r.info.shore > 1500 && r.info.rocks === 'south-lake' && r.info.forest?.[0] === 6656, `Ski Run, desktop: the south shore-break field alone (${r.info.shore} tiles), the south rocks box and forest region (${JSON.stringify(r.breaks)}, ${r.info.rocks}, ${JSON.stringify(r.info.forest)})`);
    check(r.errors.length === 0, `Ski Run, desktop: no page errors (${r.errors.slice(0, 2).join(' | ')})`);
  }
  {
    const r = await load(PHONE, `?${Q}&birth=ski-run&terrain=phone`);
    const want = ['terrain/south/south-phone.json', 'terrain/south/photo/manifest.json', 'terrain/south/south-h2.lsh', 'terrain/south/south-c.lsh', 'terrain/south/south-d2.lsh'];
    check(want.every((f) => r.south.includes(f)) && r.south.every((f) => want.includes(f) || f.startsWith('terrain/south/photo/phone/south/')), `Ski Run, phone: only the 8 m set's files (${r.south.length} files)`);
    check(r.southBytes > 0.7e6 && r.southBytes < 0.8e6, `Ski Run, phone: ${r.southBytes} B of terrain/south/ (about 0.75 MB)`);
    check(r.bay.length === 0 && r.info.spacing === 8, `Ski Run, phone: none of the bay's detail, the 8 m level under her (${r.info.spacing} m)`);
    check(r.piers.length === 1 && JSON.stringify(r.info.sets) === '["south"]', `Ski Run, phone: the south piers fetched once and merged (${r.piers.length} request, sets ${JSON.stringify(r.info.sets)})`);
    check(JSON.stringify(r.breaks) === '["shore-south.vsf.gz"]' && r.info.rocks === 'south-lake' && r.info.forest?.[0] === 6656, `Ski Run, phone: the south shore-break field, rocks box and forest region (${JSON.stringify(r.breaks)}, ${r.info.rocks}, ${JSON.stringify(r.info.forest)})`);
    check(r.errors.length === 0, `Ski Run, phone: no page errors (${r.errors.slice(0, 2).join(' | ')})`);
  }
  {
    // the home card: a first visit on the bay's level; a pick of Off Ski Run reloads onto South Lake's level and she starts there
    const ctx = await browser.newContext(DESK);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
    await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0&music=0`, { waitUntil: 'load' });
    const home = () => page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.birthplaces && window.__velia?.terrainLevel, null, { timeout: 240000, polling: 200 });
    await home();
    const before = await page.evaluate(() => window.__velia.terrainLevel.key);
    await Promise.all([page.waitForEvent('load', { timeout: 60000 }), page.evaluate(() => window.__velia.birthplaces.pick('ski-run'))]);
    await home();
    const after = await page.evaluate(() => { const v = window.__velia, s = v.boat.state; return { key: v.terrainLevel.key, current: v.birthplaces.current, x: s.x, z: s.z }; });
    check(before === 'bay' && after.key === 'south-lake' && after.current === 'ski-run' && Math.hypot(after.x - 11800, after.z + 875) < 150, `home card: the Ski Run pin reloads onto South Lake's level and she is there (${before} → ${JSON.stringify(after)})`);
    check(errors.length === 0, `home card: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
process.exit(fails ? 1 : 0);
