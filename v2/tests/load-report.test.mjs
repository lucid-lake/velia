// The load report's builder (v2/ui/loadReportData.js) and recorder (v2/engine/loadRecorder.js), from synthetic timings: the
// stages in order with their durations, the blocker picked (CPU, network, stuck, failed), the chat text within 3,000
// characters, and no full URL, query string or key anywhere in the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoadReport, reportText, cleanPath, stagesFrom, pickBlocker, uaFamily, TEXT_MAX } from '../ui/loadReportData.js';
import { startLoadRecorder, BEAT_MS } from '../engine/loadRecorder.js';

const ORIGIN = 'https://velia.example';
const span = (n, a, b) => [{ name: `velia:${n}:s`, startTime: a }, ...(b == null ? [] : [{ name: `velia:${n}:e`, startTime: b }])];
const pt = (n, t) => ({ name: `velia:${n}`, startTime: t });
const res = (path, start, dur, sent = 50000, extra = {}) => ({ name: `${ORIGIN}${path}`, initiatorType: 'fetch', startTime: start, requestStart: start + 5, responseStart: start + 40, responseEnd: start + dur, transferSize: sent, encodedBodySize: sent, decodedBodySize: sent * 2, nextHopProtocol: 'h2', ...extra });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

// a load: the HTML, the loading screen's script, the gate, the engine's chunk, the device, the world, the pipelines (long),
// the sky, the terrain's wait, the boat, the card
function marks({ pipe = 6200, terrainWait = 300 } = {}) {
  let t = 900;
  const m = [pt('index', 420), ...span('fonts', 420, 700), ...span('gate', 450, 520), ...span('main', 520, 900)];
  const seg = (n, d) => { m.push(...span(n, t, t + d)); t += d; };
  seg('device', 80);
  m.push(...span('manifests', t + 5, t + 200));
  m.push(...span('terrain1', t + 60, t + 1500));
  seg('world', 350); seg('pipelines', pipe); seg('sky', 120); seg('terrain.wait', terrainWait); seg('boat', 330);
  m.push(pt('frame1', t));
  m.push(...span('card', t, t + 1100));
  m.push(...span('controls', t - 200, t + 600));
  return { marks: m, frame1: t };
}
const NAV = { responseStart: 120, responseEnd: 180, domInteractive: 300, transferSize: 110000, nextHopProtocol: 'h2', type: 'navigate' };
const device = { ua: IPHONE, touch: 5, cores: 6, memGB: null, screen: { w: 390, h: 844 }, viewport: { w: 844, h: 390 }, dpr: 3, conn: { effectiveType: '4g', downlink: 9.5, rtt: 60 }, standalone: false };

test('the stages come in time order with their durations; html and the first script from the navigation timing', () => {
  const { marks: m } = marks();
  const { stages, points } = stagesFrom(m, NAV, 20000);
  for (let i = 1; i < stages.length; i++) assert.ok(stages[i].start >= stages[i - 1].start, `${stages[i].name} after ${stages[i - 1].name}`);
  const by = Object.fromEntries(stages.map((s) => [s.name, s]));
  assert.deepEqual([by.html.start, by.html.end], [0, 300]);
  assert.deepEqual([by.index.start, by.index.end], [300, 420]);
  assert.equal(by.pipelines.dur, 6200);
  assert.equal(by.device.dur, 80);
  assert.ok(by.pipelines.crit && !by.terrain1.crit, 'the path\'s stages are marked, the side ones not');
  assert.ok(points.some((p) => p.name === 'frame1'));
  // an open stage runs to now
  const open = stagesFrom([...span('pipelines', 1000)], null, 4000).stages[0];
  assert.equal(open.open, true); assert.equal(open.dur, 3000);
});

test('the blocker: a long pipeline build with the main thread held is CPU', () => {
  const { marks: m } = marks({ pipe: 6200 });
  const rep = buildLoadReport({ marks: m, nav: NAV, device, origin: ORIGIN, now: 15000, resources: [res('/assets/main-AbC123.js', 520, 350, 260000)],
    rec: { observed: { longtask: true }, longTasks: [{ start: 1400, dur: 2900, attr: 'self' }, { start: 4400, dur: 2600, attr: 'self' }], stalls: [], heap: [] } });
  assert.equal(rep.blocker.kind, 'cpu');
  assert.equal(rep.blocker.name, 'pipelines');
  assert.match(rep.blocker.text, /^shader \+ pipeline build 6\.2 s \(\d+ % of the [\d.]+ s path\): main thread busy 5\.\d s, longest task 2\.9 s$/);
  assert.equal(rep.totals.done, true);
  assert.equal(rep.slowStages[0].name, 'pipelines');
});

test('the blocker: a long wait for the terrain\'s first stage names its downloads and the network', () => {
  const { marks: m } = marks({ pipe: 400, terrainWait: 4100 });
  // the terrain's files finish inside the wait (pipelines end at 1730, the sky at 1850, the wait to 5950)
  const terr = [res('/terrain/bay-h2.bin', 1050, 4800, 843000), res('/terrain/far-h3.bin', 1050, 3900, 300000), res('/terrain/cover.bin', 1050, 2600, 120000)];
  const rep = buildLoadReport({ marks: m, nav: NAV, device, origin: ORIGIN, now: 9000, resources: [res('/assets/main-AbC123.js', 520, 350, 260000), ...terr], rec: { observed: { longtask: false }, longTasks: [], stalls: [{ start: 1300, dur: 200 }], heap: [] } });
  assert.equal(rep.blocker.kind, 'net');
  assert.equal(rep.blocker.name, 'terrain.wait');
  assert.match(rep.blocker.text, /^wait for terrain stage 1 4\.1 s .*: download 3 files 1\.2 MB, slowest \/terrain\/bay-h2\.bin 4\.8 s on 4g$/);
  assert.equal(rep.main.source, 'stalls', 'Safari: the heartbeat\'s stalls stand in for long tasks');
  assert.equal(rep.slowFiles[0].path, '/terrain/bay-h2.bin');
});

test('the blocker: a load that never finished is stuck in its open stage; a failed start says where', () => {
  const m = [pt('index', 400), ...span('gate', 450, 500), ...span('main', 500, 900), ...span('device', 900, 980), ...span('world', 980, 1300), ...span('pipelines', 1300)];
  const stuck = buildLoadReport({ marks: m, nav: NAV, device, origin: ORIGIN, now: 60000 });
  assert.equal(stuck.totals.done, false);
  assert.equal(stuck.blocker.kind, 'stuck');
  assert.equal(stuck.blocker.text, 'stuck in shader + pipeline build: started at 1.3 s, not finished at 60.0 s');
  assert.match(reportText(stuck), /NOT READY at 60\.0 s/);
  const failed = buildLoadReport({ marks: [...m, pt('fail', 2500)], nav: NAV, device, origin: ORIGIN, now: 3000, errors: [`pipeline "water": bad WGSL at ${ORIGIN}/assets/water.js?v=9&token=abc`] });
  assert.equal(failed.blocker.kind, 'fail');
  assert.match(failed.blocker.text, /^start failed in shader \+ pipeline build at 2\.5 s: pipeline "water": bad WGSL at \/assets\/water\.js$/);
});

test('the gaps between the path\'s stages count too (a script fetched between two)', () => {
  const m = [...span('gate', 400, 450), ...span('main', 3450, 3600), ...span('device', 3600, 3700), pt('frame1', 3800)];
  const { stages, points } = stagesFrom(m, null, 4000);
  const b = pickBlocker({ stages, points, resources: [{ path: '/start-x.js', start: 460, dur: 2950, sentKB: 12 }], tasks: [], done: true });
  assert.equal(b.name, 'gate>main');
  assert.match(b.text, /^between WebGPU check \(adapter\) and engine download \+ start 3\.0 s .*: download \/start-x\.js 12 kB$/);
});

test('the chat text fits 3,000 characters with hundreds of files, many stages and long errors; the device line reads', () => {
  const { marks: m } = marks();
  const extra = Array.from({ length: 40 }, (_, i) => span(`extra${i}`, 2000 + i * 10, 2100 + i * 10)).flat();
  const files = Array.from({ length: 600 }, (_, i) => res(`/terrain/a-very-long-folder-name-for-the-tiles/tile-${i}-with-a-long-name.bin`, 1000 + i, 500 + i, 4000));
  const rep = buildLoadReport({ marks: [...m, ...extra], nav: NAV, device, origin: ORIGIN, now: 15000, resources: files, errors: Array(9).fill('x'.repeat(900)),
    facts: { gpu: { vendor: 'apple', architecture: 'common-3', description: '' }, quality: { level: 1, name: 'L1 balanced', source: 'guess' }, phoneFlat: true } });
  const text = reportText(rep);
  assert.ok(text.length <= TEXT_MAX, `${text.length} chars`);
  assert.match(text, /iPhone · iOS 18\.6 · Safari 26\.0 \| 844x390 @3 \| 6 cores \| net 4g 9\.5 Mbps 60 ms \| browser tab/);
  assert.match(text, /GPU apple common-3 · quality L1 balanced \(guess\) · flat controls/);
  assert.match(text, /Likely blocker: /);
  assert.match(text, /\*shader \+ pipeline build/);
  assert.equal(rep.resources.length, 600, 'the JSON keeps every file');
  // a small load keeps every stage in the text
  const small = reportText(buildLoadReport({ marks: m, nav: NAV, device, origin: ORIGIN, now: 15000 }));
  assert.ok(small.includes('terrain stage 1 fetch + decode'));
});

test('no full URL, query string or key leaves the report', () => {
  const key = ['sk', 'live', '9f8e7d6c5b4a39281706f5e4d3c2b1a0ffeeddcc'].join('_'); // made up; built in parts so secret scanners do not flag a fake key
  const { marks: m } = marks();
  const rep = buildLoadReport({ marks: m, nav: NAV, device, origin: ORIGIN, now: 15000, page: '/play/?seed=1&key=secret', params: ['seed', 'loadreport'],
    resources: [res(`/api/thing?key=${key}&x=1#frag`, 1000, 300), res(`/files/${key}/data.bin`, 1000, 200), { ...res('/font.woff2', 10, 90), name: 'https://fonts.example.com/s/font.woff2?token=zzz' }, { ...res('/x', 1, 1), name: 'data:image/png;base64,AAAA' }],
    errors: [`fetch failed: https://velia.example/terrain/a.bin?sig=${key}`] });
  const all = JSON.stringify(rep) + reportText(rep);
  assert.ok(!all.includes(key), 'no key');
  assert.ok(!/https?:\/\//.test(all), 'no scheme or host');
  assert.ok(!/[?#&]\w+=/.test(all.replace(/"params":\[[^\]]*\]/, '')), 'no query string');
  assert.ok(!all.includes('velia.example') && !all.includes('fonts.example.com'), 'no host');
  assert.equal(cleanPath(`${ORIGIN}/assets/main-B1x2Y3z4.js?v=3`, ORIGIN), '/assets/main-B1x2Y3z4.js', 'a hashed asset keeps its name');
  assert.equal(cleanPath(`https://cdn.other.example/a/b.js`, ORIGIN), '(ext) /a/b.js');
  assert.equal(cleanPath(`${ORIGIN}/files/${key}/data.bin`, ORIGIN), '/files/…/data.bin');
  assert.deepEqual(rep.params, ['seed', 'loadreport'], 'the flags by name only');
});

test('the user agent in a few words', () => {
  assert.equal(uaFamily(IPHONE).text, 'iPhone · iOS 18.6 · Safari 26.0');
  assert.equal(uaFamily('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36').text, 'Android · Android 14 · Chrome 131');
  assert.equal(uaFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', 5).dev, 'iPad', 'an iPad asks as a Mac, with touch');
});

test('the recorder: late heartbeats are stalls, long tasks where the browser has them, and it stops', () => {
  let now = 0;
  const q = [];
  const perf = { now: () => now, memory: { usedJSHeapSize: 50 * 1048576, jsHeapSizeLimit: 4096 * 1048576 } };
  let cb = null;
  class PO { constructor(f) { cb = f; } observe() {} disconnect() { cb = null; } static supportedEntryTypes = ['longtask']; }
  const rec = startLoadRecorder({ perf, PO, setT: (f) => { q.push(f); return q.length; }, clearT: () => {} });
  const run = (dt) => { now += dt; const f = q.shift(); f?.(); };
  run(BEAT_MS); run(BEAT_MS); run(900); run(BEAT_MS);
  cb({ getEntries: () => [{ startTime: 120, duration: 850, attribution: [{ name: 'self', containerType: 'window' }] }] });
  rec.stop();
  const d = rec.data();
  assert.deepEqual(d.stalls.map((s) => [s.start, s.dur]), [[150, 850]]);
  assert.equal(d.longTasks.length, 1); assert.equal(d.longTasks[0].dur, 850); assert.equal(d.longTasks[0].attr, 'window');
  assert.equal(d.observed.longtask, true);
  assert.ok(d.heap.length >= 2 && Math.round(d.heap.at(-1).usedMB) === 50);
  assert.equal(rec.stopped, true);
  const n = q.length; run(BEAT_MS); assert.equal(q.length, Math.max(0, n - 1), 'no beat after stop');
});

test('perf(v2) iOS pipelines: the shaders\' facts name the slowest families in the blocker and the chat text', () => {
  const { marks: m } = marks({ pipe: 8200 });
  const facts = { pipes: { n: 37, ms: 8200, families: [['water', 3100, 8], ['terrain', 2400, 6], ['boat', 1900, 7], ['sky', 500, 5]], top: [['water', 2900]], deferred: 58, slow: true },
    pipesLate: { core: { n: 37, ms: null }, forest: { n: 15, ms: 4100 }, towns: { n: 5, ms: 1500 } } };
  const rep = buildLoadReport({ marks: m, nav: NAV, device, origin: ORIGIN, now: 20000, facts });
  assert.equal(rep.blocker.name, 'pipelines');
  assert.match(rep.blocker.text, /^shader \+ pipeline build 8\.2 s .*; slowest water 3\.1 s \(8\), terrain 2\.4 s \(6\), boat 1\.9 s \(7\)$/);
  assert.deepEqual([rep.pipes.n, rep.pipes.late.n, rep.pipes.late.ms], [37, 20, 5600]);
  assert.match(reportText(rep), /\nShaders: 37 before the first frame 8\.2 s \(water 3\.1 s \(8\), terrain 2\.4 s \(6\), boat 1\.9 s \(7\)\); 20 after the card 5\.6 s · slow compiler\n/);
  assert.equal(buildLoadReport({ marks: m, nav: NAV, device, origin: ORIGIN, now: 20000 }).pipes, null, 'no facts: no line');
});

test('a phone that builds every shader first: the modes-ready time and the build line (owner 2026-11-17)', () => {
  const { marks: m, frame1 } = marks({ pipe: 9000 });
  const all = [...m, ...span('handover', frame1, frame1 + 1300), ...span('modes', frame1, frame1 + 15400)];
  const facts = { pipes: { n: 33, ms: 9000, families: [['water', 2000, 4]], deferred: 55 }, build: { first: true, n: 88, built: 88, ms: 15400 } };
  const rep = buildLoadReport({ marks: all, nav: NAV, device, origin: ORIGIN, now: frame1 + 16000, facts });
  assert.equal(rep.totals.modes, frame1 + 15400, 'the modes lit when every shader was built');
  assert.ok(rep.stages.some((s) => s.name === 'modes' && /modes ready/.test(s.label)));
  assert.deepEqual(rep.pipes.build, { n: 88, built: 88, ms: 15400 });
  const txt = reportText(rep);
  assert.match(txt, /modes ready \d+\.\d\d s/); assert.match(txt, /phone: all 88 of 88 built before the modes, 15\.4 s after the first frame/);
  const desk = buildLoadReport({ marks: m, nav: NAV, device, origin: ORIGIN, now: frame1 + 2000, facts: { pipes: facts.pipes } });
  assert.equal(desk.totals.modes, null, 'a tablet or a desktop: no such stage'); assert.equal(desk.pipes.build, null);
});
