// Channel markers (BACKLOG "Channel markers", owner 2026-11-17, go 2026-11-18): the aids to navigation
// of a waters, from one data file (v2/sim/channelMarks.json: positions, types, light patterns, each row's public source), so the
// whole lake slots in as rows. Emerald Bay's entrance today: OpenSeaMap's four lateral buoys (lighted 1 and 2, can 3, nun 4: round 2 models them as the moulded polyethylene buoys the Coast Guard sets there) at
// their real stations along the carved channel (v2/terrain/channel.js), a pair 5/6 placed by the channel's geometry over the rest of
// the bar, and the bay's white no-wake buoys (TRPA's 5 mph rule; no published positions, so design placements).
// US lateral convention (33 CFR 62, IALA B): red right returning, so entering from the lake red lies to starboard, green to port.
// Pure (no DOM, no GPU): main.js draws the buoys (render/navAids.js), the chart draws their marks
// (src/ui/chartplotter.js aids), the planner and AUTO read them (ui/planChart.js, sim/channelHelm.js), the tests read the file.
//   resolveMarks(data, { waters, channel, lonLatToWorld }) → [{ id, name, type, colour, shape, number, light, x, z, src, osm }]
//   parseLight('Fl(2) R 5s') → { colour: 'R', rgb, period, on: [[t0, t1], …] } | null ('F' fixed, 'Q', 'VQ', 'Iso', 'Oc', 'Fl', 'LFl')
//   lightLevel(light, t, phase = 0) → 0…1 (the lamp at time t: its pattern's flashes, each eased in and out over LIGHT.rampS)
//   markLights(out, o, marks, { t, sunElevDeg, heightAt, pose }) → n (GLOW_FLOATS each, from float o: the night's glow list)
//   createMarkBodies(marks, { onBump }) → { bodies, post(S, dt, t), gap(S), stats }: each buoy a light body on its rode, the boat's
//     hull outline against its float (a soft bump: an impulse with both masses, the overlap closed, the buoy swings back)
//   markPose(body, heightAt, t) → { x, y, z, yaw, heel }: the buoy on the drawn water, tilted with its slope and its swing
//   keepRight(dir) → the channel helm's and the planner's offset (m) to starboard of the line, going that way
import { GLOW_FLOATS, navLevel } from './night.js';
import { OUTLINE_POLY, outlineDistance, toBody, invMass, push, pointVel } from '../../src/sim/race/contact.js';

export const KEEP_RIGHT_M = 6;   // m to starboard of the channel's line, either way (COLREG rule 9: keep to the starboard side)
export const keepRight = () => KEEP_RIGHT_M;

// the buoys (the 54-inch moulded polyethylene class, foam-filled, 0.70 m collar at the water,
// 1.10 m above it): the float's radius at the water (m), the mass with the water it carries (kg: 43 kg net, the cement base, the
// chain and the added mass), the lamp's height and the top's (m). 'lighted' is the can moulding with a solar LED lantern on top
export const SHAPES = Object.freeze({
  lighted: Object.freeze({ r: 0.35, mass: 140, lampY: 1.22, topY: 1.3 }),
  can: Object.freeze({ r: 0.35, mass: 130, lampY: 1.1, topY: 1.1 }),
  conical: Object.freeze({ r: 0.35, mass: 130, lampY: 1.1, topY: 1.1 }),
  regulatory: Object.freeze({ r: 0.35, mass: 130, lampY: 1.1, topY: 1.1 }),
  // a mooring ball (v2/sim/moorings.js: the 24-inch white ball with its blue band, its chain and the water it carries)
  mooring: Object.freeze({ r: 0.3, mass: 45, lampY: 0.5, topY: 0.5 }),
});
// the rode's pull back to the station (a damped spring: period s, damping time s) and the farthest a bump shoves it (m)
export const RODE = Object.freeze({ period: 5, tau: 2.2, maxOff: 2.4 });
export const BUMP = Object.freeze({ e: 0.2, mu: 0.2, slop: 0.005, minJ: 120, coolS: 1.5, reachM: 6 });
// the lamps: a flash's length by the period (the light list's short flash), the ease at each edge, the glow on the night's list
export const LIGHT = Object.freeze({ flashS: 0.4, shortFlashS: 0.3, longFlashS: 2.0, rampS: 0.06, size: 0.3, radiance: 320 });
// the mesh for each shape (render/navAids.js AID_KINDS) and the body's colour (rgba8, r in the low byte, as render/raceProps.js rgbaOf):
// the lateral red and green of a buoy's paint (linear, as the props' palette), the no-wake buoy's white
export const AID_KIND = Object.freeze({ lighted: 'aidLit', can: 'aidCan', conical: 'aidNun', regulatory: 'aidSpar' });
const pack = (hex) => { const h = parseInt(hex.slice(1), 16); return (0xff000000 | ((h & 255) << 16) | (h & 0xff00) | ((h >> 16) & 255)) >>> 0; };
export const AID_RGBA = Object.freeze({ red: pack('#A3130C'), green: pack('#0B5A2B'), white: pack('#ECEBE6') });
const RGB = Object.freeze({ R: Object.freeze([1.0, 0.16, 0.1]), G: Object.freeze([0.18, 1.0, 0.42]), W: Object.freeze([1.0, 0.95, 0.86]), Y: Object.freeze([1.0, 0.8, 0.25]) });

// a channel's point and unit direction at along s (m from its first point; past either end, straight on)
function channelPoint(C, s) {
  const P = C.pts; let run = 0;
  for (let i = 1; i < P.length; i++) {
    const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], L = Math.hypot(dx, dz);
    if (s <= run + L || i === P.length - 1) { const t = (s - run) / L; return { p: [P[i - 1][0] + dx * t, P[i - 1][1] + dz * t], d: [dx / L, dz / L] }; }
    run += L;
  }
  return null;
}
// the unit vector to starboard for a boat heading along d (world x east, z south): (−dz, dx)
const rightOf = (d) => [-d[1], d[0]];

export function resolveMarks(data, { waters = 'tahoe-emerald', channel = null, lonLatToWorld = null } = {}) {
  const W = data?.waters?.[waters];
  if (!W) return [];
  const out = [];
  for (const m of W.marks ?? []) {
    let x = null, z = null, face = phaseOf(m.id) * 2 * Math.PI;
    if (m.on === 'channel' && channel) {
      const c = channelPoint(channel, m.along ?? 0);
      // entering is toward the bay: along falling, so the entering heading is −d and its starboard (dz, −dx)
      const inbound = [-c.d[0], -c.d[1]], stbd = rightOf(inbound);
      const side = m.side ?? (m.colour === 'red' ? 'starboard' : m.colour === 'green' ? 'port' : 'starboard');
      const k = (side === 'starboard' ? 1 : -1) * (m.off ?? 0);
      x = c.p[0] + stbd[0] * k; z = c.p[1] + stbd[1] * k;
      face = Math.atan2(c.d[0], -c.d[1]);   // the numbers face up and down the channel (the props' mapping: local +z to (sin, −cos))
    } else if (m.at) { [x, z] = m.at; }
    else if (m.osm && lonLatToWorld) { [x, z] = lonLatToWorld(m.osm[1], m.osm[0]); }
    if (x == null) continue;
    out.push({ id: m.id, name: m.name ?? m.id, type: m.type, colour: m.colour, shape: m.shape ?? 'can', number: m.number ?? null,
      light: m.light ? parseLight(m.light) : null, lightText: m.light ?? null, x, z, face, src: m.src, osm: m.osm ?? null, phase: phaseOf(m.id) });
  }
  return out;
}
// a lamp's own phase (s), from its id (real lamps are not in step; deterministic)
export function phaseOf(id) { let h = 7; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return ((h >>> 0) % 997) / 997; }

// the light list's characteristic → a pattern over one period
export function parseLight(text) {
  if (!text) return null;
  const s = String(text).trim();
  const m = s.match(/^(LFl|Fl|VQ|Q|Iso|Oc|F)(?:\((\d+)\))?\s*([RGWY])?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/);
  if (!m) return null;
  const [, ch, nStr, col = 'W', perStr] = m, n = nStr ? parseInt(nStr, 10) : 1;
  let period = perStr ? parseFloat(perStr) : ch === 'Q' ? 1 : ch === 'VQ' ? 0.5 : ch === 'F' ? 1 : 4;
  const on = [];
  if (ch === 'F') on.push([0, period]);
  else if (ch === 'Iso') on.push([0, period / 2]);
  else if (ch === 'Oc') on.push([0, Math.max(period * 0.5, period - Math.min(1, period / 3))]);
  else if (ch === 'Q' || ch === 'VQ') { const f = period * 0.4; for (let i = 0; i < n; i++) on.push([i * period, i * period + f]); if (n > 1) period = period * n + period * 2; }
  else {
    const f = ch === 'LFl' ? LIGHT.longFlashS : period <= 2.5 ? LIGHT.shortFlashS : LIGHT.flashS, gap = Math.max(0.6, f * 1.5);
    for (let i = 0; i < n; i++) on.push([i * (f + gap), i * (f + gap) + f]);
  }
  return { ch, n, colour: col, rgb: RGB[col] ?? RGB.W, period, on };
}

export function lightLevel(L, t, phase = 0) {
  if (!L) return 0;
  if (L.ch === 'F') return 1;
  const T = L.period, u = (((t + phase * T) % T) + T) % T, r = LIGHT.rampS;
  let k = 0;
  for (const [a, b] of L.on) {
    if (u < a - r || u > b + r) continue;
    const up = Math.min(1, (u - (a - r)) / (2 * r)), down = Math.min(1, ((b + r) - u) / (2 * r));
    k = Math.max(k, Math.max(0, Math.min(up, down)));
  }
  return k;
}

// the lit marks into the night's glow list (render/night.js: drawn as the nav lights are, their halo and image in the water): at
// night only (the boat's nav-light ramp), each lamp at its pattern's level; dark between flashes writes nothing
export function markLights(out, o, marks, { t = 0, sunElevDeg = 90, heightAt = () => 0, pose = null } = {}) {
  const level = navLevel(sunElevDeg);
  if (!(level > 0)) return 0;
  const cap = Math.floor((out.length - o) / GLOW_FLOATS);
  let n = 0;
  for (let i = 0; i < marks.length && n < cap; i++) {
    const m = marks[i];
    if (!m.light) continue;
    const k = lightLevel(m.light, t, m.phase);
    if (!(k > 0.002)) continue;
    const p = pose ? pose(i) : null, x = p ? p.x : m.x, z = p ? p.z : m.z, y = (p ? p.y : heightAt(x, z)) + (SHAPES[m.shape]?.lampY ?? 1.2);
    const w = o + n * GLOW_FLOATS;
    out[w] = x; out[w + 1] = y; out[w + 2] = z; out[w + 3] = LIGHT.size;
    out[w + 4] = m.light.rgb[0]; out[w + 5] = m.light.rgb[1]; out[w + 6] = m.light.rgb[2]; out[w + 7] = LIGHT.radiance * level * k;
    n++;
  }
  return n;
}

// ---- the buoys as bodies: their station, their place now, their velocity; the boat's hull against their float ----
export function createMarkBodies(marks, { onBump = null, rode = RODE, bump = BUMP } = {}) {
  // a row's own r and mass win over its shape's (v2/sim/anchoredBoats.js: a hull's circles)
  const bodies = marks.map((m) => { const S = SHAPES[m.shape] ?? SHAPES.can; return { id: m.id, x0: m.x, z0: m.z, x: m.x, z: m.z, vx: 0, vz: 0, r: m.r ?? S.r, m: m.mass ?? S.mass, armed: true }; });
  const stats = { contacts: 0, bumps: 0, maxPen: 0, lastJ: 0, lastT: -1e9 };
  const reach = Math.max(...OUTLINE_POLY.map(([x, y]) => Math.hypot(x, y)));
  // the rode: a damped spring to the station, the shove capped at the rode's swing
  const stepRode = (b, dt) => {
    const w = 2 * Math.PI / rode.period, k = Math.exp(-dt / rode.tau);
    b.vx = (b.vx - w * w * (b.x - b.x0) * dt) * k; b.vz = (b.vz - w * w * (b.z - b.z0) * dt) * k;
    b.x += b.vx * dt; b.z += b.vz * dt;
    clampRode(b);
  };
  const clampRode = (b) => {
    const ox = b.x - b.x0, oz = b.z - b.z0, o = Math.hypot(ox, oz);
    if (o > rode.maxOff) { b.x = b.x0 + ox * rode.maxOff / o; b.z = b.z0 + oz * rode.maxOff / o; const vr = (b.vx * ox + b.vz * oz) / o; if (vr > 0) { b.vx -= vr * ox / o; b.vz -= vr * oz / o; } return true; }
    return false;
  };
  // the float (a circle of radius r at the water) against the hull's waterline outline: the deepest overlap and its normal (world,
  // out of the hull toward the buoy), or null
  const contactOf = (S, b) => {
    const [bx, by] = toBody(S, b.x, b.z);
    if (Math.abs(bx) > reach + b.r || Math.abs(by) > reach + b.r) return null;
    const q = outlineDistance(bx, by), pen = b.r - q.d;
    if (pen <= 0) return null;
    // inside the outline the nearest edge's normal still points out of the hull (outlineDistance's normal is outward)
    const sh = Math.sin(S.heading), ch = Math.cos(S.heading);
    const nx = q.nx * sh + q.ny * ch, nz = -q.nx * ch + q.ny * sh;
    return { pen, nx, nz };
  };
  function post(S, dt, t = 0) {
    for (const b of bodies) {
      stepRode(b, dt);
      if (Math.abs(b.x - S.x) > bump.reachM + b.r || Math.abs(b.z - S.z) > bump.reachM + b.r) { b.armed = true; continue; }
      let J = 0;
      for (let pass = 0; pass < 3; pass++) {
        const c = contactOf(S, b);
        if (!c) break;
        const { pen, nx, nz } = c;
        // the contact point on the hull: the float's centre less its radius along the normal
        const wx = b.x - nx * b.r, wz = b.z - nz * b.r, [ax, ay] = toBody(S, wx, wz), [vbx, vbz] = pointVel(S, ax, ay);
        const rvx = b.vx - vbx, rvz = b.vz - vbz, vn = rvx * nx + rvz * nz;
        if (vn < 0) {   // closing: the normal impulse (both masses), then a little friction along the slide
          const j = -(1 + bump.e) * vn / (invMass(S, nx, nz, ax, ay) + 1 / b.m);
          b.vx += nx * j / b.m; b.vz += nz * j / b.m; push(S, -nx * j, -nz * j, ax, ay);
          const tx = rvx - vn * nx, tz = rvz - vn * nz, tl = Math.hypot(tx, tz);
          if (tl > 1e-4) {
            const ux = tx / tl, uz = tz / tl, jt = Math.min(bump.mu * j, tl / (invMass(S, ux, uz, ax, ay) + 1 / b.m));
            b.vx -= ux * jt / b.m; b.vz -= uz * jt / b.m; push(S, ux * jt, uz * jt, ax, ay);
          }
          J += j;
        }
        // the overlap closed: the buoy takes its share by the masses; what its rode will not give, the boat gives
        const share = 3765 / (3765 + b.m), d = pen + bump.slop;
        b.x += nx * d * share; b.z += nz * d * share; S.x -= nx * d * (1 - share); S.z -= nz * d * (1 - share);
        if (clampRode(b)) { const c2 = contactOf(S, b); if (c2) { S.x -= c2.nx * (c2.pen + bump.slop); S.z -= c2.nz * (c2.pen + bump.slop); } }
        stats.contacts++; stats.maxPen = Math.max(stats.maxPen, pen);
      }
      if (J > bump.minJ && b.armed && t - stats.lastT > bump.coolS) {
        stats.bumps++; stats.lastJ = J; stats.lastT = t; b.armed = false;
        onBump?.({ id: b.id, j: J, x: b.x, z: b.z, t, speed: J / b.m / (1 + bump.e) });   // speed: the closing speed (m/s), the thud's loudness
      } else if (!contactOf(S, b)) b.armed = true;
    }
  }
  const gap = (S) => { let g = Infinity; for (const b of bodies) { const [bx, by] = toBody(S, b.x, b.z); g = Math.min(g, outlineDistance(bx, by).d - b.r); } return g; };
  return { bodies, post, gap, stats, set onBump(f) { onBump = f; } };
}

// a buoy on the drawn water: its height, and a tilt that follows the surface's slope under it and leans with its swing
const TILT = Object.freeze({ probe: 0.6, slopeK: 0.9, swingK: 0.12, max: 0.32 });
export function markPose(b, heightAt, t = 0) {
  const x = b.x, z = b.z, h = TILT.probe, y = heightAt(x, z, t);
  const gx = (heightAt(x + h, z, t) - heightAt(x - h, z, t)) / (2 * h), gz = (heightAt(x, z + h, t) - heightAt(x, z - h, t)) / (2 * h);
  // the tilt as a vector toward the side that goes down (downslope, and the way the rode drags it)
  let tx = -gx * TILT.slopeK + b.vx * TILT.swingK, tz = -gz * TILT.slopeK + b.vz * TILT.swingK;
  const a = Math.min(TILT.max, Math.hypot(tx, tz));
  return { x, y, z, yaw: a > 1e-5 ? Math.atan2(tz, tx) : 0, heel: a };
}
