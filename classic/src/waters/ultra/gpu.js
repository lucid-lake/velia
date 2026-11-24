// Ultra-Water's FFT ocean (MIT, ./LICENSE) as WebGPU compute, inside Velia's own renderer: no second context, no 7 MB
// read-back. The maths is OceanSim.js's (Tessendorf, Stockham radix-2 IFFT, JONSWAP + cos-2s, capillary-gravity
// dispersion on the finest cascade, a 300 s loop); the rest is ours:
//   - h0 (the initial spectrum) on the CPU, rebuilt only when the wind, its direction or the fetch change (about 20 ms);
//     the sea's size is a GPU gain (uAmp), so the Hs feedback never rebuilds it.
//   - evolve, 16 FFT passes (8 per axis), assemble: TSL compute over storage buffers (vec4 f32).
//   - assemble writes two half-float array textures (displacement: lambda Dx, Dy, lambda Dz, turbulence; slope: sx, sz,
//     sx^2, sz^2), mipmapped by three after the compute (so far water keeps its chop), and a small window of the f32
//     field round the boat for the CPU surface (the boat and the marks float on the same numbers the GPU draws).
//   - a stats pass writes a 64 x 64 subsample (jacobian sum, heights) for the whitecap threshold and the Hs feedback.
//   const ocean = createComputeOcean(renderer, { lengths, cuts, spec });  ocean.step(t, dt); ocean.disp, ocean.slope
import * as THREE from 'three/webgpu';
import { Fn, instanceIndex, storage, uniform, float, vec2, vec4, uint, uvec2, floor, sqrt, sin, cos, min, max, select, If, storageTexture, texture, fract, exp, pow, abs } from 'three/tsl';

export const N = 256;
const NN = N * N, LOOP = 300, G = 9.81, ST = 7.4e-5, PI = Math.PI;
const W0 = 2 * PI / LOOP;

// --- h0 on the CPU: OceanSim.js INIT_FRAG, line for line -----------------------------------------------------
function pcg2d(x, y) {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0; y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
  return [x, y];
}
function gauss(ix, iy, c, seed) {
  const [hx, hy] = pcg2d((ix + c * 7919 + seed) >>> 0, (iy + c * 104729 + seed) >>> 0);
  const u1 = (hx + 1) / 4294967296, u2 = hy / 4294967296, r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * PI * u2), r * Math.sin(2 * PI * u2)];
}
const omega = (k) => Math.sqrt(G * k + ST * k * k * k);
function jonswap(w, a, b) {
  const wp = b[1], sigma = w <= wp ? 0.07 : 0.09, r = Math.exp(-((w - wp) ** 2) / (2 * sigma * sigma * wp * wp)), iw = 1 / w, q = wp * iw;
  return a[0] * b[0] * G * G * iw ** 5 * Math.exp(-1.25 * q ** 4) * Math.pow(b[2], r);
}
function normalisation(s) {
  const s2 = s * s, s3 = s2 * s, s4 = s3 * s;
  if (s < 5) return -0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * s + 0.163;
  return -4.80e-08 * s4 + 1.07e-05 * s3 - 9.53e-04 * s2 + 5.90e-02 * s + 3.93e-01;
}
function directional(theta, w, a, b) {
  const x = w / b[1];
  let s = x > 1 ? 9.77 * Math.pow(x, -2.5) : 6.97 * Math.pow(x, 5);
  s += 16 * Math.tanh(Math.min(x, 20)) * a[3] * a[3];
  const t = theta - a[1], cosine2s = normalisation(s) * Math.pow(Math.abs(Math.cos(0.5 * t)), 2 * s);
  const m = 2 / PI * Math.cos(t) * Math.cos(t);
  return m + (cosine2s - m) * a[2];
}
// spec: { A: [[scale, angle(rad), spreadBlend, swell], ...], B: [[alpha, peakOmega, gamma, fade], ...], lengths, cuts (k, per cascade: the top of its band) }
function buildH0({ lengths, cuts, A, B, seed = 1337, lastFade = null }) {
  const C = lengths.length, out = new Float32Array(C * NN * 4);
  const h0 = (ix, iy, c) => {
    const L = lengths[c], dk = 2 * PI / L, kx = (ix - N / 2) * dk, kz = (iy - N / 2) * dk, kl = Math.hypot(kx, kz);
    const lo = c === 0 ? 1e-4 : cuts[c - 1], hi = cuts[c];
    if (kl < lo || kl > hi) return [0, 0];
    const w = omega(kl), dwdk = (G + 3 * ST * kl * kl) / (2 * w), theta = Math.atan2(kz, kx);
    let S = 0;
    for (let i = 0; i < A.length; i++) {
      if (A[i][0] <= 0) continue;
      const fade = c === C - 1 && lastFade != null ? lastFade : B[i][3];
      S += jonswap(w, A[i], B[i]) * directional(theta, w, A[i], B[i]) * Math.exp(-fade * fade * kl * kl);
    }
    const amp = Math.sqrt(2 * S * dwdk / kl * dk * dk), g = gauss(ix, iy, c, seed);
    return [g[0] * amp, g[1] * amp];
  };
  for (let c = 0; c < C; c++) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    const a = h0(ix, iy, c), b = h0((N - ix) % N, (N - iy) % N, c), o = ((c * N + iy) * N + ix) * 4;
    out[o] = a[0]; out[o + 1] = a[1]; out[o + 2] = b[0]; out[o + 3] = -b[1];
  }
  return out;
}
export function jonswapParams(windSpeed, fetchKm) {
  const fetch = fetchKm * 1000;
  return { alpha: 0.076 * Math.pow((G * fetch) / (windSpeed * windSpeed), -0.22), peakOmega: 22 * Math.pow((windSpeed * fetch) / (G * G), -0.33) };
}

// --- the GPU side ---------------------------------------------------------------------------------------------
const cmul = (a, b) => vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));
const pack2 = (a, b) => vec2(a.x.sub(b.y), a.y.add(b.x));
const pick = (c, vals) => vals.reduceRight((acc, v, i) => (acc === null ? float(v) : select(c.lessThan(i + 0.5), float(v), acc)), null);   // vals[c] for a float c

// opts: { lengths: [m...], cuts: [k...], windows: [{ c, w }...] (the f32 windows read back for the CPU, per cascade) }
export function makeFieldTexture(layers) {
  const t = new THREE.StorageArrayTexture(N, N, layers);
  t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.mipmapsAutoUpdate = true; t.anisotropy = 4;
  return t;
}

// disp / slope / layer0: share two array textures between sims (one writes layers 0..3, the next 4..5): the water shader has 16 sampled textures at most
export function createComputeOcean(renderer, { lengths, cuts, windows = [], lastFade = null, disp: dispIn = null, slope: slopeIn = null, layer0 = 0 } = {}) {
  const C = lengths.length, count = C * NN;
  const buf = (n = count) => new THREE.StorageBufferAttribute(new Float32Array(n * 4), 4);
  const h0A = buf(), p0 = buf(), p1 = buf(), q0 = buf(), q1 = buf();
  const turbA = new THREE.StorageBufferAttribute(new Float32Array(count).fill(1), 1);
  const st = (a, n = count, t = 'vec4') => storage(a, t, n);
  const h0S = st(h0A), p0S = st(p0), p1S = st(p1), q0S = st(q0), q1S = st(q1), turbS = storage(turbA, 'float', count);

  const mkTex = () => {
    const t = new THREE.StorageArrayTexture(N, N, C);
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true; t.mipmapsAutoUpdate = true; t.anisotropy = 4;
    return t;
  };
  const disp = dispIn ?? mkTex(), slope = slopeIn ?? mkTex();

  // window buffer: one square per windowed cascade
  const wOff = []; let wTot = 0;
  for (const { c, w } of windows) { wOff[c] = { off: wTot, w }; wTot += w * w; }
  const winA = new THREE.StorageBufferAttribute(new Float32Array(Math.max(1, wTot) * 4), 4), winS = storage(winA, 'vec4', Math.max(1, wTot));
  const uOrg = windows.map(() => uniform(0));   // x then z origin texel per windowed cascade (set per frame)
  const uOrgX = windows.map(() => uniform(0)), uOrgZ = windows.map(() => uniform(0));
  const stat = new THREE.StorageBufferAttribute(new Float32Array(4096 * 4), 4), statS = storage(stat, 'vec4', 4096);

  const uTime = uniform(0), uDt = uniform(0), uAmp = uniform(1), uLambda = uniform(0.85), uRec = uniform(0.7);
  const uSub = uniform(2), uHs = uniform(1), uVert = uniform(0);

  const idx = () => {
    const i = float(instanceIndex), cf = floor(i.div(NN)), r = i.sub(cf.mul(NN)), yf = floor(r.div(N)), xf = r.sub(yf.mul(N));
    return { i, cf, r, yf, xf };
  };
  const Lc = (cf) => pick(cf, lengths);

  // evolve: h(k, t) from h0, into the two packed complex fields
  const evolve = Fn(() => {
    const { cf, xf, yf } = idx();
    const L = Lc(cf), dk = float(2 * PI).div(L), kx = xf.sub(N / 2).mul(dk), kz = yf.sub(N / 2).mul(dk), kl = sqrt(kx.mul(kx).add(kz.mul(kz)));
    const ik = select(kl.greaterThan(1e-6), float(1).div(kl), float(0));
    const om = sqrt(kl.mul(G).add(kl.mul(kl).mul(kl).mul(ST)));
    const ph = float(2 * PI).mul(fract(floor(om.div(W0)).mul(uTime.div(LOOP))));
    const e = vec2(cos(ph), sin(ph)), h0 = h0S.element(instanceIndex);
    const h = cmul(h0.xy, e).add(cmul(h0.zw, vec2(e.x, e.y.negate()))).mul(uAmp), ih = vec2(h.y.negate(), h.x);
    const dx = ih.mul(kx).mul(ik), dz = ih.mul(kz).mul(ik);
    const dxdx = h.mul(kx).mul(kx).mul(ik).negate(), dzdz = h.mul(kz).mul(kz).mul(ik).negate(), dxdz = h.mul(kx).mul(kz).mul(ik).negate();
    p0S.element(instanceIndex).assign(vec4(pack2(dx, dz), pack2(h, dxdz)));
    p1S.element(instanceIndex).assign(vec4(pack2(ih.mul(kx), ih.mul(kz)), pack2(dxdx, dzdz)));
  })().compute(count);

  // one Stockham stage between two buffer pairs
  const stage = (s0, s1, d0, d1) => Fn(() => {
    const { cf, xf, yf } = idx(), vert = uVert.greaterThan(0.5);
    const il = select(vert, yf, xf);
    const hs = uHs, sub = uSub;
    const e = floor(il.div(sub)).mul(hs).add(il.sub(floor(il.div(hs)).mul(hs)));   // (i / sub) * hs + (i mod hs)
    const base = cf.mul(NN);
    const pe = select(vert, base.add(e.mul(N)).add(xf), base.add(yf.mul(N)).add(e));
    const po = select(vert, base.add(e.add(N / 2).mul(N)).add(xf), base.add(yf.mul(N)).add(e.add(N / 2)));
    const im = il.sub(floor(il.div(sub)).mul(sub));   // i mod sub
    const a = im.mul(2 * PI).div(sub), tw = vec2(cos(a), sin(a));
    const peU = uint(pe).toVar(), poU = uint(po).toVar();
    const e0 = s0.element(peU), o0 = s0.element(poU), e1 = s1.element(peU), o1 = s1.element(poU);
    d0.element(instanceIndex).assign(vec4(e0.xy.add(cmul(tw, o0.xy)), e0.zw.add(cmul(tw, o0.zw))));
    d1.element(instanceIndex).assign(vec4(e1.xy.add(cmul(tw, o1.xy)), e1.zw.add(cmul(tw, o1.zw))));
  })().compute(count);
  const stagePQ = stage(p0S, p1S, q0S, q1S), stageQP = stage(q0S, q1S, p0S, p1S);

  // assemble: the real fields out of the transform (the centred-k shift undone), the jacobian with its recovery, the textures
  const assemble = Fn(() => {
    const { cf, xf, yf } = idx();
    const s = select(xf.add(yf).mod(2).lessThan(0.5), float(1), float(-1));
    const a = p0S.element(instanceIndex).mul(s), b = p1S.element(instanceIndex).mul(s);
    const dxx = uLambda.mul(b.z), dzz = uLambda.mul(b.w), dxz = uLambda.mul(a.w);
    const jac = float(1).add(dxx).mul(float(1).add(dzz)).sub(dxz.mul(dxz));
    const sl = vec2(b.x.div(max(float(1).add(dxx), 0.2)), b.y.div(max(float(1).add(dzz), 0.2)));
    const prev = turbS.element(instanceIndex);
    const turb = min(jac, prev.add(uDt.mul(uRec).div(max(jac, 0.5)))).toVar();
    turbS.element(instanceIndex).assign(turb);
    const dv = vec4(uLambda.mul(a.x), a.z, uLambda.mul(a.y), turb), sv = vec4(sl.x, sl.y, sl.x.mul(sl.x), sl.y.mul(sl.y));
    const uv = uvec2(uint(xf), uint(yf));
    storageTexture(disp, uv, dv).depth(uint(cf.add(layer0))).toStack();
    storageTexture(slope, uv, sv).depth(uint(cf.add(layer0))).toStack();
    // the CPU's window (f32)
    windows.forEach(({ c, w }, k) => {
      const ox = uOrgX[k], oz = uOrgZ[k];
      const wx = xf.sub(ox).add(N).mod(N), wz = yf.sub(oz).add(N).mod(N);
      If(cf.equal(c).and(wx.lessThan(w)).and(wz.lessThan(w)), () => {
        winS.element(uint(wz.mul(w).add(wx).add(wOff[c].off))).assign(dv);
      });
    });
  })().compute(count);

  // stats: a 64 x 64 subsample of (the jacobian sum over the first three cascades, their heights)
  const statsPass = Fn(() => {
    const i = float(instanceIndex), yy = floor(i.div(64)), xx = i.sub(yy.mul(64)), t = yy.mul(4).mul(N).add(xx.mul(4));
    const s = float(1);   // (4x + 4y) is even: the centred shift sign is +1
    // the first three cascades (fewer in a two-cascade sim: the missing ones read 0 and count 1 in the jacobian)
    const turbAt = (k) => (k < C ? turbS.element(uint(t.add(k * NN))) : float(1)), yAt = (k) => (k < C ? p0S.element(uint(t.add(k * NN))).z.mul(s) : float(0));
    statS.element(instanceIndex).assign(vec4(turbAt(0).add(turbAt(1)).add(turbAt(2)).sub(2), yAt(0), yAt(1), yAt(2)));
  })().compute(4096);

  let h0Key = '', ampBaked = 1, last = null, steps = 0;
  const api = {
    disp, slope, lengths, windows, wOff, winA, stat, uAmp, uLambda,
    // spec: { A, B } as buildH0; key changes only when the spectrum does
    setSpectrum({ A, B, key, seed }) {
      if (key === h0Key) return false;
      h0Key = key;
      h0A.array.set(buildH0({ lengths, cuts, A, B, seed, lastFade })); h0A.needsUpdate = true;
      return true;
    },
    setWindowOrigins(origins) { origins.forEach(([x, z], k) => { uOrgX[k].value = x; uOrgZ[k].value = z; }); },
    step(t, dt) {
      uTime.value = ((t % LOOP) + LOOP) % LOOP; uDt.value = dt;
      renderer.compute(evolve);
      for (let dir = 0; dir < 2; dir++) for (let s = 1; s <= 8; s++) {
        uVert.value = dir; uSub.value = 1 << s; uHs.value = 1 << (s - 1);
        renderer.compute((steps++ & 1) ? stageQP : stagePQ);
      }
      renderer.compute(assemble);
      renderer.compute(statsPass);
    },
    readWindow: () => renderer.getArrayBufferAsync(winA),
    readStats: () => renderer.getArrayBufferAsync(stat),
  };
  return api;
}
