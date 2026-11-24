// perf(v2) phone Regatta: the steps that bring a phone race under the governor's line.
// 1. render/navAids.js setView: a buoy wholly outside the camera's side planes is not uploaded; one in view, one at the frame's edge
//    (its sphere crossing a plane) and every buoy before a view is set still are.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mat4, perspectiveReversed, lookDir, multiply, DEG } from '../engine/math.js';

globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
function gpu() {
  const writes = [];
  const obj = () => ({ createView: () => ({}) });
  const device = new Proxy({ createBuffer: () => obj(), createTexture: () => obj(), createRenderPipeline: () => ({}), queue: { writeBuffer: (b, o, data, off, n) => writes.push(new Float32Array(data, off, n / 4).slice()), writeTexture: () => {} } },
    { get: (t, k) => (k in t ? t[k] : () => obj()) });
  const reg = { shader: (l, code) => ({ l, code }), add: () => {}, get: (name) => ({ name }) };
  return { device, reg, writes };
}
function viewProj(eye, fwd, fovDeg = 41.4, aspect = 1231 / 569) {
  const v = mat4(), p = mat4(), vp = mat4();
  lookDir(v, eye, fwd); perspectiveReversed(p, fovDeg * DEG, aspect, 0.3, 20000); multiply(vp, p, v);
  return vp;
}

test('navAids: buoys outside the view are not uploaded; in view, at the edge and before a view they are', async () => {
  const { createNavAids, CULL_R } = await import('../render/navAids.js');
  const { device, reg, writes } = gpu();
  const NA = createNavAids({ device, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', sky: { skyBGL: {}, skyBG: {} }, hdrTarget: { format: 'rgba16float' } });
  const put = () => {
    NA.begin();
    NA.put('aidCan', 0, 0, -100);        // straight ahead
    NA.put('aidNun', 0, 0, 100);         // behind the eye
    NA.put('aidLit', 400, 0, -100);      // far right, out of the frame
    NA.put('mooringBall', 0, 0, -100 - 1);
    NA.end();
  };
  put();
  assert.equal(NA.stats.instances, 4, 'no view yet: every buoy');
  NA.setView(viewProj([0, 6, 0], [0, 0, -1]));
  put();
  assert.equal(NA.stats.instances, 2, 'the two ahead');
  assert.equal(NA.stats.culled, 2, 'behind and far right culled');
  const xs = Array.from({ length: 2 }, (_, i) => writes.at(-1)[i * 12]);
  assert.deepEqual(xs.sort(), [0, 0], 'the uploaded instances are the ones in view');
  // the frame's right edge at 100 m ahead: x = 100 × tan(hfov / 2); a buoy just past it by less than its sphere stays
  const edge = 100 * Math.tan(Math.atan(Math.tan(41.4 * DEG / 2) * 1231 / 569));
  NA.begin(); NA.put('aidCan', edge + CULL_R * 0.5, 0, -100); NA.put('aidCan', edge + CULL_R * 1.5, 0, -100); NA.end();
  assert.equal(NA.stats.instances, 1, 'the sphere crossing the edge kept, the one past it culled');
  // the race's queue is culled the same way
  NA.begin(); NA.end();
  NA.raceBegin(); NA.racePut('raceCyl', 0, 0, -50); NA.racePut('raceTetra', 0, 0, 50); NA.raceEnd();
  assert.equal(NA.stats.instances, 1, 'the race mark behind the eye culled');
  assert.equal(NA.stats.race, 2, 'both still queued');
});
