// Readable wind shifts (pro sailing, owner 2026-10-29): the slow oscillations in the wind's direction a
// sailor plays on a beat. Plain JS, no three.js. src/wind.js calls it from one marked hook (dirAt and toTexture), so
// every effect that reads the wind (the sails, the telltales, the glyph's arrow, the pod's needle, the water's lanes
// and the gust patches' streaks) sees the same shift.
//
// What real lake wind does (research: Houghton & Sanders, "Wind Strategy" (2nd ed., 2005) ch. 3–5; Bethwaite, "High
// Performance Sailing" (2008) ch. 9–11; Walker, "Wind and Strategy" (1998)): on an inland water the direction
// oscillates by typically ±5–15° with periods of a few minutes to ≈ 10 (the thermals' rolls and the gradient wind's
// eddies), the shifts are carried downwind with the air (a shift seen on the water upwind arrives at the boat about
// a wavelength / wind speed later), they are bigger in light air than in a breeze, and they are bigger and partly
// persistent near the shore, at headlands, bay mouths and valley outflows (the land's own bends).
//
// The model: a frozen pattern carried by the air (the gusts' own advection, WindField.advection), so it drifts downwind
// at the wind speed. In the advected frame q = p − adv(t), with a = q·û along the wind and c = q·n̂ across it:
//   shift(p, t) = G_level · G_place(p) · Σ_i A_i sin(2π a / λ_i + θ_i + φ_c,i(c) + φ_a,i(a)) + P(p)
//   - three components, at a fixed point the periods T_i = 4, 7 and 11 min at the reference wind (λ_i = V̄ · T_i, V̄
//     the level's wind at 18:45, the level's reference hour); amplitudes 3.0°, 4.0° and 3.5° on open water at level 3 (≈ 4.3° rms, ±10° peaks);
//   - φ_c: a slow phase wander across the wind (≈ 1.8 km), so a shift line is a few km long and bends, not a ruled
//     line across the lake; φ_a: a slower wander along it, so the oscillation is quasi-periodic (no metronome);
//   - G_level: × 1.6, 1.25, 1.0, 0.8 at levels 1–4 (light air shifts most, a breeze is steadier);
//   - G_place: 1 + 0.7 × roughness (headlands, bay mouths, valley outflows: WindField.roughAt) + 0.5 × the shore's
//     nearness (water within ≈ 150–900 m of land);
//   - P: a persistent bias near the land, ± 5° × (0.6 rough + 0.4 shore) on a ≈ 700 m pattern, fixed in place (a
//     shore's own bend that a local sailor learns: "the left pays off the point").
// Clouds' shifts (a veer under a cloud's leading edge) wait for a cloud field the wind can read.
//
// The trend (ShiftTrend below): the lift / header cue a tactical instrument shows (B&G's "Lift/Header", Tacktick's
// tactical compass): the true wind direction's short mean against its long mean, signed by the tack.

const DEG = Math.PI / 180;
export const SHIFTS = {
  periodsS: [240, 420, 660],         // s, at a fixed point at the reference wind (4, 7, 11 min)
  ampDeg: [3.0, 4.0, 3.5],           // degrees, open water, level 3
  levelGain: [1.6, 1.25, 1.0, 0.8],  // levels 1–4
  acrossM: 1800,                     // m: the across-wind phase wander's scale
  alongWander: 1.0,                  // rad: the along-wind phase wander's size (over 2.5 λ)
  rough: 0.7, shore: 0.5,            // G_place's gains
  shoreM: [150, 900],                // m: the shore's nearness, full within the first, none past the second
  persistDeg: 5, persistM: 700,      // the standing bias near the land
  minRefMs: 2,                       // m/s: the reference wind's floor (λ = V̄ T)
  gridN: 32,                         // the texture's coarse grid (cells across the texture's extent)
};

function hash(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
import { clampT as clamp } from './core/math.js';
import { smooth } from './core/math.js';
// 1-D smooth noise in [−1, 1]
function n1(s, seed) { const i = Math.floor(s), f = s - i; return 2 * (hash(i, 0, seed) + (hash(i + 1, 0, seed) - hash(i, 0, seed)) * fade(f)) - 1; }
// 2-D smooth value noise in [−1, 1]
function n2(x, y, seed) {
  const i = Math.floor(x), j = Math.floor(y), u = fade(x - i), v = fade(y - j);
  const a = hash(i, j, seed), b = hash(i + 1, j, seed), c = hash(i, j + 1, seed), d = hash(i + 1, j + 1, seed);
  return 2 * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) - 1;
}

export class WindShifts {
  // wind: the WindField (its seed, level, day, advection, roughAt and height); opts override SHIFTS, plus dayRefMs (the
  // day's wind at the level's hour (18:45) before the level's scale, m/s: V̄ = dayRefMs × the level's scale)
  constructor(wind, opts = {}) {
    this.w = wind;
    this.o = { ...SHIFTS, ...opts };
    this.seed = (wind.seed | 0) + 401;
    this.theta = this.o.periodsS.map((_, i) => 2 * Math.PI * hash(i, 7, this.seed));
    this.place = new Map();             // the place gain and bias per 200 m lattice point
    this.gridCache = null;
  }

  // the reference wind V̄ (m/s): the level's wind at 18:00 in day mode, the base speed for a fixed wind
  refMs() {
    const w = this.w;
    if (w.day && this.o.dayRefMs != null) return Math.max(this.o.minRefMs, this.o.dayRefMs * (w.lv?.scale0 ?? 1));
    return Math.max(this.o.minRefMs, w.base.speedMs);
  }

  levelGain() { const L = this.w.level; return L ? this.o.levelGain[clamp(L | 0, 1, 4) - 1] : 1; }

  // the shore's nearness 0..1 at a point (rings of land samples; 0 without terrain)
  shoreAt(x, z) {
    const w = this.w;
    if (!w.heightAt || w.height(x, z) > 0) return w.heightAt ? 1 : 0;
    const [r0, r1] = this.o.shoreM;
    let d = Infinity;
    for (const r of [150, 300, 500, 700, 900]) {
      for (let k = 0; k < 8; k++) { const a = (k + (r === 300 || r === 700 ? 0.5 : 0)) * Math.PI / 4; if (w.height(x + Math.cos(a) * r, z + Math.sin(a) * r) > 0) { d = r; break; } }
      if (d < Infinity) break;
    }
    return 1 - smooth(r0, r1, d);
  }

  // the place gain and the persistent bias (degrees) at a lattice point, cached
  placeNode(i, j) {
    const key = i * 65536 + j;
    let p = this.place.get(key);
    if (!p) {
      const x = i * 200, z = j * 200, o = this.o;
      const rough = this.w.heightAt ? this.w.roughAt(x, z) : 0, shore = this.shoreAt(x, z);
      p = [1 + o.rough * rough + o.shore * shore, o.persistDeg * (0.6 * rough + 0.4 * shore) * n2(x / o.persistM, z / o.persistM, this.seed + 9)];
      if (this.place.size > 40000) this.place.clear();
      this.place.set(key, p);
    }
    return p;
  }
  // [gain, bias°] at a point, bilinear on the 200 m lattice
  placeAt(x, z) {
    if (this.hAt !== this.w.heightAt) { this.place.clear(); this.gridCache = null; this.hAt = this.w.heightAt; }   // setTerrain
    const fx = x / 200, fz = z / 200, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = this.placeNode(i, j), b = this.placeNode(i + 1, j), c = this.placeNode(i, j + 1), d = this.placeNode(i + 1, j + 1);
    const l = (k) => (a[k] * (1 - u) + b[k] * u) * (1 - v) + (c[k] * (1 - u) + d[k] * u) * v;
    return [l(0), l(1)];
  }

  // the frame of time t: the advection, the along and across axes, the wavelengths, the gain
  frame(t) {
    const w = this.w;
    if (this.fr && this.fr.t === t && this.fr.dir === w.base.dirDeg) return this.fr;
    const [ox, oz] = w.advection(t), d = w.base.dirDeg * DEG, ux = -Math.sin(d), uz = Math.cos(d);
    const V = this.refMs();
    this.fr = { t, dir: w.base.dirDeg, ox, oz, ux, uz, lam: this.o.periodsS.map((T) => V * T), g: this.levelGain() };
    return this.fr;
  }

  // the open-water oscillation at a point (degrees, before the place gain)
  osc(x, z, F) {
    const o = this.o, qx = x - F.ox, qz = z - F.oz, a = qx * F.ux + qz * F.uz, c = -qx * F.uz + qz * F.ux;
    let s = 0;
    for (let i = 0; i < o.ampDeg.length; i++) {
      const L = F.lam[i];
      const ph = 2 * Math.PI * a / L + this.theta[i] + Math.PI * n1(c / o.acrossM + 13.7 * i, this.seed + 3 + i) + o.alongWander * n1(a / (2.5 * L) + 5.1 * i, this.seed + 17 + i);
      s += o.ampDeg[i] * Math.sin(ph);
    }
    return s * F.g;
  }

  // the shift at a point and time, degrees (+ = veered, clockwise)
  deg(x, z, t) {
    const F = this.frame(t), [g, bias] = this.placeAt(x, z);
    return this.osc(x, z, F) * g + bias;
  }

  // for toTexture: the shift at every texel centre (row-major, rows north to south, as WindField.toTexture), from a
  // coarse grid (gridN cells across the extent, ≈ 128 m for the water's 4 km) read bilinearly: the shift's smallest
  // scale is ≈ 1 km, so the grid is exact to ≈ 0.1°
  texture(t, sizePx, extentM, cx, cz) {
    const N = this.o.gridN, cell = extentM / N, x0 = cx - extentM / 2, z0 = cz - extentM / 2, F = this.frame(t), M = N + 1;
    this.placeAt(x0, z0);   // drops the caches after a setTerrain
    const key = `${sizePx}:${cx}:${cz}:${extentM}`;
    if (!this.gridCache || this.gridCache.key !== key) {
      const pl = new Float64Array(M * M * 2);
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const p = this.placeAt(x0 + i * cell, z0 + j * cell); pl[2 * (j * M + i)] = p[0]; pl[2 * (j * M + i) + 1] = p[1]; }
      // per texel column: the grid cell and the weight (the same for every row)
      const ci = new Int32Array(sizePx), cu = new Float64Array(sizePx), step = extentM / sizePx / cell;
      for (let q = 0; q < sizePx; q++) { const fx = Math.min((q + 0.5) * step, N - 1e-9); ci[q] = Math.floor(fx); cu[q] = fx - ci[q]; }
      this.gridCache = { key, pl, ci, cu, step, v: new Float64Array(M * M), row: new Float64Array(M), out: new Float32Array(sizePx * sizePx) };
    }
    const { pl, v, out, ci, cu, step, row } = this.gridCache;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const k = j * M + i; v[k] = this.osc(x0 + i * cell, z0 + j * cell, F) * pl[2 * k] + pl[2 * k + 1]; }
    for (let r = 0; r < sizePx; r++) {
      const fz = Math.min((r + 0.5) * step, N - 1e-9), j = Math.floor(fz), w = fz - j, o = r * sizePx;
      for (let i = 0; i <= N; i++) row[i] = v[j * M + i] * (1 - w) + v[(j + 1) * M + i] * w;
      for (let q = 0; q < sizePx; q++) { const i = ci[q]; out[o + q] = row[i] + (row[i + 1] - row[i]) * cu[q]; }
    }
    return out;
  }
}

// ---- the trend: lift or header ------------------------------------------------------------------------------------
// A tactical instrument's cue (B&G H5000 "Lift/Header"; Raymarine/Tacktick's tactical compass: the heading against the
// tack's mean). Here from the true wind's direction at the boat: its short mean (τ 15 s) against its long mean (τ 4 min,
// about the shortest oscillation), so a shift shows within ≈ 20 s and a steady new wind fades back to nothing.
// Signed by the tack: on starboard (the wind over the starboard bow) a veer frees you (a lift: you can point higher
// toward the wind), a back heads you; on port the other way round. Only on a beat or a close reach (|TWA| < 80°):
// downwind the same shift means the opposite and real instruments show it as a separate page.
// Returns { deltaDeg (short − long, + = veered), signed (+ lift, − header), kind: 'lift' | 'header' | null, level 0..1 }.
const TREND = { shortS: 15, longS: 240, onDeg: 3, offDeg: 2, fullDeg: 10, maxTwaDeg: 80 };
export class ShiftTrend {
  constructor(o = {}) { this.o = { ...TREND, ...o }; this.s = null; this.l = null; this.kind = null; }
  // dt s; twdDeg the true wind's FROM direction (compass °); twa rad (+ = from starboard)
  update(dt, twdDeg, twa) {
    const o = this.o, x = Math.sin(twdDeg * DEG), y = Math.cos(twdDeg * DEG);
    if (!this.s) { this.s = [x, y]; this.l = [x, y]; }
    const ks = 1 - Math.exp(-dt / o.shortS), kl = 1 - Math.exp(-dt / o.longS);
    this.s[0] += (x - this.s[0]) * ks; this.s[1] += (y - this.s[1]) * ks;
    this.l[0] += (x - this.l[0]) * kl; this.l[1] += (y - this.l[1]) * kl;
    const d = Math.atan2(this.s[0] * this.l[1] - this.s[1] * this.l[0], this.s[0] * this.l[0] + this.s[1] * this.l[1]) / DEG;
    const signed = d * (twa >= 0 ? 1 : -1), up = Math.abs(twa) < o.maxTwaDeg * DEG;
    const m = Math.abs(signed);
    if (!up || m < o.offDeg) this.kind = null;
    else if (m >= o.onDeg || this.kind) this.kind = signed > 0 ? 'lift' : 'header';
    return { deltaDeg: d, signed, kind: this.kind, level: this.kind ? smooth(o.offDeg, o.fullDeg, m) : 0 };
  }
}
