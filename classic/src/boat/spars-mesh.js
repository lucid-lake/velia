// Lakeshore boat M4 on screen: the spars and the standing rig as three.js meshes (geometry from src/boat/spars.js).
//
//   import { createRigging } from './boat/spars-mesh.js';
//   const rigging = createRigging();             // a Group named 'rigging', in the RIG frame (origin at the mast step)
//   boat.sockets.mast.add(rigging.group);         // or Boat.attach('rigging', rigging.group)
//   rigging.update(state);                        // state.boomAngle (rad, + = to starboard); boomTilt optional
//   rigging.setLight({ sunDir, sunColor, skyColor });   // the wires' own shading (world frame, scene luminance)
//
// Nodes: rigging › mast (static: extrusion, spreaders, fittings, rigging screws, the furler's fixed parts), wires
// (ribbons), boom (pivot at the gooseneck pin; boom › boom-spar: extrusion, fittings, blocks, vang, lazy bag), wind-vane,
// furler-drum (a socket: turn it about its +y). Five draw calls. Fittings: src/boat/spars-detail.js.
//
// Wires: a stainless 1×19 wire is 6–8 mm across, ≈ 0.15 px at the game camera (45 m, FOV 40, 720 px), so a plain
// tube flickers in and out. Each span is a camera-facing ribbon held at ≥ `minPx` pixels wide and faded by its true
// coverage (the "phone-wire AA" trick, Persson 2011), shaded as a thin cylinder (Kajiya–Kay 1989): the long
// highlight that runs down a lit wire is the "real boat" cue the art bible asks for.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, varying, vec3, vec4, float, uniform, normalize, cross, dot, max, min, sqrt, pow, abs, mix, clamp, sin,
  smoothstep, modelWorldMatrix, cameraViewMatrix, cameraProjectionMatrix, cameraPosition, screenSize, positionLocal,
  normalLocal, transformNormalToView,
} from 'three/tsl';
import { sparsFor, solveRig, buildSpars, wireArrays } from '../../../src/boat/spars.js';
import { DEFAULT_DIMS } from '../../../src/sim/boat/dims.js';
import { VaneDamper, mastheadWind } from './vane.js';

function toGeometry(md) {
  const a = md.arrays();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.setAttribute('mr', new THREE.BufferAttribute(a.mr, 2));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  return g;
}

// One PBR material for every solid part: albedo, metalness and roughness per vertex. `clay` greys it for the clay pass.
function solidMaterial({ clay = false, bounce = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const mr = attribute('mr', 'vec2');
  m.colorNode = clay ? vec3(0.5) : attribute('color', 'vec3');
  m.metalnessNode = clay ? float(0) : mr.x;
  m.roughnessNode = clay ? float(0.8) : mr.y;
  // the lazy bag's canvas (roughness 0.85, the only part that rough): soft vertical folds along the boom and a fine
  // weave, tilting its normal along the boom (local z); every other part keeps its normal
  const isCanvas = smoothstep(0.84, 0.86, mr.y);
  const z = positionLocal.z;
  const fold = sin(z.mul(41.0).add(sin(z.mul(6.3)).mul(2.2))).mul(0.20).add(sin(z.mul(113.0).add(z.mul(z))).mul(0.07));
  const weave = sin(positionLocal.y.mul(2600.0)).mul(sin(z.mul(2600.0))).mul(0.05);
  m.normalNode = transformNormalToView(normalize(normalLocal.add(vec3(0, 0, fold.add(weave).mul(isCanvas)))));
  // and the light the sails and the deck bounce onto the bag's shaded underside (the scene has no bounce light: from
  // the helm it read as a flat grey patch under the main): the albedo × a warm bounce, in the wires' light units
  if (bounce && !clay) m.emissiveNode = attribute('color', 'vec3').mul(bounce).mul(isCanvas);
  return m;
}

// The vane's own material (only the vane and its tabs use it): physical, vertex-coloured. Metals (metalness 1) are the satin
// aluminium and the stainless: a satin sheen along the arm. The plastics get a clear coat (moulded ABS or
// polycarbonate), and the red ones (roughness 0.38) a faint translucency: the albedo's own colour, a few per cent, as light
// through a thin moulding; never a glow.
function vaneMaterial({ clay = false } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const mr = attribute('mr', 'vec2'), col = attribute('color', 'vec3');
  m.colorNode = clay ? vec3(0.5) : col;
  m.metalnessNode = clay ? float(0) : mr.x;
  m.roughnessNode = clay ? float(0.8) : mr.y;
  m.clearcoatNode = float(1).sub(mr.x).mul(0.55);
  m.clearcoatRoughnessNode = float(0.16);
  // no anisotropy: with it the satin aluminium blew out to flat white (checked 2026-10-30); the sheen is the roughness 0.48 alone
  const red = smoothstep(0.365, 0.372, mr.y).mul(float(1).sub(smoothstep(0.388, 0.395, mr.y))).mul(float(1).sub(mr.x));
  if (!clay) m.emissiveNode = col.mul(red).mul(0.05);
  return m;
}

function wireMaterial({ minPx = 1.0, clay = false } = {}) {
  const u = {
    sunDir: uniform(new THREE.Vector3(0.3, 0.5, -0.8).normalize()),
    sunColor: uniform(new THREE.Color(3.0, 2.8, 2.5)),
    skyColor: uniform(new THREE.Color(0.35, 0.45, 0.6)),
    minPx: uniform(minPx),
  };
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const pos = attribute('position', 'vec3'), tan = attribute('wireTangent', 'vec3');
  const side = attribute('wireSide', 'float'), rad = attribute('wireRadius', 'float');
  const world = modelWorldMatrix.mul(vec4(pos, 1)).xyz;
  const T = normalize(modelWorldMatrix.mul(vec4(tan, 0)).xyz);
  const V = normalize(cameraPosition.sub(world));
  const depth = cameraViewMatrix.mul(vec4(world, 1)).z.negate();
  const pxWorld = depth.mul(2).div(cameraProjectionMatrix.element(1).y.mul(screenSize.y));   // one pixel at that depth, m
  const width = max(rad.mul(2), pxWorld.mul(u.minPx));
  const across = normalize(cross(T, V));
  m.vertexNode = Fn(() => {
    const p = world.add(across.mul(side.mul(width.mul(0.5))));
    return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));
  })();
  const vCov = varying(clamp(rad.mul(2).div(width), 0, 1));
  const vT = varying(T), vAcross = varying(across), vSide = varying(side), vWorld = varying(world);
  const albedo = clay ? vec3(0.5) : varying(attribute('color', 'vec3'));
  m.colorNode = Fn(() => {
    const t = normalize(vT), L = normalize(u.sunDir);
    const Vf = normalize(cameraPosition.sub(vWorld));
    const s = clamp(vSide, -1, 1);
    // across a wide (close-up) ribbon, a cylinder's normal; on a thin one this averages out
    const N = normalize(vAcross.mul(s).add(Vf.mul(sqrt(max(float(1).sub(s.mul(s)), 0.0)))));
    const tl = dot(t, L), th = dot(t, normalize(L.add(Vf)));
    const kkDiffuse = sqrt(max(float(1).sub(tl.mul(tl)), 0.0)).mul(max(dot(N, L).mul(0.5).add(0.5), 0.0));
    const kkSpec = pow(sqrt(max(float(1).sub(th.mul(th)), 0.0)), 90.0);
    const sky = mix(u.skyColor.mul(0.35), u.skyColor, N.y.mul(0.5).add(0.5));   // a metal mostly mirrors the sky
    return albedo.mul(sky.mul(0.9).add(u.sunColor.mul(kkDiffuse.mul(0.15)))).add(u.sunColor.mul(albedo).mul(kkSpec.mul(1.6)));
  })();
  m.opacityNode = vCov.mul(float(1).sub(smoothstep(0.8, 1.0, abs(vSide)).mul(0.5)));
  return { material: m, uniforms: u };
}

function wireGeometry(wires) {
  const a = wireArrays(wires);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('wireTangent', new THREE.BufferAttribute(a.tangent, 3));
  g.setAttribute('wireSide', new THREE.BufferAttribute(a.side, 1));
  g.setAttribute('wireRadius', new THREE.BufferAttribute(a.radius, 1));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 0.5;   // the ribbons widen in the vertex shader
  return g;
}

// dims: the boat's (src/boat/dims.js; this page's boat by default): its spars
export function createRigging({ dims = DEFAULT_DIMS, spars = sparsFor(dims), clay = false, minPx = 1.0 } = {}) {
  const rig = solveRig(spars);
  const geo = buildSpars(rig);
  const group = new THREE.Group(); group.name = 'rigging';
  const bounce = uniform(new THREE.Color(0.30, 0.27, 0.23));
  const solid = solidMaterial({ clay, bounce });
  const mast = new THREE.Mesh(toGeometry(geo.mast), solid); mast.name = 'mast';
  const boom = new THREE.Group(); boom.name = 'boom';
  boom.position.set(...rig.points.gooseneck);
  const boomSpar = new THREE.Mesh(toGeometry(geo.boom), solid); boomSpar.name = 'boom-spar';
  boom.add(boomSpar);
  const wm = wireMaterial({ minPx, clay });
  const wires = new THREE.Mesh(wireGeometry(geo.wires), wm.material); wires.name = 'wires';
  wires.renderOrder = 2;
  // the wind vane at the masthead (turned to the apparent wind) and the furler's drum: a socket the features engineer
  // turns about its local +y (the stay) as the furling line pays out (furlerDrum.userData.turn(rad))
  const vaneMat = vaneMaterial({ clay });
  const vane = new THREE.Mesh(toGeometry(geo.vane), vaneMat); vane.name = 'wind-vane';
  vane.position.set(...geo.vaneAt);
  const vaneTabs = new THREE.Mesh(toGeometry(geo.vaneTabs), vaneMat); vaneTabs.name = 'wind-vane-tabs';   // fixed: the two reference tabs
  vaneTabs.position.set(...geo.vaneAt);
  const furlerDrum = new THREE.Group(); furlerDrum.name = 'furler-drum';
  furlerDrum.position.set(...geo.furler.at);
  furlerDrum.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...geo.furler.axis));
  const drumMesh = new THREE.Mesh(toGeometry(geo.furler.drum), solid); drumMesh.name = 'furler-drum-mesh';
  furlerDrum.add(drumMesh);
  furlerDrum.userData.turn = (rad) => { drumMesh.rotation.y = rad; };
  group.add(mast, boom, wires, vane, vaneTabs, furlerDrum);
  const triangles = geo.mast.triangleCount + geo.boom.triangleCount + geo.wires.length * 2 + geo.vane.triangleCount + geo.vaneTabs.triangleCount + geo.furler.drum.triangleCount;
  const damper = new VaneDamper();

  function update(state = {}, dt = 1 / 60) {
    // the vane points into the apparent wind AT THE MASTHEAD (vane.js), a damped spring: brisker in more wind
    const vaneYaw = damper.step(dt, mastheadWind(state));
    vane.rotation.y = vaneYaw;
    boom.rotation.set(0, 0, 0);
    boom.rotateY(state.boomAngle ?? 0);           // + swings the boom end (+z) toward +x, starboard
    boom.rotateX(state.boomTilt ?? 0);            // + lifts the boom end
  }
  // the colours as last set: D2's per-frame level scales from these (the wires are unlit: their light is ours)
  const lightBase = { sun: wm.uniforms.sunColor.value.clone(), sky: wm.uniforms.skyColor.value.clone() };
  const BOUNCE = { sun: 0.08, sky: 0.18 };   // the bag's bounce: shares of the sun and the sky (the sails above, the deck)
  const setBounce = (sun, sky) => bounce.value.copy(sun).multiplyScalar(BOUNCE.sun).add(sky.clone().multiplyScalar(BOUNCE.sky));
  function setLight({ sunDir, sunColor, skyColor } = {}) {
    if (sunDir) wm.uniforms.sunDir.value.copy(sunDir).normalize();
    if (sunColor) { wm.uniforms.sunColor.value.copy(sunColor); lightBase.sun.copy(sunColor); }
    if (skyColor) { wm.uniforms.skyColor.value.copy(skyColor); lightBase.sky.copy(skyColor); }
    setBounce(wm.uniforms.sunColor.value, wm.uniforms.skyColor.value);
  }
  // D2 (time of day): sunDir per frame; sun: the sun's share (0 below the horizon); light: the level (1 by day)
  function setDaylight({ sunDir = null, sun = 1, light = 1 } = {}) {
    if (sunDir) wm.uniforms.sunDir.value.set(sunDir.x, sunDir.y, sunDir.z).normalize();
    wm.uniforms.sunColor.value.copy(lightBase.sun).multiplyScalar(sun * light);
    wm.uniforms.skyColor.value.copy(lightBase.sky).multiplyScalar(light);
    setBounce(wm.uniforms.sunColor.value, wm.uniforms.skyColor.value);
  }
  group.userData.daylight = (f) => setDaylight({ sunDir: f.sunDir, sun: f.sunShare ?? 1, light: f.light });
  return { group, mast, boom, wires, vane, vaneTabs, vaneDamper: damper, furlerDrum, rig, update, setLight, setDaylight, stats: { triangles, drawCalls: 5, spans: geo.wires.length } };
}
