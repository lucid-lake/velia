// The instruments' faces (feat/cockpit-dials, owner 2026-11-06: placement (a), the dials set into the coaming's ends): each
// dial drawn to a canvas that the cockpit (cockpit3d.js) lays on its 3D face as the backlit emissive map. The content is the
// live dials' own: the wind dial's SVG (captainView.js: the teaching boat, the sails' angles, luff and stall, the no-go wedge,
// the arrow, the tick ring) re-stroked from its paths, and the chart dial's own canvas (chartplotter.js) under big HDG, SOG and
// DPT. Drawn for daylight: a dark face, bright cream marks, red and green accents, thick enough to read at ≈ 120 px; by night
// the same in red-amber.
//
//   const f = createDialFaces();              // f.canvas.chart, f.canvas.wind (FACES.px square)
//   f.drawWind(svg, read, { night, grow })    // read: windRead(state)
//   f.drawChart(src, read, { night, grow })   // src: the chart dial's canvas (or null); read: { hdg, sog, dpt, alarm }
// When: FaceClock (pure) redraws a face only when its key changed, at most FACES.steadyHz (FACES.busyHz while the player
// trims), and the chart at least every FACES.beatS (its map scrolls under the boat).
import { KN } from '../../ui/captainView.js';

export const FACES = { px: 384, steadyHz: 4, busyHz: 10, beatS: 1, glow: 1.6, glowS: 0.35 };
const DEG = Math.PI / 180;

// the readings the wind face prints (the same rules as the wind dial's plate)
export function windRead(s) {
  const awa = s?.apparentWind?.angle ?? 0, aws = s?.apparentWind?.speed ?? 0, aw = Math.abs(awa) / DEG;
  return { awa: String(Math.round(aw)), side: aw < 5 || aw > 175 ? '' : awa < 0 ? 'P' : 'S', aws: (aws * KN).toFixed(1) };
}
// the key of what the wind face shows: the readings and the boat's drawn parts, quantised to what a ≈ 120 px face can show
export function windKey(s, { night = false, grow = false, t = 0 } = {}) {
  if (!s) return '';
  const r = windRead(s), q = (v, st) => Math.round((v ?? 0) / st);
  const luff = (s.mainFill ?? 1) < 0.85 || (s.jibFill ?? 1) < 0.85;   // a luffing sail flutters: its phase is part of the picture
  return [r.awa, r.side, r.aws, q(s.boomAngle, DEG), q(s.jibAngle, DEG), q(s.mainFill, 0.05), q(s.jibFill, 0.05), q(s.mainStall, 0.1), q(s.jibStall, 0.1),
    q(s.rudderAngle, 0.5 * DEG), q(s.trueWind?.angle, 2 * DEG), luff ? Math.floor(t * 12) : 0, night ? 1 : 0, grow ? 1 : 0].join();
}
export const chartKey = (read, { night = false, grow = false } = {}) => (read ? [read.hdg, read.sog, read.dpt, read.alarm, night ? 1 : 0, grow ? 1 : 0].join() : '');

// one face's clock: redraw when the key changed and the interval has passed, or on the heartbeat (beat s; 0: none), or forced
export class FaceClock {
  constructor({ beat = 0 } = {}) { this.beat = beat; this.key = null; this.since = Infinity; this.n = 0; }
  tick(dt, key, { busy = false, force = false } = {}) {
    this.since += dt;
    const gap = 1 / (busy ? FACES.busyHz : FACES.steadyHz);
    const due = force || (key !== this.key && this.since >= gap - 1e-4) || (this.beat > 0 && this.since >= this.beat - 1e-4);
    if (due) { this.key = key; this.since = 0; this.n++; }
    return due;
  }
}

// the palettes: day (cream on a deep navy glass) and night (red-amber on near black)
const PAL = {
  day: { g0: '#16213a', g1: '#070b14', ink: '#F6EEDC', inkA: (a) => `rgba(246,238,220,${a})`, port: '#FF6A5C', stbd: '#4FD68A', amber: '#F7C060', navy: 'rgba(7,11,20,.85)', scrim: '7,11,20' },
  night: { g0: '#1c0806', g1: '#070202', ink: '#FF7A5E', inkA: (a) => `rgba(255,122,94,${a})`, port: '#FF5A4C', stbd: '#3E9E62', amber: '#FFA068', navy: 'rgba(7,2,2,.85)', scrim: '7,2,2' },
};
const FONT = (px, w = 700) => `${w} ${Math.round(px)}px "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", sans-serif`;

export function createDialFaces({ px = FACES.px } = {}) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = px; return c; };
  const canvas = { chart: mk(), wind: mk() };
  const S = px, U = S / 100, LW = S / 150;   // U: px per dial unit (the SVG's viewBox is 100); LW: one line-weight unit
  const stats = { wind: 0, chart: 0, ms: 0 };
  // a test DOM has no 2D canvas: the faces stay blank there. Both canvases get their context now: a canvas with none is no
  // image to the GPU, and the chart face (drawn first at its beat) was uploaded blank by the warm-up ("CopyExternalImage-
  // ToTexture(): Browser fails extracting valid resource", once per load)
  const able = (() => { try { return typeof DOMMatrix === 'function' && typeof Path2D === 'function' && !!canvas.wind.getContext('2d') && !!canvas.chart.getContext('2d'); } catch { return false; } })();
  // a path of the SVG in the face's px (its group's transform, then the dial's scale); the stroke is then set in face px
  const pathOf = (el, m) => { const p = new Path2D(); const d = el?.getAttribute('d'); if (d) p.addPath(new Path2D(d), m); return p; };
  const matOf = (el) => {
    const g = el?.closest?.('g[transform]'), base = new DOMMatrix([U, 0, 0, U, 0, 0]);
    const t = g?.transform?.baseVal?.consolidate?.()?.matrix;
    return t ? base.multiply(new DOMMatrix([t.a, t.b, t.c, t.d, t.e, t.f])) : base;
  };
  // the glass: a deep radial ground, a soft inner shadow at the rim, the bezel's hairline
  const ground = (g, P) => {
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S);
    const r = g.createRadialGradient(S / 2, S * 0.42, S * 0.05, S / 2, S / 2, S / 2); r.addColorStop(0, P.g0); r.addColorStop(1, P.g1);
    g.fillStyle = r; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.fill();
  };
  const rim = (g) => {
    const v = g.createRadialGradient(S / 2, S / 2, S * 0.4, S / 2, S / 2, S / 2); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = v; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.fill();
  };
  // a bottom (or top) scrim so the numbers sit on a quiet ground
  const scrim = (g, P, y0, y1, a = 0.82) => {
    const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, `rgba(${P.scrim},0)`); gr.addColorStop(0.45, `rgba(${P.scrim},${a})`); gr.addColorStop(1, `rgba(${P.scrim},${a})`);
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.clip(); g.fillStyle = gr; g.fillRect(0, Math.min(y0, y1), S, Math.abs(y1 - y0)); g.restore();
  };
  // a number with its unit (and an optional side chip): centred on x, baseline-centred on y
  const reading = (g, P, { x = S / 2, y, value, unit = '', fs, chip = '', color = P.ink }) => {
    g.textBaseline = 'middle';
    g.font = FONT(fs, 700); const vw = g.measureText(value).width;
    g.font = FONT(fs * 0.5, 600); const uw = unit ? g.measureText(unit).width + fs * 0.08 : 0;
    const cw = chip ? fs * 0.62 : 0, gap = chip ? fs * 0.14 : 0, W = vw + uw + gap + cw;
    let cx = x - W / 2;
    g.fillStyle = color; g.font = FONT(fs, 700); g.textAlign = 'left'; g.fillText(value, cx, y); cx += vw;
    if (unit) { g.font = FONT(fs * 0.5, 600); g.fillText(unit, cx + fs * 0.08, y + fs * 0.14); cx += uw; }
    if (chip) {
      cx += gap; const h = fs * 0.62;
      g.fillStyle = chip === 'P' ? P.port : P.stbd; g.beginPath(); g.roundRect(cx, y - h / 2, cw, h, h * 0.18); g.fill();
      g.fillStyle = P.g1; g.font = FONT(fs * 0.46, 700); g.textAlign = 'center'; g.fillText(chip, cx + cw / 2, y + fs * 0.02);
    }
  };

  // ---- the wind face: the wind dial's SVG, re-stroked ----
  let wEls = null, wSvg = null;
  const pick = (svg) => {
    if (svg === wSvg && wEls) return wEls;
    const q = (c) => svg.querySelector(c), all = (c) => [...svg.querySelectorAll(c)];
    wSvg = svg;
    wEls = { ring: q('.ring'), tick: q('.tick'), bow: q('.bow'), wedge: q('.wedge'), nedgeP: q('.nedge.p'), nedgeS: q('.nedge.s'), hf: q('.hf'), hull: q('.hull'), edgeP: q('.edge.p'), edgeS: q('.edge.s'),
      sheetM: q('.sheet.main'), sheetJ: q('.sheet.jib'), boom: q('.boom'), main: q('.sail.main'), jib: q('.sail.jib'), mast: q('circle.mast'), rud: q('.rud'), wind: q('.wind:not(.head)'), head: q('.wind.head'), trend: q('.trend'), plans: all('.plan') };
    return wEls;
  };
  function drawWind(svg, read, { night = false, grow = false } = {}) {
    if (!able) return;
    const t0 = performance.now(), g = canvas.wind.getContext('2d'), P = night ? PAL.night : PAL.day, E = svg ? pick(svg) : null;
    ground(g, P);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const id = new DOMMatrix([U, 0, 0, U, 0, 0]);
    // the tick ring: 10° ticks, every 30° longer, the bow's mark
    g.strokeStyle = P.inkA(0.92); g.lineWidth = LW * 1.5;
    for (let i = 1; i < 36; i++) { const a = i * 10 * DEG, r1 = i % 3 ? 45.2 : 42.2, r0 = 48.6; g.beginPath(); g.moveTo(S / 2 + Math.sin(a) * r0 * U, S / 2 - Math.cos(a) * r0 * U); g.lineTo(S / 2 + Math.sin(a) * r1 * U, S / 2 - Math.cos(a) * r1 * U); g.lineWidth = LW * (i % 3 ? 1.3 : 2); g.stroke(); }
    g.fillStyle = P.ink; g.beginPath(); g.moveTo(50 * U, 4.6 * U); g.lineTo(46.4 * U, 11.6 * U); g.lineTo(53.6 * U, 11.6 * U); g.closePath(); g.fill();
    if (E) {
      // the no-go wedge (brighter as the bow comes into it) and its port / starboard edges
      const wo = parseFloat(E.wedge?.style.opacity) || 0.12;
      g.fillStyle = P.inkA(Math.min(0.32, wo * 1.15)); g.fill(pathOf(E.wedge, id));
      g.lineWidth = LW * 2; g.strokeStyle = P.port; g.stroke(pathOf(E.nedgeP, id)); g.strokeStyle = P.stbd; g.stroke(pathOf(E.nedgeS, id));
      // the teaching boat (in its plan group's transform)
      const m = matOf(E.hf), K = m.a / U;   // K: the plan's own scale
      g.fillStyle = P.inkA(0.5); g.fill(pathOf(E.hf, m));
      g.strokeStyle = P.ink; g.lineWidth = LW * 1.4; g.stroke(pathOf(E.hull, m));
      g.lineWidth = LW * 2.4; g.strokeStyle = P.port; g.stroke(pathOf(E.edgeP, m)); g.strokeStyle = P.stbd; g.stroke(pathOf(E.edgeS, m));
      g.lineWidth = LW * 0.9; g.strokeStyle = P.inkA(0.85); g.stroke(pathOf(E.sheetM, m)); g.stroke(pathOf(E.sheetJ, m));
      const under = (p, w) => { g.strokeStyle = P.navy; g.lineWidth = w + LW * 2.2; g.stroke(p); };
      const boom = pathOf(E.boom, m); under(boom, LW * 2); g.strokeStyle = P.ink; g.lineWidth = LW * 2; g.stroke(boom);
      for (const [el, a] of [[E.main, 1], [E.jib, 0.92]]) {
        const p = pathOf(el, m), hard = el?.classList.contains('hard');
        g.fillStyle = P.inkA(a); g.fill(p); g.strokeStyle = P.navy; g.lineWidth = LW * (hard ? 2.2 : 1); g.stroke(p);
      }
      if (E.mast) { const cx = +E.mast.getAttribute('cx'), cy = +E.mast.getAttribute('cy'), r = +E.mast.getAttribute('r'), q = m.transformPoint(new DOMPoint(cx, cy));
        g.beginPath(); g.arc(q.x, q.y, Math.max(r * K * U, LW * 2), 0, 7); g.fillStyle = P.ink; g.fill(); g.lineWidth = LW; g.strokeStyle = P.navy; g.stroke(); }
      const rud = pathOf(E.rud, m); under(rud, LW * 2); g.strokeStyle = P.ink; g.lineWidth = LW * 2; g.stroke(rud);
      // the apparent wind: the arrow from the side it blows from, its weight with the strength, coloured by the side
      const side = E.wind?.classList.contains('p') ? P.port : E.wind?.classList.contains('s') ? P.stbd : P.ink;
      const ww = (parseFloat(E.wind?.style.strokeWidth) || 4) * LW * 0.95;
      const wp = pathOf(E.wind, id), hp = pathOf(E.head, id);
      under(wp, ww); g.strokeStyle = side; g.lineWidth = ww; g.stroke(wp);
      g.strokeStyle = P.navy; g.lineWidth = LW * 2.4; g.stroke(hp); g.fillStyle = side; g.fill(hp);
      const to = parseFloat(E.trend?.style.opacity) || 0;
      if (to > 0.01) { g.strokeStyle = P.inkA(to); g.lineWidth = LW * 1.6; g.stroke(pathOf(E.trend, id)); }
    }
    // the readings: AWA big with its side, AWS under it; growing, AWA bigger still and AWS smaller
    scrim(g, P, S * 0.62, S);
    if (read) {
      reading(g, P, { y: S * (grow ? 0.78 : 0.765), value: `${read.awa}°`, fs: S * (grow ? 0.19 : 0.145), chip: read.side });
      reading(g, P, { y: S * (grow ? 0.905 : 0.885), value: read.aws, unit: 'kn', fs: S * (grow ? 0.08 : 0.095), color: P.inkA(0.92) });
    }
    rim(g);
    stats.wind++; stats.ms += performance.now() - t0;
  }

  // ---- the chart face: the chart dial's own canvas, big HDG, SOG and DPT over it ----
  function drawChart(src, read, { night = false, grow = false } = {}) {
    if (!able) return;
    const t0 = performance.now(), g = canvas.chart.getContext('2d'), P = night ? PAL.night : PAL.day;
    ground(g, P);
    if (src && src.width > 0) {
      g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.clip();
      g.filter = night ? 'brightness(.62) contrast(1.1)' : 'brightness(.42) contrast(1.25) saturate(1.15)'; g.drawImage(src, 0, 0, S, S); g.filter = 'none'; g.restore();   // the chart dimmed under the numbers: a dark face, never a pale one
    }
    // the scrims (as the dial's own: the heading's at the top, the speed's and the depth's at the foot)
    scrim(g, P, S * 0.36, 0, 0.86); scrim(g, P, S * 0.56, S, 0.86);
    if (read) {
      const lit = read.alarm ? P.amber : P.ink;
      reading(g, P, { y: S * 0.175, value: `${read.hdg}°`, unit: 'T', fs: S * 0.13 });
      if (grow && read.alarm) {
        reading(g, P, { y: S * 0.705, value: read.sog, unit: 'kn', fs: S * 0.085, color: P.inkA(0.9) });
        reading(g, P, { y: S * 0.83, value: read.dpt, unit: 'm', fs: S * 0.18, color: lit });
      } else {
        reading(g, P, { y: S * 0.705, value: read.sog, unit: 'kn', fs: S * 0.12 });
        reading(g, P, { y: S * 0.845, value: read.dpt, unit: 'm', fs: S * (grow ? 0.15 : 0.12), color: lit });
      }
    }
    rim(g);
    stats.chart++; stats.ms += performance.now() - t0;
  }
  return { canvas, drawWind, drawChart, stats };
}
