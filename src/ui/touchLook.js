// Two fingers on the open water: drag to look round (orbit), pinch to zoom. Pure: feed it the canvas pointers. One finger
// never reaches here (it steers or trims, pads.js), and the wheel, winches, panel and circles are DOM above the canvas.
// look: [dx, dy] rad (the mouse drag's scale); zoom: a factor for the camera (> 1 farther, < 1 closer: fingers apart zooms in).
export const LOOK = { dragX: 0.005, dragY: 0.004, minPx: 24, zoomMin: 0.5, zoomMax: 2 };

export class TwoFinger {
  constructor() { this.p = new Map(); this.prev = null; }
  get active() { return this.p.size === 2; }
  _geom() { const [a, b] = [...this.p.values()]; return { mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; }
  down(id, x, y) { this.p.set(id, [x, y]); this.prev = this.p.size === 2 ? this._geom() : null; return this.active; }
  // returns { look: [dx, dy], zoom } for this move, or null when fewer than two fingers are down
  move(id, x, y) {
    if (!this.p.has(id)) return null;
    this.p.set(id, [x, y]);
    if (this.p.size !== 2) return null;
    const g = this._geom(), q = this.prev ?? g; this.prev = g;
    const zoom = q.d > LOOK.minPx && g.d > LOOK.minPx ? Math.min(LOOK.zoomMax, Math.max(LOOK.zoomMin, q.d / g.d)) : 1;
    return { look: [(g.mx - q.mx) * LOOK.dragX, (g.my - q.my) * LOOK.dragY], zoom };
  }
  up(id) { this.p.delete(id); this.prev = this.p.size === 2 ? this._geom() : null; }
}
