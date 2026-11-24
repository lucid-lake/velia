// Hemi-octahedral impostors (Brucks 2018): every tree variant baked at load from the 25
// directions of a 5 × 5 hemi-octahedral grid into two atlases, albedo+alpha and object-space normal+depth, on the
// GPU in two render passes (an orthographic camera over a grid of rotated instances). At draw time the view direction
// picks the three frames round it, blended by their barycentric weights, and the baked normal is lit per pixel by
// the scene's sun, so the sun can move through the session.
//
//   import { bakeImpostors, octEncode, octDecode, FRAMES, FRAME_PX } from './forest/impostor.js';
//   const bake = await bakeImpostors(renderer, variants, { atlas });   // variants: [{ geometry }] (unit trees)
//   bake.albedo, bake.normal (textures), bake.tile(i) → [u0, v0] of variant i's tile, bake.tileSize (0 .. 1)
import * as THREE from 'three/webgpu';
import { attribute, vec3, vec2, float, select } from 'three/tsl';

export const FRAME_PX = 112;
// the frames a side and the frame size: High's 6 x 112 px (a larger atlas than the first 5 x 96); a
// quality tier passes its own to the bake (src/trees.js: tier.forest.frames, framePx), and the shader reads the bake's
export const IMPOSTOR = Object.freeze({ framePx: FRAME_PX, frames: 6 });
export const FRAMES = IMPOSTOR.frames;

// a unit direction with y ≥ 0 → [u, v] in 0 .. 1 (the hemi-octahedron unfolded, the horizon on the square's edge)
export function octEncode(x, y, z) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1, px = x / s, pz = z / s;
  return [(px + pz) * 0.5 + 0.5, (px - pz) * 0.5 + 0.5];
}
export function octDecode(u, v) {
  const a = u * 2 - 1, b = v * 2 - 1, px = (a + b) / 2, pz = (a - b) / 2, py = 1 - Math.abs(px) - Math.abs(pz);
  const l = Math.hypot(px, py, pz) || 1;
  return [px / l, py / l, pz / l];
}
// the frame's own basis: right, up for a view direction d (the camera sits along d looking at −d)
export function frameBasis(d) {
  const [dx, dy, dz] = d;
  let ux, uy, uz;
  if (Math.abs(dy) > 0.999) { ux = 0; uy = 0; uz = -1; }                              // straight down: up = north
  else { ux = -dx * dy; uy = 1 - dy * dy; uz = -dz * dy; const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l; }
  const rx = uy * dz - uz * dy, ry = uz * dx - ux * dz, rz = ux * dy - uy * dx;        // right = up × d
  return { right: [rx, ry, rz], up: [ux, uy, uz] };
}

// bake: a grid of tiles (one per variant), FRAMES × FRAMES frames each; the atlas is as square as it gets
export async function bakeImpostors(renderer, variants, { atlas, clearColor = 0x2a4a33, frames = IMPOSTOR.frames, framePx = IMPOSTOR.framePx } = {}) {
  const FRAMES = frames, FRAME_PX_ = framePx, TILE_PX_ = FRAMES * FRAME_PX_;
  const n = variants.length, cols = Math.ceil(Math.sqrt(n * 2)), rows = Math.ceil(n / cols);   // a wide atlas: 8 x 4 tiles for 32 variants (the squarest grid wastes a row)
  const W = cols * TILE_PX_, H = rows * TILE_PX_;
  await renderer.init();
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, W, H, 0, -4, 4);
  cam.position.set(0, 0, 2); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  // the two materials: albedo × AO (gamma-encoded into 8 bits) and the raw object normal + the depth along the view
  const alb = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const tex = attribute('uv', 'vec2'), ex = attribute('extra', 'vec4'), bk = attribute('bark', 'vec4');
  const sampleCard = (uvN) => atlas.sample(uvN, ex, bk);
  {
    const c = sampleCard(tex);
    alb.colorNode = c.rgb.mul(ex.x.mul(0.65).add(0.35)).pow(1 / 2.2);   // the crown's baked AO, softened: a far stand reads as one mass, not as black holes
    alb.opacityNode = c.a;
    alb.alphaTest = 0.25;   // a 30 m tree is 96 px here: the cards minify to their coverage, so keep the thin needles
  }
  const nrm = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  {
    const c = sampleCard(tex);
    const nLocal = attribute('normal', 'vec3');                 // the geometry's normal, before the instance rotation
    nrm.colorNode = vec3(nLocal.mul(0.5).add(0.5));
    nrm.opacityNode = c.a;
    nrm.alphaTest = 0.25;
  }
  const meshes = [];
  const m = new THREE.Matrix4(), rot = new THREE.Matrix4();
  variants.forEach((v, vi) => {
    const tx = (vi % cols) * TILE_PX_, ty = Math.floor(vi / cols) * TILE_PX_;
    const mk = (mat) => {
      const im = new THREE.InstancedMesh(v.geometry, mat, FRAMES * FRAMES);
      im.frustumCulled = false;
      for (let fy = 0; fy < FRAMES; fy++) for (let fx = 0; fx < FRAMES; fx++) {
        const d = octDecode(fx / (FRAMES - 1), fy / (FRAMES - 1)), { right, up } = frameBasis(d);
        // M = rows (right, up, d): local → frame space; then scale to the frame, centre the tree's middle in the cell
        rot.set(right[0], right[1], right[2], 0, up[0], up[1], up[2], 0, d[0], d[1], d[2], 0, 0, 0, 0, 1);
        const s = FRAME_PX_ * 0.98;
        m.identity().makeTranslation(tx + (fx + 0.5) * FRAME_PX_, ty + (fy + 0.5) * FRAME_PX_, 0).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(0, -0.5, 0));
        im.setMatrixAt(fy * FRAMES + fx, m);
      }
      im.instanceMatrix.needsUpdate = true;
      return im;
    };
    meshes.push([mk(alb), mk(nrm)]);
  });
  const targets = [];
  const mrtWas = renderer.getMRT();
  renderer.setMRT(null);
  const clearWas = new THREE.Color(); renderer.getClearColor(clearWas); const alphaWas = renderer.getClearAlpha();
  // one depth buffer for both passes, freed once they are drawn: the atlases are sampled, never drawn into again
  // (two 2880² depth24 targets were 63 MB of GPU memory kept for nothing)
  const depth = new THREE.DepthTexture(W, H);
  for (const pass of [0, 1]) {
    const rt = new THREE.RenderTarget(W, H, { depthBuffer: true, depthTexture: depth, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.generateMipmaps = true;
    rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    scene.clear();
    for (const pair of meshes) scene.add(pair[pass]);
    renderer.setClearColor(pass === 0 ? clearColor : 0x8080ff, 0);
    renderer.setRenderTarget(rt);
    renderer.clear();   // the renderer is initialised at boot: the Async forms only awaited init() first
    renderer.render(scene, cam);
    targets.push(rt);
  }
  renderer.setRenderTarget(null);
  depth.dispose();
  renderer.setClearColor(clearWas, alphaWas);
  renderer.setMRT(mrtWas);
  const tileSize = [TILE_PX_ / W, TILE_PX_ / H];
  return {
    albedo: targets[0].texture, normal: targets[1].texture, cols, rows, W, H, tileSize,
    tile: (i) => [(i % cols) * TILE_PX_ / W, Math.floor(i / cols) * TILE_PX_ / H],
    framePx: FRAME_PX_, frames: FRAMES,
    dispose() { for (const t of targets) t.dispose(); },
  };
}

// TSL: the three frames round a local view direction and their weights (nodes; plain function, not a Fn)
export function octFrames(vLocal, frames = FRAMES) {
  const v = vLocal;
  const s = v.x.abs().add(v.y.abs()).add(v.z.abs()).max(1e-5);
  const px = v.x.div(s), pz = v.z.div(s);
  const enc = vec2(px.add(pz).mul(0.5).add(0.5), px.sub(pz).mul(0.5).add(0.5)).clamp(0, 0.99999);
  const g = enc.mul(frames - 1), cell = g.floor(), f = g.fract();
  const lower = f.x.add(f.y).lessThan(1);
  const a = select(lower, cell, cell.add(1));
  const b = cell.add(vec2(1, 0)), c = cell.add(vec2(0, 1));
  const wa = select(lower, float(1).sub(f.x).sub(f.y), f.x.add(f.y).sub(1));
  const wb = select(lower, f.x, float(1).sub(f.y));
  const wc = select(lower, f.y, float(1).sub(f.x));
  return { a, b, c, wa, wb, wc };
}

// the card is a convex hull of the conifer silhouette, not a square: its bottom corners (the bare trunk) and top corners (the
// spire) are cut, ~12 % fewer shaded pixels, and the corners that remain still hold the widest crown ([27])
export const HULL = [[-0.2, -0.5], [0.2, -0.5], [0.5, -0.3], [0.5, 0.3], [0.3, 0.45], [0.1, 0.5], [-0.1, 0.5], [-0.3, 0.45], [-0.5, 0.3], [-0.5, -0.3]];
export function impostorQuad() {
  const g = new THREE.InstancedBufferGeometry();
  const P = [0, 0, 0], N = [0, 0, 1], U = [0.5, 0.5], idx = [];
  for (const [x, y] of HULL) { P.push(x, y, 0); N.push(0, 0, 1); U.push(x + 0.5, y + 0.5); }
  for (let i = 0; i < HULL.length; i++) idx.push(0, 1 + i, 1 + (i + 1) % HULL.length);   // a fan from the middle (the hull is convex)
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e6, -1e6, -1e6), new THREE.Vector3(1e6, 1e6, 1e6));
  return g;
}
