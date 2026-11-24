// The paddler's motion (feat/kayak-paddler stages 4–7): the approved key poses splined
// into loops, the loops blended by a small controller. Pure numbers, no meshes: the rig (rig.js) turns a pose into bones,
// the paddler (index.js) reads where the blades are and raises the stroke events. Deterministic: the same intents and
// steps give the same poses (the rest idles come from the seed, never Math.random or a wall clock).
//
//   const m = createPaddleMotion({ seed });
//   m.setMode('rest' | 'cruise' | 'sprint' | 'turnLeft' | 'turnRight' | 'back')   a preset intent
//   m.setIntent({ throttle: -1..1, turn: -1..1 })   throttle > 0 forward (0.5 cruise, 1 sprint), < 0 back paddling;
//                                                   turn < 0 to port (sweeps on the starboard side), > 0 to starboard
//   m.update(dt) → pose        the blended pose (poses.js format) for this step
//   m.snap(phase)              jump straight to the intent's blend at that phase (stills)
//   m.state()                  { mode, intent, phase, hz, weights, side, strokes }
//     phase 0..1 over one full cycle: a starboard stroke in 0–0.5 (catch at 0), a port one in 0.5–1 (a sweep loop
//     strokes the same side twice); side: the side whose stroke the phase is in ('R' | 'L')
//
// Loops (each its own keys, not one stroke sped up). The rates are human (owner, 2026-11-07; K3 § Round 7): a full cycle
// (a stroke each side) takes 2.0 s in a cruise (30 strokes a side a minute, a touring pace), 1.0 s in a sprint (60 a side,
// a hard effort under an elite 200 m race's 72–84), 2.4 s back paddling and 2.8 s for two sweeps. Cruise: low angle;
// sprint: a high shaft, long reach, more lean and rotation; back paddling on the back face, the head turned to the blade;
// a sweep on one side, wide and low, carried forward over the same side; rest: the paddle across the lap, breathing, a
// slow look round the view and now and then a long look to one side.
//
// Timing follows the load (owner: "when the paddle is in the air a human can move it faster; when a tip is in the water
// the human needs strength to resist it"): the phase does not run at a constant speed. Through each stroke its speed
// follows LOAD_SPEED: the blade spears in quickly, slows as it bites and the load builds, speeds up through the pull as the
// torso unwinds, releases quickly at the hip and swings forward in the air fastest, easing to place the next catch. The
// curve is C2 (quintic smoothsteps between its points), so the paddle's speed and acceleration change without a step; the
// keys are splined C2 too (a periodic cubic spline through them).
import { KEY_POSES } from './keyPoses.js';   // the key poses as data (poses.js adds the paddle's three.js transform)

const FIELDS = [['c', 3], ['e', 1], ['yaw', 1], ['roll', 1], ['twist', 1], ['lean', 1], ['side', 1], ['head', 2], ['hip', 3], ['heelL', 3], ['heelR', 3]];
const N = FIELDS.reduce((s, [, n]) => s + n, 0);
export function flatten(p) {
  const v = new Float64Array(N); let i = 0;
  for (const [k, n] of FIELDS) { if (n === 1) v[i++] = p[k] ?? 0; else for (let j = 0; j < n; j++) v[i++] = p[k]?.[j] ?? 0; }
  return v;
}
export function unflatten(v) {
  const p = {}; let i = 0;
  for (const [k, n] of FIELDS) { if (n === 1) p[k] = v[i++]; else { p[k] = []; for (let j = 0; j < n; j++) p[k].push(v[i++]); } }
  return p;
}
const lerpV = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
// the phase's speed through a stroke (one half of the cycle, x 0..1 from the catch), relative: [x, speed]. The blade is in
// the water from the catch to x 0.58 (the pull windows: 0.29 of the cycle); measured, the water takes ≈ 66 % of each
// stroke's time (sources in K3 § Round 7: 57–64 % in modern racing, 71–73 % in older studies; a slow touring stroke sits
// between)
const LOAD_SPEED = [[0, 1.25], [0.12, 0.88], [0.40, 1.15], [0.52, 1.2], [0.64, 1.55], [0.86, 1.55]];
const quintic = (t) => t * t * t * (t * (6 * t - 15) + 10);
export function loadSpeed(phase) {
  const x = ((phase * 2) % 1 + 1) % 1, P = LOAD_SPEED, n = P.length;
  for (let i = 0; i < n; i++) {
    const [x0, v0] = P[i], [x1r, v1] = P[(i + 1) % n], x1 = i + 1 < n ? x1r : 1;
    if (x >= x0 && x < x1) return v0 + (v1 - v0) * quintic((x - x0) / (x1 - x0));
  }
  return P[0][1];
}
// the harmonic mean of the speed over a stroke: the phase advances at hz × speed / VBAR, so a cycle still takes 1 / hz
export const VBAR = (() => { let s = 0; const M = 4000; for (let i = 0; i < M; i++) s += 1 / loadSpeed((i + 0.5) / M / 2); return M / s; })();
const K = (name) => flatten(KEY_POSES[name]);
const at = (v, field) => { let i = 0; for (const [k, n] of FIELDS) { if (k === field) return i; i += n; } return -1; };
const I = { side: at(0, 'side'), cy: at(0, 'c') + 1, cz: at(0, 'c') + 2, e: at(0, 'e'), roll: at(0, 'roll'), headY: at(0, 'head'), headP: at(0, 'head') + 1, lean: at(0, 'lean'), twist: at(0, 'twist') };

// the recovery between two strokes: halfway, the shaft swung level and lifted (or, on a same-side recovery, the blade
// lifted clear and carried forward)
function recovery(a, b, { lift = 0.05, e = null } = {}) {
  const r = lerpV(a, b, 0.5);
  r[I.cy] += lift;
  r[I.cz] -= 0.08;   // the hands carried forward toward the next catch (the elbows stay in front of the chest)
  r[I.e] = e ?? (a[I.e] + b[I.e]) * 0.15;
  return r;
}
function loop(hz, keys) { return { hz, keys: keys.map(([t, v]) => [t, Float64Array.from(v)]) }; }

export const LOOPS = (() => {
  const cr = { c: K('cruise_catchR'), p: K('cruise_pullR'), x: K('cruise_exitR'), cl: K('cruise_catchL'), pl: K('cruise_pullL'), xl: K('cruise_exitL') };
  const sp = { c: K('sprint_catchR'), p: K('sprint_pullR'), x: K('sprint_exitR'), cl: K('sprint_catchL'), pl: K('sprint_pullL'), xl: K('sprint_exitL') };
  const bk = { c: K('back_catchR'), p: K('back_midR'), x: K('back_exitR'), cl: K('back_catchL'), pl: K('back_midL'), xl: K('back_exitL') };
  const sw = (s) => ({ c: K(`sweep_catch${s}`), m: K(`sweep_mid${s}`), x: K(`sweep_end${s}`) });
  const swR = sw('R'), swL = sw('L');
  const sweepLoop = (q) => loop(0.36, [[0, q.c], [0.15, q.m], [0.30, q.x], [0.40, recovery(q.x, q.c, { lift: 0.08, e: q.c[I.e] * 0.25 })],
    [0.5, q.c], [0.65, q.m], [0.80, q.x], [0.90, recovery(q.x, q.c, { lift: 0.08, e: q.c[I.e] * 0.25 })]]);
  return {
    cruise: loop(0.5, [[0, cr.c], [0.13, cr.p], [0.29, cr.x], [0.40, recovery(cr.x, cr.cl, { lift: 0.0 })], [0.5, cr.cl], [0.63, cr.pl], [0.79, cr.xl], [0.90, recovery(cr.xl, cr.c, { lift: 0.0 })]]),
    sprint: loop(1.0, [[0, sp.c], [0.12, sp.p], [0.26, sp.x], [0.38, recovery(sp.x, sp.cl, { lift: 0.08 })], [0.5, sp.cl], [0.62, sp.pl], [0.76, sp.xl], [0.88, recovery(sp.xl, sp.c, { lift: 0.08 })]]),
    back: loop(0.42, [[0, bk.c], [0.14, bk.p], [0.28, bk.x], [0.40, recovery(bk.x, bk.cl)], [0.5, bk.cl], [0.64, bk.pl], [0.78, bk.xl], [0.90, recovery(bk.xl, bk.c)]]),
    sweepR: sweepLoop(swR),
    sweepL: sweepLoop(swL),
  };
})();

// a periodic C2 cubic spline through the keys (non-uniform times, period 1): the second derivatives at the keys solve the
// cyclic tridiagonal system once per loop (cached), so the pose, its velocity and its acceleration are continuous
function splineM(L) {
  if (L._M) return L._M;
  const ks = L.keys, n = ks.length, h = (i) => { const a = ks[i][0], b = i + 1 < n ? ks[i + 1][0] : ks[0][0] + 1; return b - a; };
  const A = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) { const hm = h((i - 1 + n) % n), hi = h(i); A[i][(i - 1 + n) % n] += hm; A[i][i] += 2 * (hm + hi); A[i][(i + 1) % n] += hi; }
  const M = Array.from({ length: n }, () => new Float64Array(N));
  for (let j = 0; j < N; j++) {
    const a = A.map((r) => Float64Array.from(r)), b = new Float64Array(n);
    for (let i = 0; i < n; i++) { const im = (i - 1 + n) % n, ip = (i + 1) % n; b[i] = 6 * ((ks[ip][1][j] - ks[i][1][j]) / h(i) - (ks[i][1][j] - ks[im][1][j]) / h(im)); }
    for (let c = 0; c < n; c++) {   // Gaussian elimination with partial pivoting (n is 8)
      let piv = c; for (let r2 = c + 1; r2 < n; r2++) if (Math.abs(a[r2][c]) > Math.abs(a[piv][c])) piv = r2;
      [a[c], a[piv]] = [a[piv], a[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      for (let r2 = c + 1; r2 < n; r2++) { const f = a[r2][c] / a[c][c]; if (!f) continue; for (let k = c; k < n; k++) a[r2][k] -= f * a[c][k]; b[r2] -= f * b[c]; }
    }
    for (let c = n - 1; c >= 0; c--) { let v = b[c]; for (let k = c + 1; k < n; k++) v -= a[c][k] * M[k][j]; M[c][j] = v / a[c][c]; }
  }
  L._M = M; L._h = h;
  return M;
}
export function sampleLoop(L, phase, out = new Float64Array(N)) {
  const ks = L.keys, n = ks.length, ph = ((phase % 1) + 1) % 1, M = splineM(L);
  let i = n - 1; for (let k = 0; k < n; k++) if (ks[k][0] <= ph) i = k;
  const t0 = ks[i][0], hh = L._h(i), x = ph >= t0 ? ph - t0 : ph + 1 - t0, ip = (i + 1) % n;
  const a = hh - x, b = x;
  for (let j = 0; j < N; j++) {
    const y0 = ks[i][1][j], y1 = ks[ip][1][j], m0 = M[i][j], m1 = M[ip][j];
    out[j] = m0 * a * a * a / (6 * hh) + m1 * b * b * b / (6 * hh) + (y0 / hh - m0 * hh / 6) * a + (y1 / hh - m1 * hh / 6) * b;
  }
  return out;
}

// mulberry32 and a smooth value noise from it, for the rest idles
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const MODES = Object.freeze({
  rest: { throttle: 0, turn: 0 }, cruise: { throttle: 0.5, turn: 0 }, sprint: { throttle: 1, turn: 0 },
  turnLeft: { throttle: 0, turn: -1 }, turnRight: { throttle: 0, turn: 1 }, back: { throttle: -0.6, turn: 0 },
});
const GAITS = ['rest', 'cruise', 'sprint', 'back', 'sweepR', 'sweepL'];
const HZ = { rest: 0.25, cruise: LOOPS.cruise.hz, sprint: LOOPS.sprint.hz, back: LOOPS.back.hz, sweepR: LOOPS.sweepR.hz, sweepL: LOOPS.sweepL.hz };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function targetWeights({ throttle = 0, turn = 0 }) {
  const th = Math.max(-1, Math.min(1, throttle)), tu = Math.max(-1, Math.min(1, turn));
  const fwd = Math.max(0, th), rev = Math.max(0, -th), ta = Math.abs(tu);
  const w = Object.fromEntries(GAITS.map((g) => [g, 0]));
  const move = Math.max(fwd, rev, ta);
  w.rest = 1 - ss(0.05, 0.3, move);
  const sweep = ss(0.2, 0.6, ta) * (1 - 0.5 * fwd);
  w[tu < 0 ? 'sweepR' : 'sweepL'] = (1 - w.rest) * sweep;
  const rest2 = (1 - w.rest) * (1 - sweep);
  if (rev > fwd) w.back = rest2;
  else { const s = ss(0.6, 0.95, fwd); w.sprint = rest2 * s; w.cruise = rest2 * (1 - s); }
  const sum = GAITS.reduce((s, g) => s + w[g], 0) || 1;
  for (const g of GAITS) w[g] /= sum;
  return w;
}

export function createPaddleMotion({ seed = 1, mode = 'rest' } = {}) {
  const r = rng(seed * 2654435761 + 7);
  const idle = { a: r() * 6.28, b: r() * 6.28, c: r() * 6.28, next: 6 + r() * 6, look: 0, lookDir: r() < 0.5 ? -1 : 1, lookT: 0 };
  let intent = { ...MODES[mode] ?? MODES.rest }, modeName = MODES[mode] ? mode : 'rest';
  const w = targetWeights(intent);
  let phase = 0, t = 0, strokes = 0, hz = HZ.rest;
  const buf = Object.fromEntries(GAITS.map((g) => [g, new Float64Array(N)]));
  const out = new Float64Array(N);
  let headY = null, headP = null, applied = null;
  const restKey = K('rest');
  // a little life (seeded, smooth, never repeating exactly): the stroke rate wanders ±4 %, the torso's swing ±4 %
  const vary = { a: r() * 6.28, b: r() * 6.28, c: r() * 6.28, d: r() * 6.28 };
  const wm = { ...w };   // the weights' first easing stage (two stages: the blend's rate changes smoothly too)
  const torso = new Float64Array(N);

  function restPose(dt) {
    const v = Float64Array.from(restKey);
    // breathing (≈ 13 a minute), a slow look round, a long look to one side now and then (every 6–12 s, ≈ 3.5 s)
    v[I.lean] += 1.2 * Math.sin(2 * Math.PI * 0.22 * t + idle.a);
    v[I.cy] += 0.006 * Math.sin(2 * Math.PI * 0.22 * t + idle.a + 0.6);
    v[I.headY] += 14 * Math.sin(2 * Math.PI * 0.045 * t + idle.b) + 6 * Math.sin(2 * Math.PI * 0.11 * t + idle.c);
    v[I.headP] += 3 * Math.sin(2 * Math.PI * 0.07 * t + idle.c);
    idle.next -= dt;
    if (idle.next <= 0 && idle.lookT <= 0) { idle.lookT = 3.5; idle.lookDir = r() < 0.5 ? -1 : 1; idle.next = 6 + r() * 6; }
    if (idle.lookT > 0) idle.lookT -= dt;
    const want = idle.lookT > 0 ? 1 : 0;
    idle.look += (want - idle.look) * (1 - Math.exp(-dt / 0.6));
    v[I.headY] += idle.lookDir * 42 * idle.look;
    v[I.twist] += idle.lookDir * 10 * idle.look;   // the chest turns a little with a long look
    return v;
  }

  return {
    setMode(m) { if (!MODES[m]) throw new Error(`unknown mode ${m}`); modeName = m; intent = { ...MODES[m] }; },
    setIntent({ throttle = 0, turn = 0 } = {}) { intent = { throttle, turn }; modeName = 'intent'; },
    // jump to the current intent's blend at a phase (a still capture: no blend-in, a chosen moment of the stroke)
    snap(ph = phase) { const tw = targetWeights(intent); for (const g of GAITS) w[g] = tw[g]; phase = ((ph % 1) + 1) % 1; hz = GAITS.reduce((s, g) => s + w[g] * HZ[g], 0); headY = null; headP = null; },
    update(dt, pace = 1) {   // pace: the paddler's pull speed against the loop's own (the boat passing the blade sets it)
      t += dt;
      // a sweep comes in only at its own side's catch (else, from cruise, the blend crosses a port stroke with a starboard
      // sweep and the paddle swings through the boat): until the phase reaches that catch, the old blend holds
      let tw = targetWeights(intent);
      const nearR = phase >= 0.9 || phase < 0.06, nearL = phase >= 0.4 && phase < 0.56;
      if ((tw.sweepR > w.sweepR + 0.02 && !nearR && w.sweepR < 0.5) || (tw.sweepL > w.sweepL + 0.02 && !nearL && w.sweepL < 0.5)) tw = applied ?? tw;
      applied = tw;
      const k = 1 - Math.exp(-dt / 0.24);
      for (const g of GAITS) { wm[g] += (tw[g] - wm[g]) * k; w[g] += (wm[g] - w[g]) * k; }
      const rate = 1 + 0.025 * Math.sin(2 * Math.PI * 0.093 * t + vary.a) + 0.015 * Math.sin(2 * Math.PI * 0.051 * t + vary.b);
      hz = GAITS.reduce((s, g) => s + w[g] * HZ[g], 0) * rate;
      const before = Math.floor(phase * 2);
      // the phase runs at the load's speed (slow in the loaded pull, fast in the air), a midpoint step
      const f = (ph) => hz * loadSpeed(ph) / VBAR * pace;
      phase += dt * f(phase + 0.5 * dt * f(phase));
      if (Math.floor(phase * 2) !== before) strokes++;
      phase -= Math.floor(phase);
      out.fill(0); torso.fill(0);
      // overlap: the torso leads the paddle by 70 ms (sampled that far ahead along the stroke), so the chest turns first,
      // the shoulders and the arms (tied to the paddle) follow a few frames later
      const lead = 0.07 * f(phase);
      for (const g of GAITS) {
        if (w[g] < 1e-4) continue;
        const v = g === 'rest' ? restPose(dt) : sampleLoop(LOOPS[g], phase, buf[g]);
        for (let j = 0; j < N; j++) out[j] += w[g] * v[j];
        const vt = g === 'rest' ? v : sampleLoop(LOOPS[g], phase + lead, buf[g]);
        for (const j of [I.twist, I.lean, I.side]) torso[j] += w[g] * vt[j];
      }
      const amp = 1 + 0.04 * Math.sin(2 * Math.PI * 0.071 * t + vary.c);
      for (const j of [I.twist, I.lean, I.side]) out[j] = torso[j] * amp;
      // breathing while paddling too (≈ 15 a minute), small; the head counters the chest's turn a little
      out[I.lean] += 0.5 * (1 - w.rest) * Math.sin(2 * Math.PI * 0.25 * t + vary.d);
      out[I.headY] -= 0.06 * out[I.twist];
      if (w.rest < 1e-4) restPose(dt);   // keep the idle clock running
      // the head lags the chest a little (a still head, an eased look), so the look never snaps
      const hk = 1 - Math.exp(-dt / 0.22);
      headY = headY == null ? out[I.headY] : headY + (out[I.headY] - headY) * hk;
      headP = headP == null ? out[I.headP] : headP + (out[I.headP] - headP) * hk;
      out[I.headY] = headY; out[I.headP] = headP;
      return unflatten(out);
    },
    state() {
      return { mode: modeName, intent: { ...intent }, phase, hz, weights: { ...w }, side: phase < 0.5 ? 'R' : 'L', strokes, t };
    },
  };
}
