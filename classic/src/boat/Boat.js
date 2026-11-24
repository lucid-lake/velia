// The boat assembly: a root that follows the physics (position, heading, heel, pitch, heave) and named sockets where
// the modules attach. Until a module's GLB or builder lands, a placeholder stands in at
// its socket, with the real dimensions of a ≈30 ft sloop. Moving parts are driven from the physics state each frame.
import * as THREE from 'three/webgpu';
import { DEFAULT_DIMS } from '../../../src/sim/boat/dims.js';
import { applyCanvas } from './canvas.js';

// Dimensions come from ./dims.js (the one source: the boat profile's, vesselDims(vessel)). dimOf keeps the old names for
// the placeholders; DIM is this page's boat's.
const dimOf = ({ HULL, RIG }) => ({
  loa: HULL.loa, lwl: HULL.lwl, beam: HULL.beam, freeboard: HULL.freeboard, draft: HULL.draft,
  mastStep: HULL.mastStepZ, mastHeight: RIG.mastTop, boomHeight: RIG.gooseneck, boomLength: RIG.boom,
  forestayBow: HULL.stemZ, rudderZ: HULL.rudderZ, wheelZ: HULL.wheelZ,
});
export const DIM = dimOf(DEFAULT_DIMS);

// Socket names the modules attach to; every module GLB names its root after its socket.
const SOCKETS = ['hull', 'keel', 'rudder', 'cockpit', 'wheel', 'mast', 'boom', 'main', 'jib', 'rigging', 'lines', 'hardware', 'details',
  'anchor', 'exhaust', 'prop', 'throttle'];

function placeholder(name, dims) {
  const DIM = dimOf(dims), { RIG } = dims;
  const m = (c, o = {}) => new THREE.MeshStandardNodeMaterial({ color: c, roughness: 0.6, ...o });
  const g = new THREE.Group(); g.name = `${name}-placeholder`;
  const add = (geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) => { const mesh = new THREE.Mesh(geo, mat); mesh.position.set(...pos); mesh.rotation.set(...rot); g.add(mesh); return mesh; };
  switch (name) {
    case 'hull': {
      // a tapered box hull: wide aft, a pointed bow (−z)
      const shape = new THREE.Shape();
      shape.moveTo(0, -DIM.loa / 2); shape.quadraticCurveTo(DIM.beam * 0.55, -DIM.loa * 0.15, DIM.beam / 2 * 0.92, DIM.loa / 2);
      shape.lineTo(-DIM.beam / 2 * 0.92, DIM.loa / 2); shape.quadraticCurveTo(-DIM.beam * 0.55, -DIM.loa * 0.15, 0, -DIM.loa / 2);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: DIM.freeboard + 0.4, bevelEnabled: false });
      geo.rotateX(Math.PI / 2); geo.translate(0, DIM.freeboard, 0);
      add(geo, m(0xf2efe8, { roughness: 0.35 }));
      add(new THREE.BoxGeometry(1.7, 0.45, 2.8), m(0xece8de), [0, DIM.freeboard + 0.22, -0.2]);   // cabin trunk
      break;
    }
    case 'keel': add(new THREE.BoxGeometry(0.12, DIM.draft, 1.0), m(0x2a2a2a), [0, -DIM.draft / 2 - 0.3, -0.3]); break;
    case 'rudder': add(new THREE.BoxGeometry(0.06, 1.0, 0.45), m(0x2a2a2a), [0, -0.6, 0.2]); break;
    case 'cockpit': add(new THREE.BoxGeometry(1.5, 0.05, 2.2), m(0x9c7a52), [0, DIM.freeboard + 0.02, 2.5]); break;
    case 'wheel': add(new THREE.TorusGeometry(0.4, 0.025, 8, 32), m(0xb8bcc0, { metalness: 1, roughness: 0.25 }), [0, 0.6, 0]); break;
    case 'mast': add(new THREE.CylinderGeometry(0.07, 0.09, DIM.mastHeight, 12), m(0xcfd3d6, { metalness: 0.8, roughness: 0.3 }), [0, DIM.mastHeight / 2, 0]); break;
    case 'boom': add(new THREE.CylinderGeometry(0.06, 0.06, DIM.boomLength, 10), m(0xcfd3d6, { metalness: 0.8, roughness: 0.3 }), [0, 0, DIM.boomLength / 2], [Math.PI / 2, 0, 0]); break;
    case 'main': {
      // a triangle from the gooseneck up the mast and out to the boom end; the sail module replaces this
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, RIG.gooseneck, 0, 0, RIG.gooseneck + RIG.mainLuff, 0, 0, RIG.gooseneck, RIG.boom], 3));
      geo.computeVertexNormals();
      add(geo, m(0xf4efe2, { side: THREE.DoubleSide, roughness: 0.8 }));
      break;
    }
    case 'jib': {
      const geo = new THREE.BufferGeometry();
      // tack at the forestay fitting, head 85 % up the forestay, clew aft by the mast
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...RIG.tack, ...RIG.head, 0, 0.9, -0.3], 3));
      geo.computeVertexNormals();
      add(geo, m(0xf4efe2, { side: THREE.DoubleSide, roughness: 0.8 }));
      break;
    }
    // feat/engine-anchor: simple stand-ins at real sizes until hardware.glb's anchor and the cockpit's lever land
    case 'anchor': {   // a 7 kg plough stowed on the roller: shank forward and down, the blade under it
      const steel = m(0x8c9196, { metalness: 0.9, roughness: 0.35 });
      add(new THREE.BoxGeometry(0.035, 0.035, 0.46), steel, [0, -0.06, -0.2], [0.35, 0, 0]);
      add(new THREE.ConeGeometry(0.12, 0.22, 3), steel, [0, -0.17, -0.46], [Math.PI / 2 + 0.35, 0, 0]);
      break;
    }
    case 'prop': {     // a 13 in two-blade
      const bronze = m(0x9a7b4f, { metalness: 0.9, roughness: 0.4 });
      add(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 10), bronze, [0, 0, 0], [Math.PI / 2, 0, 0]);
      for (const s of [1, -1]) add(new THREE.BoxGeometry(0.07, 0.16, 0.012), bronze, [0, s * 0.09, 0], [0, 0, s * 0.35]);
      break;
    }
    case 'throttle': { // the lever on its pod
      add(new THREE.BoxGeometry(0.06, 0.12, 0.1), m(0x26292b), [0, 0, 0]);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8), m(0xb8bcc0, { metalness: 1, roughness: 0.25 }), [0.03, 0.09, 0]);
      add(new THREE.SphereGeometry(0.02, 10, 8), m(0x1d1f20), [0.03, 0.17, 0]);
      break;
    }
    default: break;   // rigging, lines, hardware, details, exhaust: no placeholder
  }
  return g;
}

export class Boat extends THREE.Group {
  // dims: the boat's (src/boat/dims.js vesselDims(vessel); this page's boat by default): its sockets and placeholders
  constructor({ dims = DEFAULT_DIMS } = {}) {
    super();
    this.name = 'boat';
    this.dims = dims;
    const DIM = dimOf(dims), { HULL } = dims;
    this.heelPivot = new THREE.Group();            // rolls and pitches about the waterline centre
    this.add(this.heelPivot);
    this.sockets = {};
    const S = (name, parent, pos) => { const s = new THREE.Group(); s.name = `socket:${name}`; s.position.set(...pos); parent.add(s); this.sockets[name] = s; return s; };
    S('hull', this.heelPivot, [0, 0, 0]);
    S('keel', this.heelPivot, [0, 0, 0]);
    S('rudder', this.heelPivot, [0, 0, DIM.rudderZ]);
    S('cockpit', this.heelPivot, [0, 0, 0]);
    S('wheel', this.heelPivot, [0, DIM.freeboard, DIM.wheelZ]);
    const mast = S('mast', this.heelPivot, [0, HULL.mastStepY, DIM.mastStep]);   // the RIG frame origin (dims.js)
    S('boom', mast, [0, DIM.boomHeight, 0.12]);
    S('main', mast, [0, 0, 0]);   // rig frame: a0's sails place themselves from the state (sheet angles inside)
    // The RIG frame (dims.js) is the mast socket: rigging, lines and the jib mount there; the jib's own origin is at
    // the tack, so its socket sits at RIG.tack.
    S('jib', mast, [0, 0, 0]);    // rig frame too: the jib's tack is RIG.tack inside the module
    S('rigging', mast, [0, 0, 0]);
    S('lines', mast, [0, 0, 0]);
    S('hardware', this.heelPivot, [0, DIM.freeboard, 0]);
    S('details', mast, [0, 0, 0]);   // burgee, telltales, nav lights: rig frame (f4's M9)
    // the engine and the anchor (hero hull; for the features engineer), HULL frame:
    // anchor: the stowed anchor's shackle (hardware.glb's "anchor" node moves here at load; lower the socket to drop it),
    //   its roller axle is HULL.anchorRoller; exhaust: the outlet on the starboard quarter, +x out, +z aft;
    // prop: the propeller hub, the shaft rising forward at HULL.propShaftDeg (the socket is tilted to the shaft line)
    S('anchor', this.heelPivot, HULL.anchorPin);
    S('exhaust', this.heelPivot, HULL.exhaust);
    S('prop', this.heelPivot, HULL.prop).rotation.x = -HULL.propShaftDeg * Math.PI / 180;
    S('throttle', this.heelPivot, HULL.throttle);   // feat/engine-anchor: the lever (rotates about x with it)
    this.modules = {};
    this.afterUpdate = [];   // fn(state, dt, env) after the parts move each frame (src/boat/boatShadow.js: the light box follows the hull)
    for (const n of SOCKETS) this.attach(n, placeholder(n, dims));
  }

  // Attach a module (a three.js Object3D, e.g. a loaded GLB scene or a procedural builder's group) at its socket,
  // replacing the placeholder. A module may expose update(state, dt, env) for its own moving parts.
  attach(name, object) {
    const s = this.sockets[name];
    if (!s) throw new Error(`no socket ${name}`);
    if (this.modules[name]) s.remove(this.modules[name]);
    this.modules[name] = object;
    s.add(object);
    if (name === 'cockpit') applyCanvas(object);    // ?canvas=a|b|c: the dodger's colour variant (canvas.json)
  }

  // A module's own per-frame update(state, dt, env) (the rig, the cockpit, the details, the hardware: src/craft/sloop/):
  // set on the module attached at that socket now (a later attach there replaces the module and its update)
  setUpdate(name, fn) {
    const m = this.modules[name];
    if (!m) throw new Error(`no module at ${name}`);
    m.update = fn;
    return m;
  }

  // Drive the root and the moving parts from the physics state (src/boat/contract.js STATE).
  update(state, dt = 0, env = {}) {
    this.position.set(state.x, state.heave, state.z);
    this.rotation.set(0, -state.heading, 0);                // heading clockwise from north; three's +y rotation is counter-clockwise
    this.heelPivot.rotation.set(state.pitch, 0, -state.heel); // + heel to starboard (+x) is a negative roll about −z-forward
    this.sockets.rudder.rotation.y = -state.rudderAngle;
    // the helmsman stands aft (+z) facing forward (−z), starboard (+x) on the right: to starboard the wheel turns CLOCKWISE as he sees it
    // (its top to the right), a negative turn about +z (it was positive: the wheel turned the wrong way, 2026-10-30; tests/helmStation.test.mjs)
    this.sockets.wheel.rotation.z = -state.rudderAngle * 4;
    // feat/engine-anchor: the prop turns with the shaft (2.1 : 1), the lever leans with the throttle (forward for ahead)
    if (this.modules.prop) this.modules.prop.rotation.z += (state.engineRpm ?? 0) / 2.1 / 60 * 2 * Math.PI * dt * Math.sign(state.engineGear ?? 0);
    this.sockets.throttle.rotation.x = -(state.throttle ?? 0) * 0.7;
    this.sockets.boom.rotation.y = state.boomAngle;   // three: +y rotation swings the aft-pointing boom (+z) toward +x = starboard (a0's catch)
    for (const [n, a] of [['main', state.boomAngle], ['jib', state.jibAngle]]) {
      const m = this.modules[n]; if (m?.name?.endsWith('-placeholder')) m.rotation.y = a;   // real sails shape themselves
    }
    for (const m of Object.values(this.modules)) m.update?.(state, dt, env);
    for (const f of this.afterUpdate) f(state, dt, env);
  }
}
