// The diagnostics panel for phone screenshots (the phone pass, 2026-11-13): ?diag=1 shows a small navy-glass plate in the
// top-left corner with the numbers the owner sends back from a real phone: fps and frame ms (average and worst over the
// last 2 s), the GPU ms when timestamps exist, the quality level and why, the backing size and DPR, the adapter, the
// user agent (short) and the errors. Off by default.
//
// Cost: the frame writes two numbers into fixed rings (frame()); the panel's text is built and written as DOM text on a
// 250 ms timer, outside the frame loop (at most 4 updates a second), and only when it changed. A tap on
// the panel folds it to four lines (fps, the GPU, the level, the errors) so it never hides the boat while sailing, and opens it again.
//   const d = createDiag({ on, errors, info: () => ({ … }) });  d.frame(dtMs, gpuMs, now);  d.stop()
export const DIAG = Object.freeze({ windowMs: 2000, updateMs: 250, ring: 1024, maxPasses: 12, topPasses: 6 });

// the average and the worst over the last `windowMs` of a ring: t (time stamps, ms), v (values), n written so far
export function windowStats(t, v, n, now, windowMs = DIAG.windowMs) {
  const N = t.length, m = Math.min(n, N); let sum = 0, worst = 0, c = 0;
  for (let k = 0; k < m; k++) {
    const i = (n - 1 - k + N * 2) % N;
    if (now - t[i] > windowMs) break;
    const x = v[i]; if (!(x >= 0)) continue;
    sum += x; c++; if (x > worst) worst = x;
  }
  return c ? { avg: sum / c, worst, count: c } : null;
}

// perf(v2) phone: each pass's average over the last `windowMs` (rings: t time stamps, v[k * P + p] the ms of pass p in
// sample k, n written so far) → [{ name, avg }] sorted, the slowest first (the panel shows the top 6)
export function passStats(t, v, n, P, names, now, windowMs = DIAG.windowMs) {
  const N = t.length, m = Math.min(n, N), sum = new Float64Array(P); let c = 0;
  for (let k = 0; k < m; k++) {
    const i = (n - 1 - k + N * 2) % N;
    if (now - t[i] > windowMs) break;
    for (let p = 0; p < P; p++) sum[p] += v[i * P + p];
    c++;
  }
  if (!c) return null;
  const out = [];
  for (let p = 0; p < P && p < names.length; p++) out.push({ name: names[p], avg: sum[p] / c });
  return out.sort((a, b) => b.avg - a.avg);
}
// perf(v2) phone: what limits the frame, from the 2 s averages: the GPU's busy span against the refresh budget, the CPU's ms
// perf(v2) phone round 2: a GPU-bound frame on a 60 Hz display misses one vsync and presents on the next, so the frame is
// quantized to 30 Hz: the verdict says by how much the span misses, and to what the frames fall
// fix(v2) governor (the owner's iPhone, 2026-11-14: "GPU-bound: misses 56 Hz by 4.5 ms (busy 22.5 of 18.0)" at 59.7 fps):
// gpu is the GPU's work (the passes' own shares, no idle; `work` false: the older span), and frames on vsync are on budget
// whatever the GPU reads: nothing misses
export function verdictOf(frame, gpu, cpu, budgetMs, { work = true } = {}) {
  if (!frame || !(budgetMs > 0)) return null;
  const hz = Math.round(1000 / budgetMs), k = Math.max(1, Math.round(frame.avg / budgetMs));
  const pinned = k > 1 && Math.abs(frame.avg / (k * budgetMs) - 1) < 0.08;
  const pace = pinned ? ` (frames pinned at ${(1000 / (k * budgetMs)).toFixed(0)} Hz: every ${k === 2 ? '2nd' : k === 3 ? '3rd' : `${k}th`} vsync)` : '';
  const word = work ? 'work' : 'busy';
  if (frame.avg <= budgetMs * 1.08) return `on budget (${hz} Hz): frames on vsync`;   // the GPU line above has the work
  if (gpu && gpu.avg > budgetMs * 0.95) return `GPU-bound: misses ${hz} Hz by ${Math.max(0, gpu.avg - budgetMs).toFixed(1)} ms (${word} ${gpu.avg.toFixed(1)} of ${budgetMs.toFixed(1)})${pinned ? `, quantized to ${(1000 / (k * budgetMs)).toFixed(0)} Hz` : ''}`;
  if (cpu && cpu.avg > budgetMs * 0.8) return `CPU-bound: ${cpu.avg.toFixed(1)} ms of script a frame${pace}`;
  if (frame.avg > budgetMs * 1.15) return `not GPU-bound (GPU fits ${hz} Hz): pacing or the page${pace}`;
  return `on budget (${hz} Hz)`;
}

// the user agent, short: the device, the OS and the browser with their versions
export function shortUA(ua = '') {
  const s = String(ua);
  const ver = (re) => { const m = re.exec(s); return m ? m[1].replace(/_/g, '.') : ''; };
  let dev = '', os = '', br = '';
  if (/iPhone/.test(s)) { dev = 'iPhone'; os = `iOS ${ver(/OS (\d+[_.]\d+(?:[_.]\d+)?)/)}`; }
  else if (/iPad/.test(s)) { dev = 'iPad'; os = `iPadOS ${ver(/OS (\d+[_.]\d+(?:[_.]\d+)?)/)}`; }
  else if (/Android/.test(s)) { os = `Android ${ver(/Android (\d+(?:\.\d+)?)/)}`; dev = (/Android[^;)]*;\s*([^;)]+?)(?:\s+Build|\))/.exec(s)?.[1] ?? '').trim(); if (dev === 'K') dev = ''; }
  else if (/Macintosh/.test(s)) { os = 'Mac'; }
  else if (/Windows/.test(s)) { os = 'Windows'; }
  else if (/Linux/.test(s)) { os = 'Linux'; }
  if (/EdgA?\//.test(s)) br = `Edge ${ver(/EdgA?\/(\d+)/)}`;
  else if (/CriOS\//.test(s)) br = `Chrome ${ver(/CriOS\/(\d+)/)}`;
  else if (/FxiOS\//.test(s)) br = `Firefox ${ver(/FxiOS\/(\d+)/)}`;
  else if (/Firefox\//.test(s)) br = `Firefox ${ver(/Firefox\/(\d+)/)}`;
  else if (/HeadlessChrome\//.test(s)) br = `Headless Chrome ${ver(/HeadlessChrome\/(\d+)/)}`;
  else if (/Chrome\//.test(s)) br = `Chrome ${ver(/Chrome\/(\d+)/)}`;
  else if (/Safari\//.test(s)) br = `Safari ${ver(/Version\/(\d+(?:\.\d+)?)/)}`;
  return [dev, os, br].filter((x) => x && x.trim()).join(' · ') || s.slice(0, 60);
}

// the panel's lines from a snapshot (pure: the tests read it)
//   o: { frame: {avg, worst} | null, gpu: {avg, worst} | null, timestamps, level, levelName, why, pending: [], backing: [w, h],
//        css: [w, h], dpr, dprCap, maxPx, scale, adapter: {vendor, architecture, description}, ua, errors: [] }
export function diagLines(o) {
  const f = o.frame, g = o.gpu, n1 = (x) => (x == null ? '–' : x.toFixed(1));
  const lines = [];
  lines.push(f ? `fps ${n1(1000 / f.avg)} avg · ${n1(1000 / f.worst)} worst` : 'fps –');
  lines.push(f ? `frame ${n1(f.avg)} ms avg · ${n1(f.worst)} worst (2 s)${o.cpu ? ` · CPU ${n1(o.cpu.avg)}` : ''}` : 'frame –');
  // fix(v2) governor: the GPU line is the GPU's work (the passes' own shares: the busy span less its idle gaps), the
  // number the governor reads, with the span and its idle beside it. Without own shares (an older timer), the busy span
  if (g && o.gpuSpan) lines.push(`GPU work ${g.avg.toFixed(2)} ms avg · ${g.worst.toFixed(2)} worst (span ${o.gpuSpan.avg.toFixed(1)}, idle ${(o.gpuGap?.avg ?? 0).toFixed(1)})`);
  else lines.push(g ? `GPU ${g.avg.toFixed(2)} ms avg · ${g.worst.toFixed(2)} worst (busy span${o.gpuSum ? `; passes sum ${o.gpuSum.avg.toFixed(1)}` : ''}${o.gpuGap && o.gpuGap.avg >= 0.05 ? `; idle ${o.gpuGap.avg.toFixed(1)}` : ''})` : (o.busySpan != null ? `GPU ≈ ${o.busySpan.toFixed(1)} ms (work-done probe; no timestamp-query)` : `GPU – (${o.timestamps ? 'no sample yet' : 'no timestamp-query'})`));   // #32: the probe's reading without a timer
  if (o.passes?.length) {
    // perf(v2) phone round 2: each pass's own share of the span (frame.js makeTimer): a light pass after a heavy one no
    // longer carries the heavy one's tail; they add up to the span less its idle time
    const top = o.passes.slice(0, DIAG.topPasses).map((p) => `${p.name} ${p.avg >= 10 ? p.avg.toFixed(1) : p.avg.toFixed(2)}`);
    lines.push(`passes${o.passesOwn ? ' (own ms)' : ''} ${top.slice(0, 3).join(' · ')}`);
    if (top.length > 3) lines.push(`  ${top.slice(3).join(' · ')}`);
  }
  const verdict = verdictOf(f, g, o.cpu, o.budgetMs, { work: !!o.gpuSpan });
  if (o.budgetMs > 0) lines.push(`pace ${(o.refreshHz > 0 ? o.refreshHz : 1000 / o.budgetMs).toFixed(0)} Hz display (budget ${o.budgetMs.toFixed(1)} ms${o.refreshMeasured === false ? ', not measured yet' : o.refreshSource && o.refreshSource !== 'frames' ? `, ${o.refreshSource === 'idle' ? 'measured at load' : 'assumed'}` : ''})${o.gov ? ` · scale ${o.gov.scale.toFixed(2)} (floor ${o.gov.min.toFixed(2)}, ${o.gov.cuts} cuts)` : ''}`);
  if (o.budgetMs > 0 && o.budgetWhy) lines.push(`  ${o.budgetWhy}`);   // fix(v2) desktop quality: the budget and why (perf(v2) phone 30 fps: quality first)
  if (o.pacing) lines.push(`  ${o.pacing}`);   // perf(v2) phone 30 fps: the limiter's cadence and the presented frames' p50 / p95
  if (verdict) lines.push(`  ${verdict}`);
  if (o.gov?.why && o.gov.enabled !== false && o.gov.why !== 'warming up') lines.push(`  governor ${o.gov.why}`);   // fix(v2) governor: why it holds, cuts or raises
  if (o.level == null) lines.push(`quality – (loading${o.stage ? `: ${o.stage}` : ''})`);
  else lines.push(`quality ${o.levelName ?? `L${o.level}`}${o.pending?.length ? ` (next load: ${o.pending.join(', ')})` : ''}${o.levers ? ` · ${o.levers}` : ''}`);
  if (o.why) lines.push(`  ${o.why}`);
  for (const l of o.raceQ ?? []) lines.push(l);   // step D2: the race's ladder (step-down only) and its decisions
  for (const l of o.sweep ?? []) lines.push(l);
  if (o.backing) {
    const [bw, bh] = o.backing;
    lines.push(`backing ${bw}×${bh} · ${(bw * bh / 1e6).toFixed(2)} Mpx · scale ${(o.scale ?? 1).toFixed(2)}`);
  }
  const [cw, ch] = o.css ?? [0, 0];
  lines.push(`DPR ${+(+(o.dpr ?? 1)).toFixed(2)}${o.dprCap != null ? ` (cap ${o.dprCap})` : ''} · css ${Math.round(cw)}×${Math.round(ch)}${o.msaa != null ? ` · MSAA ${o.msaa}${o.msaaWant != null && o.msaaWant !== o.msaa ? ` → ${o.msaaWant} (building)` : ''}` : ''}`);   // #31: a live MSAA step waits for its pipelines
  if (o.mem) lines.push(`memory GPU ≈ ${o.mem.gpuMB.toFixed(0)} MB (${o.mem.buffers} buffers, ${o.mem.textures} textures)${o.mem.heapMB != null ? ` · JS heap ${o.mem.heapMB.toFixed(0)} of ${o.mem.heapLimitMB.toFixed(0)} MB` : ''}${o.mem.deviceGB != null ? ` · device ${o.mem.deviceGB} GB` : ''}`);
  if (o.pipeline) lines.push(`failed pipeline "${o.pipeline.name}": ${String(o.pipeline.message).split('\n')[0].slice(0, 160)}`);
  if (o.crash) lines.push(o.crash);
  if (o.profile) { const p = o.profile; lines.push(`device ${p.form} · ${p.input} · screen ${(p.tokens ?? [p.screen]).join(' ')} · gpu ${p.gpu ?? '–'}${p.quirks?.length ? ` · ${p.quirks.join(' ')}` : ''}${p.forced ? ' (forced)' : ''}`); }   // the device profile (src/core/profile.js)
  for (const l of o.features ?? []) lines.push(`  ${l}`);   // each feature's state (src/core/features.js)
  const a = o.adapter ?? {};
  lines.push(`adapter ${[a.vendor, a.architecture].filter(Boolean).join(' · ') || '(hidden)'}${a.description ? ` · ${a.description}` : ''}${a.fallback ? ' · fallback' : ''}`);
  lines.push(`UA ${shortUA(o.ua)}`);
  const errs = (o.errors ?? []).slice(-3).map((e) => String(e).split('\n')[0].slice(0, 140));
  lines.push(errs.length ? `errors ${o.errors.length} (last ${errs.length}, newest last):` : 'errors none');
  for (const e of errs) lines.push(`  ${e}`);
  return lines;
}

export const DIAG_CSS = `
#diag { position: fixed; z-index: 2147483100; left: max(8px, env(safe-area-inset-left)); top: max(48px, calc(env(safe-area-inset-top) + 44px));
  max-width: min(420px, calc(100vw - 16px)); box-sizing: border-box; padding: 8px 12px; border-radius: 14px;
  background: rgba(28, 35, 64, 0.86); -webkit-backdrop-filter: blur(12px) saturate(.9); backdrop-filter: blur(12px) saturate(.9);
  border: 1px solid rgba(243, 231, 200, 0.25); color: rgba(243, 231, 200, 0.96); user-select: none;
  font: 500 15px/1.3 "Atkinson Hyperlegible Next", system-ui, -apple-system, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums;
  white-space: pre-wrap; overflow-wrap: anywhere; text-shadow: none; }
#diag[hidden] { display: none; }
#diag { pointer-events: auto; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #diag{ max-width: min(420px, 46vw); top: max(8px, env(safe-area-inset-top)); line-height: 1.22; }

`;

export function createDiag({ on = false, errors = [], info: info0 = () => ({}), doc = globalThis.document, timers = globalThis } = {}) {
  const N = DIAG.ring, PM = DIAG.maxPasses;
  const tF = new Float64Array(N), vF = new Float64Array(N), vG = new Float64Array(N), vS = new Float64Array(N), vC = new Float64Array(N), vI = new Float64Array(N), vSp = new Float64Array(N);
  const tP = new Float64Array(N), vP = new Float64Array(N * PM);   // perf(v2) phone: each resolved frame's pass times
  let n = 0, nP = 0, lastSeq = -1, nPass = 0, names = [], el = null, last = '', timer = null, updates = 0, buildMs = 0, info = info0, mini = false, own = false;
  function mount() {
    if (el || !doc?.body) return;
    const st = doc.createElement('style'); st.textContent = DIAG_CSS; doc.head.appendChild(st);
    el = doc.createElement('div'); el.id = 'diag'; el.setAttribute('aria-hidden', 'true'); doc.body.appendChild(el);
    // a tap folds it to four lines (fps, the GPU, the level, the errors) so it never hides the boat while sailing; a tap opens it
    el.addEventListener?.('click', (e) => { e.stopPropagation?.(); mini = !mini; last = ''; update(); });
    el.addEventListener?.('pointerdown', (e) => e.stopPropagation?.());
  }
  function update() {
    const t = globalThis.performance?.now?.() ?? Date.now();
    const now = t;
    let o = {}; try { o = info() ?? {}; } catch (e) { o = { why: `diag: ${e?.message ?? e}` }; }
    const all = diagLines({ ...o, errors, frame: windowStats(tF, vF, n, now), gpu: windowStats(tF, vG, n, now), gpuSum: windowStats(tF, vS, n, now),
      cpu: windowStats(tF, vC, n, now), gpuGap: windowStats(tF, vI, n, now), gpuSpan: windowStats(tF, vSp, n, now), passesOwn: own, passes: nPass ? passStats(tP, vP, nP, PM, names.slice(0, nPass), now) : null });
    const text = (mini ? all.filter((l) => /^(fps|GPU|quality|errors)/.test(l)) : all).join('\n');
    if (text !== last) { last = text; el.textContent = text; }
    updates++; buildMs = (globalThis.performance?.now?.() ?? Date.now()) - t;
  }
  if (on) { mount(); if (el) { update(); timer = timers.setInterval?.(update, DIAG.updateMs); } }
  return {
    get on() { return !!el; },
    get el() { return el; },
    get stats() { return { updates, lastUpdateMs: +buildMs.toFixed(3), text: last }; },
    // the frame's part: numbers into fixed rings (dt: the wall interval, ms; gpu: the frame graph's newest { span, total,
    // passes, seq } or a plain ms or null; cpu: the script's ms). A resolved frame's pass times go in once (by seq)
    frame(dt, gpu, now, cpu = null) {
      if (!el) return;
      const i = n % N; tF[i] = now; vF[i] = dt == null ? -1 : dt; vC[i] = cpu == null ? -1 : cpu;
      const g = typeof gpu === 'number' ? { span: gpu } : gpu;
      // fix(v2) governor: the GPU ring holds the work (the own shares' sum: span − gap) when the timer has own shares; the
      // span ring is then kept beside it (else -1, and the line falls back to the busy span)
      const work = g?.work ?? (g?.own && g.span != null && g.gap != null ? Math.max(0, g.span - g.gap) : null);
      vG[i] = work ?? g?.span ?? g?.total ?? -1; vSp[i] = work != null ? g.span : -1; vS[i] = g?.total ?? -1; vI[i] = g?.gap ?? -1; n++;
      if (g?.passes && g.seq !== lastSeq) {
        const per = g.own ?? g.passes; own = !!g.own;   // perf(v2) phone round 2: the passes' own shares when the timer has them
        lastSeq = g.seq; const j = nP % N; tP[j] = now; const P = Math.min(per.length, PM);
        for (let p = 0; p < PM; p++) vP[j * PM + p] = p < P ? per[p] : 0;
        nPass = P; nP++;
      }
    },
    setPassNames(a) { names = a.slice(0, PM); },
    refresh() { if (el) update(); },
    setInfo(fn) { info = fn; if (el) update(); },
    stop() { if (timer != null) timers.clearInterval?.(timer); timer = null; },
  };
}

// The crash log (the owner's iPhone, 2026-11-13: v1 "keeps crashing and flashing"): iOS Safari kills a tab that runs out
// of memory and reloads it, with no error the page can catch. So the page keeps a small note in localStorage (safe:
// try/catch) while it runs: alive, the level, the GPU memory, the frames, the last errors; a clean exit (pagehide) marks it
// closed. A visit that finds the last note still alive says so in the panel, with that visit's last error and memory: the
// one trace of a crash a screenshot can carry. (Two tabs at once also leave it alive: the panel says "may".)
//   const log = createCrashLog({ storage, errors, snapshot: () => ({ level, mb, frames }) });  log.line(); log.beat(); log.close()
export const CRASH_KEY = 'velia.v2.diag.last';
export function createCrashLog({ storage = null, errors = [], snapshot = () => ({}), now = () => Date.now() } = {}) {
  let previous = null, lastText = '';
  try { const o = JSON.parse(storage?.getItem?.(CRASH_KEY) ?? 'null'); if (o && o.alive) previous = o; } catch { /* no note */ }
  function beat(alive = true) {
    let s = {}; try { s = snapshot() ?? {}; } catch { /* the page is half up */ }
    const note = { alive, at: now(), level: s.level ?? null, mb: s.mb != null ? +(+s.mb).toFixed(1) : null, frames: s.frames ?? null,
      errors: errors.slice(-3).map((e) => String(e).split('\n')[0].slice(0, 160)) };
    const text = JSON.stringify({ ...note, at: 0 });
    if (alive && text === lastText) return;   // nothing new: no write
    try { storage?.setItem?.(CRASH_KEY, JSON.stringify(note)); lastText = text; } catch { /* storage full or blocked */ }
  }
  beat(true);
  return {
    get previous() { return previous; },
    beat, close() { beat(false); },
    // the panel's line for the last visit (null when it closed cleanly)
    line() {
      if (!previous) return null;
      const ago = Math.max(0, Math.round((now() - previous.at) / 1000));
      return `last visit may have crashed (${ago} s ago; L${previous.level ?? '?'}, GPU ${previous.mb ?? '?'} MB, ${previous.frames ?? '?'} frames${previous.errors?.length ? `; ${previous.errors.at(-1)}` : ''})`;
    },
  };
}
