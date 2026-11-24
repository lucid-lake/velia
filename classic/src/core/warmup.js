// The shader warm-up (perf/shader-warmup): the pipelines a draw will need are built behind
// the loading card with three's renderer.compileAsync(), before the draw asks for them. A draw that meets a missing
// pipeline builds it on the spot and blocks the page for the whole build (0.7 s on this Mac; 10 s in one block on its
// WebGL2; 38 s on SwiftShader). compileAsync builds each object's shaders in its own task (scheduler.yield between
// objects), asks WebGPU for createRenderPipelineAsync, and on WebGL2 lets KHR_parallel_shader_compile link off the main
// thread; so the page stays responsive, the card's line keeps moving, and several pipelines build at once.
// Nothing here changes a picture: the draws that follow find the same pipelines in three's caches.
//
//   warmScene(renderer, root, camera, { scene, target, mrt, pass, passDepth, lanes, cull, hidden, view, live, around, slice, priority })
//     root: an object, or a list of them (one call for several roots: their objects share the lanes; perf/phone-load)
//     builds the pipelines for root's drawable objects as camera sees them (drawables() below: one per material and
//     geometry layout, in view first, nearest first), `lanes` compileAsync calls at a time, for the draw target
//     `target` with `mrt` (undefined: the renderer's current ones). pass: a PassNode (the post chain's scene pass):
//     its target, MRT and flags, at the call depth its draw uses (passDepth: the post chain's, src/core/post.js; 1 by
//     default). cull: false also takes objects out of view;
//     hidden: true also hidden ones. view: 'in' only the objects in view, 'out' only the others (perf/ready-first-frame).
//     live: true in play, between live frames (liveHooks below; perf/ready-first-frame): the state is set only while
//     three reads it, in slices of `slice` objects, one slice at a time, priority: true ahead of the queue. around:
//     the caller's own state, { sync(root) → undo, build() → undo } (the probe's capture state, TRAA's matrix): sync
//     for each call's synchronous part, build for three's later pieces; behind the card both held for the whole call.
//     Returns { ms, objects, error } (+ slices in play); never throws: a failed warm-up leaves the draw to build as
//     before.
//   drawables(root, camera, { cull, hidden, twoPassOut, view })   the objects warmScene compiles, in its order (two-pass
//     transparent ones go to twoPassOut instead: warmScene builds them through sideTwins())
//   liveHooks(renderer)   the hooks a warm-up in play needs (installed once, at the first; { ok } false on another three)
//   LIVE_HOOKS_THREE   the three REVISION liveHooks was written against (tests/liveHooksThree.test.mjs fails on any other)
//   LATE   the late warm-up's lanes and slice in play (src/core/index.js)
//   warmOn(flags)   false for ?warm=0 (the A/B switch and the kill switch)
//   passDepthFor(aa)   the scene pass's render call depth under the tier's anti-aliasing (warmScene's passDepth)
import { Vector2, Vector3, Matrix4, Frustum, DoubleSide, BackSide, FrontSide } from 'three/webgpu';
import { toFlags } from '../../../src/sim/core/flags.js';

// perf/ready-first-frame: the late warm-up's parallel compile calls and objects per turn in play (liveHooks below)
// playLanes (perf/enter-freeze): once the frame budget paces the builds (src/core/lateWarm.js) the pieces run one at a
// time anyway; fewer objects in flight let a priority call (a kayak going full) in sooner
export const LATE = { lanes: 16, slice: 32, playLanes: 4 };

export const warmOn = (flags) => toFlags(flags).warm;   // flags: the page's or a mode's (null: the defaults)

// The render call depth the post chain draws its scene pass at (perf/enter-freeze; warmScene's passDepth): the chain's own
// quad draws at 0 and the scene pass inside it at 1; FXAA and TRAA read the graded picture as a texture, drawn by a render
// of their own inside the chain's quad (FXAA: convertToTexture; TRAA: its resolve), so the scene pass draws at 2.
// src/core/post.js also reads the depth from the pass's own draw once it has drawn (pc.passDepth)
export const passDepthFor = (aa) => (aa === 'fxaa' || aa === 'traa' ? 2 : 1);

// The load's yield (perf/phone-load). three's compileAsync yields after every object it builds (yieldToMain): with
// scheduler.yield() where the browser has it (Chrome), else with requestAnimationFrame. Safari has no scheduler.yield, so
// on an iPhone every warmed object waited for a display frame: about 620 objects in 6 lanes, ≈ 100 frames, 1.7 s at
// 60 Hz and 3.4 s at 30 Hz (Low Power Mode). Behind the loading card nothing needs those frames, so while the boot runs a
// browser without scheduler.yield gets one that resolves in the next task (a MessageChannel message): the page still
// paints between tasks and the card keeps moving. fastYield() installs it and returns the undo, which the boot calls at
// its first live frame, so play keeps the browser's own pacing. Chrome (it has scheduler.yield) is untouched.
export function fastYield(g = globalThis) {
  if (g.scheduler?.yield || typeof g.MessageChannel !== 'function') return () => {};
  const ch = new g.MessageChannel(), queue = [];
  ch.port1.onmessage = () => queue.shift()?.();
  const had = 'scheduler' in g, prev = g.scheduler;
  const shim = { yield: () => new Promise((resolve) => { queue.push(resolve); ch.port2.postMessage(0); }) };
  try { if (had && prev) prev.yield = shim.yield; else g.scheduler = shim; } catch { return () => {}; }
  return () => {
    try { if (had && prev) delete prev.yield; else delete g.scheduler; } catch { /* left as is */ }
    while (queue.length) queue.shift()();
    ch.port1.close();
  };
}

const _size = new Vector2();

const _frustum = new Frustum(), _m = new Matrix4(), _p = new Vector3();
const DRAWN = (o) => !!o.material && (o.isMesh || o.isPoints || o.isLine || o.isSprite);
// A transparent double-sided material draws twice (back faces, then front), three flipping material.side around each
// draw. compileAsync queues both draws but builds them later, with the side already put back to DoubleSide: their
// cached state then drew the dodger's acrylic wrong (helm golden, 4.4 % of pixels). Those are left to the draw.
const twoPass = (o) => [o.material].flat().some((m) => m?.transparent === true && m.side === DoubleSide && m.forceSinglePass === false);
const layoutOf = (o) => {
  const g = o.geometry, a = g?.attributes ? Object.keys(g.attributes).sort().join(',') : '';
  return `${a}|${g?.index ? 'i' : ''}|${Object.keys(g?.morphAttributes ?? {}).join(',')}|${o.isInstancedMesh ? 'I' : ''}${o.isSkinnedMesh ? 'S' : ''}${o.isBatchedMesh ? `B${o.id}` : ''}|${o.type}`;
};
export function drawables(root, camera, { cull = true, hidden = false, twoPassOut = null, view = null } = {}) {
  camera.updateMatrixWorld?.();
  _frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
  const seen = new Set(), list = [];
  const walk = (o) => {
    if (!hidden && o.visible === false) return;
    // with hidden: a mask that writes no colour (the cockpit's depth punch, shown only in some views): built for a target without the scene's MRT, its
    // fragment shader had no output at all (a WGSL error that stopped the load); it is left to its own draw
    const mask = hidden && [o.material].flat().some((m) => m?.colorWrite === false);
    if (DRAWN(o) && !mask) {
      const key = `${[o.material].flat().map((m) => m?.id).join(',')}#${layoutOf(o)}`;
      if (twoPass(o)) { if (twoPassOut && !seen.has(key)) { seen.add(key); twoPassOut.push(o); } }
      else if (!seen.has(key)) {
        seen.add(key);
        let inView = true;
        if (o.frustumCulled !== false && o.geometry) {
          if (o.geometry.boundingSphere == null) o.geometry.computeBoundingSphere?.();
          inView = !o.geometry.boundingSphere || _frustum.intersectsObject(o);
        }
        // view: 'in' only the ones in view, 'out' only the others (perf/ready-first-frame: the first view's set, then the rest)
        if ((inView || !cull) && (view == null || (view === 'in') === inView)) list.push([o, inView ? 0 : 1, o.getWorldPosition(_p).distanceToSquared(camera.position)]);
      }
    }
    for (const c of o.children) walk(c);
  };
  for (const c of Array.isArray(root) ? root.filter(Boolean) : root.isScene ? root.children : [root]) walk(c);
  return list.sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
}

// A two-pass object's own draws, built ahead (fix/first-visit-hitches: the bird spray at the osprey's plunge, the storm's
// lightning; each built 2 pipelines in play). compileAsync cannot build them on the object's own material (see twoPass
// above), so each side builds on a twin: a clone of the material with side BackSide, then FrontSide, which is exactly
// what three sets around each of the two draws. three keys GPU pipelines by shader code and state, not by material, so
// the real draws find these pipelines. The twins are kept (a disposed twin would release its pipelines).
const _twins = new WeakMap();
const TWIN_FLAGS = ['fog', 'lights', 'flatShading', 'wireframe', 'vertexColors'];
export function sideTwins(m) {
  let t = _twins.get(m);
  if (!t) {
    // NodeMaterial.copy leaves `fog` at its default (Material.copy has no fog): a fog: false material (the bolts) cloned
    // with fog on, a different shader the draw never used. The flags copied by hand.
    t = [BackSide, FrontSide].map((side) => { const c = m.clone(); for (const k of TWIN_FLAGS) if (k in m) c[k] = m[k]; c.side = side; c.name = `${m.name ?? ''}#warm`; return c; });
    _twins.set(m, t);
  }
  return t;
}

// --- Warm-ups in play (perf/ready-first-frame) ---
// Behind the loading card nothing else draws, so a warm-up sets the renderer's target and MRT (and its caller's state:
// the probe's capture state, TRAA's matrix) once and keeps them until every build is done. In play the live frames run
// between the builds, and three builds an object's shaders over several tasks after compileAsync returns (the node
// build yields after each shader stage), reading the renderer's MRT, target and samples, the scene's environment and
// TRAA's matrix as it goes. Held across frames, that state drew the frames wrong; let go, the builds read the frame's
// state and made pipelines the draw never uses, or invalid ones (a kayak's warm-up in play: "Color target has no
// corresponding fragment stage output"). So in play (live: true) the state is set only while three
// reads it: inside each compileAsync call's synchronous part, and at the start of each piece of a build three runs
// later (the render object's lookup, the node build's start and each of its stages, the node updates), then put back
// by a microtask queued at that start, which runs as soon as the piece ends, before any other task: no frame ever runs
// with it. A frame's own draws (render, compute) never apply it. One warm-up in play at a time (a queue).
// It wraps three's private renderer internals (renderer._nodes, renderer._objects), so a three upgrade must re-check it
// first: tests/liveHooksThree.test.mjs fails when the installed three is not this revision.
export const LIVE_HOOKS_THREE = '184';
const LIVE = new WeakMap();   // renderer → its hooks
export function liveHooks(renderer) {
  let h = LIVE.get(renderer);
  if (h) return h;
  h = { ok: false, session: null, applied: null, depth: 0, sync: 0, applies: 0, busy: false, wait: [] };
  // one slice in play at a time: a turn, first come first served; a priority call (a kayak about to go full) goes first
  // urgent: a priority call waits (perf/enter-freeze): the running slice takes no new object, so the call goes next as
  // soon as the objects already building are done (on the frame budget a slice of 32 took seconds on a phone, and the
  // kayak pair waited for it)
  h.urgent = 0;
  h.acquire = (priority) => new Promise((res) => { if (!h.busy) { h.busy = true; res(); } else if (priority) { h.urgent++; h.wait.unshift(() => { h.urgent--; res(); }); } else h.wait.push(res); });
  h.release = () => { const n = h.wait.shift(); if (n) n(); else h.busy = false; };
  LIVE.set(renderer, h);
  const nodes = renderer?._nodes, objects = renderer?._objects;
  const has = (o, n) => typeof o?.[n] === 'function';
  if (!['getForRenderAsync', '_createNodeBuilder', 'updateBefore', 'updateForRender', 'updateAfter'].every((n) => has(nodes, n)) || !has(objects, 'get') || !has(renderer, 'render')) return h;   // another three: the boot's way only
  const leave = () => { const undo = h.applied; h.applied = null; undo?.(); };
  const enter = () => {
    if (!h.session || h.depth || h.sync || h.applied) return;
    h.applied = h.session.build(); h.applies++;
    queueMicrotask(leave);
  };
  const wrap = (o, n, after = null) => { const f = o[n]; o[n] = function (...a) { enter(); const r = f.apply(this, a); return after ? after(r) : r; }; };
  wrap(objects, 'get');
  for (const n of ['getForRenderAsync', 'updateBefore', 'updateForRender', 'updateAfter']) wrap(nodes, n);
  // a node builder made for a warm-up's build: each of its stages starts by applying the state (three yields between them)
  wrap(nodes, '_createNodeBuilder', (b) => {
    if (h.session && !h.depth && b) for (const m of ['setBuildStage', 'setShaderStage']) { const f = b[m]; if (typeof f === 'function') b[m] = function (...a) { enter(); return f.apply(this, a); }; }
    return b;
  });
  // a draw (render, compute) never runs with the warm-up's state: a frame's (the microtask has put it back by then), or
  // one a build makes in the middle of its piece (a node's own render: the sky's environment cube and its PMREM, drawn
  // from a node update while the state was set: built for the scene pass's 4 targets, invalid). The state is put back
  // for the draw and set again after it, so the rest of the piece still reads it.
  for (const n of ['render', 'compute']) {
    const f = renderer[n]; if (typeof f !== 'function') continue;
    renderer[n] = function (...a) {
      const was = !h.depth && h.applied;
      if (was) { h.applied(); h.applied = null; }
      h.depth++;
      try { return f.apply(this, a); } finally { h.depth--; if (was && h.session) h.applied = h.session.build(); }
    };
  }
  h.ok = true;
  return h;
}

export async function warmScene(renderer, root, camera, { scene = root, target, mrt, lanes = 6, pass = null, passDepth = 1, cull = true, hidden = false, view = null, live = false, around = null, slice = 12, priority = false } = {}) {
  const t0 = performance.now();
  const out = { ms: 0, objects: 0, error: null };
  if (typeof renderer?.compileAsync !== 'function' || !root || !camera) return out;
  if (live) {
    // in play: one at a time; a three without the hooks' internals builds nothing here (its draws build as before)
    const h = liveHooks(renderer);
    if (!h.ok) { out.error = 'live warm-up: no hooks'; return out; }
    return warmBody(renderer, root, camera, { scene, target, mrt, lanes, pass, passDepth, cull, hidden, view, around, slice, priority }, t0, out, h);
  }
  return warmBody(renderer, root, camera, { scene, target, mrt, lanes, pass, passDepth, cull, hidden, view, around }, t0, out, null);
}

// h: the live hooks (in play), or null (behind the card: the state held from the first call to the last build)
async function warmBody(renderer, root, camera, { scene, target, mrt, lanes, pass, passDepth = 1, cull, hidden, view, around, slice = 0, priority = false }, t0, out, h) {
  if (pass) {
    // the pass's own target at the size its next draw will set (PassNode.updateBefore), so it is allocated once
    renderer.getSize(_size);
    pass.setPixelRatio?.(renderer.getPixelRatio());
    pass.setSize?.(_size.width, _size.height);
    target = pass.renderTarget;
    mrt = pass.getMRT?.() ?? null;
  }
  // One compileAsync per drawable object, not per top-level group: a group (the boat: 27 materials) compiled its
  // objects one after another, each waiting for its own pipeline. One object per material and geometry layout (the
  // others build the same pipeline); the ones in view first, nearest first; `lanes` of them at a time.
  const two = [];
  const sync0 = around?.sync?.(root);   // the caller's state (the probe's capture state) for the list: who is shown, which material
  let parts;
  try {
    parts = drawables(root, camera, { cull, hidden, twoPassOut: two, view });
    if (!parts.length && Array.isArray(root)) return out;   // a list with nothing to draw
    if (!parts.length) parts.push(root);   // the scene's own background (the sky) comes with every call
    // each two-pass object twice, once per side twin (sideTwins above); a multi-material one is left to the draw
    for (const o of two) if (!Array.isArray(o.material)) for (const m of sideTwins(o.material)) parts.push([o, m]);
  } finally { sync0?.(); }
  // The render context's call depth. three keys an object's built shaders by its render context, and the context by
  // (target, MRT, call depth). The post chain draws the scene pass from inside its own quad's draw (depth 1), while
  // compileAsync always asks for depth 0: its builds were a twin set the frame never used. For the pass, ask for depth 1,
  // or the depth the post chain draws it at (perf/enter-freeze: under FXAA or TRAA, Low and the phones, the scene pass is
  // drawn inside the AA's own input render, depth 2; built at 1, every object was built again at its first draw: a plain
  // material's WGSL came out the same, so its pipeline was found, but a skinned mesh's names its bone buffer by the build's
  // own node id, so the kayak pair's 10 paddler pipelines were built again in one frame: 1.3–2.4 s on a phone)
  const depth = pass ? (passDepth >= 1 ? Math.round(passDepth) : 1) : 0;
  const rc = renderer._renderContexts, get0 = rc?.get;
  if (depth && (typeof get0 !== 'function' || Object.prototype.hasOwnProperty.call(rc, 'get'))) return out;   // a three without it (0.184's private API): leave it to the draw
  const getAt = function (t, m, d = 0) { return get0.call(this, t, m, d === 0 ? depth : d); };
  let next = 0;
  const saved = [];   // each object's frustumCulled and visible, changed for the synchronous part only (cull, hidden, twoPass)
  // in play: the target, the MRT and the flags (and the caller's build state) only while three reads them (liveHooks)
  const setState = () => {
    const rt = renderer.getRenderTarget(), face = renderer.getActiveCubeFace?.() ?? 0, mip = renderer.getActiveMipmapLevel?.() ?? 0;
    const m = renderer.getMRT?.() ?? null, op = renderer.opaque, tr = renderer.transparent;
    if (target !== undefined) renderer.setRenderTarget(target);
    if (mrt !== undefined) renderer.setMRT(mrt);
    if (pass) { renderer.opaque = pass.opaque !== false; renderer.transparent = pass.transparent !== false; }
    const undo = around?.build?.();
    return () => { undo?.(); renderer.setRenderTarget(rt, face, mip); renderer.setMRT(m); renderer.opaque = op; renderer.transparent = tr; };
  };
  const one = (item) => {
    const [o, twin] = Array.isArray(item) ? item : [item, null];
    const mat0 = o.material;
    let mine = false, undoSync = null;
    try {
      // in play: the state for this call's synchronous part (h.applied: a draw inside it puts it back and sets it again)
      if (h) { h.sync++; if (!h.applied) { h.applied = setState(); mine = true; } undoSync = around?.sync?.(o) ?? null; }
      if (depth) rc.get = getAt;   // an own property over the prototype's, for this call's synchronous part only
      if (twin) {
        // the twin's call: this object alone, wearing the twin (three keeps the material it read for the build)
        o.material = twin;
        saved.push(o, o.frustumCulled, o.visible); o.frustumCulled = false; o.visible = true;
        for (const c of o.children) { saved.push(c, c.frustumCulled, c.visible); c.visible = false; }
        return renderer.compileAsync(o, camera, scene);
      }
      o.traverse((x) => {
        const two = DRAWN(x) && twoPass(x);
        if (cull && !hidden && !two) return;
        saved.push(x, x.frustumCulled, x.visible);
        if (!cull) x.frustumCulled = false;
        if (hidden) x.visible = true;
        if (two) x.visible = false;
      });
      return renderer.compileAsync(o, camera, scene);
    } finally {
      if (twin) o.material = mat0;
      for (let i = 0; i < saved.length; i += 3) { saved[i].frustumCulled = saved[i + 1]; saved[i].visible = saved[i + 2]; }
      saved.length = 0;
      if (depth) delete rc.get;
      if (h) { undoSync?.(); if (mine && h.applied) { h.applied(); h.applied = null; } h.sync--; }
    }
  };
  let end = parts.length;   // in play: the slice's end (each slice its own turn)
  const lane = async () => {
    while (next < end && !out.error && !(h?.urgent && !priority)) {
      const o = parts[next++];
      try { await one(o); out.objects++; } catch (e) { out.error = String(e?.message ?? e).slice(0, 160); }
    }
  };
  // the target, the MRT and the flags stay set until every call has built its shaders: three builds an object's nodes
  // after compileAsync's first await, and reads the MRT then (a build without it gave a pipeline whose shader lacked the
  // MRT's outputs). Nothing else draws meanwhile: the boot awaits the warm-up.
  // in play: the parts in slices of `slice` objects, each slice in its own turn (liveHooks: one at a time, so the state
  // the hooks set is this slice's; a priority call can go between two slices)
  if (h) {
    const step = slice > 0 ? slice : parts.length;
    out.slices = 0;
    while (next < parts.length && !out.error) {
      await h.acquire(priority);
      end = Math.min(parts.length, next + step);
      h.session = { build: setState, priority };
      // lanes: a number, or a function read per slice (the late queue: fewer once the frame budget paces the builds)
      const nl = typeof lanes === 'function' ? lanes() : lanes;
      try { await Promise.all(Array.from({ length: Math.max(1, Math.min(nl, end - next)) }, lane)); out.slices++; } finally { h.session = null; h.release(); }
    }
    out.ms = Math.round(performance.now() - t0);
    return out;
  }
  const rt = renderer.getRenderTarget(), face = renderer.getActiveCubeFace?.() ?? 0, mip = renderer.getActiveMipmapLevel?.() ?? 0;
  const m = renderer.getMRT?.() ?? null, opaque = renderer.opaque, transparent = renderer.transparent;
  // behind the card the caller's state (around) is held for the whole call too
  const undoAround = [around?.sync?.(root), around?.build?.()];
  try {
    if (target !== undefined) renderer.setRenderTarget(target);
    if (mrt !== undefined) renderer.setMRT(mrt);
    if (pass) { renderer.opaque = pass.opaque !== false; renderer.transparent = pass.transparent !== false; }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(typeof lanes === 'function' ? lanes() : lanes, parts.length)) }, lane));
  } finally {
    renderer.setRenderTarget(rt, face, mip); renderer.setMRT(m);
    renderer.opaque = opaque; renderer.transparent = transparent;
    for (const u of undoAround.reverse()) u?.();
  }
  out.ms = Math.round(performance.now() - t0);
  return out;
}
