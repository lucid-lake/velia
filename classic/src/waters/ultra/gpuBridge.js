// The compute path of the Ultra water (gpu.js): the same surface API as bridge.js (the WebGL path, ?fft=gl), with no second
// context and no 7 MB read-back: the cascades are written by compute into two mipmapped half-float array textures, and only a
// 1.6 MB window of f32 round the camera (the whole 600 m tile, 192 texels of the 85 m one) and a 64 x 64 subsample for the
// whitecap threshold and the Hs gain come back, one frame late, for the CPU surface (the boat and the marks).
import { createComputeOcean, makeFieldTexture, jonswapParams, N } from './gpu.js';
import { CASCADE_LENGTHS, defaultOceanParams } from './OceanSim.js';
import { warpAt, WARP, cascadeDamp } from '../../../../src/sim/waters/ultra/surface.js';
// v1's water-height provider (src/sim/waterSurface.js): the GPU read-back fills the shared sim's CPU surface each frame
import { makeCpuSurface } from '../../../../src/sim/waterSurface.js';

export { warpAt, WARP, cascadeDamp };
export const LENGTHS = CASCADE_LENGTHS;
export { N };
const LOOP = 300, W1 = 192;

export function createUltraGpu({ renderer, seed = 1337 } = {}) {
  // the short-wave fades (m): Ultra's 0.04 / 0.08 give a glossy sea; the beauty pass (2026-10-30) lets the fine ripples (2 to 20 cm) through, as classic's 16 ripple bands do
  const params = { ...defaultOceanParams(), swellScale: 0, shortWavesFade: 0.012, capillaryFade: 0.015 };
  const cuts = [...CASCADE_LENGTHS.slice(1).map((L) => (2 * Math.PI / L) * 6), 1e4];
  const dispT = makeFieldTexture(6), slopeT = makeFieldTexture(6);   // layers 0..3 the lake sim, 4..5 the bay sim
  const ocean = createComputeOcean(renderer, { lengths: CASCADE_LENGTHS, cuts, windows: [{ c: 0, w: N }, { c: 1, w: W1 }], lastFade: params.capillaryFade, disp: dispT, slope: slopeT, layer0: 0 });
  // the bay's sim: the same FFT with a short-fetch spectrum (1 km), 85 and 12 m tiles only: the lake sim's one spectrum peaks at
  // the 25 km fetch's 30 m waves, a bay's sea is 3 to 6 m and steep (the slam, the chop the hull rides). Blended by the
  // per-point fetch in the shader (water.js) and in the CPU surface (surface.js `bay`).
  const FB = 6, cutsB = [(2 * Math.PI / CASCADE_LENGTHS[2]) * 6, (2 * Math.PI / CASCADE_LENGTHS[3]) * 6];
  const oceanB = createComputeOcean(renderer, { lengths: [CASCADE_LENGTHS[1], CASCADE_LENGTHS[2]], cuts: cutsB, windows: [{ c: 0, w: W1 }], disp: dispT, slope: slopeT, layer0: 4 });
  let hsTargetB = null, scaleB = 1;
  const cpu = makeCpuSurface(), dbg = cpu.dbg;
  const stats = { jac0: 0.5, rms: 0, readMs: 0, bytes: ocean.winA.array.byteLength + ocean.stat.array.byteLength };
  let lastT = null, inFlight = false, pending = null, reads = 0, specKey = '', hsTarget = null, cover = 0.004, scale = 1;

  function jacQuantile(v, q) {
    const a = new Float32Array(4096); for (let i = 0; i < 4096; i++) a[i] = v[i * 4];
    a.sort(); return a[Math.min(4095, Math.max(0, Math.floor(q * 4096)))];
  }
  function onRead(win, st, tSub, meta, t0, winB, stB) {
    const f = new Float32Array(win), s = new Float32Array(st);
    const c0 = f.subarray(0, N * N * 4), c1 = f.subarray(N * N * 4, N * N * 4 + W1 * W1 * 4);
    const b0 = new Float32Array(winB);
    cpu.pushWindow({ layers: { 0: { w: N, ox: 0, oz: 0, data: c0 }, 1: { w: W1, ox: meta.ox, oz: meta.oz, data: c1 }, 4: { w: W1, ox: meta.ox, oz: meta.oz, data: b0 } } }, tSub);
    stats.jac0 += (jacQuantile(s, cover) - stats.jac0) * 0.5;
    stats.readMs = performance.now() - t0; reads++;
    let a = 0; for (let i = 0; i < 4096; i++) a += s[i * 4 + 1] ** 2 + s[i * 4 + 2] ** 2 + s[i * 4 + 3] ** 2;
    stats.rms = Math.sqrt(a / 4096);
    if (hsTarget && reads % 6 === 0) {   // the sea's size follows the lake's physics: rescale toward the target Hs (a GPU gain, no rebuild)
      const ratio = (hsTarget / 4 / Math.max(stats.rms, 1e-4)) ** 2;
      if (Math.abs(Math.log(ratio)) > 0.12) { scale = Math.min(3, Math.max(0.002, scale * ratio)); ocean.uAmp.value = Math.sqrt(scale); }
    }
    if (hsTargetB && reads % 6 === 3) {
      const sb = new Float32Array(stB); let q = 0; for (let i = 0; i < 4096; i++) q += sb[i * 4 + 1] ** 2 + sb[i * 4 + 2] ** 2;
      const ratio = (hsTargetB / 4 / Math.max(Math.sqrt(q / 4096), 1e-4)) ** 2;
      if (Math.abs(Math.log(ratio)) > 0.12) { scaleB = Math.min(3, Math.max(0.002, scaleB * ratio)); oceanB.uAmp.value = Math.sqrt(scaleB); }
    }
  }

  function update(t, o = {}) {
    const dt = lastT === null ? 0.05 : Math.min(0.25, Math.max(0, t - lastT)); lastT = t;
    const sp = Math.max(1, o.speed ?? 6), dir = (((o.dirDeg ?? 0) % 360) + 360) % 360, fk = Math.min(200, Math.max(1, o.fetchKm ?? 20));
    cover = o.cover ?? 0.004; hsTarget = o.hs ?? null; hsTargetB = o.hsB ?? null;
    const key = `${sp.toFixed(1)}|${Math.round(dir / 2)}|${Math.round(fk * 0.4)}`;
    if (key !== specKey) {
      specKey = key;
      const wind = jonswapParams(sp, fk), rad = Math.PI / 180;
      // dirDeg is the way the waves are to travel; in this sim's convention a wave travels toward -k, so the spectrum is aimed the other way
      // (the first checks read the cross-correlation's shift backwards, and the sea ran upwind until 2026-10-30: tools/ultra-orbit.mjs)
      const ang = ((dir + 180) % 360 > 180 ? (dir + 180) % 360 - 360 : (dir + 180) % 360) * rad, windB = jonswapParams(sp, FB);
      ocean.setSpectrum({ key, seed, A: [[1, ang, params.spreadBlend, params.windSwell]], B: [[wind.alpha, wind.peakOmega, params.gamma, params.shortWavesFade]] });
      oceanB.setSpectrum({ key, seed: seed + 11, A: [[1, ang, params.spreadBlend, params.windSwell]], B: [[windB.alpha, windB.peakOmega, params.gamma, params.shortWavesFade]] });
    }
    // the windows follow the camera (the boat is in front of it): the 85 m tile's 192 texels (64 m) centred on its warped position
    const [fx, fz] = o.focus ?? [0, 0], [wx, wz] = warpAt(fx, fz), L1 = CASCADE_LENGTHS[1];
    const cx = Math.floor((((fx + wx) / L1) % 1 + 1) % 1 * N - 0.5), cz = Math.floor((((fz + wz) / L1) % 1 + 1) % 1 * N - 0.5);
    const meta = { ox: (((cx - W1 / 2) % N) + N) % N, oz: (((cz - W1 / 2) % N) + N) % N };
    ocean.setWindowOrigins([[0, 0], [meta.ox, meta.oz]]); oceanB.setWindowOrigins([[meta.ox, meta.oz]]);
    ocean.step(t, dt); oceanB.step(t, dt);
    if (!inFlight) {
      inFlight = true;
      const t0 = performance.now(), tSub = t;
      pending = Promise.all([ocean.readWindow(), ocean.readStats(), oceanB.readWindow(), oceanB.readStats()]).then(([w, s, wb, sb]) => onRead(w, s, tSub, meta, t0, wb, sb)).catch((e) => console.warn('ultra gpu read', e)).finally(() => { inFlight = false; pending = null; });
    }
  }
  async function settle() {
    const want = reads + 1;
    for (let i = 0; i < 300 && reads < want; i++) { if (pending) await pending; else await new Promise((r) => setTimeout(r, 4)); }
  }
  async function bench(n = 120) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { ocean.step(i / 60, 1 / 60); oceanB.step(i / 60, 1 / 60); }
    await ocean.readStats();
    return (performance.now() - t0) / n;
  }
  function moments() { return { rms: [stats.rms], jac0: stats.jac0, wind: params.windSpeed, scale }; }
  const sampleDisp = cpu.sampleDisp;
  return { gpu: true, dbg, attachMips() {}, bench, sampleDisp, snapshot: () => null, fixed: {}, moments, params, disp: dispT, slope: slopeT, bayLayer: 4, FB, update, settle, heightAt: cpu.heightAt, velocityAt: cpu.velocityAt, stats, get reads() { return reads; }, lengths: CASCADE_LENGTHS, ocean };
}
