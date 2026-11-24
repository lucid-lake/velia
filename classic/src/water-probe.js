// The water's reflection probe (split from src/water.js, refactor round 2 Phase D; the code is unchanged): the scene
// seen from mid-lake without the water, captured at load, built ahead for later captures, and re-captured as the sun
// moves. The water's shader reads it through its probe lookups; setTexture(t) points them at a new capture.
//   const P = createProbeCapture({ probe, mesh, atmosphere, position: uProbe, setTexture })
//   P.prepare(renderer), P.captureProbe(renderer, scene, camera, { warm }), P.warmProbe(...), P.probeUpdater(renderer, scene)
import * as THREE from 'three/webgpu';
import { waitForLut } from './core/skyGuard.js';
import { span } from './profile.js';

// Each node-material object under `roots` (an object or a list) wears cloneOf(its material); → the undo. An object is
// dressed once even when the roots overlap: the late warm-up's re-probe roots hold the boat twice (the mode's own root and
// the fireworks' warmRoots), and the second visit saved the probe clone as the "original", so the undo left the boat's
// plain-colour materials (the skipper, the life ring) on their probe clones, which three clones without their colour:
// white from ≈ 25 s after ENTER (fix/white-skipper). The undo runs in reverse, so it ends on the true originals.
function wearClones(roots, cloneOf, skip = null) {
  const swapped = [], seen = new Set();
  const visit = (o) => {
    if (o === skip || seen.has(o) || !o.material || Array.isArray(o.material) || !o.material.isNodeMaterial) return;
    seen.add(o);
    swapped.push([o, o.material]); o.material = cloneOf(o.material);
  };
  for (const r of [roots].flat()) r?.traverse?.(visit);
  return () => { for (let i = swapped.length - 1; i >= 0; i--) swapped[i][0].material = swapped[i][1]; };
}

export function createProbeCapture({ probe, mesh, atmosphere = null, position, setTexture }) {
  const uProbe = position;
  let probeRT = null, cubeCam = null;
  const probeClones = new WeakMap();
  // a capture's clone without three's JSON copy of userData: Material.copy() stringifies it, and the ground's (its
  // texture handles, src/terrain-mesh.js userData.ground) warned "Unable to serialize Texture" x2 at load and came out
  // as junk; the clone shares the original's entries instead. Nothing draws from userData.
  const probeClone = (m) => {
    const ud = m.userData; m.userData = {};
    try { const c = m.clone(); c.userData = { ...ud }; return c; } finally { m.userData = ud; }
  };

  // The probe: await captureProbe(renderer, scene, camera) once the scene is built, before the first frame (again if
  // the light changes, e.g. a new hour). ≈ 6 scene renders at 256² plus the prefilter, at load. prepare() makes a
  // placeholder (an empty scene's PMREM) so the water can never bind a missing texture.
  async function prepare(renderer) {
    if (!probe || probeRT) return;
    const gen = new THREE.PMREMGenerator(renderer);
    probeRT = gen.fromScene(new THREE.Scene(), 0, 1, 10, { size: probe.size });   // the renderer is initialised at boot (fromSceneAsync only awaited init() first)
    setTexture(probeRT.texture);
    gen.dispose();
  }
  // objects that stay out of the probe (userData.probe === false: the fireworks' stars and smoke, which draw only into the
  // scene pass's own 'fireworks' target: with no MRT their shader has no output, a WGSL error; fireworks S5): hidden for
  // the capture and its warm-up; → the undo
  const hideOutOfProbe = (scene) => {
    const hid = [];
    scene.traverse((o) => { if (o.userData?.probe === false && o.visible) { o.visible = false; hid.push(o); } });
    return () => { for (const o of hid) o.visible = true; };
  };
  // warm(cubeCamera, target): perf/shader-warmup (src/core/warmup.js): builds a face's pipelines before it is drawn
  // at: [x, z] (M6): the probe stands there (at its own height) for this capture and after
  async function captureProbe(renderer, scene, camera = null, { warm = null, at = null } = {}) {
    if (!probe) return;
    if (at) { uProbe.value.set(at[0], uProbe.value.y, at[1]); cubeCam?.position.copy(uProbe.value); }
    const endProbe = span('water:probe');
    await prepare(renderer);
    const was = mesh.visible, env = scene.environmentNode;
    mesh.visible = false;
    // with an atmosphere, its scattering LUTs build asynchronously from the first render that uses them: one plain
    // render starts them, then wait (as src/main.js does), so the probe's sky isn't black
    const lut = atmosphere?.lutNode;
    if (lut && camera) {
      scene.environmentNode = null;
      const endFirst = span('water:probe first render');
      // the core's shader warm-up already started the build (its sky object's updateBefore): no plain frame needed
      if (lut.currentVersion === undefined) renderer.render(scene, camera);
      endFirst(); const endLut = span('water:probe lut wait');
      await waitForLut(lut, { hidden: () => globalThis.document?.visibilityState === 'hidden' });   // at most 12 s of visible time (src/core/skyGuard.js); a failed build gives the plain sky there
      endLut();
    }
    // the sky's own environment map is a PMREM too: rendering it inside this prefilter nests two PMREM renders that
    // share three's module state, and the sky model went black for the whole page; the probe's faces don't need it
    scene.environmentNode = null;
    // no sun disc in the probe: the analytic glint is the sun's reflection; the probe's (misplaced by the parallax
    // correction, as the sun is at infinity) showed as a second, square sun on the water
    const sky = scene.backgroundNode, hadSun = sky?.showSun;
    if (hadSun !== undefined) sky.showSun = false;
    // no MRT on the cube's single target (defensive: the scene pass sets one while it renders)
    const mrtWas = renderer.getMRT();
    renderer.setMRT(null);
    // a CubeCamera renders the six faces (three's own path for scene captures), then the generator prefilters them
    if (!cubeCam) {
      const crt = new THREE.CubeRenderTarget(probe.size, { type: THREE.HalfFloatType });
      cubeCam = new THREE.CubeCamera(1, 40000, crt);
      cubeCam.position.copy(uProbe.value);
    }
    // fresh material clones for the capture: a material already compiled for the scene pass (MSAA 4, MRT) drew
    // nothing in the cube (its cached pipeline doesn't fit the target, and is skipped without an error); a plain
    // override material drew fine, so it is the cache, not the geometry. Clones are kept for later captures.
    const swapped = [];
    scene.traverse((o) => {
      if (o === mesh || !o.material || Array.isArray(o.material) || !o.material.isNodeMaterial) return;
      let c = probeClones.get(o.material);
      if (!c) { c = probeClone(o.material); probeClones.set(o.material, c); }
      swapped.push([o, o.material]);
      o.material = c;
    });
    const unhide = hideOutOfProbe(scene);
    if (warm) {
      // CubeCamera.update's own set-up, early: the faces' orientation for this renderer, then each face's pipelines
      if (cubeCam.coordinateSystem !== renderer.coordinateSystem) { cubeCam.coordinateSystem = renderer.coordinateSystem; cubeCam.updateCoordinateSystem(); }
      if (cubeCam.parent === null) cubeCam.updateMatrixWorld();
      for (const c of cubeCam.children) await warm(c, cubeCam.renderTarget);
    }
    const endCube = span('water:probe cube');
    cubeCam.updateMatrixWorld(); cubeCam.update(renderer, scene);
    endCube();
    unhide();
    for (const [o, m] of swapped) o.material = m;
    const gen = new THREE.PMREMGenerator(renderer);
    const rt = gen.fromCubemap(cubeCam.renderTarget.texture, probeRT);
    renderer.setMRT(mrtWas);
    if (hadSun !== undefined) sky.showSun = hadSun;
    scene.environmentNode = env;
    mesh.visible = was;
    probeRT = rt;
    setTexture(rt.texture);
    gen.dispose();
    endProbe();
  }

  // The probe's later captures built ahead (fix/first-visit-hitches): the boat and the mode's objects came after the
  // load's capture, so the first re-capture (the forest complete, ≈ 3 s into play) built ≈ 26 pipelines for them in the
  // cube's target, a face per frame: the camera froze as it swung round the boat. In the capture's own state (the
  // clones, no environment, no sun disc, no MRT, the water hidden), for one face (the pipelines do not depend on the
  // face), everything in the scene; `extra`: roots whose hidden objects may show in a later capture (the mode's boat:
  // its furled sails; the wind lines; the rain). Hidden ones only under these: the whole scene's hidden objects
  // included some whose shader has no output without the scene's MRT (a WGSL error, now and then).
  //   await water.warmProbe(renderer, scene, warm, extra)   warm: (root, camera, opts) → the core's warm-up (src/core/warmup.js)
  //   live: true (perf/ready-first-frame): in play, between live frames. The capture's state is then set only inside each
  //   build's synchronous part (the object's own materials, the water hidden, no environment, no sky: the load's capture
  //   built the probe's sky), and the environment while three builds (src/core/warmup.js liveHooks); never across a frame
  async function warmProbe(renderer, scene, warm, extra = [], { live = false, ...opts } = {}) {
    if (!probe || !cubeCam || !warm) return [];
    if (live) return warmProbeLive(renderer, scene, warm, extra, opts);
    const was = mesh.visible, env = scene.environmentNode, sky = scene.backgroundNode, hadSun = sky?.showSun;
    mesh.visible = false; scene.environmentNode = null;
    if (hadSun !== undefined) sky.showSun = false;
    const swapped = [];
    scene.traverse((o) => {
      if (o === mesh || !o.material || Array.isArray(o.material) || !o.material.isNodeMaterial) return;
      let c = probeClones.get(o.material);
      if (!c) { c = probeClone(o.material); probeClones.set(o.material, c); }
      swapped.push([o, o.material]); o.material = c;
    });
    const out = [], unhide = hideOutOfProbe(scene);
    try {
      // the state stays set until every build has read it (three builds after compileAsync's first await)
      const cam = cubeCam.children[0], target = cubeCam.renderTarget;
      out.push(await warm(scene, cam, { target, mrt: null, cull: false }));
      // the later objects in one call (perf/phone-load: one call each cost two display frames of yields on Safari)
      const more = extra.filter((r) => r && r.userData?.probe !== false);   // (the fireworks' stars stay out: hideOutOfProbe)
      if (more.length) out.push(await warm(more, cam, { target, mrt: null, cull: false, hidden: true }));
    } finally {
      for (const [o, m] of swapped) o.material = m;
      if (hadSun !== undefined) sky.showSun = hadSun;
      scene.environmentNode = env; mesh.visible = was; unhide();
    }
    // the re-capture's prefilter (its own generator, kept): run once on the cube the load captured, so its pipeline is
    // built; it writes the same probe the load made
    try {
      probeGen ??= new THREE.PMREMGenerator(renderer);
      cubeCam.renderTarget.texture.needsPMREMUpdate = true;
      const mrtWas = renderer.getMRT(); renderer.setMRT(null);
      probeRT = probeGen.fromCubemap(cubeCam.renderTarget.texture, probeRT);
      renderer.setMRT(mrtWas);
      setTexture(probeRT.texture);
    } catch { /* the draw builds it */ }
    return out;
  }

  // opts: the warm-up's lanes, slice and priority; only: just the extra roots (a kayak going full), no prefilter
  async function warmProbeLive(renderer, scene, warm, extra, { only = false, ...opts } = {}) {
    // roots: an object, a list or the scene; each object under them wears its probe clone; the out-of-probe objects
    // (anywhere: their lights stay out of the call's light list, as in the capture) hidden
    const outOfProbe = []; scene.traverse((o) => { if (o.userData?.probe === false) outOfProbe.push(o); });
    const sync = (roots) => {
      const was = mesh.visible, env = scene.environmentNode, bg = scene.backgroundNode;
      mesh.visible = false; scene.environmentNode = null; scene.backgroundNode = null;
      const hid = [];
      for (const o of outOfProbe) if (o.visible) { o.visible = false; hid.push(o); }
      const undoClones = wearClones(roots, (m) => {
        let c = probeClones.get(m);
        if (!c) { c = probeClone(m); probeClones.set(m, c); }
        return c;
      }, mesh);
      return () => {
        for (const o of hid) o.visible = true;
        undoClones();
        scene.environmentNode = env; scene.backgroundNode = bg; mesh.visible = was;
      };
    };
    const build = () => { const env = scene.environmentNode; scene.environmentNode = null; return () => { scene.environmentNode = env; }; };
    const out = [], cam = cubeCam.children[0], target = cubeCam.renderTarget;
    if (!only) out.push(await warm(scene, cam, { ...opts, target, mrt: null, cull: false, live: true, around: { sync, build } }));
    const more = extra.filter((r) => r && r.userData?.probe !== false);
    if (more.length) out.push(await warm(more, cam, { ...opts, target, mrt: null, cull: false, hidden: true, live: true, around: { sync, build } }));
    if (only) return out;
    // the re-capture's prefilter, as above (a draw of its own, in this task); not while a re-capture is half done (its
    // own prefilter follows its last face)
    if (activeJob?.busy) return out;
    try {
      probeGen ??= new THREE.PMREMGenerator(renderer);
      cubeCam.renderTarget.texture.needsPMREMUpdate = true;
      const mrtWas = renderer.getMRT(); renderer.setMRT(null);
      probeRT = probeGen.fromCubemap(cubeCam.renderTarget.texture, probeRT);
      renderer.setMRT(mrtWas);
      setTexture(probeRT.texture);
    } catch { /* the draw builds it */ }
    return out;
  }

  // D2: the probe again as the sun moves, spread over frames so no frame takes the whole capture. start() begins one
  // (a newer start() restarts it); step() each frame renders `facesPerStep` cube faces, then prefilters on the frame
  // after the last face. The water keeps reading the previous probe until the new one is filtered, so there is no
  // half-updated frame. Needs one captureProbe() first (it builds the cube camera and the material clones).
  let probeGen = null, activeJob = null;
  function probeUpdater(renderer, scene, { facesPerStep = 1 } = {}) {
    const job = { face: -1, busy: false, lastMs: 0, maxMs: 0, count: 0, held: false, wanted: false, at: null };
    activeJob = job;
    const withCaptureState = (fn) => {
      const was = mesh.visible, env = scene.environmentNode, sky = scene.backgroundNode, hadSun = sky?.showSun;
      mesh.visible = false; scene.environmentNode = null;
      if (hadSun !== undefined) sky.showSun = false;
      const mrtWas = renderer.getMRT(); renderer.setMRT(null);
      const swapped = [];
      scene.traverse((o) => {
        if (o === mesh || !o.material || Array.isArray(o.material) || !o.material.isNodeMaterial) return;
        let c = probeClones.get(o.material);
        if (!c) { c = probeClone(o.material); probeClones.set(o.material, c); }
        swapped.push([o, o.material]); o.material = c;
      });
      const unhide = hideOutOfProbe(scene);
      try { fn(); } finally {
        unhide();
        for (const [o, m] of swapped) o.material = m;
        renderer.setMRT(mrtWas);
        if (hadSun !== undefined) sky.showSun = hadSun;
        scene.environmentNode = env; mesh.visible = was;
      }
    };
    const renderFace = (i) => {
      const rt = cubeCam.renderTarget, cams = cubeCam.children;
      const prevRT = renderer.getRenderTarget(), prevFace = renderer.getActiveCubeFace(), prevMip = renderer.getActiveMipmapLevel();
      const gm = rt.texture.generateMipmaps;
      rt.texture.generateMipmaps = i === 5 ? gm : false;   // as CubeCamera.update: mips on the last face
      renderer.setRenderTarget(rt, i, 0);
      renderer.render(scene, cams[i]);
      rt.texture.generateMipmaps = gm;
      renderer.setRenderTarget(prevRT, prevFace, prevMip);
    };
    return Object.assign(job, {
      // hold(): perf/ready-first-frame: no capture starts until release() (the late warm-up builds its pipelines first);
      // a start asked for meanwhile runs at the release, so the water keeps the load's probe till then
      // at: [x, z] (M6): the new capture stands there; the water's probe moves when it goes live (never mid-capture)
      start(at = null) {
        if (at) job.at = at;
        if (job.held) { job.wanted = true; return; }
        if (probe && cubeCam) {
          if (job.at) { cubeCam.position.set(job.at[0], uProbe.value.y, job.at[1]); cubeCam.updateMatrixWorld(); }
          job.face = 0; job.busy = true;
        }
      },
      hold() { job.held = true; },
      release() { job.held = false; if (job.wanted) { job.wanted = false; job.start(); } },
      // one frame's share; returns true on the frame the new probe goes live
      step() {
        if (!job.busy) return false;
        const t0 = performance.now();
        let live = false;
        if (job.face < 6) {
          withCaptureState(() => { for (let k = 0; k < facesPerStep && job.face < 6; k++) renderFace(job.face++); });
        } else {
          cubeCam.renderTarget.texture.needsPMREMUpdate = true;
          probeGen ??= new THREE.PMREMGenerator(renderer);
          const mrtWas = renderer.getMRT(); renderer.setMRT(null);
          const rt = probeGen.fromCubemap(cubeCam.renderTarget.texture, probeRT);
          renderer.setMRT(mrtWas);
          probeRT = rt; setTexture(rt.texture);
          if (job.at) { uProbe.value.copy(cubeCam.position); job.at = null; }
          job.busy = false; job.count++; live = true;
        }
        job.lastMs = performance.now() - t0; job.maxMs = Math.max(job.maxMs, job.lastMs);
        return live;
      },
    });
  }

  return { prepare, captureProbe, warmProbe, probeUpdater };
}
