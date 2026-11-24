// The helm station's layout (refactor round 2, Phase D: moved unchanged from helmStation.js, which re-exports it): pure
// functions of the window, the device kind and the insets; tests/helmStation.test.mjs and the layout tests call them.
import { deviceKind } from '../../ui/device.js';

// ---- the layout (pure; tests/helmStation.test.mjs) ----------------------------------------------------------------------
// v: { w, h } the viewport; d: the instrument circles' diameter; by: the bottom margin; mx: the side margin; coarse: a finger;
// kind: the device tier (device.js; from w, h, coarse when absent); inset: the safe areas (css px: l, r, b); top: the bar's foot
// (an upright phone's circles stand there). Returns css-px rects (x, y, w, h) for wheel, jib, main, panel, thr (the throttle
// lever), more (the PANEL row, phones), dial (the wind dial, phones), chart (an upright phone), the panel's form and the lit
// word's size.
export function helmLayout({ w, h, d = 220, by = 14, mx = 40, coarse = false, kind = null, inset = {}, jib: jibOn = true, rowH = 46, trimAt = 'top', top = null } = {}) {
  kind ??= deviceKind({ w, h, coarse });
  const R = (x, y, ww, hh) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(ww), h: Math.round(hh) });
  const L = Math.max(16, inset.l ?? 0), Rt = Math.max(16, inset.r ?? 0);
  if (kind === 'phone-land') {
    //: steering under the left thumb (the wheel in the corner, the throttle beside it), the sheets under the right
    // (MAIN in the corner, JIB inboard, the wind dial above them); SAILS · ANCHOR · PANEL · CHART in the bottom centre
    const base = h - Math.max(20, (inset.b ?? 0) - 4);   // 20 px clear of the bottom edge: the SAILS / ANCHOR keys and the winch tapes draw 8 px below their rects
    const wheel = R(L, base - 114, 114, 114);
    const thr = R(wheel.x + wheel.w + 12, base - 134, 60, 134);
    const main = R(w - Rt - 78, base - 78 - 12, 78, 78), jib = R(main.x - 80, main.y, 78, 78);
    const kw = 4 * 60, panel = R(Math.max(thr.x + thr.w + 104, Math.min(jib.x - 16 - kw, w / 2 - kw / 2)), base - 60, kw, 60);
    const more = R(w / 2 - 6 * 62 / 2, panel.y - 8 - 66, 6 * 62, 66);
    const dial = R(main.x + main.w - 124, main.y - 6 - 124, 124, 124);
    const cd = Math.round(d), chart = R(wheel.x, wheel.y - 6 - 44 - 6 - cd, cd, cd);   // 44 px of it is the Tack button's, which stands on the wheel   // the heading / chart circle stands above the wheel and the lever, as the wind dial stands above the winches
    return { kind, form: 'keys', u: 1, wheel, thr, jib, main, panel, more, dial, chart, steps: false, tape: 12, word: 13, knob: 30, eng: 8.5 };
  }
  if (kind === 'phone-port') return portraitLayout({ w, h, inset, top });
  // desktop and tablet (owner, 2026-10-30): ONE group in the middle, chart and wind in the corners: the wheel, the two winches, the
  // control panel and the throttle lever, one shared height H, one gap g, bottoms on the row's baseline, the group centred under
  // the boat.: wheel 128 · JIB 102 · MAIN 102 · panel 192 (three 64 u columns) · lever 64, and the lit word beside the
  // lever (104 u). A tablet runs at u = 1 (the desktop's own sizes, not the phone's), its circles 200 px (180 in portrait).
  const u = kind === 'tablet' ? 1 : gridUnit({ w, d, mx });
  const H = 128 * u, g = 8 * u, tape = 14 * u, ww = 0.8 * H, pw = 192 * u, tw = 64 * u, word = 104 * u;
  const G = GRID_W * u, x0 = w / 2 - G / 2, y0 = h - gridBottom({ h, by, kind }) - H;
  const wheel = R(x0, y0, H, H);
  const view = (x) => R(x, y0, ww, H - tape - 2 * u);   // the winch's 3D view; its tape sits under it inside the slot
  const jib = view(x0 + H + g), main = view(x0 + H + g + ww + g);
  const panel = R(x0 + H + 2 * ww + 3 * g, y0, pw, H);
  const thr = R(panel.x + pw + g, y0, tw, H);
  // the pro trim panel (trimPanel.js), in Pro only: on top of the control panel, right-aligned with it (?trimpanel=right: beside it)
  const trw = 200 * u, th = 96 * u;
  const trim = trimAt === 'right' ? R(thr.x + tw + 6 * u + word + g, y0 + H - th, trw, th) : R(panel.x + panel.w - trw, y0 - 6 * u - th, trw, th);
  return { kind, form: 'grid', u, wheel, jib, main, panel, thr, trim, steps: kind === 'desktop', tape, H, word: 15 * u, knob: Math.max(22 * u, kind === 'tablet' ? 30 : 0), eng: 11 * u, group: R(x0, y0, G, H) };
}
// The desktop group's unit (fix/helm-fullscreen, owner 2026-11-05: on a 14-inch MacBook Pro in full screen, 1512 x 982 css px,
// the wheel slid under the chart circle). u grew with the circles (d / 220: 1.37 at 982 px tall) but the room between the circles
// grows with the width: at 1512 x 982 the group was 998 px wide in an 816 px gap. Any screen narrower than about 1.74 : 1 (16:10,
// 3:2, the notched Macs) overlapped. u is now the smaller of the two, so the group (GRID_W u wide, centred) keeps `clear` px
// from both circles; never under 0.8 (the panel's own floor, tokens.css --lk-u) unless the circles' size asks for less.
export const GRID_W = 128 + 2 * 0.8 * 128 + 192 + 64 + 4 * 8 + 6 + 104;   // wheel, two winch views, panel, lever, 4 gaps, the lit word: 730.8 u
export function gridUnit({ w, d = 220, mx = 40, clear = 12 } = {}) {
  const fit = (w - 2 * (mx + d + clear)) / GRID_W;
  return Math.max(Math.min(d / 220, fit), Math.min(d / 220, 0.8));
}
// the desktop group's foot above the bottom edge: the shared edge gap (by), or 2.6 % of the height on a tall screen, so the
// winches' tapes and the lever's ASTERN keep clear of the edge (1512 x 982: 26 px, was 16); a tablet keeps by
export const gridBottom = ({ h, by = 14, kind = 'desktop' } = {}) => (kind === 'tablet' ? by : Math.max(by, Math.round(0.026 * h)));
// iPhone upright (owner, 2026-10-31: "for portrait mode we need to adjust the control layout"; replaces's reduced
// set): a bottom band of three columns, both circles at the top, the boat between them.
//   left    the wheel, its foot on the band's base (the steering thumb)
//   middle  the two trim winches side by side, JIB and MAIN with their tapes; under them SAILS · ANCHOR · PANEL · CHART in one row
//   right   the throttle lever, its lit word above it inside the column (never over the boat or the wheel)
//   top     the chart circle (HDG, SOG, DPT) at the left, the wind dial (AWA, AWS) at the right, under the bar (top: the bar's
//           foot + its gap, css px; the notch and the Dynamic Island are under the bar already)
// inset: the safe areas (css px: l, r, b); every target 44 px or more at 375 px wide.
const PORTRAIT = { side: 10, gap: 6, winchGap: 10, keysH: 62, cpU: 1.05, tapeH: 14, winch: 80, thrW: 58, litH: 30, circ: 120, circGap: 12 };
function portraitColumns(w, inset = {}) {
  const P = PORTRAIT, l = Math.max(P.side, inset.l ?? 0), r = Math.max(P.side, inset.r ?? 0), W = w - l - r;
  const left = Math.round(Math.max(92, Math.min(116, W * 0.27))), right = P.thrW, mid = W - left - right - 2 * P.gap;
  return { l, r, left, mid, right, x: [l, l + left + P.gap, l + left + P.gap + mid + P.gap] };
}
export function portraitLayout({ w, h, inset = {}, top = null }) {
  const P = PORTRAIT, R = (x, y, ww, hh) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(ww), h: Math.round(hh) });
  const C = portraitColumns(w, inset), base = h - Math.max(12, inset.b ?? 0);
  const s = Math.min(P.winch, Math.floor((C.mid - P.winchGap) / 2));   // the winches' pads reach 4 px past their views: 10 px apart
  const panel = R(C.x[1], base - P.keysH, C.mid, P.keysH);
  const wy = panel.y - P.gap - P.tapeH - s, wx = C.x[1] + (C.mid - 2 * s - P.winchGap) / 2;
  const jib = R(wx, wy, s, s), main = R(wx + s + P.winchGap, wy, s, s);
  const band = R(C.l, wy, w - C.l - C.r, base - wy);
  const wheel = R(C.x[0], base - C.left, C.left, C.left);
  const lit = R(C.x[2], band.y, C.right, P.litH);
  const thr = R(C.x[2], band.y + P.litH, C.right, base - band.y - P.litH);
  const t = top ?? 16 + 40 + 10, cl = Math.max(12, inset.l ?? 0), cr = Math.max(12, inset.r ?? 0);
  const d = Math.round(Math.min(P.circ, (w - cl - cr) * 0.3));
  const chart = R(cl, t, d, d), dial = R(w - cr - d, t, d, d);
  const more = R(w / 2 - 6 * 58 / 2, band.y - 8 - 66, 6 * 58, 66);
  return { kind: 'phone-port', form: 'keys', u: 1, wheel, thr, lit, jib, main, panel, more, dial, chart, band, cols: C, cpU: P.cpU, steps: false, tape: 12, word: 12, knob: 30, eng: 8.5, litAt: 'top' };
}
// Which device kinds get the 3D cockpit (feat/cockpit-phone, stage 3, owner 2026-11-06): a desktop, and a phone held sideways (the
// same object, laid out for 844 x 390 to 932 x 430). An upright phone keeps its compact helm; a tablet its grid.
export const cockpitKind = (kind) => kind === 'desktop' || kind === 'phone-land';
// The phone's hit cells (feat/cockpit-phone): on 844 x 390 the small parts stand closer than a finger, so their cells (each ≥ 44 px,
// over its part) are pushed apart sideways where two overlap, half each, until none does (pure: tests/helmStation.test.mjs).
// rects: { id: { x, y, w, h } } (css px); returns new rects, the same sizes
export function spreadCells(rects, { gap = 0, iters = 40 } = {}) {
  const ids = Object.keys(rects).filter((k) => rects[k]);
  const r = Object.fromEntries(ids.map((k) => [k, { ...rects[k] }]));
  for (let it = 0; it < iters; it++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = r[ids[i]], b = r[ids[j]];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap, oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox <= 0.01 || oy <= 0) continue;
      const sg = a.x + a.w / 2 <= b.x + b.w / 2 ? 1 : -1;
      a.x -= sg * ox / 2; b.x += sg * ox / 2; moved = true;
    }
    if (!moved) break;
  }
  for (const k of ids) { const q = r[k]; q.x = Math.round(q.x * 2) / 2; }
  return r;
}
export const overlaps = (a, b, pad = 0) => !!a && !!b && a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
