// The sky's environment map (image-based light) without the library's listener leak (refactor round 2, B6).
//
// @takram/three-atmosphere 0.19.1's SkyEnvironmentNode re-renders a 64 px sky cube and re-filters it (a PMREM, about
// 4.5 ms GPU) whenever its version moves. Its setup() adds three per-frame callbacks (camera cell, sun, moon) to the
// material being built, each with its own copy of the direction it last saw, and never removes them. setup runs once
// per material build that reads the environment, so the page carried dozens of callbacks with staggered references;
// any one crossing its 0.1° step re-filtered: 20 % of day frames, most night frames (the 40x clock).
//
// This node does the same checks once a frame, in its own updateBefore, against one shared "last seen" state. The
// environment re-filters only when the sun or the moon has turned 0.1° since the last re-filter, or the camera has
// changed 1 km cell, or the LUT updated. Live lighting follows the sun in 0.1° steps (owner-accepted, 2026-11-11);
// still captures are unchanged (their clock is frozen). Everything else is the library's code as published.
import { Vector3 } from 'three/webgpu';
import { pmremTexture, positionGeometry, vec4 } from 'three/tsl';
import { SkyEnvironmentNode, getAtmosphereContext } from '@takram/three-atmosphere/webgpu';

class SkyEnvironmentOnce extends SkyEnvironmentNode {
  static get type() { return 'SkyEnvironmentOnce'; }

  constructor(size = 64) {
    super(size);
    this._context = null;                 // the atmosphere context, from the last setup
    this._cell = new Vector3();           // the camera's last 1 km cell (the library starts at the origin's cell)
    this._sun = null;                     // the sun and moon directions at the last re-filter
    this._moon = null;
  }

  // Once a frame (updateBeforeType FRAME): mark the cube stale on a real move, then the library's re-render.
  updateBefore(frame) {
    this.watch();
    super.updateBefore(frame);
  }

  // The library's three checks, on one state. Returns true when it marked the cube stale.
  watch() {
    const c = this._context;
    if (c == null) return false;
    let stale = false;
    if (c.camera != null) {
      const next = (this._nextCell ??= new Vector3()).copy(c.camera.position).divideScalar(this.distanceThreshold).round();
      if (!this._cell.equals(next)) { this._cell.copy(next); stale = true; }
    }
    const sun = c.sunDirectionECEF.value, moon = c.moonDirectionECEF.value;
    if (this._sun == null) this._sun = sun.clone();
    else if (this._sun.angleTo(sun) > this.angularThreshold) { this._sun.copy(sun); stale = true; }
    if (this._moon == null) this._moon = moon.clone();
    else if (this._moon.angleTo(moon) > this.angularThreshold) { this._moon.copy(moon); stale = true; }
    if (stale) this.needsUpdate = true;
    return stale;
  }

  setup(builder) {
    const context = getAtmosphereContext(builder);
    if (this._context !== context) {      // a new context: start from its present state (the library cloned at setup)
      this._context = context;
      this._cell.set(0, 0, 0); this._sun = null; this._moon = null;
      this.watch();
    }
    const onLUT = () => { this.needsUpdate = true; };
    context.lutNode.addEventListener('update', onLUT);
    this.removeLUTUpdateListener?.();
    this.removeLUTUpdateListener = () => { context.lutNode.removeEventListener('update', onLUT); };

    this.material.vertexNode = vec4(positionGeometry.xy, 0, 1);
    this.material.fragmentNode = this.skyNode;
    return pmremTexture(this.renderTarget.texture);
  }
}

export const skyEnvironmentOnce = (...args) => new SkyEnvironmentOnce(...args);
