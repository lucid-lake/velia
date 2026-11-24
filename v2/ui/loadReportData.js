// The load report's numbers (pure: no DOM; v2/tests/load-report.test.mjs): the boot's marks (engine/loadMarks.js), the
// browser's navigation and resource timing, the recorder's long tasks and stalls (engine/loadRecorder.js) and the device's
// facts, made into one report: the stages in order with their times, the slowest stages and files, the totals and the
// likely blocker. reportText() is the short form for a chat message (at most TEXT_MAX characters); the JSON is the report.
//   const rep = buildLoadReport(raw);   rep.blocker.text   reportText(rep)
// No full URL leaves here: a file is its path alone (no host, no query, no hash; long token-like segments masked).
const REPORT_V = 1;
export const TEXT_MAX = 3000;

// the stages the boot marks, in plain words; `crit` stages run one after another on the way to a playable card (their sum is
// the card's time, less small gaps); the rest run beside them
export const STAGES = Object.freeze({
  html: { label: 'HTML page', crit: true, net: true },
  index: { label: 'loading screen script', crit: true, net: true },
  gate: { label: 'WebGPU check (adapter)', crit: true },
  main: { label: 'engine download + start', crit: true, net: true },
  device: { label: 'GPU device', crit: true },
  world: { label: 'world build', crit: true },
  pipelines: { label: 'shader + pipeline build', crit: true },
  sky: { label: 'sky + clouds bake', crit: true },
  'terrain.wait': { label: 'wait for terrain stage 1', crit: true, net: true },
  boat: { label: 'boat + first frame', crit: true },
  card: { label: 'home card scripts', crit: true, net: true },
  handover: { label: 'card hand-over (by design)' },
  manifests: { label: 'terrain manifests', net: true },
  terrain1: { label: 'terrain stage 1 fetch + decode', net: true },
  fonts: { label: 'fonts', net: true },
  controls: { label: 'Sail controls', net: true },
  cockpit: { label: 'cockpit asset', net: true },
  audio: { label: 'audio setup' },
  'pipes.late': { label: 'shaders after the card' },
  modes: { label: 'modes ready (a phone: every shader built)' },   // owner 2026-11-17: a phone builds every pipeline, then presents the modes
});
const POINTS = Object.freeze({ index: 'loading screen script ran', frame1: 'first frame', 'worker.terrain': 'terrain worker made', 'worker.terrain.reply': 'terrain worker first reply', 'worker.wind': 'wind worker made', fail: 'start failed' });
const labelOf = (n) => STAGES[n]?.label ?? POINTS[n] ?? n;

const r1 = (x) => Math.round(x * 10) / 10;
const s2 = (ms) => (ms / 1000).toFixed(2);
const s1 = (ms) => (ms / 1000).toFixed(ms < 1000 ? 2 : 1);
const kB = (b) => Math.round((b ?? 0) / 1024);
const mb = (b) => (b / 1048576).toFixed(1);

// a URL as a path alone: no origin, query or hash; another site's file is "(ext) /path"; data: and blob: say only that
export function cleanPath(url, origin = '') {
  const s = String(url ?? '');
  if (/^data:/i.test(s)) return 'data:';
  if (/^blob:/i.test(s)) return 'blob:';
  let u;
  try { u = new URL(s, origin || 'http://local.invalid/'); } catch { return '?'; }
  const mask = (seg) => (seg.length >= 32 && /^[A-Za-z0-9_\-=%+.]+$/.test(seg) && !/\.[A-Za-z0-9]{1,5}$/.test(seg) ? '…' : seg);
  let p = u.pathname.split('/').map(mask).join('/');
  try { p = decodeURIComponent(p); } catch { /* keep it encoded */ }
  if (/^\/@fs\//.test(p)) p = `/@fs/…/${p.split('/').slice(-2).join('/')}`;   // a dev server's file-system path: never the machine's folders
  if (p.length > 72) p = `…${p.slice(-71)}`;
  return origin && u.origin !== origin ? `(ext) ${p}` : p;
}

// the user agent in a few words: the device, the OS and its version, the browser and its version
export function uaFamily(ua = '', touch = 0) {
  const s = String(ua);
  const ver = (re) => { const m = re.exec(s); return m ? m[1].replace(/_/g, '.') : ''; };
  let dev = '', os = '', br = '';
  const iPadDesk = /Macintosh/.test(s) && touch > 1;
  if (/iPhone/.test(s)) { dev = 'iPhone'; os = `iOS ${ver(/OS (\d+[_.]\d+(?:[_.]\d+)?)/)}`; }
  else if (/iPad/.test(s) || iPadDesk) { dev = 'iPad'; os = iPadDesk ? 'iPadOS' : `iPadOS ${ver(/OS (\d+[_.]\d+(?:[_.]\d+)?)/)}`; }
  else if (/Android/.test(s)) { dev = 'Android'; os = `Android ${ver(/Android (\d+(?:\.\d+)?)/)}`; }
  else if (/Macintosh/.test(s)) os = 'Mac';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux/.test(s)) os = 'Linux';
  if (/EdgA?\/|EdgiOS\//.test(s)) br = `Edge ${ver(/Edg(?:A|iOS)?\/(\d+)/)}`;
  else if (/SamsungBrowser\//.test(s)) br = `Samsung ${ver(/SamsungBrowser\/(\d+)/)}`;
  else if (/CriOS\//.test(s)) br = `Chrome ${ver(/CriOS\/(\d+)/)}`;
  else if (/FxiOS\//.test(s)) br = `Firefox ${ver(/FxiOS\/(\d+)/)}`;
  else if (/Firefox\//.test(s)) br = `Firefox ${ver(/Firefox\/(\d+)/)}`;
  else if (/HeadlessChrome\//.test(s)) br = `Headless Chrome ${ver(/HeadlessChrome\/(\d+)/)}`;
  else if (/Chrome\//.test(s)) br = `Chrome ${ver(/Chrome\/(\d+)/)}`;
  else if (/Safari\//.test(s)) br = `Safari ${ver(/Version\/(\d+(?:\.\d+)?)/)}`;
  return { dev, os: os.trim(), browser: br.trim(), text: [dev, os, br].filter((x) => x && x.trim()).join(' · ') || s.slice(0, 40) };
}

// the stages from the marks: `velia:x:s` + `velia:x:e` is a span, `velia:x` a point; html and the first script from the
// navigation's own timing (the HTML parsed at domInteractive; the first script's mark)
export function stagesFrom(marks = [], nav = null, now = Infinity) {
  const byName = new Map();
  const points = [];
  for (const m of marks) {
    if (!m?.name?.startsWith('velia:')) continue;
    const n = m.name.slice(6), t = m.startTime;
    const end = n.endsWith(':e'), start = n.endsWith(':s');
    if (start || end) {
      const k = n.slice(0, -2);
      const o = byName.get(k) ?? { name: k };
      if (start && o.start == null) o.start = t;
      if (end && o.end == null) o.end = t;
      byName.set(k, o);
    } else if (!points.some((p) => p.name === n)) points.push({ name: n, t });
  }
  const idx = points.find((p) => p.name === 'index');
  if (nav && nav.domInteractive > 0) {
    if (!byName.has('html')) byName.set('html', { name: 'html', start: 0, end: nav.domInteractive });
    if (idx && !byName.has('index')) byName.set('index', { name: 'index', start: nav.domInteractive, end: Math.max(nav.domInteractive, idx.t) });
  }
  const stages = [...byName.values()].filter((s) => s.start != null || s.end != null).map((s) => {
    const start = s.start ?? s.end, open = s.end == null, end = open ? Math.max(start, Number.isFinite(now) ? now : start) : s.end;
    return { name: s.name, label: labelOf(s.name), start: r1(start), end: r1(end), dur: r1(end - start), crit: !!STAGES[s.name]?.crit, open };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  points.sort((a, b) => a.t - b.t);
  return { stages, points: points.map((p) => ({ name: p.name, label: labelOf(p.name), t: r1(p.t) })) };
}

// a resource entry as the report keeps it
function resourceOf(e, origin = '') {
  const start = e.startTime ?? 0, end = e.responseEnd || start + (e.duration ?? 0);
  const sent = e.transferSize ?? 0, size = e.decodedBodySize ?? 0, enc = e.encodedBodySize ?? 0;
  const cache = sent === 0 && (size > 0 || enc > 0) ? 'hit' : sent > 0 && enc > 0 && sent < enc ? 'part' : sent > 0 ? 'net' : '?';
  return { path: cleanPath(e.name, origin), type: e.initiatorType ?? '', start: r1(start), dur: r1(end - start),
    wait: e.responseStart > 0 && e.requestStart > 0 ? r1(e.responseStart - e.requestStart) : null, sentKB: kB(sent), sizeKB: kB(size || enc), cache, proto: e.nextHopProtocol || '' };
}

// how long the main thread was held inside [a, b] (long tasks, or the heartbeat's stalls where the browser has none)
function busyIn(a, b, tasks = []) {
  let sum = 0, longest = null;
  for (const t of tasks) {
    const o = Math.min(b, t.start + t.dur) - Math.max(a, t.start);
    if (o > 0) { sum += o; if (!longest || t.dur > longest.dur) longest = t; }
  }
  return { ms: sum, longest };
}

// the likely blocker: the longest stage on the way to the playable card (or the gap between two), then why: the main thread
// held (CPU), or the files it waited for (network); a load that never finished names the stage it is stuck in
export function pickBlocker({ stages = [], points = [], resources = [], tasks = [], conn = null, done = true, now = 0, errors = [] }) {
  const net = conn?.type ? ` on ${conn.type}` : '';
  const failed = points.find((p) => p.name === 'fail');
  if (failed) {
    const before = stages.filter((s) => s.crit && s.start <= failed.t).at(-1);
    const why = String(errors[0] ?? '').split('\n')[0].slice(0, 120);
    return { kind: 'fail', name: before?.name ?? 'start', ms: failed.t, text: `start failed${before ? ` in ${before.label}` : ''} at ${s1(failed.t)} s${why ? `: ${why}` : ''}` };
  }
  if (!done) {
    const open = stages.filter((s) => s.crit && s.open).at(-1) ?? stages.filter((s) => s.open).at(-1);
    const last = open ?? stages.filter((s) => s.crit).sort((a, b) => b.end - a.end)[0];
    if (last) return { kind: 'stuck', name: last.name, ms: now - last.start, text: `stuck in ${last.label}: started at ${s1(last.start)} s, not finished at ${s1(now)} s` };
    return { kind: 'stuck', name: 'start', ms: now, text: `no stage reached at ${s1(now)} s` };
  }
  const crit = stages.filter((s) => s.crit && !s.open).sort((a, b) => a.start - b.start);
  const segs = crit.map((s) => ({ ...s }));
  for (let i = 1; i < crit.length; i++) {   // the gaps the marks leave (a script fetched between two stages, say)
    const a = crit[i - 1], b = crit[i], g = b.start - a.end;
    if (g > 0) segs.push({ name: `${a.name}>${b.name}`, label: `between ${a.label} and ${b.label}`, start: a.end, end: b.start, dur: r1(g), gap: true, net: true });
  }
  if (!segs.length) return { kind: 'none', name: '', ms: 0, text: 'no stages marked' };
  const top = segs.sort((a, b) => b.dur - a.dur || a.start - b.start)[0];
  const total = Math.max(...crit.map((s) => s.end), top.end);
  const share = total > 0 ? ` (${Math.round((100 * top.dur) / total)} % of the ${s1(total)} s path)` : '';
  const busy = busyIn(top.start, top.end, tasks);
  if (busy.ms >= 0.5 * top.dur && busy.ms > 0) {
    return { kind: 'cpu', name: top.name, ms: top.dur, text: `${top.label} ${s1(top.dur)} s${share}: main thread busy ${s1(busy.ms)} s${busy.longest ? `, longest task ${s1(busy.longest.dur)} s` : ''}` };
  }
  // the files it waited for: those that finish inside it (or run through it), slowest first
  const files = resources.filter((r) => r.cache !== 'hit' && r.start < top.end && r.start + r.dur > top.start && r.start + r.dur >= top.start + 0.25 * top.dur);
  const isNet = STAGES[top.name]?.net || top.gap;
  const slowest = files.reduce((m, r) => Math.max(m, r.dur), 0);
  if (files.length && isNet && slowest >= 0.25 * top.dur) {
    const slow = files.slice().sort((a, b) => b.dur - a.dur)[0];
    const sum = files.reduce((t, r) => t + (r.sentKB || 0), 0);
    const what = files.length === 1 ? `${slow.path} ${sum >= 1024 ? `${(sum / 1024).toFixed(1)} MB` : `${sum} kB`}` : `${files.length} files ${sum >= 1024 ? `${(sum / 1024).toFixed(1)} MB` : `${sum} kB`}, slowest ${slow.path} ${s1(slow.dur)} s`;
    return { kind: 'net', name: top.name, ms: top.dur, text: `${top.label} ${s1(top.dur)} s${share}: download ${what}${net}` };
  }
  return { kind: isNet ? 'net' : 'cpu', name: top.name, ms: top.dur, text: `${top.label} ${s1(top.dur)} s${share}` };
}

// the device's facts as the report shows them
export function deviceOf(d = {}, facts = {}) {
  const ua = uaFamily(d.ua, d.touch);
  const c = d.conn ?? null;
  return {
    ua: ua.text, os: ua.os, browser: ua.browser, dev: ua.dev,
    screen: d.screen ? `${d.screen.w}x${d.screen.h}` : '', viewport: d.viewport ? `${d.viewport.w}x${d.viewport.h}` : '', dpr: d.dpr ?? null,
    cores: d.cores ?? null, memGB: d.memGB ?? null, touch: d.touch ?? 0,
    conn: c ? { type: c.effectiveType ?? c.type ?? '', downlink: c.downlink ?? null, rtt: c.rtt ?? null, saveData: !!c.saveData } : null,
    standalone: !!d.standalone,
    gpu: facts.gpu ?? null, gate: facts.gate ?? null, quality: facts.quality ?? null, phoneFlat: facts.phoneFlat ?? null,
  };
}

// the report: raw = { at, version, page, params, nav, paint, marks, resources, rec, facts, device, origin, errors, now }
export function buildLoadReport(raw = {}) {
  const origin = raw.origin ?? '';
  const now = raw.now ?? 0;
  const { stages, points } = stagesFrom(raw.marks ?? [], raw.nav ?? null, now);
  const resources = (raw.resources ?? []).map((e) => resourceOf(e, origin)).sort((a, b) => a.start - b.start);
  const rec = raw.rec ?? null;
  const tasks = rec?.observed?.longtask ? rec.longTasks ?? [] : rec?.stalls ?? [];
  const p = (n) => points.find((x) => x.name === n)?.t ?? null;
  const st = (n) => stages.find((x) => x.name === n) ?? null;
  const frame1 = p('frame1'), card = st('card'), hand = st('handover');
  const cardAt = card && !card.open ? Math.max(card.end, hand && !hand.open ? hand.end : 0) : null;   // ready to play: the card's scripts in and the card handed over
  const done = frame1 != null && (cardAt != null || !card);
  const paint = raw.paint ?? [];
  const device = deviceOf(raw.device ?? {}, raw.facts ?? {});
  const errors = (raw.errors ?? []).map((e) => String(e).split('\n')[0].replace(/\b(?:https?|wss?):\/\/[^\s)'"]+/g, (u) => cleanPath(u, origin)).slice(0, 160)).slice(0, 5);
  const blocker = pickBlocker({ stages, points, resources, tasks, conn: device.conn, done, now, errors });
  const pipes = pipesOf(raw.facts ?? {});
  if (blocker.name === 'pipelines' && pipes?.slowest) blocker.text += `; slowest ${pipes.slowest}`;   // the shaders that cost most (the load's own times)
  const sent = resources.reduce((t, r) => t + r.sentKB, 0), size = resources.reduce((t, r) => t + r.sizeKB, 0);
  const heap = rec?.heap?.length ? rec.heap.at(-1) : raw.heap ?? null;
  const nav = raw.nav ?? null;
  return {
    v: REPORT_V, at: raw.at ?? '', version: raw.version ?? '', page: cleanPath(raw.page ?? '/', ''), params: (raw.params ?? []).map((k) => String(k).slice(0, 24)).slice(0, 20),
    device, blocker, pipes,
    totals: {
      done, firstPaint: r1(paint.find((x) => x.name === 'first-paint')?.startTime ?? paint[0]?.startTime ?? NaN) || null,
      fcp: r1(paint.find((x) => x.name === 'first-contentful-paint')?.startTime ?? NaN) || null,
      ttfb: nav?.responseStart ? r1(nav.responseStart) : null, htmlKB: nav ? kB(nav.transferSize) : null, proto: nav?.nextHopProtocol ?? '', navType: nav?.type ?? '',
      firstFrame: frame1, card: cardAt, at: r1(now),
      modes: (() => { const m = st('modes'); return m && !m.open ? m.end : null; })(),   // a phone: Sail, Cruise and Regatta lit (every pipeline built)
      requests: resources.length, sentKB: sent, sizeKB: size, cached: resources.filter((r) => r.cache === 'hit').length,
    },
    stages, points,
    slowStages: stages.slice().sort((a, b) => b.dur - a.dur).slice(0, 5).map((s) => ({ name: s.name, label: s.label, dur: s.dur, start: s.start })),
    slowFiles: resources.filter((r) => cardAt == null || r.start <= cardAt).sort((a, b) => b.dur - a.dur).slice(0, 5),   // the files the load waited on: those asked for before the card was live
    resources,
    main: {
      source: rec ? (rec.observed?.longtask ? 'longtask' : 'stalls') : 'none',
      count: tasks.length, totalMs: r1(tasks.reduce((t, x) => t + x.dur, 0)),
      longest: tasks.slice().sort((a, b) => b.dur - a.dur).slice(0, 5).map((t) => ({ start: r1(t.start), dur: r1(t.dur), attr: t.attr ?? '', in: stages.filter((s) => s.crit && s.start <= t.start && s.end >= t.start).map((s) => s.name)[0] ?? '' })),
      longTasks: (rec?.longTasks ?? []).map((t) => ({ start: r1(t.start), dur: r1(t.dur), attr: t.attr ?? '' })),
      stalls: (rec?.stalls ?? []).map((t) => ({ start: r1(t.start), dur: r1(t.dur) })),
    },
    heap: heap ? { usedMB: r1(heap.usedMB), limitMB: r1(heap.limitMB) } : null,
    hidden: (rec?.visibility ?? []).filter((v) => v.state === 'hidden').map((v) => r1(v.t)),
    facts: raw.facts ?? {},
    errors,
  };
}

// the shaders: the load's set (its count, its time, the families that cost most: engine/pipelines.js timings) and the groups
// built after the card (their count and time); null when the boot left no facts
function pipesOf(facts = {}) {
  const p = facts.pipes;
  if (!p) return null;
  const fam = (p.families ?? []).filter(([, ms]) => ms > 0);
  const slowest = fam.slice(0, 3).map(([f, ms, n]) => `${f} ${s1(ms)} s${n > 1 ? ` (${n})` : ''}`).join(', ');
  const late = facts.pipesLate ? Object.entries(facts.pipesLate).filter(([g]) => g !== 'core') : null;
  const b = facts.build;   // a phone: every pipeline built before the modes (main.js gateTick)
  return { n: p.n ?? 0, ms: p.ms ?? 0, slow: !!p.slow, deferred: p.deferred ?? 0, families: fam, top: p.top ?? [], slowest,
    build: b ? { n: b.n ?? 0, built: b.built ?? 0, ms: b.ms ?? 0 } : null,
    late: late ? { n: late.reduce((t, [, g]) => t + (g.n ?? 0), 0), ms: late.reduce((t, [, g]) => t + (g.ms ?? 0), 0), groups: late.map(([g, o]) => [g, o.n, o.ms]) } : null };
}

// step D2: the race's quality ladder in one line ("Race quality: 2 steps down: fleet bands at 0:42 (p90 51.2 ms), L2 at 1:10 …"), null
// when no race stepped
export function raceQualityLine(facts = {}) {
  const st = facts?.raceQuality?.steps;
  if (!Array.isArray(st) || !st.length) return null;
  const mm = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  return `Race quality: ${st.length} step${st.length > 1 ? 's' : ''} down: ${st.map((x) => `${x.rung === 'fleet' ? 'fleet bands' : `L${x.level}`} at ${mm(x.at)} (p90 ${x.p90} ms)`).join(', ')}`;
}

// the quality level in words: "L1 balanced (guess)", never "L1 (L1, guess)"
export const qualityWords = (q) => `${String(q.name ?? '').startsWith(`L${q.level}`) ? q.name : `L${q.level}${q.name ? ` ${q.name}` : ''}`} (${q.source || '?'})`;

// the short form for a chat message: the device, the totals, the blocker, the stages, the slowest files, the main thread;
// trimmed (the stages beside the path first, then files) until it fits TEXT_MAX
export function reportText(rep, max = TEXT_MAX) {
  const d = rep.device, t = rep.totals;
  const c = d.conn;
  const head = [
    `Velia load report${rep.version ? ` · ${rep.version}` : ''}${rep.at ? ` · ${rep.at}` : ''}`,
    [d.ua, `${d.viewport || d.screen}${d.dpr ? ` @${+(+d.dpr).toFixed(2)}` : ''}`, d.cores ? `${d.cores} cores` : '', d.memGB ? `${d.memGB} GB` : '',
      c ? `net ${[c.type, c.downlink != null ? `${c.downlink} Mbps` : '', c.rtt != null ? `${c.rtt} ms` : ''].filter(Boolean).join(' ')}` : 'net ?', d.standalone ? 'Home Screen app' : 'browser tab'].filter(Boolean).join(' | '),
    [d.gpu ? `GPU ${[d.gpu.vendor, d.gpu.architecture, d.gpu.description].filter(Boolean).join(' ').slice(0, 60) || '?'}` : 'GPU ?', d.quality ? `quality ${qualityWords(d.quality)}` : '', d.phoneFlat != null ? (d.phoneFlat ? 'flat controls' : 'cockpit') : ''].filter(Boolean).join(' · '),
    t.done ? `Card live ${t.card != null ? s2(t.card) : '-'} s${t.modes != null ? ` · modes ready ${s2(t.modes)} s` : ''} · first frame ${s2(t.firstFrame)} s · first paint ${t.firstPaint != null ? s2(t.firstPaint) : '-'} s · HTML ${t.ttfb != null ? s2(t.ttfb) : '-'} s TTFB ${t.proto}`
      : `NOT READY at ${s1(t.at)} s${t.firstFrame != null ? ` (first frame ${s2(t.firstFrame)} s)` : ''}`,
    `Likely blocker: ${rep.blocker.text}`,
  ];
  const stageLine = (s) => `${s.crit ? '*' : ' '}${s.label.slice(0, 30).padEnd(30)} ${s2(s.start).padStart(6)}-${s.open ? '  ...' : s2(s.end).padStart(6)} ${s2(s.dur).padStart(6)}`;
  const fileLine = (r) => `${s2(r.dur).padStart(6)} ${r.path} ${r.sentKB}/${r.sizeKB}kB ${r.cache}${r.proto ? ` ${r.proto}` : ''} @${s2(r.start)}`;
  const m = rep.main;
  const tail = [
    m.source === 'none' ? 'Main thread: not recorded (use Record a fresh load)' : `Main thread (${m.source}): ${m.count}, ${s2(m.totalMs)} s held; longest ${m.longest.slice(0, 3).map((x) => `${s2(x.dur)}s@${s2(x.start)}${x.in ? ` ${x.in}` : ''}`).join(', ') || '-'}`,
    `${t.requests} files, ${(t.sentKB / 1024).toFixed(1)} MB sent, ${t.cached} from cache${rep.heap ? ` · heap ${Math.round(rep.heap.usedMB)}/${Math.round(rep.heap.limitMB)} MB` : ''}${rep.hidden?.length ? ` · page hidden at ${rep.hidden.map((x) => s1(x)).join(', ')} s` : ''}`,
    ...(rep.pipes ? [`Shaders: ${rep.pipes.n} before the first frame ${s1(rep.pipes.ms)} s${rep.pipes.slowest ? ` (${rep.pipes.slowest})` : ''}; ${rep.pipes.late ? `${rep.pipes.late.n} after the card ${s1(rep.pipes.late.ms)} s` : `${rep.pipes.deferred} after the card`}${rep.pipes.slow ? ' · slow compiler' : ''}${rep.pipes.build ? ` · phone: all ${rep.pipes.build.built} of ${rep.pipes.build.n} built before the modes, ${s1(rep.pipes.build.ms)} s after the first frame` : ''}`] : []),
    ...(raceQualityLine(rep.facts) ? [raceQualityLine(rep.facts)] : []),   // step D2: the race ladder's decisions
    rep.errors.length ? `Errors: ${rep.errors.slice(0, 2).map((e) => e.slice(0, 120)).join(' | ')}` : 'Errors: none',
  ];
  let stages = rep.stages.slice(), files = rep.slowFiles.slice();
  const assemble = () => [...head, 'Stages (s, start-end, took; * on the path):', ...stages.map(stageLine), 'Slowest files (s, path, sent/size, cache):', ...files.map(fileLine), ...tail].join('\n');
  let out = assemble();
  while (out.length > max) {
    const side = stages.findLastIndex((s) => !s.crit);
    if (side >= 0) stages.splice(side, 1);
    else if (files.length > 2) files.pop();
    else if (stages.length > 4) stages.splice(stages.findIndex((s) => s.dur === Math.min(...stages.map((x) => x.dur))), 1);
    else { out = out.slice(0, max - 1) + '…'; break; }
    out = assemble();
  }
  return out;
}
