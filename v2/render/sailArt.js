// The mainsail's graphics (owner, 2026-11-18: option 4 "Mix" picked from the Phase A mock-ups): the compass rose with the fleur-de-lis
// as the class emblem, the Velia mark in its medallion, the sail number under it, on white Dacron; in Regatta every hull white, each
// rival told apart by her sail (her number, her cloth, her insignia's colour), the same rival the same sail in every race.
// ?sailart=off turns it all off for one release (v2/engine/flags.js): the plain cream main and the coloured hulls.
//   const atlas = sailArtAtlas(device)   one shared r8 glyph atlas (the rose, the mark, 0-9 U S A V) with its mips, ≈ 0.7 MB for the fleet
//   boatArt(i, number)                   the boat's spec (0 the player, 1-5 FLEET's order); packArt(spec) its 4 floats for a record
//   SAIL_ART_WGSL                        artInk(sx, h, starboard, glyphs, grads) -> vec2f (A: number + mark, B: the rose), composed per
//                                        fragment from the atlas: needs `tArt: texture_2d<f32>` and `sArt: sampler` declared beside it
// The print lives in the cloth's own metres (met.x along the chord from the luff, met.y up the luff: render/boat.js CLOTH_WGSL; the
// lite boats' flat main the same frame, render/raceProps.js), so a circle stays a circle on the narrow sail and the print follows the
// camber, the crinkles and the flutter. Both faces print, each read from its own side (the starboard face mirrored); the far face shows
// through the weave. Placed per RRS Appendix G1.3: the insignia above the numbers and back to back, the numbers on both sides with the
// starboard side's uppermost, all wholly above the arc of 60 % of the leech from the head (checked in v2/tests/sail-art.test.mjs);
// 375 mm numbers (G1.2's height for a boat of 8.5–11 m). Drawn from paths (no fonts: deterministic, no load race): a stroke sail-number
// face in the Lucid Lake geometry (round ends, as the Velia word), the Velia mark from brand/velia-mark-mono.svg, the rose after the N3
// card's. Every lookup is a textureSampleGrad on the continuous coordinate's gradients, so a glyph's cell edge never seams and the far
// boats read the atlas's small mips (a faint emblem, never a pop).
import { RIG } from '../../src/boat/rig.js';

export const sailArtOn = (v) => String(v ?? '').toLowerCase() !== 'off';
// the cloths (render/boat.js and raceProps.js: the same order): 0 v1's cream (the plain sail, ?sailart=off), 1 white Dacron,
// 2 cream / tan Dacron, 3 grey laminate (a scrim of threads, glossier, little light through), 4 black laminate
export const CLOTH_KIND = Object.freeze({ cream: 0, white: 1, tan: 2, grey: 3, black: 4 });
// linear colours (render/boat.js reads its own table; the lite boats' this one)
export const CLOTH_LIN = Object.freeze([[0.8632, 0.7913, 0.6445], [0.905, 0.896, 0.855], [0.815, 0.716, 0.521], [0.156, 0.165, 0.184], [0.024, 0.026, 0.031]]);
export const INK = Object.freeze({ navy: '#1C2340', gold: '#C9A45A', red: '#A3312B', green: '#2F6B45', blue: '#2F5E95', white: '#F2F0EA', paleNavy: '#3A4670' });
const chordAt = (y) => { const v = Math.max(0, Math.min(1, y / RIG.mainLuff)); return RIG.boom * (1 - v) + RIG.mainHead * v + RIG.roach * 4 * v * (1 - v); };

// --- the layout on the sail (metres: x along the chord from the luff, y up the luff) ---
// the rose a touch larger than the mock's (1.26 m) so it reads from the Boat view: as large as fits between the luff tape and the leech
// at its height, its medallion holding the mark; the numbers under it (starboard 0.45 m higher than port), the port line's far corner
// just inside the 60 % arc
export const LAYOUT = Object.freeze({ roseX: 0.80, roseY: 5.65, roseD: 1.44, markW: 0.38, medallion: 0.36, numH: 0.375, numYS: 4.35, numYP: 3.9, fit: 0.84 });

// --- the atlas: 1024 × 512, r8 coverage. The rose's cell 512² at (0, 0) (the ring's radius a third of the cell); the mark's 256² at
// (512, 0) (the mark 200 px wide); 16 glyph cells 64 × 128 from (512, 256), 8 a row (the glyph's 100 × 160 box at 0.5 px a unit,
// 7 px in and 24 px down) ---
export const ATLAS = Object.freeze({ w: 1024, h: 512, mips: 8, rose: [0, 0, 512], mark: [512, 0, 256, 200], glyph: [512, 256, 64, 128, 7, 24, 0.5] });
const GLYPH_W = 100, CAP = 160, WEIGHT = 25, TRACK = 14, SPACE = 56;
// glyph codes: 0-9 the digits, 10 U, 11 S, 12 A, 13 V, 14 a space, 15 the end
const GLYPH_CODES = Object.freeze({ U: 10, S: 11, A: 12, V: 13, ' ': 14 });
const GLYPHS = {
  '0': (g) => { g.ellipse(50, 80, 37, 67, 0, 0, Math.PI * 2); },
  '1': (g) => { g.moveTo(28, 36); g.lineTo(58, 13); g.lineTo(58, 147); },
  '2': (g) => { g.arc(50, 49, 36, Math.PI + 0.25, 0.55); g.lineTo(14, 147); g.lineTo(88, 147); },
  '3': (g) => { g.arc(50, 46, 33, Math.PI + 0.45, Math.PI / 2); g.moveTo(50, 79); g.arc(50, 111, 36, -Math.PI / 2, Math.PI - 0.45); },
  '4': (g) => { g.moveTo(68, 147); g.lineTo(68, 13); g.lineTo(12, 108); g.lineTo(90, 108); },
  '5': (g) => { g.moveTo(84, 13); g.lineTo(24, 13); g.lineTo(18, 74); g.arc(50, 105, 42, -Math.PI + 0.85, Math.PI - 0.6); },
  '6': (g) => { g.moveTo(78, 16); g.quadraticCurveTo(14, 52, 12, 108); g.moveTo(90, 107); g.arc(51, 107, 39, 0, Math.PI * 2); },
  '7': (g) => { g.moveTo(12, 13); g.lineTo(88, 13); g.lineTo(38, 147); },
  '8': (g) => { g.moveTo(82, 44); g.arc(50, 44, 32, 0, Math.PI * 2); g.moveTo(87, 112); g.arc(50, 112, 37, 0, Math.PI * 2); },
  '9': (g) => { g.moveTo(22, 144); g.quadraticCurveTo(86, 108, 88, 52); g.moveTo(88, 53); g.arc(49, 53, 39, 0, Math.PI * 2); },
  U: (g) => { g.moveTo(14, 13); g.lineTo(14, 104); g.arc(50, 104, 36, Math.PI, 0, true); g.lineTo(86, 13); },
  S: (g) => { g.arc(50, 46, 33, -0.45, Math.PI / 2, true); g.arc(50, 113, 34, -Math.PI / 2, Math.PI - 0.45); },
  A: (g) => { g.moveTo(10, 147); g.lineTo(50, 13); g.lineTo(90, 147); g.moveTo(25, 104); g.lineTo(75, 104); },
  V: (g) => { g.moveTo(10, 13); g.lineTo(50, 147); g.lineTo(90, 13); },
};
const GLYPH_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'U', 'S', 'A', 'V'];
// the line's width in units (the shader's loop, the same sums)
export const textUnits = (s) => [...s].reduce((w, ch, i) => w + (ch === ' ' ? SPACE : GLYPH_W) + (i ? TRACK : 0), 0);
// the Velia mark (brand/velia-mark-mono.svg, made by tools/brand/gen_lakeshore_mark.py)
const MARK = { vb: [-10, -6, 160, 148], fills: ['M 78 2 L 78 100 L 140 100 Q 124 54 78 2 Z', 'M 70 22 L 8 100 L 58 100 Q 66 64 70 22 Z', 'M 0 108 H 140 L 134 124 H 24 Q 10 124 0 108 Z'], bar: [-4, 130, 148, 5], stroke: 6 };

// --- the boats: 0 the player, 1-5 v2/regatta/session.js FLEET's order (Osprey/wren, Tern, Kestrel, Heron, Plover). One class, one
// layout: each rival her own cloth, and her insignia (the rose) in her colour, the race HUD's chip colour (FLEET's `hull`, kept as the
// boat's identity colour now that every hull is white); the numbers navy on a light cloth, white on a laminate ---
export const RIVAL_CLOTH = Object.freeze({ wren: 'tan', tern: 'white', kestrel: 'white', heron: 'grey', plover: 'black' });
const FALLBACK = [['tan', '#1f2c4a'], ['white', '#8a2a24'], ['white', '#2f5a3c'], ['grey', '#3d6f9e'], ['black', '#b9842c']];
const dark = (cloth) => cloth === 'grey' || cloth === 'black';
export function boatArt(i, number) {
  if (!i) return { number: number ?? 'USA 28', cloth: 'white', inkA: INK.navy, inkB: INK.paleNavy, roseAlpha: 0.62 };
  const [cloth, badge] = FALLBACK[(i - 1) % FALLBACK.length];
  return { number: number ?? `USA ${i}`, cloth, inkA: dark(cloth) ? INK.white : INK.navy, inkB: badge, roseAlpha: 0.85 };
}
// a FLEET entry ({ id, sail, hull }) as her sail: the same rival, the same sail in every race
export function rivalArt(f, i = 1) {
  const cloth = RIVAL_CLOTH[f.id] ?? FALLBACK[(i - 1) % FALLBACK.length][0];
  return { number: `USA ${f.sail}`, cloth, inkA: dark(cloth) ? INK.white : INK.navy, inkB: f.hull ?? INK.navy, roseAlpha: 0.85 };
}
// a colour packed for a record (1 + the sRGB bytes; 0: none)
const packInk = (hex) => 1 + (parseInt(hex.replace('#', ''), 16) & 0xffffff);
// the glyph codes, 4 bits each, the first character in the low bits, 15 past the end (6 characters at most: exact in an f32, < 2^24)
export function packGlyphs(text) {
  const s = String(text).toUpperCase().slice(0, 6);
  let v = 0;
  for (let i = 0; i < 6; i++) { const ch = s[i]; const c = ch == null ? 15 : (GLYPH_CODES[ch] ?? (ch >= '0' && ch <= '9' ? +ch : 14)); v += c * 2 ** (4 * i); }
  return v;
}
// the record's 4 floats: (cloth + 1 + 16 × the rose's opacity in %, ink A, ink B, glyphs); all 0: no print (the plain sail)
export const packArt = (b) => [CLOTH_KIND[b.cloth] + 1 + 16 * Math.round(b.roseAlpha * 100), packInk(b.inkA), packInk(b.inkB), packGlyphs(b.number)];

// --- painting the atlas (a canvas: the browser's) ---
function fleur(c) {   // a fleur-de-lis in a unit box: its foot at (0, 0), its tip at (0, −1)
  c.beginPath();
  c.moveTo(0, -1); c.bezierCurveTo(0.2, -0.78, 0.2, -0.5, 0, -0.3); c.bezierCurveTo(-0.2, -0.5, -0.2, -0.78, 0, -1); c.closePath();
  for (const s of [1, -1]) {
    c.moveTo(0.05 * s, -0.33); c.bezierCurveTo(0.28 * s, -0.78, 0.66 * s, -0.66, 0.52 * s, -0.42); c.bezierCurveTo(0.46 * s, -0.31, 0.32 * s, -0.33, 0.34 * s, -0.44);
    c.bezierCurveTo(0.24 * s, -0.38, 0.16 * s, -0.29, 0.07 * s, -0.19); c.closePath();
  }
  c.rect(-0.27, -0.25, 0.54, 0.08);
  c.moveTo(-0.13, -0.17); c.lineTo(0.13, -0.17); c.lineTo(0.05, 0); c.lineTo(-0.05, 0); c.closePath();
  c.fill();
}
// the rose in ring radii about (0, 0): two rings with the degree ticks between, a 16-point star (each point half solid, half in outline:
// the engraver's light and shade), the fleur-de-lis on north beyond the ring; the medallion left clear for the mark
function rose(c, medallion) {
  const T = Math.PI * 2;
  c.lineWidth = 0.022; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const r of [1, 0.965, 0.86, 0.83]) { c.beginPath(); c.arc(0, 0, r, 0, T); c.stroke(); }
  for (let k = 0; k < 72; k++) { const a = (k / 72) * T, l = k % 2 ? 0.9 : 0.965; c.beginPath(); c.moveTo(Math.sin(a) * 0.86, -Math.cos(a) * 0.86); c.lineTo(Math.sin(a) * l, -Math.cos(a) * l); c.stroke(); }
  const point = (a, len, half) => {
    const tip = [Math.sin(a) * len, -Math.cos(a) * len], l = [Math.sin(a - Math.PI / 2) * half, -Math.cos(a - Math.PI / 2) * half], r = [-l[0], -l[1]];
    c.beginPath(); c.moveTo(0, 0); c.lineTo(r[0], r[1]); c.lineTo(tip[0], tip[1]); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(0, 0); c.lineTo(l[0], l[1]); c.lineTo(tip[0], tip[1]); c.closePath(); c.stroke();
  };
  for (let k = 0; k < 8; k++) point((k + 0.5) * T / 8, 0.5, 0.06);
  for (let k = 0; k < 4; k++) point((k + 0.5) * T / 4, 0.74, 0.1);
  for (let k = 0; k < 4; k++) point(k * T / 4, 0.98, 0.14);   // the cardinals inside the ring (the emblem stays inside the cloth's edges)
  c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(0, 0, medallion, 0, T); c.fill(); c.restore();
  c.beginPath(); c.arc(0, 0, medallion, 0, T); c.stroke();
  c.save(); c.translate(0, -1.02); c.scale(0.42, 0.42); fleur(c); c.restore();
}
function paintAtlas(g) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, ATLAS.w, ATLAS.h); g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  const [rx, ry, rs] = ATLAS.rose;
  g.save(); g.translate(rx + rs / 2, ry + rs / 2); g.scale(rs / 3, rs / 3); rose(g, LAYOUT.medallion); g.restore();
  const [mx, my, ms, mw] = ATLAS.mark, [vx, vy, vw, vh] = MARK.vb, k = mw / vw;
  g.save(); g.translate(mx + ms / 2, my + ms / 2); g.scale(k, k); g.translate(-(vx + vw / 2), -(vy + vh / 2));
  g.lineJoin = 'round'; g.lineWidth = MARK.stroke;
  for (const d of MARK.fills) { const p = new Path2D(d); g.fill(p); g.stroke(p); }
  const [bx, by, bw, bh] = MARK.bar; g.beginPath(); g.roundRect(bx, by, bw, bh, bh / 2); g.fill(); g.restore();
  const [gx, gy, cw, ch, px, py, s] = ATLAS.glyph;
  GLYPH_ORDER.forEach((name, i) => {
    g.save(); g.translate(gx + (i % 8) * cw + px, gy + (i >> 3) * ch + py); g.scale(s, s);
    g.lineWidth = WEIGHT; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); GLYPHS[name](g); g.stroke(); g.restore();
  });
}
function downsample(src, w, h) {   // a 2 × 2 box filter, one level down
  const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1), out = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) { const a = 2 * y * w + 2 * x; out[y * w2 + x] = (src[a] + src[a + 1] + src[a + w] + src[a + w + 1] + 2) >> 2; }
  return { data: out, w: w2, h: h2 };
}
// the atlas's levels: [{ data: Uint8Array, w, h }] (r8), and its bytes
function bakeAtlas() {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(ATLAS.w, ATLAS.h) : Object.assign(document.createElement('canvas'), { width: ATLAS.w, height: ATLAS.h });
  const g = c.getContext('2d', { willReadFrequently: true });
  paintAtlas(g);
  const px = g.getImageData(0, 0, ATLAS.w, ATLAS.h).data, base = new Uint8Array(ATLAS.w * ATLAS.h);
  for (let i = 0; i < base.length; i++) base[i] = px[4 * i];
  const mips = [{ data: base, w: ATLAS.w, h: ATLAS.h }];
  while (mips.length < ATLAS.mips) { const p = mips[mips.length - 1]; mips.push(downsample(p.data, p.w, p.h)); }
  return { mips, bytes: mips.reduce((a, q) => a + q.data.byteLength, 0) };
}
// the GPU atlas, one per device (the boat's cloth and the lite boats share it). on false: a 1 × 1 stand-in, never sampled
const ATLASES = new WeakMap();
export function sailArtAtlas(device, on = true) {
  const key = on ? 'on' : 'off', have = ATLASES.get(device) ?? {};
  if (have[key]) return have[key];
  const T = globalThis.GPUTextureUsage ?? { TEXTURE_BINDING: 4, COPY_DST: 2 };
  const canPaint = typeof Path2D !== 'undefined' && (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined');   // the node tests' stand-in GPU: no canvas, an empty atlas
  const t0 = performance.now(), baked = on && canPaint ? bakeAtlas() : null;
  const tex = device.createTexture({ label: 'sail-art-atlas', size: baked ? [ATLAS.w, ATLAS.h] : [1, 1], format: 'r8unorm', mipLevelCount: baked ? baked.mips.length : 1, usage: T.TEXTURE_BINDING | T.COPY_DST });
  if (baked) baked.mips.forEach((q, lv) => device.queue.writeTexture({ texture: tex, mipLevel: lv }, q.data, { bytesPerRow: q.w, rowsPerImage: q.h }, [q.w, q.h]));
  const sampler = device.createSampler({ label: 'sail-art', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 4, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const a = { tex, view: tex.createView(), sampler, bytes: baked?.bytes ?? 0, bakeMs: +(performance.now() - t0).toFixed(1), on };
  ATLASES.set(device, { ...have, [key]: a });
  return a;
}

// --- the composer (WGSL). g: (d sx/dx, d sx/dy, d h/dx, d h/dy), taken in uniform flow by the caller ---
const f = (x) => Number(x).toFixed(5);
export const SAIL_ART_WGSL = `
const ART_ROSE = vec3f(${f(LAYOUT.roseX)}, ${f(LAYOUT.roseY)}, ${f(LAYOUT.roseD * 0.5)});
const ART_MARK_K = ${f(ATLAS.mark[3] / LAYOUT.markW)};
const ART_NUM = vec4f(${f(LAYOUT.numH)}, ${f(LAYOUT.numYS)}, ${f(LAYOUT.numYP)}, ${f(LAYOUT.fit)});
const ART_AT = vec2f(${ATLAS.w}.0, ${ATLAS.h}.0);
fn artChord(y: f32) -> f32 { let v = clamp(y / ${f(RIG.mainLuff)}, 0.0, 1.0); return ${f(RIG.boom)} * (1.0 - v) + ${f(RIG.mainHead)} * v + ${f(RIG.roach * 4)} * v * (1.0 - v); }
fn artTap(p: vec2f, dx: vec2f, dy: vec2f) -> f32 { return textureSampleGrad(tArt, sArt, p / ART_AT, dx / ART_AT, dy / ART_AT).r; }
fn artInkC(c: vec3f) -> vec3f { let u = u32(max(c.x - 1.0, 0.0) + 0.5); return pow(vec3f(f32((u >> 16u) & 255u), f32((u >> 8u) & 255u), f32(u & 255u)) / 255.0, vec3f(2.2)); }
// the ink at (sx, h) on one face: x the number and the mark (ink A), y the rose (ink B, before its opacity)
fn artInk(sx: f32, h: f32, stbd: bool, glyphs: f32, g: vec4f) -> vec2f {
  let mir = select(1.0, -1.0, stbd);
  var o = vec2f(0.0);
  let dX = vec2f(g.x * mir, -g.z); let dY = vec2f(g.y * mir, -g.w);   // d(local x, local y down)/d(screen x, y), per metre
  let lx = (sx - ART_ROSE.x) * mir; let ly = ART_ROSE.y - h;
  let rr = ART_ROSE.z; let rs = ${f(ATLAS.rose[2] / 3)};
  if (abs(lx) < 1.5 * rr && abs(ly) < 1.5 * rr) {
    let k = rs / rr;
    o.y = artTap(vec2f(${f(ATLAS.rose[0] + ATLAS.rose[2] / 2)} + lx * k, ${f(ATLAS.rose[1] + ATLAS.rose[2] / 2)} + ly * k), dX * k, dY * k);
    let mk = ART_MARK_K;
    if (abs(lx * mk) < ${f(ATLAS.mark[2] / 2)} && abs(ly * mk) < ${f(ATLAS.mark[2] / 2)}) {
      o.x = artTap(vec2f(${f(ATLAS.mark[0] + ATLAS.mark[2] / 2)} + lx * mk, ${f(ATLAS.mark[1] + ATLAS.mark[2] / 2)} + ly * mk), dX * mk, dY * mk);
    }
  }
  let y0 = select(ART_NUM.z, ART_NUM.y, stbd);
  if (h > y0 - 0.1 && h < y0 + ART_NUM.x + 0.1) {
    let gi = u32(glyphs + 0.5);
    var w = 0.0;
    for (var i = 0u; i < 6u; i++) { let c = (gi >> (4u * i)) & 15u; if (c == 15u) { break; } w += select(${GLYPH_W}.0, ${SPACE}.0, c == 14u) + select(0.0, ${TRACK}.0, i > 0u); }
    var k = ART_NUM.x / ${CAP}.0;
    let maxW = artChord(y0 + ART_NUM.x) * ART_NUM.w;
    if (w * k > maxW) { k = maxW / max(w, 1.0); }
    let cx = artChord(y0 + ART_NUM.x * 0.5) * 0.5;
    let ux = (sx - cx) * mir / k + w * 0.5; let uy = (y0 + ${CAP}.0 * k - h) / k;
    var x = 0.0;
    for (var i = 0u; i < 6u; i++) {
      let c = (gi >> (4u * i)) & 15u; if (c == 15u) { break; }
      if (i > 0u) { x += ${TRACK}.0; }
      let adv = select(${GLYPH_W}.0, ${SPACE}.0, c == 14u);
      if (c < 14u && ux >= x - ${TRACK / 2}.0 && ux < x + adv + ${TRACK / 2}.0 && uy > -40.0 && uy < 200.0) {
        let s = ${f(ATLAS.glyph[6])} / k;
        let cell = vec2f(${ATLAS.glyph[0]}.0 + f32(c % 8u) * ${ATLAS.glyph[2]}.0 + ${ATLAS.glyph[4]}.0, ${ATLAS.glyph[1]}.0 + f32(c / 8u) * ${ATLAS.glyph[3]}.0 + ${ATLAS.glyph[5]}.0);
        o.x = max(o.x, artTap(cell + vec2f(ux - x, uy) * ${f(ATLAS.glyph[6])}, dX * s, dY * s));
      }
      x += adv;
    }
  }
  return o;
}`;
