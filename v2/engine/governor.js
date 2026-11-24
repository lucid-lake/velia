// The dynamic-resolution governor (Cold Smoke's shape): it never switches a feature off; it
// moves the render scale. Pure: feed it a cost in ms (the GPU time of the frame when timestamps work, else the wall
// frame time) and a time stamp; read `scale`.
//   warm-up 3 s; then 1 s windows of the mean cost. Two slow windows in a row (mean > budget × 1.2) cut the scale by
//   10 %, by 20 % when the mean is > budget × 1.67; floor `min`. Twelve fast windows in a row (mean < budget × 1.05)
//   raise it 8 %, at most once per `cooldownMs`, up to `max`. At most `maxCuts` cuts in all (a broken frame never pins
//   the page at the floor forever: it stops cutting and the number shows in stats).
//   const g = createGovernor({ budgetMs: 1000 / 60 });  g.feed(gpuMs, nowMs) → scale;  g.state()
export function createGovernor({ budgetMs = 1000 / 60, warmupMs = 3000, windowMs = 1000, min = 0.6, max = 1, start = 1,
  cooldownMs = 20000, maxCuts = 5, slowWindows = 2, fastWindows = 12, enabled = true, slowK = 1.2, fastK = 1.05,   // perf(v2) phone round 2: slowK, fastK (the page passes 1.05, 0.85 when the cost is the GPU busy span: a span past one vsync misses it)
  paceK = null, targetK = null, holdMs = 0, failMs = 15000 } = {}) {   // fix(v2) governor: see GOV_WORK
  let heatK = null;   // perf(v2) phone 30 fps: setAim
  let scale = Math.min(max, Math.max(min, start)), t0 = null, winStart = null, sum = 0, n = 0, dtSum = 0, dtN = 0, pixSum = 0, pixN = 0;
  let slow = 0, fast = 0, cuts = 0, raises = 0, lastChange = -Infinity, lastMean = null, lastDt = null, lastRaise = -Infinity, ceiling = null, ceilingUntil = -Infinity, why = 'warming up';
  const clamp = (x) => Math.min(max, Math.max(min, x));
  const r2 = (x) => Math.round(x * 100) / 100;
  // fix(v2) governor: the cost at another scale. The pixel-bound part (pixMs: the passes drawn at the backing size, the
  // scene and the composite; else 75 % of the cost, the ladder's FIXED rule) grows with the scale squared; the rest (the
  // water's compute, the shadow maps, the cloud key) does not. Scaling the whole scene pass by pixels over-states a raise
  // (its vertex work does not grow), so a raise this allows is safe and a cut it sizes is never too deep
  const project = (mean, pix, s) => { const p = Math.min(mean, pix ?? mean * 0.75); return mean - p + p * (s / scale) ** 2; };
  // the largest scale whose projection fits `k` × the budget, from `lo` up to `hi` (the projection grows with s: solve it)
  const fitScale = (mean, pix, k) => { const p = Math.min(mean, pix ?? mean * 0.75), fixed = mean - p, room = budgetMs * k - fixed; return room <= 0 || p <= 0 ? (p <= 0 ? max : min) : scale * Math.sqrt(room / p); };
  function closeWindow(now) {
    const mean = n ? sum / n : null, dt = dtN ? dtSum / dtN : null, pix = pixN ? pixSum / pixN : null;
    lastMean = mean; lastDt = dt; sum = 0; n = 0; dtSum = 0; dtN = 0; pixSum = 0; pixN = 0; winStart = now;
    if (mean == null) return;
    if (targetK == null) {   // the frame-time rule (no GPU timer) and round 2's span rule: thresholds on the cost alone
      if (mean > budgetMs * slowK) { slow++; fast = 0; } else if (mean < budgetMs * fastK) { fast++; slow = 0; } else { slow = 0; fast = 0; }
      if (slow >= slowWindows && cuts < maxCuts && scale > min) {
        scale = clamp(scale * (mean > budgetMs * 1.67 ? 0.8 : 0.9)); cuts++; slow = 0; lastChange = now; why = `cut: ${r2(mean)} ms > ${slowK} × ${r2(budgetMs)}`;
      } else if (fast >= fastWindows && scale < max && now - lastChange >= cooldownMs) {
        scale = clamp(scale * 1.08); raises++; fast = 0; lastChange = now; why = `raise: ${fastWindows} windows under ${fastK} × ${r2(budgetMs)}`;
      } else why = slow ? `hold: slow ${slow}/${slowWindows}` : fast ? `hold: fast ${fast}/${fastWindows}` : 'hold';
      return;
    }
    // fix(v2) governor (the owner's iPhone, 2026-11-14: 60 fps at scale 0.60, the busy span 22.5 ms with 11.7 ms idle in it):
    // the cost is the GPU's work (the passes' own shares, no idle), and the frames' own interval says whether the page holds
    // the refresh. Frames on vsync are never cut: there is nothing to win. A cut needs the work over the budget and the
    // frames missing it; it goes straight to the scale whose projection fits `targetK` × the budget (at most 20 % a step).
    // A raise needs `fastWindows` windows in a row whose projection one step up fits `targetK` × the budget, and goes to
    // the largest such scale (at most 25 % a step), below a scale that failed in the last `holdMs` (the ceiling)
    const paced = dt != null && paceK != null && dt <= budgetMs * paceK;
    if (ceiling != null && now >= ceilingUntil) ceiling = null;
    // perf(v2) phone 30 fps: with an aim (setAim < 1: a phone's thermal headroom) work held over 1.05 × the aim is cut too,
    // even on vsync (the limiter holds a phone's frames at 33.3 ms, so they never read as missed until the work passes it)
    const over = (mean > budgetMs * slowK && !paced) || (heatK != null && mean > budgetMs * heatK * 1.05);
    const cap = Math.min(max, ceiling != null ? ceiling * 0.98 : max);
    const up = Math.min(cap, scale * 1.25, fitScale(mean, pix, targetK));
    const roomUp = up >= scale * 1.03 - 1e-9 && scale < cap;
    if (over) { slow++; fast = 0; } else if (roomUp && mean < budgetMs * fastK) { fast++; slow = 0; } else { slow = 0; fast = 0; }
    if (slow >= slowWindows && cuts < maxCuts && scale > min) {
      const from = scale, to = clamp(Math.min(scale * 0.95, Math.max(scale * 0.8, fitScale(mean, pix, targetK))));
      if (now - lastRaise <= failMs) { ceiling = from; ceilingUntil = now + holdMs; }   // the last raise did not hold: remember it
      scale = to; cuts++; slow = 0; lastChange = now;
      why = `cut ${r2(from)} → ${r2(to)}: work ${r2(mean)} ms > ${r2(budgetMs)}${dt != null ? `, frames ${r2(dt)}` : ''}`;
    } else if (fast >= fastWindows && now - lastChange >= cooldownMs) {
      const from = scale; scale = clamp(up); raises++; fast = 0; lastChange = now; lastRaise = now;
      why = `raise ${r2(from)} → ${r2(scale)}: work ${r2(mean)} ms, ${r2(project(mean, pix, scale))} projected`;
      return;
    } else if (paced) why = `hold: frames on vsync${scale >= max - 1e-6 ? ', scale at max' : fast ? `, raise in ${fastWindows - fast} s` : ceiling != null && scale >= cap - 1e-6 ? `, under ${r2(ceiling)} (failed)` : ', no room up'}`;
    else if (over) why = `hold: work ${r2(mean)} ms > ${r2(budgetMs)}, slow ${slow}/${slowWindows}${cuts >= maxCuts ? ', no cuts left' : scale <= min + 1e-6 ? ', at the floor' : ''}`;
    else why = `hold: work ${r2(mean)} of ${r2(budgetMs)} ms${dt != null ? `, frames ${r2(dt)}` : ''}${scale >= max - 1e-6 ? ', scale at max' : fast ? `, raise in ${fastWindows - fast} s` : roomUp ? '' : ', no room up'}`;
  }
  return {
    get scale() { return scale; },
    get enabled() { return enabled; },
    get budgetMs() { return budgetMs; },
    get why() { return why; },
    setBudget(ms) { if (ms > 0 && Number.isFinite(ms)) budgetMs = ms; },
    // the phone pass: the ladder asks whether the scale has nowhere left to go (its floor, or no cuts left), and after a
    // level step the scale starts again at `to` with fresh windows (the new level's pixels are a new page)
    get atFloor() { return scale <= min + 1e-6 || cuts >= maxCuts; },
    // perf(v2) phone 30 fps: the share of the budget a raise may fill and a cut aims at (lowers targetK and fastK; GOV_WORK's 0.95)
    setAim(k) { if (k > 0 && k <= 1 && targetK != null) { targetK = Math.min(targetK, k); fastK = Math.min(fastK, k); heatK = k < 1 ? k : null; } },
    get aim() { return targetK; },
    reset(to = 1, now = null) { scale = clamp(to); sum = 0; n = 0; dtSum = 0; dtN = 0; pixSum = 0; pixN = 0; slow = 0; fast = 0; cuts = 0; ceiling = null; if (now != null) { winStart = now; lastChange = now; } },
    // ms: the cost (the GPU work with the timer, else the wall frame time); dt: the frame's own rAF interval (ms, optional);
    // pixMs: the cost's pixel-bound part (optional)
    feed(ms, now, dt = null, pixMs = null) {
      if (!enabled || !(ms >= 0) || !Number.isFinite(now)) return scale;
      if (t0 == null) { t0 = now; winStart = now; return scale; }
      if (now - t0 < warmupMs) return scale;
      sum += ms; n++;
      if (dt > 0 && dt < 250) { dtSum += dt; dtN++; }
      if (pixMs >= 0) { pixSum += pixMs; pixN++; }
      if (now - winStart >= windowMs) closeWindow(now);
      return scale;
    },
    state: () => ({ scale: +scale.toFixed(4), min, cuts, raises, lastMean: lastMean == null ? null : +lastMean.toFixed(2), slow, fast, enabled, budgetMs: +budgetMs.toFixed(2),
      frameMs: lastDt == null ? null : +lastDt.toFixed(2), ceiling: ceiling == null ? null : +ceiling.toFixed(4), why }),
  };
}
// fix(v2) governor: the page's options when the GPU timer exists and the cost is the GPU's work (the passes' own shares:
// the busy span less its idle gaps). A cut needs the work over the budget (slowK 1) with the frames off vsync (their mean
// interval over paceK × the budget), two windows running; it goes to the scale projected at 0.95 × the budget. A raise
// needs 5 windows in a row with room one 3 % step up inside 0.95 × the budget, 8 s after the last change; a raise that is
// cut within 15 s sets a ceiling for 2 minutes (no oscillation). 5 % steps at the least, up to 12 cuts
export const GOV_WORK = Object.freeze({ slowK: 1, fastK: 0.95, paceK: 1.1, targetK: 0.95, fastWindows: 5, cooldownMs: 8000, holdMs: 120000, failMs: 15000, maxCuts: 12 });

// The frame budget from the display's refresh: the measured rAF intervals (ms), snapped to the nearest common refresh
// rate (so 8.0–8.8 ms is 120 Hz: 8.33 ms, not a jittery 8.4); the default when too little was measured.
// fix(v2) governor (the owner's iPhone, 2026-11-14: "pace 56 Hz display (budget 18.0 ms)" at 59.7 fps): the median of a
// sample with hitches in it (the load's streaming, a GC) sat between the vsync and two, and a rate more than 6 % from every
// known one was kept as measured. A late frame only lengthens an interval, never shortens it under the vsync, so the
// reading is the lower quartile, and it always snaps to the nearest known rate: no display runs at 56 Hz.
//   budgetFromRefresh([8.4, 8.2, 8.3, 16.9, 8.3, …]) → 8.333…
export const REFRESH_RATES = Object.freeze([240, 165, 144, 120, 100, 90, 85, 75, 72, 60, 50, 48, 30]);
export function snapRefresh(ms) {
  let best = null, err = Infinity;
  for (const hz of REFRESH_RATES) { const p = 1000 / hz, e = Math.abs(Math.log(ms / p)); if (e < err) { err = e; best = p; } }
  return best;
}
export function budgetFromRefresh(intervalsMs, { dflt = 1000 / 60 } = {}) {
  const a = (intervalsMs ?? []).filter((x) => x > 2 && x < 100).sort((x, y) => x - y);
  if (a.length < 5) return dflt;
  return snapRefresh(a[Math.floor((a.length - 1) * 0.25)]);
}

// fix(v2) desktop quality (the owner's MacBook, 2026-11-15: a 120 Hz ProMotion screen set the budget to 8.3 ms, so the
// governor cut the scale to 0.69–0.77 at 7 ms of GPU work; owner: "we do not have to teach 120fps").
// perf(v2) phone 30 fps (owner rulings, 2026-11-15: "phone should target at 30fps not 60 and push for the picture quality";
// "on macbook ... we should aim at high picture quality first"): picture quality first on every page. The budget the
// governor and the ladder cut against is 30 fps's 33.3 ms, whatever the display's refresh:
//   desk    no frame limiter: it draws as fast as the display and the GPU allow at full quality (a MacBook still shows
//           60–120 fps with room) and gives up sharpness only when the frames fall under 30 fps. aimK 1
//   phone,  held at 30 fps by the frame limiter (engine/pacer.js: every 2nd vsync at 60 Hz, every 4th at 120 Hz); the
//   tablet  ladder and the governor's raises aim at PHONE_AIM × 33.3 ms (26 ms): a phone heats under a sustained load,
//           so the work leaves 22 % of each frame idle (the 30 fps cap already halves the frames)
//   frameBudget(8.33, { kind: 'phone' }) → { budgetMs: 33.33, hz: 120, held: true, aimK: 0.78, limit: true, why: 'budget 33.3 ms: phone held at 30 fps (quality first)' }
export const QUALITY_FPS = 30;
export const QUALITY_BUDGET_MS = 1000 / QUALITY_FPS;
export const PHONE_AIM = 0.78;
export function frameBudget(refreshMs, { desk = false, kind = desk ? 'desk' : 'phone' } = {}) {
  const r = refreshMs > 0 && Number.isFinite(refreshMs) ? refreshMs : 1000 / 60, hz = Math.round(1000 / r);
  const isDesk = kind === 'desk', budgetMs = QUALITY_BUDGET_MS;
  const why = isDesk ? `budget ${budgetMs.toFixed(1)} ms: quality first: cuts only below ${QUALITY_FPS} fps (the ${hz} Hz display)`
    : `budget ${budgetMs.toFixed(1)} ms: ${kind === 'tablet' ? 'tablet' : 'phone'} held at ${QUALITY_FPS} fps (quality first)`;
  return { budgetMs, hz, held: true, aimK: isDesk ? 1 : PHONE_AIM, limit: !isDesk, why };
}

// perf(v2) phone round 2 (the owner's iPhone 16 Pro, 2026-11-13: "pace 30 Hz display" with Low Power Mode off): a frame
// whose GPU busy span is over one vsync misses it and presents on the next, so a 60 Hz display shows 33.3 ms rAF intervals,
// the same as a display pinned at 30 Hz. An interval is evidence of the refresh only when the frame could not have been
// quantized: no GPU timer (the old rule), a short interval (< 22 ms: the display is at least 45 Hz), or a span under 45 %
// of the interval (the GPU would have fit a vsync twice as fast)
export const refreshEvidence = (dtMs, gpuMs = null) => gpuMs == null || !(gpuMs >= 0) || dtMs < 22 || gpuMs <= 0.45 * dtMs;
// the display's refresh from rAF intervals taken while the page is light (the load, before the first frame): a busy main
// thread only lengthens an interval, never shortens it under the vsync, so the lowest third is the refresh → ms or null
export function idleBudget(intervalsMs) {
  const a = (intervalsMs ?? []).filter((x) => x > 2 && x < 100).sort((x, y) => x - y);
  if (a.length < 12) return null;
  return budgetFromRefresh(a.slice(0, Math.max(5, Math.ceil(a.length / 3))), { dflt: null });
}

// a probe: feed it rAF time stamps and the frame's GPU busy span (null without a timer); after `n` intervals (the first
// `skip` dropped: the page settling) it reports once: onBudget(ms, { source, quantized, evidence, of }). The budget is the
// refresh from the evidence intervals (refreshEvidence) when at least half of them are; else the idle refresh measured at
// load (setIdle), else 60 Hz ('default'); and a ≤ 40 Hz reading from frames never wins over a faster idle reading.
// quantized: the frames' own intervals were not the display's (GPU-bound frames each missing a vsync)
// fix(v2) governor: feed it the GPU's work (the passes' own shares), not the busy span: the span holds idle gaps (11.7 ms
// of the owner's 22.5), so a light frame read as one that could have missed a vsync
//   const probe = createRefreshProbe((budgetMs) => gov.setBudget(budgetMs));  probe.setIdle(idleBudget(dts));  probe.sample(now, gpuSpanMs)
export function createRefreshProbe(onBudget, { n = 60, skip = 10 } = {}) {
  const dts = new Float64Array(n); let prev = null, i = 0, seen = 0, kept = 0, done = false, idle = null, info = null;
  return {
    get done() { return done; },
    get info() { return info; },
    get idle() { return idle; },
    setIdle(ms) { if (ms > 0 && Number.isFinite(ms)) idle = ms; },
    sample(now, gpuMs = null) {
      if (done) return;
      if (prev != null) {
        seen++;
        if (seen > skip) {
          const dt = now - prev; i++;
          if (refreshEvidence(dt, gpuMs)) dts[kept++] = dt;
          if (i >= n) {
            done = true;
            let b = kept >= n / 2 ? budgetFromRefresh(Array.from(dts.subarray(0, kept))) : null, source = 'frames';
            if (b == null) { b = idle ?? 1000 / 60; source = idle != null ? 'idle' : 'default'; } else if (b > 25 && idle != null && idle < 25) { b = idle; source = 'idle'; }
            info = { source, quantized: source !== 'frames', evidence: kept, of: n };
            onBudget(b, info);
          }
        }
      }
      prev = now;
    },
  };
}
