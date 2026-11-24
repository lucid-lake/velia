// The helm station's live 3D objects (owner, 2026-10-30): the boat's own wheel and winches drawn as
// small real objects on the bottom row, lit by the scene's own sun and sky (the same AtmosphereLight and sky environment
// as the world), with the scene's exposure and AgX: a stainless wheel on screen is the same stainless as on the boat.
//
// How: each object has its own small render target (MSAA, half float, linear light, transparent where empty) and its own
// camera; createHud3d() is built before the post chain, and compose(color) lays the targets over the scene's colour in
// the post chain, BEFORE the tone mapping, each into its screen rectangle. A slot with no rectangle costs one compare.
// The renders run before the post pass each frame, only for the slots that show (a few draw calls at a few hundred px).
//
//   const hud = createHud3d({ renderer, scene });      // core/index.js; core.hud
//   post.outputNode = toneMapping(…, hud.compose(color));
//   const s = hud.slot({ object, camera, rect: () => ({ x, y, w, h }) | null });  // css px, top-left origin; null: hidden
//   s.setOpacity(0.35);                                // a real per-slot opacity (the Calm HUD's faint wheel); 1 by default
// The cockpit (cockpit3d.js) takes one slot with three more options: fixedCamera (its camera is a full-frame lens cropped to the
// slot with setViewOffset: the slot leaves its projection alone), maxPx (its own size cap: a screen-wide band) and dirty()
// (render on change: false keeps the last picture, the composite still lays it in; a resize always draws).
//   hud.render();                                      // core/index.js, before post.render()
// Headless captures add no slots: compose() then returns the scene's colour unchanged (mix with alpha 0), the goldens hold.
//
// The crisp path (feat/portrait, the owner: "all the symbols on iPhone are very low quality"): the scene canvas draws below the
// screen's own density (a phone's Low tier: about 1.4 px per css px on a 3x screen), so an object laid into it is as soft as the
// water. When the screen is denser than the scene, the objects go to a small second canvas of their own instead (one renderer,
// a CanvasTarget), over just the box the slots cover, at the screen's density (up to 3x): the same render targets, the same
// AgX at the scene's exposure, composited over clear glass. present() draws it, after the scene's frame.
import * as THREE from 'three/webgpu';
import { texture, screenUV, uniform, vec2, vec3, vec4, float, step, max, Fn, renderOutput } from 'three/tsl';
import { AtmosphereLight } from '@takram/three-atmosphere/webgpu';

const HUD3D = { slots: 4, maxPx: 640, samples: 4 };

// the screen rectangle (css px, top-left origin) as the shader's uniform: x0, y0 (screen uv, top-left), 1/w, 1/h; a hidden slot
// gets an empty rectangle off screen
function rectUniform(rect, vw, vh) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0) || !(vw > 0) || !(vh > 0)) return [-2, -2, 1, 1];
  return [rect.x / vw, rect.y / vh, vw / rect.w, vh / rect.h];
}

// the box (css px, whole pixels) that holds every shown slot's rectangle, padded a pixel; null when none shows
export function slotsBox(rects) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) { if (!r || !(r.w > 0) || !(r.h > 0)) continue; x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  if (!(x1 > x0)) return null;
  const x = Math.floor(x0) - 1, y = Math.floor(y0) - 1;
  return { x, y, w: Math.ceil(x1) + 1 - x, h: Math.ceil(y1) + 1 - y };
}
// whether the objects take their own canvas: the screen is denser than the scene draws (dpr: the screen's, capped at 3)
export const crispWanted = ({ dpr = 1, ratio = 1, able = true } = {}) => able && Math.min(3, dpr) > ratio + 0.05;

export function createHud3d({ renderer, scene: world, toneMap = null }) {
  const scene = new THREE.Scene();
  // the world's own light: the sun through the atmosphere, and the sky's environment (shared node: it re-renders its cube
  // only when the sun moves, for both scenes)
  scene.add(new AtmosphereLight());
  scene.environmentNode = world?.environmentNode ?? null;
  // a soft fill from the viewer (a deck lamp's worth): the objects stay readable at dusk; scaled by fill.intensity per frame
  const fill = new THREE.DirectionalLight(0xfff4e6, 0); scene.add(fill); scene.add(fill.target);
  const slots = [];
  for (let i = 0; i < HUD3D.slots; i++) {
    const rt = new THREE.RenderTarget(2, 2, { type: THREE.HalfFloatType, samples: HUD3D.samples, depthBuffer: true });
    rt.texture.generateMipmaps = false;
    slots.push({ i, rt, u: uniform(vec4(-2, -2, 1, 1)), ou: uniform(vec4(-2, -2, 1, 1)), op: uniform(1), object: null, camera: null, rect: null, on: false, w: 2, h: 2 });
  }
  // the crisp canvas (see the head): its own CanvasTarget at the screen's density over the slots' box
  const able = !!toneMap && typeof THREE.CanvasTarget === 'function' && !!renderer.backend?.isWebGPUBackend && typeof document !== 'undefined';
  let ov = null;
  const makeOverlay = () => {
    const cv = document.createElement('canvas'); cv.className = 'lk-hudc'; cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;left:0;top:0;z-index:1;pointer-events:none;display:none';
    renderer.domElement.after(cv);
    const target = new THREE.CanvasTarget(cv);
    const pipe = new (THREE.RenderPipeline ?? THREE.PostProcessing)(renderer);
    pipe.outputColorTransform = false;   // done here, on the straight colour, then premultiplied for the canvas
    pipe.outputNode = Fn(() => {
      let c = vec4(0, 0, 0, 0);
      for (const s of slots) {
        const uv = screenUV.sub(s.ou.xy).mul(s.ou.zw);
        const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
        const t = texture(s.rt.texture, vec2(uv.x, uv.y));
        const k = inside.mul(s.op), a = t.a.mul(k);
        c = vec4(c.rgb.mul(float(1).sub(a)).add(t.rgb.mul(k)), c.a.mul(float(1).sub(a)).add(a));
      }
      const straight = c.rgb.div(max(c.a, float(1e-4)));
      const out = renderOutput(toneMap(vec4(straight, 1)), THREE.NoToneMapping, THREE.SRGBColorSpace);
      return vec4(vec3(out.rgb).mul(c.a), c.a);
    })();
    return { cv, target, pipe, box: null, dpr: 0, shown: false };
  };
  // the composite: over the scene's colour (premultiplied: the targets clear to 0 alpha)
  const compose = (color) => Fn(() => {
    let c = vec4(color);
    for (const s of slots) {
      const uv = screenUV.sub(s.u.xy).mul(s.u.zw);
      const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
      const t = texture(s.rt.texture, vec2(uv.x, uv.y));   // a WebGPU target's rows run top-down, as screenUV does (no flip)
      const k = inside.mul(s.op), a = t.a.mul(k);   // the slot's opacity (Calm HUD, ui/calmHud.js): 1 draws it as before
      c = vec4(c.rgb.mul(float(1).sub(a)).add(t.rgb.mul(k)), c.a);
    }
    return c;
  })();

  function slot({ object, camera, rect, update = null, area = null, fixedCamera = false, maxPx = HUD3D.maxPx, dirty = null }) {
    const s = slots.find((x) => !x.object);
    if (!s) throw new Error('hud3d: no free slot');
    Object.assign(s, { object, camera, rect, update, area, fixedCamera, maxPx, dirty, drawn: false });
    scene.add(object);
    return {
      get rect() { return s.lastRect; },
      // a real opacity, 0..1 (premultiplied: the colour and the alpha scale together); the owner's rect() returns null to skip a slot at 0
      setOpacity(v) { s.op.value = Math.max(0, Math.min(1, +v || 0)); },
      get opacity() { return s.op.value; },
      get drawn() { return s.drawn; },
      redraw() { s.drawn = false; },
      setMaxPx(v) { if (v !== s.maxPx) { s.maxPx = v; s.drawn = false; } },   // the size cap (a phone's cockpit: feat/cockpit-phone)
      dispose() { scene.remove(object); Object.assign(s, { object: null, on: false, update: null, area: null, dirty: null, fixedCamera: false, maxPx: HUD3D.maxPx, drawn: false }); s.op.value = 1; s.u.value.set(-2, -2, 1, 1); },
    };
  }

  // the daylight level, the scene's luminance per display unit and the world's night light (src/core/milkyway.js: a constant
  // hemisphere the night exposure reveals; in the scene before this is built), as render() last had them: a slot that
  // is lit as a world object (the cockpit, look/cockpit-light) takes the world's terms from here, not the deck lamp's
  const level = { light: 1, lum: 0.1, nightLight: null };
  let nightSrc;   // the world's night light, found once
  const clear = new THREE.Color();
  function render({ sunDir = null, light = 1, lum = 1 } = {}) {
    const vw = innerWidth, vh = innerHeight, dpr = Math.min(3, Math.max(renderer.getPixelRatio(), globalThis.devicePixelRatio || 1));   // crisp on Retina even when the scene renders below it
    const crisp = crispWanted({ dpr: globalThis.devicePixelRatio || 1, ratio: renderer.getPixelRatio(), able });
    let any = false;
    for (const s of slots) {
      const r = s.object ? s.rect() : null;
      s.lastRect = r; s.on = !!r;
      s.u.value.set(...rectUniform(crisp ? null : r, vw, vh));   // the crisp path: nothing laid into the scene
      if (s.object) s.object.visible = false;
      if (r) any = true;
    }
    // the crisp canvas: over the slots' box, the slots' rectangles relative to it
    // area(): the slot's place even while faded out (the Calm HUD), so the crisp canvas keeps one box: a canvas resized to a
    // smaller box drew nothing (2026-11-05, the phone's faint wheel alone)
    const box = crisp && any ? slotsBox(slots.map((s) => (s.object && s.area?.()) || s.lastRect)) : null;
    if (box) {
      ov ??= makeOverlay();
      const b = ov.box;
      if (!b || b.x !== box.x || b.y !== box.y || b.w !== box.w || b.h !== box.h || ov.dpr !== dpr) { ov.box = box; ov.dpr = dpr; ov.resize = true; }   // applied in present()
      for (const s of slots) s.ou.value.set(...rectUniform(s.lastRect ? { x: s.lastRect.x - box.x, y: s.lastRect.y - box.y, w: s.lastRect.w, h: s.lastRect.h } : null, box.w, box.h));
    }
    if (ov && !!box !== ov.shown) { ov.shown = !!box; ov.cv.style.display = box ? 'block' : 'none'; }
    if (!any) return 0;
    // the deck lamp: a little by day, much more after dusk, and red at night as the dashboard goes red (the night set)
    const dark = 1 - Math.min(1, Math.max(0, light));
    level.light = light; level.lum = lum;   // for a slot's own light (the cockpit's deck bounce: cockpitMaterials.js)
    if (nightSrc === undefined) nightSrc = world?.getObjectByName?.('nightLight') ?? null;
    level.nightLight = nightSrc;
    fill.intensity = lum * (0.9 + 14 * dark * dark);
    fill.color.setRGB(1, 0.957 - 0.6 * dark, 0.9 - 0.66 * dark);
    const prevRT = renderer.getRenderTarget(), prevMRT = renderer.getMRT?.() ?? null, prevAuto = renderer.autoClear;
    renderer.getClearColor(clear); const prevA = renderer.getClearAlpha();
    renderer.setMRT?.(null); renderer.autoClear = true; renderer.setClearColor(0x000000, 0);
    let n = 0;
    for (const s of slots) {
      if (!s.on) continue;
      // the cap keeps the slot's shape (a wide band capped on one side only would stretch)
      const cap = s.maxPx ?? HUD3D.maxPx, k = Math.min(1, cap / Math.max(1, s.lastRect.w * dpr), cap / Math.max(1, s.lastRect.h * dpr));
      const w = Math.max(2, Math.round(s.lastRect.w * dpr * (s.fixedCamera ? k : 1))), h = Math.max(2, Math.round(s.lastRect.h * dpr * (s.fixedCamera ? k : 1)));
      const W2 = s.fixedCamera ? w : Math.min(cap, w), H2 = s.fixedCamera ? h : Math.min(cap, h);
      if (W2 !== s.w || H2 !== s.h) { s.rt.setSize(W2, H2); s.w = W2; s.h = H2; s.drawn = false; }
      if (!s.fixedCamera) { s.camera.aspect = s.lastRect.w / s.lastRect.h; s.camera.updateProjectionMatrix(); }
      s.update?.();
      // render on change: a slot whose picture holds keeps its target (the composite reads it as it is)
      if (s.dirty && s.drawn && !s.dirty()) continue;
      s.object.visible = true;
      // the fill comes from just above the viewer's shoulder
      fill.position.copy(s.camera.position).add(new THREE.Vector3(0.3, 0.6, 0)); fill.target.position.copy(s.object.position);
      renderer.setRenderTarget(s.rt);
      renderer.render(scene, s.camera);
      s.object.visible = false; n++; s.drawn = true;
    }
    renderer.setRenderTarget(prevRT); renderer.setMRT?.(prevMRT); renderer.autoClear = prevAuto; renderer.setClearColor(clear, prevA);
    return n;
  }
  // the crisp canvas's frame: after the scene's own (core/index.js), the same render targets at the screen's density
  function present() {
    if (!ov?.shown) return false;
    const main = renderer.getCanvasTarget();
    renderer.setCanvasTarget(ov.target);
    try {
      // the resize happens while the canvas is the renderer's target (fix/helm-fullscreen, 2026-11-05): the renderer hears a
      // CanvasTarget's 'resize' only for its current target, and only then drops the canvas's cached pass (its MSAA colour and
      // depth). Resized while the scene's canvas was current, the overlay kept its old 782 x 288 attachments against a 956 x 354
      // swap chain: every frame failed WebGPU validation and the wheel and the winches drew nothing (a window going full screen)
      if (ov.resize) {
        const { box, dpr } = ov; ov.resize = false;
        ov.target.setPixelRatio(dpr); ov.target.setSize(box.w, box.h);
        ov.cv.style.left = `${box.x}px`; ov.cv.style.top = `${box.y}px`;
      }
      ov.pipe.render();
    } finally { renderer.setCanvasTarget(main); }
    return true;
  }
  // the slots' objects built ahead (fix/first-visit-hitches: the wheel and the winches built 8 pipelines as the HUD first
  // showed): warm(root, camera, opts) is the core's warm-up (src/core/warmup.js), each object into its own target
  //   shown: true (perf/ready-first-frame, behind the card): only each slot's parts that show when the slot shows (the
  //   HUD shows ≈ 2 s into play), its object made visible for the build alone; the hidden parts (the helm view's, the
  //   night's) come with the full call after ready. Undefined: every part, hidden ones included.
  async function warm(warmFn, { shown } = {}) {
    const out = [];
    for (const s of slots) {
      if (!s.object || !s.camera) continue;
      // the slot's object shown while three reads it, as in its own draw: its lights (the cockpit's deck bounce, a light
      // under the object) are then in the call's light list as in the draw's; with them missing the slot's shared list
      // changed and every cockpit part built again in its next draw (perf/ready-first-frame)
      const around = { sync: () => { const w = s.object.visible; s.object.visible = true; return () => { s.object.visible = w; }; } };
      if (!shown) { out.push(await warmFn(s.object, s.camera, { scene, target: s.rt, mrt: null, cull: false, hidden: true, around })); continue; }
      const was = s.object.visible;
      s.object.visible = true;   // nothing draws while the boot's warm-up runs
      try { out.push(await warmFn(s.object, s.camera, { scene, target: s.rt, mrt: null, cull: false })); } finally { s.object.visible = was; }
    }
    // the crisp canvas (a phone): made now and drawn once, hidden (its composite built 1 pipeline as the HUD showed)
    if (out.length && crispWanted({ dpr: globalThis.devicePixelRatio || 1, ratio: renderer.getPixelRatio(), able })) {
      ov ??= makeOverlay();
      const main = renderer.getCanvasTarget();
      renderer.setCanvasTarget(ov.target);
      // at the canvas's own size (hidden); present() sizes it to the slots' box on its first show
      try { ov.pipe.render(); } catch { /* its first present builds it */ } finally { renderer.setCanvasTarget(main); }
    }
    return out;
  }
  return { scene, slots, compose, slot, render, present, fill, level, warm, get crisp() { return !!ov?.shown; }, get overlay() { return ov ? { box: ov.box, dpr: ov.dpr, px: [ov.cv.width, ov.cv.height] } : null; } };
}
