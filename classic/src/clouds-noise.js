// Lakeshore clouds: the tileable CPU noise behind the cloud volumes (moved out of src/clouds.js, unchanged, so a
// worker can bake it without three.js: src/prebake.js). Plain JS. Deterministic for a seed.
//   shapeValues(seed, size[, z0, z1])  → Float32Array, z slices [z0, z1) of the size³ shape volume, x fastest
//   detailValues(seed, size[, z0, z1]) → the same for the detail volume
//   weatherBytes(seed)                  → Uint8Array 256 × 256 × 4, the weather map (R coverage, G type, A 255)
//   toBytes(values)                     → the 1st..99th percentile stretched to 0..255 (what the textures hold)
// Slices concatenated in z order equal the whole volume value for value (the same calls in the same order).

// --- Tileable CPU noise --------------------------------------------------------------
function hash3(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const wrap = (i, p) => ((i % p) + p) % p;

// Gradient (Perlin) noise with period p cells, in [-1, 1] roughly.
function perlin(x, y, z, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const g = (i, j, k, dx, dy, dz) => {
    const h = hash3(wrap(i, p), wrap(j, p), wrap(k, p), seed);
    const th = h * 6.283185, ph = hash3(wrap(i, p), wrap(j, p), wrap(k, p), seed + 17) * 2 - 1;
    const s = Math.sqrt(1 - ph * ph);
    return Math.cos(th) * s * dx + Math.sin(th) * s * dy + ph * dz;
  };
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(g(xi, yi, zi, fx, fy, fz), g(xi + 1, yi, zi, fx - 1, fy, fz), u),
      l(g(xi, yi + 1, zi, fx, fy - 1, fz), g(xi + 1, yi + 1, zi, fx - 1, fy - 1, fz), u), v),
    l(l(g(xi, yi, zi + 1, fx, fy, fz - 1), g(xi + 1, yi, zi + 1, fx - 1, fy, fz - 1), u),
      l(g(xi, yi + 1, zi + 1, fx, fy - 1, fz - 1), g(xi + 1, yi + 1, zi + 1, fx - 1, fy - 1, fz - 1), u), v), w) * 1.6;
}

// Inverted Worley (1 at a feature point, 0 far away) with period p cells.
function worley(x, y, z, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d2 = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const wx = wrap(cx, p), wy = wrap(cy, p), wz = wrap(cz, p);
    const dx = cx + hash3(wx, wy, wz, seed) - x, dy = cy + hash3(wx, wy, wz, seed + 1) - y, dz = cz + hash3(wx, wy, wz, seed + 2) - z;
    d2 = Math.min(d2, dx * dx + dy * dy + dz * dz);
  }
  return 1 - Math.min(1, Math.sqrt(d2));
}

const remapJS = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);

// Stretch the 1st..99th percentile to 0..1, so coverage and erosion thresholds act on the whole range.
export function toBytes(values, out = new Uint8Array(values.length), stride = 1, offset = 0) {
  const sorted = Float32Array.from(values).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.floor(sorted.length * 0.99)];
  for (let i = 0; i < values.length; i++) out[i * stride + offset] = Math.round(Math.min(1, Math.max(0, (values[i] - lo) / (hi - lo))) * 255);
  return out;
}

// a size³ periodic volume's values for z slices [z0, z1), x fastest
function slab(size, z0, z1, fn) {
  const values = new Float32Array((z1 - z0) * size * size);
  for (let z = z0, n = 0; z < z1; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++, n++) {
    values[n] = fn(x / size, y / size, z / size);
  }
  return values;
}

// Shape: Perlin-Worley (billows) remapped by a low Worley fBm. Detail: a three-octave Worley fBm.
export function shapeValues(seed, size, z0 = 0, z1 = size) {
  return slab(size, z0, z1, (x, y, z) => {
    let pn = 0, a = 0.5, n = 0;
    for (let o = 0; o < 4; o++) { const p = 4 << o; pn += perlin(x * p, y * p, z * p, p, seed + o) * a; n += a; a *= 0.5; }
    pn = pn / n * 0.5 + 0.5;
    const w = worley(x * 4, y * 4, z * 4, 4, seed + 11) * 0.625 + worley(x * 8, y * 8, z * 8, 8, seed + 12) * 0.25
      + worley(x * 16, y * 16, z * 16, 16, seed + 13) * 0.125;
    const pw = remapJS(pn, 0, 1, w, 1);              // Perlin-Worley
    return remapJS(pw, w - 1, 1, 0, 1);               // the Nubis base shape
  });
}
export function detailValues(seed, size, z0 = 0, z1 = size) {
  return slab(size, z0, z1, (x, y, z) =>
    worley(x * 4, y * 4, z * 4, 4, seed + 21) * 0.625 + worley(x * 8, y * 8, z * 8, 8, seed + 22) * 0.25
    + worley(x * 16, y * 16, z * 16, 16, seed + 23) * 0.125);
}

// Weather map (2D): R coverage variation, G type variation. Tileable value fBm.
export function weatherBytes(seed) {
  const W = 256, wdata = new Uint8Array(W * W * 4), cov = new Float32Array(W * W), typ = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let c = 0, t = 0, a = 0.5, n = 0;
    for (let o = 0; o < 5; o++) {
      const p = 4 << o;
      c += perlin(x / W * p, y / W * p, 0.5, p, seed + 31 + o) * a;
      t += perlin(x / W * (p >> 1), y / W * (p >> 1), 3.5, p >> 1, seed + 41 + o) * a;
      n += a; a *= 0.5;
    }
    cov[y * W + x] = c / n;
    typ[y * W + x] = t / n;
  }
  toBytes(cov, wdata, 4, 0);
  toBytes(typ, wdata, 4, 1);
  for (let i = 3; i < wdata.length; i += 4) wdata[i] = 255;
  return wdata;
}
