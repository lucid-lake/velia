// feat/metrics: the anonymous play counts. The client (src/metrics.js) sends nothing headless, with Do Not Track or
// ?notrack, batches and caps its size; the function (functions/api/e.js) rejects garbage and oversize input and writes
// the expected fields; and no personal field exists anywhere. Pure: no browser, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMetrics, tracking, EVENTS, LIMITS, clean, fileOf, gpuClass, GPU_CLASSES, loadSteps, LOAD_WHY } from '../src/metrics.js';
import { handle, pointOf, uidOf } from '../functions/api/e.js';

const live = { search: '', hostname: 'velia.lucidlakelabs.com' };
const rig = (env = live) => {
  const sent = [], timers = [];
  const m = createMetrics({ env, send: (url, body) => sent.push({ url, body }), setTimer: (f) => timers.push(f) && timers.length, clearTimer: () => {} });
  return { m, sent, timers, events: () => sent.flatMap((s) => JSON.parse(s.body).e) };
};

test('nothing is sent headless, automated, with DNT / GPC, ?notrack, or on a dev host', () => {
  for (const env of [
    { ...live, search: '?headless=1&hour=6' }, { ...live, search: '?noload=1' }, { ...live, search: '?notrack' }, { ...live, search: '?metrics=0' },
    { ...live, webdriver: true }, { ...live, dnt: '1' }, { ...live, gpc: true }, { search: '', hostname: 'localhost' }, { search: '', hostname: '127.0.0.1' }, { search: '', hostname: '192.168.1.20' },
  ]) {
    const r = rig(env);
    assert.equal(r.m.enabled, false, JSON.stringify(env));
    assert.equal(r.m.track('session_start', { mode: 'sail' }), false);
    r.m.flush();
    assert.equal(r.sent.length, 0);
  }
  assert.equal(tracking({ search: '?metrics=1', hostname: 'localhost' }), true, '?metrics=1 turns it on for a test');
  assert.equal(tracking(live), true);
});

test('events batch: one send for a few, at the flush; urgent ones go at once', () => {
  const r = rig();
  r.m.track('session_start', { mode: 'sail', device: 'phone', backend: 'webgpu', tier: 'low', first_visit: true, lang: 'en' });
  r.m.track('set_sail', { mode: 'sail' });
  assert.equal(r.sent.length, 0, 'queued, not sent');
  assert.equal(r.timers.length, 1, 'one flush timer');
  r.timers[0]();
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].url, '/api/e');
  assert.deepEqual(r.events().map((e) => e.n), ['session_start', 'set_sail']);
  r.m.track('gpu_lost', { reason: 'device lost' });
  assert.equal(r.sent.length, 2, 'gpu_lost is flushed at once');
});

test('size is capped: a batch holds at most 20 events and 4096 bytes; long text is cut; a crash loop is limited', () => {
  const r = rig();
  for (let i = 0; i < 100; i++) r.m.track('set_sail', { mode: 'sail' });
  r.m.flush();
  assert.ok(r.m.pending === 0);
  assert.ok(r.sent.every((s) => s.body.length <= LIMITS.bodyBytes), 'every body is under the cap');
  assert.ok(r.sent.every((x) => JSON.parse(x.body).e.length <= LIMITS.batch), 'at most 20 events a send');
  assert.equal(r.events().length, 100, 'flushed in batches, none lost');
  const r2 = rig();
  r2.m.track('js_error', { msg: 'x'.repeat(5000), file: 'https://velia.lucidlakelabs.com/assets/a.js?token=SECRET#h', line: 12 });
  r2.m.flush();
  const e = r2.events()[0];
  assert.ok(e.p.msg.length <= LIMITS.str && e.p.file.length <= LIMITS.file);
  assert.ok(!/SECRET|token|https?:/.test(JSON.stringify(e)), 'no query string, no origin');
  const r3 = rig();
  for (let i = 0; i < 30; i++) r3.m.track('js_error', { msg: 'boom', line: i });
  r3.m.flush();
  assert.equal(r3.events().length, 5, 'at most 5 js_error a page load');
});

test('only the listed events and fields go out; emails and query strings are scrubbed', () => {
  const r = rig();
  assert.equal(r.m.track('anything_else', {}), false);
  r.m.track('set_sail', { mode: 'sail', email: 'a@b.co', userId: 7 });
  assert.deepEqual(r.m.pending, 1);
  r.m.flush();
  assert.deepEqual(r.events()[0], { n: 'set_sail', p: { mode: 'sail' } });
  assert.equal(clean('mail me at jo@example.com see https://x.io/p?a=1#z'), 'mail me at <email> see https://x.io/p');
  assert.equal(fileOf('https://velia.lucidlakelabs.com/assets/index-abc.js?v=3'), '/assets/index-abc.js');
});

// ---- the function ----
const req = (body, { method = 'POST', headers = {} } = {}) => new Request('https://velia.lucidlakelabs.com/api/e', { method, body: typeof body === 'string' || body == null ? body : JSON.stringify(body), headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 (iPhone) Safari', 'cf-ipcountry': 'US', 'cf-connecting-ip': '203.0.113.7', ...headers } });
const envWith = () => { const pts = []; return { pts, VELIA_EVENTS: { writeDataPoint: (p) => pts.push(p) }, VELIA_SALT: 'pepper' }; };
const day1 = new Date('2026-11-01T10:00:00Z'), day2 = new Date('2026-11-02T10:00:00Z');

test('the function writes the expected fields', async () => {
  const env = envWith();
  const res = await handle(req({ v: 1, e: [{ n: 'session_start', p: { mode: 'sail', device: 'phone', backend: 'webgl2', tier: 'low', first_visit: true, lang: 'en' } }, { n: 'session_end', p: { duration_s: 61.5 } }, { n: 'js_error', p: { msg: 'x is undefined', file: '/assets/a.js', line: 9 } }, { n: 'goal_reached' }] }), env, day1);
  assert.equal(res.status, 204);
  assert.equal(env.pts.length, 4);
  const [a, b, c, d] = env.pts;
  assert.deepEqual(a.indexes, ['session_start']);
  assert.deepEqual(a.blobs.slice(0, 8), ['session_start', 'US', 'sail', 'phone', 'webgl2', 'low', 'en', '1']);
  assert.match(a.blobs[8], /^[0-9a-f]{16}$/);
  assert.equal(b.doubles[0], 61.5);
  assert.deepEqual([c.blobs[9], c.blobs[10], c.doubles[1]], ['x is undefined', '/assets/a.js', 9]);
  assert.equal(d.blobs[0], 'goal_reached');
  assert.ok(env.pts.every((p) => p.doubles[3] === 1 && p.blobs.length === 15 && p.doubles.length === 5 && p.blobs[8] === a.blobs[8]), 'one uid per request');
});

test('load_fail says which visitors fail: device, backend and a coarse GPU class, each an enum (perf/shader-warmup)', async () => {
  const env = envWith();
  await handle(req({ v: 1, e: [
    { n: 'load_fail', p: { stage: 'sky:warm', device: 'desktop', backend: 'webgl2', gpu: 'software' } },
    { n: 'load_fail', p: { stage: 'sky', device: 'fridge', backend: 'webgl1', gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)' } },
    { n: 'session_start', p: { mode: 'sail', device: 'desktop', backend: 'webgpu', gpu: 'apple' } },
  ] }), env, day1);
  const [a, b, c] = env.pts;
  assert.deepEqual([a.blobs[3], a.blobs[4], a.blobs[9], a.blobs[11]], ['desktop', 'webgl2', 'sky:warm', 'software']);
  assert.deepEqual([b.blobs[3], b.blobs[4], b.blobs[11]], ['', '', ''], 'unknown labels and a raw renderer string are dropped');
  assert.equal(c.blobs[11], 'apple');
  assert.deepEqual(EVENTS.load_fail.slice(0, 4), ['stage', 'device', 'backend', 'gpu']);
  // the client classifies; it never sends the adapter's or the driver's own words
  assert.equal(gpuClass({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' }), 'software');
  assert.equal(gpuClass({ vendor: 'apple' }), 'apple');
  assert.equal(gpuClass({ renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'nvidia');
  assert.equal(gpuClass({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'intel');
  assert.equal(gpuClass({ renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'amd');
  assert.equal(gpuClass({ renderer: 'Adreno (TM) 740' }), 'mobile');
  assert.equal(gpuClass({ vendor: 'qualcomm' }), 'mobile');
  assert.equal(gpuClass({ vendor: 'x', fallback: true }), 'software');
  assert.equal(gpuClass({ renderer: 'Some New GPU' }), 'other');
  assert.equal(gpuClass({}), '');
  for (const g of GPU_CLASSES) assert.match(g, /^[a-z]{3,8}$/);
});

test('the same visitor has one uid a day and a different one the next; the salt matters; the IP is not in it', async () => {
  const mk = (ip, ua = 'UA', salt = 'pepper', day = '2026-11-01') => uidOf({ ip, ua, salt, day });
  assert.equal(await mk('1.2.3.4'), await mk('1.2.3.4'));
  assert.notEqual(await mk('1.2.3.4'), await mk('1.2.3.4', 'UA', 'pepper', '2026-11-02'));
  assert.notEqual(await mk('1.2.3.4'), await mk('1.2.3.5'));
  assert.notEqual(await mk('1.2.3.4'), await mk('1.2.3.4', 'UA', 'other'));
  const env = envWith();
  await handle(req({ v: 1, e: [{ n: 'set_sail', p: { mode: 'sail' } }] }), env, day1);
  await handle(req({ v: 1, e: [{ n: 'set_sail', p: { mode: 'sail' } }] }), env, day2);
  assert.notEqual(env.pts[0].blobs[8], env.pts[1].blobs[8], 'rotates daily');
  assert.ok(!JSON.stringify(env.pts).includes('203.0.113.7') && !JSON.stringify(env.pts).includes('iPhone'), 'neither the IP nor the user agent is stored');
});

test('the function rejects garbage and oversize input, and writes nothing for them', async () => {
  const bad = [
    ['not json', 400], ['{"v":1}', 400], [{ v: 2, e: [{ n: 'set_sail' }] }, 400], [{ v: 1, e: [] }, 400], [{ v: 1, e: 'x' }, 400],
    [{ v: 1, e: [{ n: 'purchase', p: {} }] }, 400], [{ v: 1, e: [null] }, 400], [{ v: 1, e: Array.from({ length: 21 }, () => ({ n: 'set_sail' })) }, 400],
    [JSON.stringify({ v: 1, e: [{ n: 'js_error', p: { msg: 'x'.repeat(5000) } }] }), 413],
  ];
  for (const [body, status] of bad) {
    const env = envWith();
    assert.equal((await handle(req(body), env, day1)).status, status, String(typeof body === 'string' ? body.slice(0, 30) : JSON.stringify(body).slice(0, 40)));
    assert.equal(env.pts.length, 0);
  }
  const env = envWith();
  assert.equal((await handle(req(null, { method: 'GET' }), env, day1)).status, 405);
  assert.equal((await handle(req({ v: 1, e: [{ n: 'set_sail' }] }, { headers: { 'content-length': '999999' } }), env, day1)).status, 413);
});

test('the function drops and cleans: DNT, GPC, bots write nothing; labels are enums; text is cut', async () => {
  for (const headers of [{ dnt: '1' }, { 'sec-gpc': '1' }, { 'user-agent': 'Googlebot/2.1' }]) {
    const env = envWith();
    assert.equal((await handle(req({ v: 1, e: [{ n: 'set_sail', p: { mode: 'sail' } }] }, { headers }), env, day1)).status, 204);
    assert.equal(env.pts.length, 0);
  }
  const env = envWith();
  await handle(req({ v: 1, e: [{ n: 'session_start', p: { mode: '<script>', device: 'toaster', backend: 7, lang: 'x'.repeat(40), first_visit: 'yes' } }, { n: 'load_fail', p: { stage: 'sky '.repeat(100) } }] }, { headers: { 'cf-ipcountry': 'T1' } }), env, day1);
  assert.deepEqual(env.pts[0].blobs.slice(1, 8), ['XX', '', '', '', '', '', ''], 'unknown labels and a non-country header become empty / XX');
  assert.ok(env.pts[1].blobs[9].length <= LIMITS.str);
  assert.equal(pointOf({ n: 'regatta_finish', p: { place: 99, level: 'Easy!' } }).place, 0);
  assert.equal((await handle(req({ v: 1, e: [{ n: 'set_sail' }] }), {}, day1)).status, 503, 'no binding: say so');
});

test('session_start\'s display: the client sends it, the function writes it as blob15; v1 without it and unknown values or fields write nothing', async () => {
  const r = rig();
  r.m.track('session_start', { mode: 'sail', device: 'phone', display: 'standalone', secret: 'x' });
  r.m.flush();
  assert.deepEqual(r.events()[0].p, { mode: 'sail', device: 'phone', display: 'standalone' }, 'the event carries display, never an unknown field');
  const env = envWith();
  await handle(req({ v: 1, e: [
    { n: 'session_start', p: { mode: 'sail', display: 'standalone' } }, { n: 'session_start', p: { mode: 'sail', display: 'fullscreen' } },
    { n: 'session_start', p: { mode: 'sail', display: 'browser' } }, { n: 'session_start', p: { mode: 'sail' } },
    { n: 'session_start', p: { mode: 'sail', display: 'kiosk', foo: 'bar' } }, { n: 'set_sail', p: { mode: 'sail', display: 'standalone' } }] }), env, day1);
  assert.deepEqual(env.pts.map((p) => p.blobs[14]), ['standalone', 'fullscreen', 'browser', '', '', ''], 'the three modes; none from v1; an unknown value and another event: empty');
  assert.ok(env.pts.every((p) => p.blobs.length === 15 && !p.blobs.includes('bar')), 'an unknown field is never written');
});

test('no personal field exists anywhere: events, the function, the page', () => {
  const fields = Object.values(EVENTS).flat();
  for (const f of fields) assert.ok(!/ip|mail|user|name|id$|token|cookie|stack|ua$|agent|city|region|lat|lon/i.test(f.replace(/^(first_visit|duration_s)$/, '')), `field ${f}`);
  const strip = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const client = strip(readFileSync(new URL('../src/metrics.js', import.meta.url), 'utf8'));
  const server = strip(readFileSync(new URL('../functions/api/e.js', import.meta.url), 'utf8'));
  for (const [n, src] of [['client', client], ['server', server]]) {   // kept: a privacy lint (no cookie, storage or fingerprinting API anywhere in either file)
    assert.ok(!/document\.cookie|localStorage|sessionStorage|indexedDB|set-cookie|\.stack\b|getTimezone|resolvedOptions|canvas|fingerprint/i.test(src), `${n}: no cookie, storage, stack or fingerprinting`);
  }
});

test('the function stores the country only: no IP, browser string, city, region, coordinates or postcode', async () => {
  // every location and identity header Cloudflare can add, with values that are easy to find in the stored points
  const headers = { 'cf-connecting-ip': '198.51.100.23', 'x-forwarded-for': '198.51.100.23', 'x-real-ip': '198.51.100.23', 'user-agent': 'Mozilla/5.0 (Macintosh) Firefox/140.0 Zyzzyva',
    'cf-ipcountry': 'nz', 'cf-ipcity': 'Queenstown', 'cf-region': 'Otago', 'cf-region-code': 'OTA', 'cf-iplatitude': '-45.0312', 'cf-iplongitude': '168.6626',
    'cf-postal-code': '9300', 'cf-ipcontinent': 'OC', 'cf-timezone': 'Pacific/Auckland', 'cf-metro-code': '777' };
  const env = envWith();
  assert.equal((await handle(req({ v: 1, e: [{ n: 'set_sail', p: { mode: 'sail' } }, { n: 'session_start', p: { mode: 'sail', device: 'desktop' } }] }, { headers }), env, day1)).status, 204);
  assert.equal(env.pts.length, 2);
  const stored = JSON.stringify(env.pts);
  for (const v of ['198.51.100', 'Zyzzyva', 'Firefox', 'Macintosh', 'Queenstown', 'Otago', 'OTA', '-45.03', '168.66', '9300', 'Pacific/Auckland', 'Auckland', '777', '"OC"']) assert.ok(!stored.includes(v), `stored: ${v}`);
  for (const p of env.pts) assert.equal(p.blobs[1], 'NZ', 'the country, upper-cased');
  // the IP and the browser string reach the store only through the daily hash: another IP or browser, another uid
  const uid = (h) => { const e = envWith(); return handle(req({ v: 1, e: [{ n: 'set_sail' }] }, { headers: { ...headers, ...h } }), e, day1).then(() => e.pts[0].blobs[8]); };
  const u0 = await uid({});
  assert.equal(u0, env.pts[0].blobs[8]); assert.match(u0, /^[0-9a-f]{16}$/);
  assert.notEqual(await uid({ 'cf-connecting-ip': '198.51.100.24' }), u0);
  assert.notEqual(await uid({ 'user-agent': 'Mozilla/5.0 (Macintosh) Firefox/141.0 Zyzzyva' }), u0);
  assert.equal(await uid({ 'cf-ipcity': 'Wanaka', 'cf-iplatitude': '-44.7' }), u0, 'the city never feeds the hash either');
});

test('the About page says it, and no other page markup changed', async () => {
  const { pagesHtml } = await import('../src/ui/homePages.js');
  const base = { waters: [], vessels: [], wChosen: '', vChosen: '', wSoon: '', vSoon: '' };
  for (const playtest of [false, true]) {
    const about = pagesHtml({ ...base, playtest }).match(/<section[^>]*data-page="about"[\s\S]*?<\/section>/)?.[0] ?? '';
    assert.match(about, /<p class="note">Velia counts anonymous plays to improve the game\. No cookies, no personal data\.<\/p>/, `on the About page (playtest ${playtest})`);
  }
});

test('load_fail tells left from timed out from failed, with the ms and each stage\'s seconds; load_late counts those who came back (perf/phone-load)', async () => {
  // the client: the steps line from the loading card's log (ms since its t0) and the boot's steps (ms from navigation)
  const steps = loadSteps({
    t0: 100,
    stages: [['gpu', 0.02, 11800], ['gpu', 0.03, 11820], ['terrain', 0.04, 13100], ['water', 0.12, 13200], ['trees', 0.26, 13700], ['shore', 0.42, 14400], ['sky', 0.72, 15200]],
    steps: [['warm', 15300], ['probe', 19100], ['compile', 21000]],
    now: 25600,
  });
  assert.equal(steps, 'mod 11.9 gpu 1.3 ter 0.1 wat 0.5 tre 0.7 sho 0.8 warm 3.8 prb 1.9 cmp 4.6+');
  assert.equal(loadSteps({ now: 4200 }), 'mod 4.2+', 'nothing logged yet: the modules are still loading');
  const long = loadSteps({ steps: Array.from({ length: 40 }, (_, i) => [`step${i}`, i * 1000]), now: 41000 });
  assert.ok(long.length <= LIMITS.steps && long.endsWith('step39 2.0+'), 'too long: the earliest steps go first');
  const r = rig();
  r.m.track('load_fail', { stage: 'sky:compile', why: 'left', ms: 25612.4, steps, device: 'phone', backend: 'webgpu', gpu: 'apple', id: 'x' });
  const [e] = r.events();
  assert.deepEqual(e.p, { stage: 'sky:compile', device: 'phone', backend: 'webgpu', gpu: 'apple', why: 'left', ms: 25612.4, steps });
  // the server: enums for why, a strict shape for steps, a bounded number for ms
  const env = envWith();
  await handle(req({ v: 1, e: [
    e,
    { n: 'load_fail', p: { stage: 'gpu', why: 'bored', ms: -5, steps: 'mod 1.0 <script>' } },
    { n: 'load_late', p: { ms: 41000 } },
  ] }), env, day1);
  const [a, b, c] = env.pts;
  assert.deepEqual([a.blobs[9], a.blobs[12], a.blobs[13], a.doubles[4]], ['sky:compile', 'left', steps, 25612.4]);
  assert.deepEqual([b.blobs[12], b.blobs[13], b.doubles[4]], ['', '', 0], 'an unknown why, a bad steps line and a negative ms are dropped');
  assert.deepEqual([c.blobs[0], c.doubles[4]], ['load_late', 41000]);
  for (const w of LOAD_WHY) assert.match(w, /^[a-z]{4,8}$/);
});
