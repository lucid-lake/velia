// Ultra-Water's FFT ocean (MIT, src/waters/ultra/LICENSE) inside Velia's WebGPU renderer, as a bridge:
// the sim runs on a private WebGL2 context (its own detached canvas), the result is read back (one async read of
// 7 layers) and uploaded as two array textures (displacement x3, slopes x4) that the TSL water material samples. The
// same bytes serve the CPU: the boat floats on exactly the surface the GPU draws (heightAt below).
//   const ultra = createUltraBridge();
//   ultra.update(t, { speed, dirDeg, fetchKm })     // each frame, before the render (t: scene seconds)
//   await ultra.settle()                            // captures: wait for this frame's read
//   ultra.disp, ultra.slope                         // THREE.DataArrayTexture, repeat, mipmapped
//   ultra.heightAt(x, z, t, { filterM, damp })      // m, the choppy surface on the CPU
// Layers: disp[c] = (lambda*Dx, Dy, lambda*Dz, turbulence) for the 600 / 85 / 12 m cascades; slope[c] = (sx, sz, sx^2,
// sz^2) for the 600 / 85 / 12 / 2.1 m cascades. Tile sizes: LENGTHS.
import * as THREE from 'three';
import { OceanSim, N, CASCADE_LENGTHS, defaultOceanParams } from './OceanSim.js';
import { warpAt, WARP, cascadeDamp } from '../../../../src/sim/waters/ultra/surface.js';
import { makeCpuSurface } from '../../../../src/sim/waterSurface.js';   // the read-back fills the shared sim's CPU surface (the ?fft=gl path)
import { FullscreenQuad, rawPass } from './fullscreen.js';

export const LENGTHS = CASCADE_LENGTHS;
export { N };
const LOOP = 300;
const LAYERS = 7;   // 3 displacement + 4 slope
const PACK = /* glsl */`
precision highp float;
precision highp int;
uniform highp sampler2D uD0; uniform highp sampler2D uD1; uniform highp sampler2D uD2;
uniform highp sampler2D uS0; uniform highp sampler2D uS1; uniform highp sampler2D uS2; uniform highp sampler2D uS3;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int l = p.y / ${N};
  ivec2 q = ivec2(p.x, p.y - l * ${N});
  if (l == 0) outColor = texelFetch(uD0, q, 0);
  else if (l == 1) outColor = texelFetch(uD1, q, 0);
  else if (l == 2) outColor = texelFetch(uD2, q, 0);
  else if (l == 3) outColor = texelFetch(uS0, q, 0);
  else if (l == 4) outColor = texelFetch(uS1, q, 0);
  else if (l == 5) outColor = texelFetch(uS2, q, 0);
  else outColor = texelFetch(uS3, q, 0);
}`;

export { warpAt, WARP, cascadeDamp };

export function createUltraBridge({ seed = 1337 } = {}) {
  const canvas = document.createElement('canvas');
  const gl = new THREE.WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'high-performance' });
  gl.setPixelRatio(1); gl.setSize(8, 8, false); gl.autoClear = false;
  const params = { ...defaultOceanParams(), swellScale: 0, shortWavesFade: 0.025, capillaryFade: 0.05 };   // a lake: wind sea only, no ocean swell
  const sim = new OceanSim(gl, params);
  sim.initMat.uniforms.uSeed.value = seed;

  const packRT = new THREE.WebGLRenderTarget(N, N * LAYERS, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  const packMat = rawPass(PACK, Object.fromEntries(['uD0', 'uD1', 'uD2', 'uS0', 'uS1', 'uS2', 'uS3'].map((k) => [k, { value: null }])));
  const packQuad = new FullscreenQuad(packMat);

  const layerLen = N * N * 4;
  const bufs = [0, 1, 2].map(() => new Float32Array(layerLen * LAYERS));
  let cur = 0, next = 1, inFlight = false, pending = null, reads = 0, lastT = null, specKey = '';
  const mk = (buf, off, depth) => {
    const t = new THREE.DataArrayTexture(new Float32Array(buf.buffer, buf.byteOffset + off * 4, layerLen * depth), N, N, depth);
    t.format = THREE.RGBAFormat; t.type = THREE.FloatType;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const disp = mk(bufs[0], 0, 3), slope = mk(bufs[0], layerLen * 3, 4);
  // Mips, ours. three's WebGPU mip generator decimates float32 layers (a nearest-sampled blit: the std of a mip level 8
  // equalled level 0), so far water aliased into a moire. We average the 2 x 2 boxes on the CPU on every read and write
  // levels 1 to 8 into the GPU texture ourselves (attachMips patches the backend's generateMipmaps for these two textures).
  const mipStore = { disp: [], slope: [] };
  for (const [k, layers] of [['disp', 3], ['slope', 4]]) for (let l = 1; l <= 8; l++) mipStore[k].push(new Float32Array(layers * (N >> l) * (N >> l) * 4));
  function buildMips(key, base, layers) {
    let src = base, size = N;
    for (let l = 0; l < 8; l++) {
      const s2 = size >> 1, dst = mipStore[key][l];
      for (let k = 0; k < layers; k++) for (let y = 0; y < s2; y++) for (let x = 0; x < s2; x++) {
        const o = ((k * s2 + y) * s2 + x) * 4, a = ((k * size + 2 * y) * size + 2 * x) * 4, b = a + 4, c = a + size * 4, d = c + 4;
        dst[o] = (src[a] + src[b] + src[c] + src[d]) * 0.25; dst[o + 1] = (src[a + 1] + src[b + 1] + src[c + 1] + src[d + 1]) * 0.25;
        dst[o + 2] = (src[a + 2] + src[b + 2] + src[c + 2] + src[d + 2]) * 0.25; dst[o + 3] = (src[a + 3] + src[b + 3] + src[c + 3] + src[d + 3]) * 0.25;
      }
      src = dst; size = s2;
    }
  }
  function attachMips(renderer) {
    const be = renderer.backend;
    if (!be?.device || be.__ultraMips) return;
    be.__ultraMips = true;
    const orig = be.generateMipmaps.bind(be);
    be.generateMipmaps = (tex, ...rest) => {
      const key = tex === disp ? 'disp' : tex === slope ? 'slope' : null;
      if (!key) return orig(tex, ...rest);
      const gpu = be.get(tex).texture, layers = key === 'disp' ? 3 : 4;
      if (!gpu) return undefined;
      for (let l = 1; l <= 8; l++) { const sz = N >> l; be.device.queue.writeTexture({ texture: gpu, mipLevel: l }, mipStore[key][l - 1], { bytesPerRow: sz * 16, rowsPerImage: sz }, { width: sz, height: sz, depthOrArrayLayers: layers }); }
      return undefined;
    };
  }
  const stats = { jac0: 0.5, rmsSlope: 0, readMs: 0, bytes: bufs[0].byteLength };

  // Jacobian threshold for a target whitecap coverage: the quantile of (t0 + t1 + t2 - 2) over the tile
  function jacQuantile(buf, cover) {
    const v = [];
    for (let j = 0; j < N; j += 4) for (let i = 0; i < N; i += 4) {
      const o = (j * N + i) * 4 + 3;
      v.push(buf[o] + buf[layerLen + o] + buf[2 * layerLen + o] - 2);
    }
    v.sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.max(0, Math.floor(cover * v.length)))];
  }

  function adopt(buf, tSub) {
    cpu.push(buf, tSub);
    if (!globalThis.__ultraNoMips) { buildMips('disp', new Float32Array(buf.buffer, 0, layerLen * 3), 3); buildMips('slope', new Float32Array(buf.buffer, layerLen * 3 * 4, layerLen * 4), 4); }
    cur = bufs.indexOf(buf);
    disp.image.data = new Float32Array(buf.buffer, 0, layerLen * 3);
    slope.image.data = new Float32Array(buf.buffer, layerLen * 3 * 4, layerLen * 4);
    disp.needsUpdate = slope.needsUpdate = true;
    ready.buf = buf;
    ready.cover = ready.cover ?? 0.004;
    stats.jac0 += (jacQuantile(buf, ready.cover) - stats.jac0) * 0.5;
    reads++;
    // the sea's size follows the lake's physics (Velia's fetch-limited Hs): rescale the whole spectrum toward the target
    if (ready.hs && reads % 6 === 0) {
      let a = 0;
      for (let c = 0; c < 3; c++) for (let i = 0; i < N * N; i += 7) a += buf[c * layerLen + i * 4 + 1] ** 2;
      const rms = Math.sqrt(a / (3 * Math.ceil(N * N / 7))) * Math.sqrt(3), ratio = Math.pow(ready.hs / 4 / Math.max(rms, 1e-4), 2);
      stats.rms = rms;
      if (Math.abs(Math.log(ratio)) > 0.12) { params.waveScale = Math.min(3, Math.max(0.002, params.waveScale * ratio)); sim.dirty = true; }
    }
  }
  const ready = { buf: null, cover: 0.004 };

  const fixed = {};   // diagnostics: { speed, fetchKm } pins the spectrum
  function update(t, o = {}) {
    const { speed = 6, dirDeg = 0, fetchKm = 20, cover = 0.004 } = { ...o, ...fixed };
    const dt = lastT === null ? 0.05 : Math.min(0.25, Math.max(0, t - lastT)); lastT = t;
    ready.cover = cover; ready.hs = o.hs ?? fixed.hs ?? null;
    // dirDeg: the direction the waves travel, as the angle of (x, z) in degrees (atan2(z, x)); checked by tools/ultra-dir.mjs
    const dir = (((dirDeg + 180) % 360) + 360) % 360, sp = Math.max(1, speed), fk = Math.min(200, Math.max(1, fetchKm));
    const key = `${sp.toFixed(1)}|${Math.round(dir / 2)}|${Math.round(fk * 0.4)}`;
    if (key !== specKey) { specKey = key; params.windSpeed = sp; params.windDirection = dir > 180 ? dir - 360 : dir; params.fetchKm = fk; sim.dirty = true; }
    sim.time = (((t - dt) % LOOP) + LOOP) % LOOP;
    sim.update(dt);
    const u = packMat.uniforms;
    for (let c = 0; c < 3; c++) u['uD' + c].value = sim.displacement[c];
    for (let c = 0; c < 4; c++) u['uS' + c].value = sim.slope[c];
    packQuad.render(gl, packRT);
    if (!inFlight) {
      inFlight = true;
      const t0 = performance.now(), buf = bufs[next], tSub = t;
      pending = gl.readRenderTargetPixelsAsync(packRT, 0, 0, N, N * LAYERS, buf).then(() => {
        stats.readMs = performance.now() - t0;
        adopt(buf, tSub);
        next = [0, 1, 2].find((i) => bufs[i] !== frame.buf && bufs[i] !== frame.prev);
      }).catch((e) => console.warn('ultra read', e)).finally(() => { inFlight = false; pending = null; });
    }
    gl.setRenderTarget(null);
  }

  // headless captures: the read of the frame just submitted (and one more so the textures hold it)
  async function settle() {
    const want = reads + 1;
    for (let i = 0; i < 200 && reads < want; i++) { if (pending) await pending; else await new Promise((r) => setTimeout(r, 4)); }
  }

  // the surface on the CPU (surface.js), fed by every read
  const cpu = makeCpuSurface();
  const frame = cpu.frame, heightAt = cpu.heightAt, dbg = cpu.dbg, velocityAt = cpu.velocityAt;

  // diagnostics: rms height (m) per displacement cascade, mean-square slope per slope cascade, the whitecap threshold
  function moments() {
    const b = frame.buf; if (!b) return null;
    const rms = [], ms = [];
    for (let c = 0; c < 3; c++) { let a = 0; for (let i = 0; i < N * N; i++) a += b[c * layerLen + i * 4 + 1] ** 2; rms.push(Math.sqrt(a / (N * N))); }
    for (let c = 0; c < 4; c++) { let a = 0; for (let i = 0; i < N * N; i++) a += b[(3 + c) * layerLen + i * 4 + 2] + b[(3 + c) * layerLen + i * 4 + 3]; ms.push(a / (N * N)); }
    return { rms, ms, msTotal: ms.reduce((x, y) => x + y, 0), jac0: stats.jac0, wind: params.windSpeed, dir: params.windDirection, fetchKm: params.fetchKm };
  }

  // GPU cost of the sim + pack on the WebGL context at full clocks: n frames back to back, finished by a 1 px read
  function bench(n = 200) {
    const px = new Float32Array(4), run = (k) => { for (let i = 0; i < k; i++) { sim.update(1 / 60); for (let c = 0; c < 3; c++) packMat.uniforms['uD' + c].value = sim.displacement[c]; for (let c = 0; c < 4; c++) packMat.uniforms['uS' + c].value = sim.slope[c]; packQuad.render(gl, packRT); } gl.readRenderTargetPixels(packRT, 0, 0, 1, 1, px); };
    run(20);
    const t0 = performance.now(); run(n);
    return (performance.now() - t0) / n;
  }
  return { velocityAt, dbg, attachMips, bench, sampleDisp: cpu.sampleDisp, snapshot: () => frame.buf && frame.buf.slice(0, layerLen * 3), fixed, moments, sim, params, disp, slope, update, settle, heightAt, stats, get reads() { return reads; }, gl, lengths: LENGTHS };
}
