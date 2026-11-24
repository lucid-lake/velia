// Things in the air (owner, 2026-10-29: "Seeing the wind"). Pure JS, no three.js: tests/air.test.mjs drives it.
// Everything reads the one wind module (src/wind.js: sample() for the air's velocity, gustAt() for the gust factor); no
// effect has a wind of its own, and nothing uses Math.random() (a seeded generator: the same seed and clock draw the same air).
//
//   1. MOTES: June pine pollen (pale yellow, tiny) and, now and then, cottonwood fluff (white, larger, slower) drifting
//      with the true wind through a cylinder around the camera. A few hundred; sparse in a light breeze, denser and faster
//      in a gust (faster because the air is); none at night, none in rain; none low over the water (they would read as
//      white flecks on it: they fade below 1.2 m); brighter looking toward the sun (forward scatter).
//   2. WISPS: above ≈ 18 kn (9.3 m/s) the wind lifts a thin veil off the crests: a few short-lived grey-white wisps
//      (≤ 9 per second at 24 kn), rising a little and streaming downwind. Not dots on the water; sparse.
//   3. LINES: the beginners' wind lines: thin short-lived strokes in the air near the boat flowing with the true wind,
//      gathering where the gust factor is high. `strength` (0–1) is set by the caller (the wind-lines setting and
//      the skill model's windRead(): auto fades them out as the player reads the wind).
//
//   const air = new AirSim({ wind, seed, waveAt });
//   air.update(dt, { t, cam: [x,y,z], boat: { x, z, heading }, light: 0..1 (the daylight level), sun: [x,y,z] (unit, world),
//                    rain: 0..1, lines: 0..1 });
//   air.motes → { n, x[], y[], z[], size[] (m), alpha[], tint[] (0 pollen … 1 white) }   air.lines → { n, ax, ay, az, bx, by, bz, alpha }
import { mulberry32 } from './core/rng.js';
export const AIR = {
  motes: 300, fluffEvery: 12, radius: 26, y0: 0.4, y1: 9,           // the pool; the cylinder around the camera (m)
  pollenAlpha: 0.9, fluffAlpha: 0.8, pollenSize: 0.014, fluffSize: 0.045,   // alpha at full density; sizes in m (lifted to the pixel floor)
  minPx: 3.0, pxM: 0.0013,                                          // the least a mote draws, in px, and 1 px in m per m of distance at 1280×720
  lowFade: [0.9, 2.4],                                              // m above the water: invisible below, full above
  calmFrac: 0.55, gustFrac: 1.0, gustMeanS: 45,                      // active share of the pool: calm → in a gust (25 % over its own 45 s mean or more)
  windAtHeight: 0.85,                                               // the air at 1–9 m over the 10 m wind
  night: [0.12, 0.45],                                              // daylight level: none below the first, full above the second
  spray: { kn: 18, fullKn: 24, rate: 9, pool: 48, crestY: 0.2, life: [0.7, 0.5], size: [0.16, 0.34], alpha: 0.22, minM: 5, maxM: 46 },
  lines: { pool: 130, perS: 28, life: [2.0, 1.4], lenS: 0.9, lenMin: 2.0, lenMax: 8, alpha: 1.0, y: [1.3, 8], r: [-26, 48], across: 38, tries: 3 },
};
const KN = 0.514444;
import { smooth } from './core/math.js';
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));


export class AirSim {
  constructor({ wind, seed = 1, waveAt = null, cfg = AIR } = {}) {
    this.wind = wind; this.waveAt = waveAt; this.C = cfg;
    const rand = this.rand = mulberry32(seed * 104729 + 7);
    const N = cfg.motes, L = cfg.lines.pool, W = cfg.spray.pool;
    // the motes' own state; the wisps follow them in the same arrays (index ≥ N), so one draw call holds both
    this.nMote = N; this.nWisp = W;
    const T = N + W;
    this.motes = { n: T, x: new Float32Array(T), y: new Float32Array(T), z: new Float32Array(T), size: new Float32Array(T), alpha: new Float32Array(T), tint: new Float32Array(T) };
    this.vx = new Float32Array(T); this.vz = new Float32Array(T); this.vy = new Float32Array(T);
    this.gate = new Float32Array(N); this.phase = new Float32Array(N); this.fluff = new Uint8Array(N);
    for (let i = 0; i < N; i++) { this.phase[i] = rand() * 6.283; this.fluff[i] = i % cfg.fluffEvery === cfg.fluffEvery - 1 ? 1 : 0; }
    this.age = new Float32Array(W).fill(1e9); this.life = new Float32Array(W).fill(1);
    this.seeded = false; this.frac = 0; this.carryW = 0; this.carryL = 0;
    // the lines
    this.lines = { n: L, ax: new Float32Array(L), ay: new Float32Array(L), az: new Float32Array(L), bx: new Float32Array(L), by: new Float32Array(L), bz: new Float32Array(L), alpha: new Float32Array(L) };
    this.lp = { x: new Float32Array(L), y: new Float32Array(L), z: new Float32Array(L), vx: new Float32Array(L), vz: new Float32Array(L), age: new Float32Array(L).fill(1e9), life: new Float32Array(L).fill(1), g: new Float32Array(L), len: new Float32Array(L) };
    this.lineK = 0; this.clock = 0; this.sampleAt = new Float32Array(N).fill(-1);
    this.cellV = new Float32Array(2 * N);   // each mote's last wind sample (refreshed in turn)
    this.stats = { active: 0, wisps: 0, lines: 0, gust: 1, tws: 0 };
  }

  airAt(x, z, t) { const w = this.wind.sample(x, z, t); return [w.vx ?? 0, w.vz ?? 0, w.speed ?? Math.hypot(w.vx ?? 0, w.vz ?? 0)]; }
  gustAt(x, z, t) { return this.wind.gustAt ? this.wind.gustAt(x, z, t) : 1; }

  update(dt, ctx) {
    dt = clamp(dt, 0, 0.1);
    const { t, cam, boat } = ctx, C = this.C, rand = this.rand, M = this.motes, N = this.nMote;
    this.clock += dt;
    const light = ctx.light ?? 1, rain = ctx.rain ?? 0, sun = ctx.sun ?? null;
    const [wvx, wvz, tws] = this.airAt(cam[0], cam[2], t);
    // a gust is a rise over the air's own recent mean (the field's factor is relative to a base that the lee and the valley scale: it can sit at 0.6 all hour)
    const g0 = this.gustAt(cam[0], cam[2], t);
    if (this.gMean == null) { let a = 0; for (let k = 0; k < 6; k++) a += this.gustAt(cam[0], cam[2], t - C.gustMeanS + k * (C.gustMeanS / 5)); this.gMean = a / 6; }   // the mean over the last 45 s, from the field itself
    this.gMean = this.gMean + (g0 - this.gMean) * Math.min(1, dt / C.gustMeanS);
    const gust = g0 / Math.max(0.2, this.gMean);
    this.stats.gust = gust; this.stats.tws = tws;
    const day = smooth(C.night[0], C.night[1], light) * (1 - clamp(rain));
    // the active share of the pool: sparse in a breeze, full in a gust; eased so a gust brings them in over a second or two
    const target = (C.calmFrac + (C.gustFrac - C.calmFrac) * smooth(1.0, 1.25, gust)) * day;
    this.frac += (target - this.frac) * Math.min(1, dt * 0.9);
    const R = C.radius, wl = Math.hypot(wvx, wvz) || 1, wdx = wvx / wl, wdz = wvz / wl;
    if (!this.seeded) {   // fill the cylinder once
      this.seeded = true;
      for (let i = 0; i < N; i++) this.respawn(i, cam, wdx, wdz, true);
    }
    const kfast = Math.min(1, dt * 0.8);
    for (let i = 0; i < N; i++) {
      // the air at the mote, refreshed in turn (1 in 12 frames each at 60 fps would be 25 samples a frame: every 0.35 s here)
      if (this.clock - this.sampleAt[i] > 0.35) {
        this.sampleAt[i] = this.clock + (i % 7) * 0.01;
        const w = this.airAt(M.x[i], M.z[i], t); this.cellV[2 * i] = w[0]; this.cellV[2 * i + 1] = w[1];
      }
      const fl = this.fluff[i], ph = this.phase[i], tt = this.clock;
      const wob = fl ? 0.5 : 0.25;   // a mote wanders a little about the air: the fluff more
      const tvx = this.cellV[2 * i] * C.windAtHeight + Math.sin(tt * 0.9 + ph) * wob, tvz = this.cellV[2 * i + 1] * C.windAtHeight + Math.cos(tt * 0.7 + ph * 1.3) * wob;
      this.vx[i] += (tvx - this.vx[i]) * kfast * 2; this.vz[i] += (tvz - this.vz[i]) * kfast * 2;
      this.vy[i] = Math.sin(tt * (fl ? 0.8 : 1.3) + ph * 2) * (fl ? 0.25 : 0.12) - (fl ? 0.12 : 0.04);
      M.x[i] += this.vx[i] * dt; M.z[i] += this.vz[i] * dt; M.y[i] += this.vy[i] * dt;
      const dx = M.x[i] - cam[0], dz = M.z[i] - cam[2], d2 = dx * dx + dz * dz;
      if (d2 > R * R || M.y[i] < C.y0 || M.y[i] > C.y1) this.respawn(i, cam, wdx, wdz, false);
      // the gate: the first `frac` of the pool is live (the fluff has its own slow comings and goings)
      const live = i < this.frac * N * 1.0001 ? 1 : 0;
      const fgate = fl ? smooth(0.15, 0.55, 0.5 + 0.5 * Math.sin(tt / 23 + ph * 5)) : 1;
      this.gate[i] += ((live * fgate) - this.gate[i]) * Math.min(1, dt * 1.5);
      // shape
      const ddx = M.x[i] - cam[0], ddy = M.y[i] - cam[1], ddz = M.z[i] - cam[2], dist = Math.hypot(ddx, ddy, ddz) + 1e-3;
      const base = fl ? C.fluffSize : C.pollenSize, minM = C.minPx * C.pxM * dist;
      const size = Math.max(base, minM);
      const edge = 1 - smooth(0.62 * R, R, Math.sqrt(d2)), low = smooth(C.lowFade[0], C.lowFade[1], M.y[i]), near = smooth(1.2, 3.5, dist);
      let fw = 0.9;
      if (sun) { const c = (ddx * sun[0] + ddy * sun[1] + ddz * sun[2]) / dist; fw = 0.8 + 0.9 * Math.pow(Math.max(0, c), 3); }   // forward scatter: brighter looking toward the sun
      M.size[i] = size;
      M.tint[i] = fl ? 1 : 0;
      M.alpha[i] = (fl ? C.fluffAlpha : C.pollenAlpha) * Math.min(1, base / size + 0.45) * this.gate[i] * edge * low * near * fw;
    }
    this.wisps(dt, ctx, tws, day);
    this.strokes(dt, ctx, tws);
    let a = 0; for (let i = 0; i < N; i++) if (M.alpha[i] > 0.004) a++;
    this.stats.active = a;
  }

  respawn(i, cam, wdx, wdz, anywhere) {
    const C = this.C, M = this.motes, r = this.rand;
    const ang = r() * 6.2832, rr = C.radius * (anywhere ? Math.sqrt(r()) : 0.95);
    let px, pz;
    if (anywhere) { px = Math.cos(ang) * rr; pz = Math.sin(ang) * rr; }
    else {   // re-enter on the upwind side, spread across the stream
      const across = (r() * 2 - 1) * C.radius * 0.95, along = -Math.sqrt(Math.max(0, C.radius * C.radius * 0.9 - across * across));
      px = wdx * along - wdz * across; pz = wdz * along + wdx * across;
    }
    M.x[i] = cam[0] + px; M.z[i] = cam[2] + pz;
    M.y[i] = C.y0 + 0.6 + Math.pow(r(), 1.4) * (C.y1 - C.y0 - 0.8);
    this.sampleAt[i] = -1;
  }

  // crest wisps above ≈ 18 kn
  wisps(dt, ctx, tws, day) {
    const C = this.C.spray, M = this.motes, N = this.nMote, rand = this.rand, boat = ctx.boat ?? { x: ctx.cam[0], z: ctx.cam[2] };
    const w = smooth(C.kn * KN, C.fullKn * KN, tws);
    this.carryW += C.rate * w * dt * (this.waveAt ? 1 : 0);
    let tries = 0;
    while (this.carryW >= 1 && tries++ < 12) {
      const ang = rand() * 6.2832, rr = C.minM + (C.maxM - C.minM) * Math.sqrt(rand());
      const x = boat.x + Math.cos(ang) * rr, z = boat.z + Math.sin(ang) * rr, wv = this.waveAt(x, z, ctx.t), y = wv.y ?? wv.height ?? 0;
      if (y < C.crestY) continue;   // only a crest throws spray
      this.carryW -= 1;
      let j = -1; for (let k = 0; k < this.nWisp; k++) if (this.age[k] >= this.life[k]) { j = k; break; }
      if (j < 0) break;
      const i = N + j, a = this.airAt(x, z, ctx.t);
      M.x[i] = x; M.z[i] = z; M.y[i] = y + 0.15; this.vx[i] = a[0] * 0.8; this.vz[i] = a[1] * 0.8; this.vy[i] = 0.5 + 0.7 * rand();
      this.age[j] = 0; this.life[j] = C.life[0] + C.life[1] * rand(); M.tint[i] = 0.85;
    }
    if (this.carryW > 2) this.carryW = 2;
    let n = 0;
    for (let j = 0; j < this.nWisp; j++) {
      const i = N + j;
      this.age[j] += dt;
      const u = this.age[j] / this.life[j];
      if (u >= 1) { M.alpha[i] = 0; M.size[i] = 0; continue; }
      this.vy[i] -= 2.2 * dt;
      M.x[i] += this.vx[i] * dt; M.z[i] += this.vz[i] * dt; M.y[i] += this.vy[i] * dt;
      if (M.y[i] < -0.05) { this.age[j] = this.life[j]; M.alpha[i] = 0; continue; }
      const dist = Math.hypot(M.x[i] - ctx.cam[0], M.y[i] - ctx.cam[1], M.z[i] - ctx.cam[2]) + 1e-3;
      M.size[i] = Math.max((C.size[0] + C.size[1] * u), this.C.minPx * this.C.pxM * dist);
      M.alpha[i] = C.alpha * Math.sin(Math.PI * Math.min(1, u * 1.15)) * day * smooth(1.2, 3.5, dist);
      n++;
    }
    this.stats.wisps = n;
  }

  // the beginners' lines
  strokes(dt, ctx, tws) {
    const C = this.C.lines, S = this.lines, P = this.lp, rand = this.rand, L = S.n;
    const boat = ctx.boat ?? { x: ctx.cam[0], z: ctx.cam[2] }, want = clamp(ctx.lines ?? 0);
    this.lineK += (want - this.lineK) * Math.min(1, dt * 0.6);   // fades in and out over a few seconds
    const k = this.lineK;
    // spawn: where the gust factor is high first (the best of a few seeded tries), more of them as the line is strong
    this.carryL += C.perS * Math.max(k, 0.0) * dt;
    const [wvx, wvz] = this.airAt(boat.x, boat.z, ctx.t), wl = Math.hypot(wvx, wvz) || 1, wdx = wvx / wl, wdz = wvz / wl;
    let guard = 0;
    while (this.carryL >= 1 && guard++ < 8) {
      let j = -1; for (let q = 0; q < L; q++) if (P.age[q] >= P.life[q]) { j = q; break; }
      if (j < 0) break;
      this.carryL -= 1;
      let best = null;
      for (let q = 0; q < C.tries; q++) {
        const along = C.r[0] + (C.r[1] - C.r[0]) * rand(), across = (rand() * 2 - 1) * C.across;
        const x = boat.x - wdx * along - wdz * across, z = boat.z - wdz * along + wdx * across, g = this.gustAt(x, z, ctx.t);
        if (!best || g > best.g) best = { x, z, g };
      }
      const a = this.airAt(best.x, best.z, ctx.t);
      P.x[j] = best.x; P.z[j] = best.z; P.y[j] = C.y[0] + Math.pow(rand(), 1.6) * (C.y[1] - C.y[0]);
      P.vx[j] = a[0]; P.vz[j] = a[1]; P.g[j] = best.g; P.len[j] = clamp(C.lenS * a[2] * (0.85 + 0.3 * rand()), C.lenMin, C.lenMax);
      P.age[j] = 0; P.life[j] = C.life[0] + C.life[1] * rand();
    }
    if (this.carryL > 3) this.carryL = 3;
    let n = 0;
    for (let j = 0; j < L; j++) {
      P.age[j] += dt;
      const u = P.age[j] / P.life[j];
      if (u >= 1) { S.alpha[j] = 0; continue; }
      P.x[j] += P.vx[j] * dt; P.z[j] += P.vz[j] * dt;
      const sp = Math.hypot(P.vx[j], P.vz[j]) || 1, ux = P.vx[j] / sp, uz = P.vz[j] / sp, len = P.len[j] * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.5;
      S.bx[j] = P.x[j]; S.by[j] = P.y[j]; S.bz[j] = P.z[j];
      S.ax[j] = P.x[j] - ux * len; S.ay[j] = P.y[j]; S.az[j] = P.z[j] - uz * len;
      const near = clamp(1 - Math.hypot(P.x[j] - boat.x, P.z[j] - boat.z) / 90);   // fainter with distance from the boat
      S.alpha[j] = C.alpha * (0.55 + 0.45 * clamp((P.g[j] - 0.9) / 0.4)) * Math.sin(Math.PI * u) ** 1.3 * near * (0.35 + 0.65 * smooth(C.y[0] - 0.1, 2.5, P.y[j])) * k;
      n++;
    }
    this.stats.lines = n;
  }
}

// The fade of the lines with skill: 'on' always, 'off' never, 'auto' (the default) 1 − windRead (0–1) from the skill
// model. A pro (windRead 1) sees none.
export function linesStrength(setting, windRead) {
  if (setting === 'off') return 0;
  if (setting === 'on') return 1;
  return clamp(1 - (windRead ?? 0));
}

// ?airboost=k: every effect's alpha × k (for tuning and the proof captures; 1 is the shipped look). tier: the quality
// tier's pools ({ motes, lines, spray }: src/quality/tiers.js air); none: AIR's own (High's)
export function airConfig(k = 1, tier = null) {
  const A = !tier ? AIR : { ...AIR, motes: tier.motes, lines: { ...AIR.lines, pool: tier.lines }, spray: { ...AIR.spray, pool: tier.spray } };
  if (!(k > 0) || k === 1) return A;
  return { ...A, pollenAlpha: A.pollenAlpha * k, fluffAlpha: A.fluffAlpha * k, spray: { ...A.spray, alpha: A.spray.alpha * k }, lines: { ...A.lines, alpha: A.lines.alpha * k } };
}
