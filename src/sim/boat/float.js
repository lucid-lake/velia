// The hull on the waves: a 3-degree-of-freedom (heave, pitch, roll) linear seakeeping model, plain JS, no three.js.
// It replaces the M10 probe-and-spring float (which low-passed the surface at half the hull and chased it with a
// spring, so a 15 cm chop moved the boat by centimetres and the eye read "a car on a plane").
//
// The waterplane is sampled at NX × NY points (21 by default), each standing for a patch of area A_i at (x_i, y_i)
// in the hull frame. The surface height η_i under each patch is read from the same wave model the GPU draws
// (water-spectrum.js makeSurface), with the Smith effect: the pressure a hull of draft d feels from a wave of number k
// is reduced by e^(−k·d), so short chop pushes less than it looks (depthM). The hydrostatic force on each patch is
// ρ g A_i (η_i − ζ_i), ζ_i the patch's own height = z + θ·x_i − φ·y_i (Archimedes linearised about the waterplane;
// the Froude–Krylov excitation and the restoring force in one line, so a wave shorter than the hull cancels across
// the patches and a wave longer than the hull lifts them together: the hull "bridges" chop and rides swell without
// any filter). Roll takes the effective wave slope across the waterplane against the keelboat's Δ·GM (the ballast,
// not the waterplane, is what rights it). Mass, added mass and radiation damping set the natural periods (≈ 1.4 s
// heave, 1.4 s pitch, 3.4 s roll for the Catalina 28): short-period chop is above resonance in
// heave and pitch, so the hull answers it with a lag and a roll-off, as a heavy boat does. Semi-implicit Euler at
// 120 Hz, deterministic.
//
//   const float = new HullFloat({ surface });   // defaults: the Catalina 28 (dims.js): LWL 7.26 m, beam 3.15 m
//   each frame: const { heave, pitch, roll, probes } = float.update({ x, z, heading }, t, dt);
// Frames and signs (src/boat/contract.js): world x east, z south, y up. heading: radians clockwise from north (−z).
// heave: m, up. pitch: rad, bow up positive. roll: rad, port side up positive (the boat leans to starboard). These
// are the WAVE motions only; the physics (S1) adds its own heel and trim on top.

import { DEFAULT_DIMS } from './dims.js';

const RHO = 1000, G = 9.81;   // fresh water
const BWL = 0.86;             // waterline beam / max beam (as wake.js)

export class HullFloat {
  constructor({
    surface, dims = DEFAULT_DIMS,   // the boat's (src/boat/dims.js; this page's boat by default)
    length = dims.HULL.lwl, beam = dims.HULL.beam * BWL, mass = dims.HULL.displacementKg,
    gm = 1.15,                 // m, transverse metacentric height (boat.js BOAT.gm)
    draft = 0.45,              // m, the canoe body (the fin keel carries no buoyancy to speak of)
    gyradius = 0.25,           // pitch radius of gyration as a fraction of LWL (Larsson & Eliasson's range, 0.25–0.30)
    ixx = 9500,                // kg·m², roll inertia (boat.js BOAT.ixx)
    added = { heave: 0.9, pitch: 0.9, roll: 0.3 },   // added mass / inertia as a fraction of the body's
    damping = { heave: 0.35, pitch: 0.35, roll: 0.25 },   // fraction of critical (radiation + viscous)
    nx = 7, ny = 3,
  } = {}) {
    if (!surface?.heightAt) throw new Error('HullFloat: surface.heightAt(x, z, t, opts) is required');
    this.surface = surface; this.length = length; this.beam = beam;
    this.depthM = 0.7 * draft;   // the mean depth of the canoe body's pressure field, for the Smith effect
    // the waterplane: stations along the hull, a plan of half-breadth b(ξ) = B/2·(1 − ξ²)^0.6 (full amidships, fine
    // at the ends; Cwp ≈ 0.72), each station split across the beam into ny patches of equal area
    const dx = 0.94 * length / nx;
    this.local = [];   // [x forward, y starboard, area]
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5 - nx / 2) * dx, xi = 2 * x / length;
      const b = 0.5 * beam * Math.pow(Math.max(0, 1 - xi * xi), 0.6);
      const area = 2 * b * dx / ny;
      for (let j = 0; j < ny; j++) this.local.push([x, (j + 0.5 - ny / 2) * (2 * b / ny), area]);
    }
    const A = this.local.reduce((s, p) => s + p[2], 0), Ix = this.local.reduce((s, p) => s + p[2] * p[0] * p[0], 0);
    this.area = A;
    this.C = { heave: RHO * G * A, pitch: RHO * G * Ix, roll: mass * G * gm };   // restoring: N/m, N·m/rad, N·m/rad
    const i55 = mass * (gyradius * length) ** 2;
    this.M = { heave: mass * (1 + added.heave), pitch: i55 * (1 + added.pitch), roll: ixx * (1 + added.roll) };
    this.D = {};
    for (const q of ['heave', 'pitch', 'roll']) this.D[q] = 2 * damping[q] * Math.sqrt(this.C[q] * this.M[q]);
    this.state = null;   // { heave, pitch, roll, vheave, vpitch, vroll }
    this.probes = this.local.map(() => ({ x: 0, z: 0, h: 0 }));
    this.t = null;
  }

  // natural periods, s (for tests and tuning)
  periods() {
    const o = {};
    for (const q of ['heave', 'pitch', 'roll']) o[q] = 2 * Math.PI / Math.sqrt(this.C[q] / this.M[q]);
    return o;
  }

  // the surface under every patch, in world space, with the Smith effect
  sample({ x, z, heading }, t) {
    const fx = Math.sin(heading), fz = -Math.cos(heading);   // forward
    const sx = -fz, sz = fx;                                  // starboard
    const o = { depthM: this.depthM };
    this.local.forEach(([f, s], i) => {
      const px = x + fx * f + sx * s, pz = z + fz * f + sz * s, p = this.probes[i];
      p.x = px; p.z = pz; p.h = this.surface.heightAt(px, pz, t, o);
    });
    return this.probes;
  }

  // the static (quasi-hydrostatic) pose the surface would give: the weighted plane through the patches
  fit() {
    let Sa = 0, Sh = 0, Sx = 0, Sxx = 0, Sxh = 0, Syy = 0, Syh = 0;
    this.local.forEach(([x, y, a], i) => {
      const h = this.probes[i].h;
      Sa += a; Sh += a * h; Sx += a * x; Sxx += a * x * x; Sxh += a * x * h; Syy += a * y * y; Syh += a * y * h;
    });
    // heave and pitch share x (the plan is symmetric about amidships here, so Sx ≈ 0); roll is independent by symmetry
    const det = Sa * Sxx - Sx * Sx;
    const heave = (Sh * Sxx - Sx * Sxh) / det, pitch = (Sa * Sxh - Sx * Sh) / det;
    return { heave, pitch, roll: -Syh / Syy };   // port (y < 0) higher → positive roll
  }

  // Roll damping by sail state (owner/integrator 2026-10-30): a boat under sail is damped in roll by its sails (the rig is a
  // flat plate swinging through the wind: aerodynamic damping, c = rho V A r^2 / 2 per radian/s), so zeta runs from the hull's
  // 0.25 (sails down, furled, or motoring) up to 0.45 with the full rig set in a breeze: x the area set (reefs), x the
  // apparent wind (full from 5 m/s), x how much the sails are drawing. A boat with no sail state (the plain float tests)
  // keeps 0.25. Low-passed over 1 s so a flogging luff or a reef going in does not step the roll.
  rollZeta(boat) {
    const base = this.zeta0 ?? (this.zeta0 = this.D.roll / (2 * Math.sqrt(this.C.roll * this.M.roll)));
    if (!boat || boat.apparentWind == null) return base;
    const area = [1, 0.75, 0.55][Math.min(2, Math.max(0, boat.reef | 0))], up = 1 - Math.min(1, Math.max(0, boat.furl ?? 0));
    const wind = Math.min(1.3, (boat.apparentWind.speed ?? 0) / 5), fill = 0.5 + 0.5 * Math.min(1, ((boat.mainFill ?? 0) * 0.6 + (boat.jibFill ?? 0) * 0.4));
    const sails = boat.engineOn && (boat.furl ?? 0) > 0.5 ? 0 : area * up * wind * fill;
    return Math.min(0.45, base + 0.2 * Math.min(1, sails));
  }

  update(boat, t, dt) {
    this.sample(boat, t);
    {
      const z = this.rollZeta(boat), k = 1 - Math.exp(-Math.max(dt, 0) / 1);
      this.zetaNow = this.zetaNow == null ? z : this.zetaNow + (z - this.zetaNow) * k;
      this.D.roll = 2 * this.zetaNow * Math.sqrt(this.C.roll * this.M.roll);
    }
    if (!this.state) {
      this.state = { ...this.fit(), vheave: 0, vpitch: 0, vroll: 0 };
      return { ...this.state, probes: this.probes, slopeX: this.state.pitch, bowRel: 0, bowRelVel: 0 };
    }
    const S = this.state;
    const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
    for (let k = 0; k < n; k++) {
      // heave and pitch: the hydrostatic force and moment summed over the patches (the wave's lift minus the hull's)
      let F = 0, M = 0;
      this.local.forEach(([x, y, a], i) => {
        const f = RHO * G * a * (this.probes[i].h - S.heave - S.pitch * x + S.roll * y);
        F += f; M += x * f;
      });
      // roll: the effective wave slope across the waterplane against Δ·GM
      const slope = this.fit().roll;
      const K = this.C.roll * (slope - S.roll);
      S.vheave += (F - this.D.heave * S.vheave) / this.M.heave * h;
      S.vpitch += (M - this.D.pitch * S.vpitch) / this.M.pitch * h;
      S.vroll += (K - this.D.roll * S.vroll) / this.M.roll * h;
      S.heave += S.vheave * h; S.pitch += S.vpitch * h; S.roll += S.vroll * h;
    }
    // the sea's push on the hull, for the physics (src/boat.js, surfing) and the spray (slamming):
    // slopeX: the waterplane's least-squares slope of the surface along the hull (+ = rising toward the bow), the
    //   Smith-reduced heights as the patches feel them. In the long-wave limit the Froude–Krylov surge force is the
    //   displacement's weight down that slope, F = −Δ·g·slopeX (Froude–Krylov: the undisturbed wave's pressure
    //   integrated over the hull; the surf-riding model of Grim 1951 / Spyrou 1996 / Umeda 1999); a wave shorter than
    //   the hull cancels across the patches, as its pressure does.
    // bowRel: the water's height over the bow sections (the foremost station) above their own height (m);
    // bowRelVel: its rate (m/s): + = the bow plunging into a rising face. Ochi 1964's slamming threshold for the
    //   relative velocity is 0.093·√(g·L) (0.78 m/s for the 7.26 m waterline).
    const fit = this.fit();
    let bh = 0, bx = 0, bn = 0;
    const xMax = this.local.reduce((m, p) => Math.max(m, p[0]), -Infinity);
    this.local.forEach(([x], i) => { if (x > xMax - 1e-6) { bh += this.probes[i].h; bx = x; bn++; } });
    const bowRel = bh / bn - (S.heave + S.pitch * bx);
    const bowRelVel = this.bowRel == null || !(dt > 0) ? 0 : (bowRel - this.bowRel) / dt;
    this.bowRel = bowRel;
    return { heave: S.heave, pitch: S.pitch, roll: S.roll, probes: this.probes, slopeX: fit.pitch, bowRel, bowRelVel };
  }
}
