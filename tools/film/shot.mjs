// A film shot: the page's URL and a scripted camera, read from a JSON shot file
// (tools/film/shots/*.json). Plain JS, no browser: the runner (run.mjs) and the tests (tests/film.test.mjs) use it.
//
// A shot file:
//   { "name": "glide-fannette", "about": "…", "duration": 10, "fps": 60,
//     "url": { "mode": "cruise", "hour": 19.3, "seed": 1, "wind": 2, "start": "x,z", "heading": 80, … },
//     "camera": { "frame": "world" | "boat0" | "boat",
//                 "keys": [ { "t": 0, "pos": [x, y, z], "fov": 32 }, … ],
//                 "aim": { "at": "boat" | "fleet" | [x, y, z], "offset": [x, y, z], "tau": 1.5 }, "ease": "inout" | "linear",
//                 "window": [a, b] (ease only inside), keys may carry "aim": [x,y,z] and "helm": 0–1, "drift": { ampM, ampDeg, hz, seed, from },
//                 "subject": "wren" (Regatta: frame the rival), "look": "down" + "up": [0, 0, -1] (straight down, north-up), "rig": true (the mode's own camera with our lens) },
//     "fw": true (step a pinned ?fwt= fireworks show with the film), "helmTrack": { "at": "kayak", … } (?view=helm: the look
//     eased toward the nearest kayak; run.mjs), "preroll": s (film steps drawn before frame 0, not captured; run.mjs),
//     "formats": { "L": { "w": 2560, "h": 1440 }, "P": { "w": 1080, "h": 1920, "camera": { …overrides } } } }
// Clips are 2–6 s, self-contained, in landscape (L, 16:9) and portrait (P, 9:16), each framed by its own camera, never a crop.
// Frames: "world" positions are world metres (x east, y up, z south); "boat0" are metres in the boat's frame at the
// shot's first frame (x starboard, y up, z ahead), so the camera dollies on a fixed line while the boat sails through;
// "boat" rides with the boat's smoothed position and heading. The aim follows the boat through a critically damped
// spring (tau s), never its heave or roll, so nothing shakes. Positions between keys are a Catmull-Rom curve (C1).
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = { linear: (t) => t, inout: (t) => t * t * (3 - 2 * t) };

// a deterministic unit number from a seed and an index (the drift's phases)
const hashUnit = (seed, i) => { let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return ((h >>> 0) % 100000) / 100000; };

export const FILM_SETTLE = { settle: 20, chillsettle: 6 };   // the boat sails this long (s) before frame 0

// The page URL for a shot: every scene parameter pinned (no wall clock, no random: the URL contract);
// no beginners' wind lines (a live Cruise has none; captures draw them by default)
export function shotQuery(shot) {
  const q = { mode: 'cruise', seed: 1, music: 0, windlines: 0, ...FILM_SETTLE, ...shot.url, film: 1, headless: 1 };
  return Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

// the camera block for a format: the shot's, with the format's own overrides
export function cameraFor(shot, format) {
  const base = shot.camera, o = shot.formats?.[format]?.camera ?? {};
  return { ...base, ...o, aim: { ...base.aim, ...(o.aim ?? {}) }, keys: o.keys ?? base.keys };
}

// Catmull-Rom through the keys' values at time t (clamped ends, keys sorted by t)
function curve(keys, t, get) {
  const n = keys.length;
  if (n === 1 || t <= keys[0].t) return [...get(keys[0])];   // copies: a caller may add to the result (the drift)
  if (t >= keys[n - 1].t) return [...get(keys[n - 1])];
  let i = 0; while (t > keys[i + 1].t) i++;
  const k1 = keys[i], k2 = keys[i + 1], k0 = keys[Math.max(0, i - 1)], k3 = keys[Math.min(n - 1, i + 2)];
  const u = (t - k1.t) / (k2.t - k1.t), p0 = get(k0), p1 = get(k1), p2 = get(k2), p3 = get(k3);
  if (p1.every((v, j) => v === p2[j])) return [...p1];   // two equal keys hold: no overshoot from the neighbours' tangents
  const out = [];
  for (let j = 0; j < p1.length; j++) {
    // tangents scaled by the key spacing, so uneven keys stay smooth
    const m1 = k2.t === k0.t ? 0 : (p2[j] - p0[j]) / (k2.t - k0.t) * (k2.t - k1.t);
    const m2 = k3.t === k1.t ? 0 : (p3[j] - p1[j]) / (k3.t - k1.t) * (k2.t - k1.t);
    const u2 = u * u, u3 = u2 * u;
    out.push((2 * u3 - 3 * u2 + 1) * p1[j] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[j] + (u3 - u2) * m2);
  }
  return out;
}

const damp = (x, v, target, tau, dt) => { const w = 2 / tau, e = Math.exp(-w * dt), d = x - target, tmp = (v + w * d) * dt; return [target + (d + tmp) * e, (v - w * tmp) * e]; };
const toWorld = (f, off) => {   // f: { x, z, heading }; off: [starboard, up, ahead]
  const s = Math.sin(f.heading), c = Math.cos(f.heading);
  return [f.x + off[0] * c + off[2] * s, off[1], f.z + off[0] * s - off[2] * c];
};

// The camera rig for one format: pose(t, boat) each frame, in order, at a fixed dt. Deterministic.
export class ShotCamera {
  constructor(shot, format = 'L') {
    this.cam = cameraFor(shot, format); this.duration = shot.duration;
    this.keys = [...this.cam.keys].sort((a, b) => a.t - b.t);
    this.ease = ease[this.cam.ease ?? 'linear'] ?? ease.linear;
    this.aim = null; this.aimV = [0, 0, 0]; this.frame0 = null; this.head = null; this.headV = 0;
  }
  pose(t, boat0, dt) {
    // "subject": "wren" frames Wren's Osprey (Regatta) instead of our boat: its position and heading drive the frames and the aim
    const boat = this.cam.subject === 'wren' && boat0.wren ? { ...boat0.wren, wren: boat0 } : boat0;
    const A = this.cam.aim ?? {}, tau = A.tau ?? 1.5;
    // the timeline: "window": [a, b] eases the keys' time inside a..b only (in and out), so a hold, then one eased move,
    // then a hold; else the whole shot's ease
    const W = this.cam.window, inout = (x) => x * x * (3 - 2 * x);
    const u = W ? (t <= W[0] || t >= W[1] ? t : W[0] + inout((t - W[0]) / (W[1] - W[0])) * (W[1] - W[0]))
      : this.duration > 0 ? this.ease(clamp(t / this.duration, 0, 1)) * this.duration : t;
    // keyed aim offsets: a key's "aim" overrides the shot's offset there, blended between keys (the aim travels sail → cockpit)
    const off = this.keys.some((k) => k.aim) ? curve(this.keys, u, (k) => k.aim ?? A.offset ?? [0, 2.5, 0]) : A.offset ?? [0, 2.5, 0];
    // aim: a world point, the boat, or "fleet" (the middle of our boat and Wren's, Regatta)
    const mid = A.at === 'fleet' && boat.wren ? { x: (boat.x + boat.wren.x) / 2, z: (boat.z + boat.wren.z) / 2 } : boat;
    const goal = Array.isArray(A.at) ? A.at : [mid.x + off[0], off[1], mid.z + off[2]];
    if (!this.aim) { this.aim = [...goal]; this.frame0 = { x: boat.x, z: boat.z, heading: boat.heading }; this.head = boat.heading; }
    else for (let j = 0; j < 3; j++) [this.aim[j], this.aimV[j]] = damp(this.aim[j], this.aimV[j], goal[j], tau, dt);
    if (this.head != null && dt > 0) [this.head, this.headV] = damp(this.head, this.headV, this.head + wrap(boat.heading - this.head), tau * 2, dt);
    const p = curve(this.keys, u, (k) => k.pos), fov = curve(this.keys, u, (k) => [k.fov ?? this.keys[0].fov ?? 35])[0];
    const frame = this.cam.frame ?? 'world';
    const pos = frame === 'world' ? p : frame === 'boat0' ? toWorld(this.frame0, p) : toWorld({ x: this.aim[0] - off[0], z: this.aim[2] - off[2], heading: this.head }, p);
    if (this.cam.rig) return { rig: true, fov };   // the mode's own camera (Cruise's ?cruisecam=helm …), our lens
    // a look straight down (wind-lanes-above) needs its own up: "up" in the camera block, e.g. [0, 0, -1] (north-up)
    // "look": "down" looks straight down from pos (the aim is ignored); give "up" (e.g. [0, 0, -1], north-up)
    const target = this.cam.look === 'down' ? [pos[0], 0, pos[2]] : [...this.aim];
    // the seeded drift (a hold's breath, never a shake): two slow sines per axis, from drift.from s on
    const D = this.cam.drift;
    if (D && t >= (D.from ?? 0)) {
      const r = (k) => hashUnit(D.seed ?? 1, k), w = 2 * Math.PI * (D.hz ?? 0.12), tt = t - (D.from ?? 0);
      const wob = (k) => 0.6 * Math.sin(w * tt + 6.283 * r(k)) + 0.4 * Math.sin(w * 1.618 * tt + 6.283 * r(k + 7));
      const am = D.ampM ?? 0.015, ad = Math.tan((D.ampDeg ?? 0.25) * Math.PI / 180) * Math.hypot(target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]);
      for (let j = 0; j < 3; j++) { pos[j] += am * wob(j); target[j] += ad * wob(j + 3); }
    }
    // a key's "helm" (0–1): the pose flies into the game's helm camera (the page blends on viewBlend's path); eased quintic
    const hk = this.keys.some((k) => k.helm != null) ? clamp(curve(this.keys, u, (k) => [k.helm ?? 0])[0], 0, 1) : 0;
    const helm = hk * hk * hk * (hk * (hk * 6 - 15) + 10);
    return { pos, target, up: this.cam.up ?? [0, 1, 0], fov, near: this.cam.near ?? 0.5, ...(helm > 0 ? { helm } : {}) };
  }
}

// the film's frame times: n = duration × fps frames, frame i at i / fps
export const frameCount = (shot) => Math.round(shot.duration * (shot.fps ?? 60));
export { lerp };
