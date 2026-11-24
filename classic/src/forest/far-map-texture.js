// The far map's texture (src/forest/far-map.js): one RG8 DataTexture over the rim's region, shared by the forest
// (src/trees.js paints it as the rim's tiles stream in) and the terrain material (src/terrain-mesh.js reads it). F: the
// tier's far map (far-map.js farMapFor); the first caller makes it (the terrain material, with the world's tier).
import * as THREE from 'three/webgpu';
import { vec2 } from 'three/tsl';
import { FARMAP, farMapSize, farMapPainter } from './far-map.js';

let shared = null;
export function farMapTexture(F = FARMAP) {
  if (shared) return shared;
  const painter = farMapPainter(F), { w, h } = farMapSize(F);
  const tex = new THREE.DataTexture(painter.data, w, h, THREE.RGFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  const { x0, x1, z0, z1 } = F.region;
  const uv = (p) => vec2(p.x.sub(x0).div(x1 - x0), p.y.sub(z0).div(z1 - z0));   // p: vec2 (x, z)
  shared = { tex, uv, painter, w, h };
  return shared;
}
