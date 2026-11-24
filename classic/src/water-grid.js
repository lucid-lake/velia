// The water's mesh and map textures (split from src/water.js, refactor round 2 Phase D; the code is unchanged): the
// camera-centred radial grid and a one-channel half-float texture for a Float32Array map.
import * as THREE from 'three/webgpu';

// rings r0·q^i out to 45 km (Tahoe's north shore is ≈ 33 km from the bay), 256 spokes: spacing ≈ 3 % of the distance.
// Past flatM no band displaces the mesh (each fades out once the grid step passes a third of its wavelength), so
// the rings there only carry a flat plane: they step ×qFar instead. Dense rings out there were 0.1–0.3 px apart
// from the sail camera (5 m up), so the water was shaded several times a pixel (2.2 ms of the 16.3 ms sail frame).
export function radialGrid(rings = 360, spokes = 256, r0 = 0.25, rMax = 45000, { flatM = Infinity, qFar = 1.5 } = {}) {
  const q = Math.pow(rMax / r0, 1 / (rings - 1));
  const radii = [];
  for (let i = 0; i < rings; i++) {
    const r = r0 * Math.pow(q, i);
    if (r > flatM) {
      for (let f = radii.at(-1) * qFar; f < rMax; f *= qFar) radii.push(f);
      radii.push(rMax);
      break;
    }
    radii.push(r);
  }
  rings = radii.length;
  const pos = new Float32Array(rings * spokes * 3);
  radii.forEach((r, i) => {
    for (let j = 0; j < spokes; j++) {
      const a = j / spokes * Math.PI * 2, o = (i * spokes + j) * 3;
      pos[o] = r * Math.cos(a); pos[o + 1] = 0; pos[o + 2] = r * Math.sin(a);
    }
  });
  const idx = new Uint32Array((rings - 1) * spokes * 6);
  let n = 0;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < spokes; j++) {
      const a = i * spokes + j, b = i * spokes + (j + 1) % spokes, c = a + spokes, d = b + spokes;
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = b; idx[n++] = c; idx[n++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax);
  return { geo, spacing: q - 1 };
}

// a one-channel half-float texture, linear filtered, for a Float32Array map
export function halfTexture(size) {
  const data = new Uint16Array(size * size);
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { data, tex, set(f) { for (let k = 0; k < f.length; k++) data[k] = THREE.DataUtils.toHalfFloat(f[k]); tex.needsUpdate = true; } };
}
