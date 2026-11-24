// GPU-vs-CPU check of the bridge: samples cascade c's displacement texture at world points in a compute pass and reads
// the result back, so a tool can compare it with ultra.heightAt's bytes (the boat floats on the CPU's copy).
import * as THREE from 'three/webgpu';
import { Fn, instanceIndex, texture, storage, vec2, vec4, float, int } from 'three/tsl';
import { LENGTHS, warpAt } from './bridge.js';

export async function gpuDisplacement(renderer, ultra, pts, c = 1, lod = 0, which = 'disp') {
  const n = pts.length;
  const inBuf = new THREE.StorageBufferAttribute(new Float32Array(pts.map(([x, z]) => (c > 0 ? [x + warpAt(x, z)[0], z + warpAt(x, z)[1]] : [x, z])).flat()), 2);
  const outBuf = new THREE.StorageBufferAttribute(new Float32Array(n * 4), 4);
  const src = storage(inBuf, 'vec2', n).toReadOnly(), dst = storage(outBuf, 'vec4', n);
  const tex = texture(which === 'slope' ? ultra.slope : ultra.disp);
  const k = Fn(() => {
    const xz = src.element(instanceIndex);
    dst.element(instanceIndex).assign(tex.sample(xz.div(LENGTHS[c])).depth(int(c)).level(float(0)));
  })().compute(n);
  await renderer.computeAsync(k);
  return Array.from(new Float32Array(await renderer.getArrayBufferAsync(outBuf)));
}
