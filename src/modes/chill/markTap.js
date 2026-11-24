// Your mark by a double-tap on the lake (owner, 2026-11-11, pattern C: "the lake is the interface"): a second tap
// (or click) within MARK_TAP.ms and MARK_TAP.px of the first, on the water, with no drag between, sets the navigator's mark there
// (the chart's own checks: dry land, too shallow, no safe way get one polite line); a double-tap on the ring clears it. A single tap
// stays the wake, a drag stays the look. The ring is drawn on screen over the mark's spot on the water, amber (a set mark is a state),
// and fades with the bar (the Calm HUD).
//   const dt = new DoubleTap();  dt.tap({ x, y, t }) → true on the second tap of a pair (then it starts over); dt.reset()
//   const ring = createMarkRing();  ring.update({ at: [sx, sy] | null }); ring.near(x, y) → bool; ring.dispose()
//   markScreen(camera, rect, x, z) → [sx, sy] | null (the mark's spot on screen; null behind the camera or off the window)
// Pure parts (DoubleTap, markScreen): tests/cruiseBar.test.mjs.
export const MARK_TAP = { ms: 350, px: 24, ringPx: 36 };

export class DoubleTap {
  constructor({ ms = MARK_TAP.ms, px = MARK_TAP.px } = {}) { this.ms = ms; this.px = px; this.last = null; }
  tap({ x, y, t }) {
    const l = this.last;
    if (l && t - l.t <= this.ms && Math.hypot(x - l.x, y - l.y) <= this.px) { this.last = null; return true; }
    this.last = { x, y, t };
    return false;
  }
  reset() { this.last = null; }
}

// the mark's spot on screen: project (x, 0, z) with a three.js camera (anything with a matrixWorldInverse and projectionMatrix);
// rect: the canvas's client rect
export function markScreen(camera, rect, x, z) {
  const e = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
  const vx = e[0] * x + e[8] * z + e[12], vy = e[1] * x + e[9] * z + e[13], vz = e[2] * x + e[10] * z + e[14];
  const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12], cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13], cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
  if (!(cw > 1e-6)) return null;   // behind the camera
  const nx = cx / cw, ny = cy / cw;
  if (Math.abs(nx) > 1.05 || Math.abs(ny) > 1.05) return null;
  return [rect.left + (nx + 1) / 2 * rect.width, rect.top + (1 - ny) / 2 * rect.height];
}

const CSS = `.lk-mark{position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;box-sizing:border-box;border-radius:50%;pointer-events:none;z-index:var(--lk-z-hud,5);
  border:2px solid rgb(var(--lk-amber,247 192 96));box-shadow:0 0 0 1px rgb(0 0 0 / .35),inset 0 0 0 1px rgb(0 0 0 / .25);opacity:.95;transition:opacity var(--lk-calm-fade,600ms) ease}
.lk-mark::after{content:'';position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgb(var(--lk-amber,247 192 96))}
.lk-mark[hidden]{display:none}
html.lk-calm-bar .lk-mark{opacity:0}
:where(:root[data-f-finger-targets=on]) .lk-mark{width:36px;height:36px;margin:-18px 0 0 -18px}`;

export function createMarkRing({ doc = document } = {}) {
  if (!doc.getElementById('lk-mark-css')) { const st = doc.createElement('style'); st.id = 'lk-mark-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const el = doc.createElement('div'); el.className = 'lk-mark'; el.hidden = true; el.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(el);
  let at = null;
  return {
    el,
    get at() { return at; },
    update({ at: a = null } = {}) {
      at = a;
      if (!a) { if (!el.hidden) el.hidden = true; return; }
      el.hidden = false; el.style.transform = `translate(${Math.round(a[0])}px,${Math.round(a[1])}px)`;
    },
    near: (x, y) => !!at && Math.hypot(x - at[0], y - at[1]) <= MARK_TAP.ringPx,
    dispose() { el.remove(); },
  };
}

// A route's rings (the passage plan): one ring a waypoint, the active one amber as the one mark was, the
// later ones in the cream at a lower weight (a state is amber; a plan is not yet one).
//   const rings = createMarkRings();  rings.update({ ats: [[sx, sy] | null, …] }) (the first is the active); rings.nearIndex(x, y) → i | −1
export function createMarkRings({ doc = document } = {}) {
  if (!doc.getElementById('lk-marks-css')) { const st = doc.createElement('style'); st.id = 'lk-marks-css'; st.textContent = '.lk-mark.next{border-color:rgb(var(--lk-cream,239 230 210) / .7);opacity:.8}.lk-mark.next::after{background:rgb(var(--lk-cream,239 230 210) / .7)}'; doc.head.appendChild(st); }
  const rings = [];
  return {
    get count() { return rings.filter((r) => r.at).length; },
    update({ ats = [] } = {}) {
      while (rings.length < ats.length) { const r = createMarkRing({ doc }); if (rings.length) r.el.classList.add('next'); rings.push(r); }
      rings.forEach((r, i) => r.update({ at: ats[i] ?? null }));
    },
    nearIndex(x, y) { for (let i = 0; i < rings.length; i++) if (rings[i].near(x, y)) return i; return -1; },
    dispose() { for (const r of rings) r.dispose(); rings.length = 0; },
  };
}
