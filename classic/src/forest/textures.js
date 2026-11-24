// The forest's textures, drawn at load from the seed (no downloads, nothing to attribute): one 1024 × 1024 atlas.
//   rows 0 .. 512   needle-cluster cards, 256 × 256 each, one per species (4 a row, species index order)
//   rows 512 .. 768 bark strips, 128 × 256 each, one per species (vertically tileable)
//   rows 768 .. 1024 the manzanita leaf card (0, 768), the log's bark (256, 768), spare
//   import { forestAtlas, CARD_UV, BARK_UV } from './forest/textures.js';
//   const { canvas, texture } = forestAtlas(seed);     // texture: a THREE.CanvasTexture, sRGB, mipmapped
// A card: a branch tip seen flat, the twig along v (0 at the trunk, 1 at the tip), side twigs and needle strokes;
// pines long sparse tufts, firs short dense sprays, cedar flat scale sprays; the alpha is the coverage.
import * as THREE from 'three/webgpu';
import { SPECIES } from './species.js';

const ATLAS = 1024, CARD = 256, BARK_W = 128, BARK_H = 256;
const cardCell = (sp) => sp < 8 ? [sp % 4, Math.floor(sp / 4)] : [sp - 8, 3];   // rows 0–1, then row 3 (row 2 is the bark)
export function CARD_UV(sp) { const [cx, cy] = cardCell(sp); return [cx * CARD / ATLAS, 1 - (cy + 1) * CARD / ATLAS, CARD / ATLAS, CARD / ATLAS]; }   // [u0, v0, du, dv]
export function BARK_UV(sp) { return [sp * BARK_W / ATLAS, 1 - 768 / ATLAS, BARK_W / ATLAS, BARK_H / ATLAS]; }

function lcg(seed) { let s = (seed * 9301 + 49297) % 233280; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
const rgb = (c, m = 1) => `rgb(${Math.round(255 * Math.min(1, c[0] * m))},${Math.round(255 * Math.min(1, c[1] * m))},${Math.round(255 * Math.min(1, c[2] * m))})`;
// linear → sRGB-ish for the canvas (the texture is read back as sRGB)
const srgb = (c, m = 1) => rgb(c.map((v) => Math.pow(Math.min(1, v * m), 1 / 2.2)));

function needleCard(ctx, ox, oy, S, sp, rnd) {
  const C = sp.crown, base = sp.needle, isPine = C.shape === 'pine' || C.shape === 'sugar', isCedar = C.shape === 'cedar';
  const cx = ox + S * 0.5;
  ctx.save();
  ctx.lineCap = 'round';
  // the twig: from the base (v = 0, the trunk end) up the card to the tip
  ctx.strokeStyle = srgb(sp.bark, 0.4); ctx.lineWidth = S * 0.012;
  ctx.beginPath(); ctx.moveTo(cx, oy + S * 0.02); ctx.lineTo(cx, oy + S * 0.96); ctx.stroke();
  const stroke = (x, y, a, len, w, m) => {
    ctx.strokeStyle = srgb(base, m); ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  };
  const needles = (x, y, dir, n, len, spread, w) => {
    for (let k = 0; k < n; k++) {
      const a = dir + (rnd() - 0.5) * spread, L = len * (0.6 + 0.6 * rnd()), m = 0.7 + 0.6 * rnd();
      stroke(x + (rnd() - 0.5) * S * 0.01, y + (rnd() - 0.5) * S * 0.01, a, L, w, m);
    }
  };
  const pairs = isPine ? 6 : 10;
  for (let p = 0; p < pairs; p++) {
    const v = 0.12 + (0.78 * p) / (pairs - 1), y = oy + S * v;
    const len = S * (isPine ? 0.26 : 0.30) * (1 - 0.55 * v);           // side twigs shorten toward the tip
    for (const side of [-1, 1]) {
      const ang = side > 0 ? Math.PI / 2 - (isCedar ? 1.05 : 0.95) : Math.PI / 2 + (isCedar ? 1.05 : 0.95);   // toward the tip
      const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
      ctx.strokeStyle = srgb(sp.bark, 0.38); ctx.lineWidth = S * 0.007;
      ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx + dx, y + dy); ctx.stroke();
      // needles along the side twig
      const segs = isPine ? 4 : 8;
      for (let q = 1; q <= segs; q++) {
        const f = q / segs, x = cx + dx * f, yy = y + dy * f;
        if (isCedar) {
          needles(x, yy, ang - side * 0.5, 3, S * 0.035, 1.2, S * 0.016); needles(x, yy, ang + side * 0.5, 3, S * 0.035, 1.2, S * 0.016);
        } else if (isPine) {
          needles(x, yy, ang, 14, S * 0.12, 1.7, S * 0.011);         // long needles in a tuft, fanning about the twig
        } else {
          needles(x, yy, ang - side * 1.2, 5, S * 0.05, 0.7, S * 0.012); needles(x, yy, ang + side * 1.2, 5, S * 0.05, 0.7, S * 0.012);
        }
      }
    }
    // needles on the main twig
    if (isPine) needles(cx, y, -Math.PI / 2, 12, S * 0.13, 2.0, S * 0.011);
    else needles(cx, y, -Math.PI / 2, 6, S * 0.045, 2.4, S * 0.012);
  }
  // the tip tuft
  needles(cx, oy + S * 0.93, -Math.PI / 2, isPine ? 40 : 14, S * (isPine ? 0.14 : 0.055), isPine ? 2.8 : 1.8, S * (isPine ? 0.011 : 0.012));
  ctx.restore();
}

function barkStrip(ctx, ox, oy, W, H, sp, rnd) {
  const b = sp.bark, style = sp.barkStyle;
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, W, H); ctx.clip();
  ctx.fillStyle = srgb(b, style === 'bleached' ? 1.0 : 0.85); ctx.fillRect(ox, oy, W, H);
  const twice = (f) => { f(0); f(-H); f(H); };   // drawn at y, y−H and y+H: tileable along the trunk
  if (style === 'plates') {
    // broad plates (orange-brown) between dark fissures, like a Jeffrey pine's jigsaw bark
    for (let n = 0; n < 26; n++) {
      const x = ox + rnd() * W, y = oy + rnd() * H, w = W * (0.18 + 0.3 * rnd()), h = H * (0.1 + 0.2 * rnd()), m = 0.8 + 0.5 * rnd();
      twice((dy) => { ctx.fillStyle = srgb(b, m); ctx.fillRect(x - w / 2, y + dy - h / 2, w, h); });
    }
    ctx.strokeStyle = 'rgb(22,14,8)'; ctx.lineWidth = 2.2;
    for (let n = 0; n < 14; n++) {
      const x = ox + rnd() * W, y = oy + rnd() * H;
      twice((dy) => { ctx.beginPath(); ctx.moveTo(x, y + dy); ctx.lineTo(x + (rnd() - 0.5) * 18, y + dy + 30 + rnd() * 60); ctx.stroke(); });
    }
  } else if (style === 'fissured') {
    // deep vertical fissures, cinnamon ridges between
    for (let n = 0; n < 9; n++) {
      const x = ox + (n + 0.5) * W / 9 + (rnd() - 0.5) * 8, w = 3 + rnd() * 5;
      twice((dy) => {
        ctx.strokeStyle = 'rgb(28,16,9)'; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, oy + dy); ctx.lineTo(x + (rnd() - 0.5) * 10, oy + dy + H); ctx.stroke();
        ctx.strokeStyle = srgb(b, 1.25); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + w, oy + dy); ctx.lineTo(x + w + (rnd() - 0.5) * 10, oy + dy + H); ctx.stroke();
      });
    }
  } else if (style === 'grey') {
    for (let n = 0; n < 60; n++) {
      const x = ox + rnd() * W, y = oy + rnd() * H, m = 0.7 + 0.6 * rnd();
      twice((dy) => { ctx.fillStyle = srgb(b, m); ctx.fillRect(x, y + dy, 4 + rnd() * 10, 3 + rnd() * 6); });
    }
    ctx.strokeStyle = 'rgb(40,36,32)'; ctx.lineWidth = 1.5;
    for (let n = 0; n < 16; n++) { const x = ox + rnd() * W, y = oy + rnd() * H; twice((dy) => { ctx.beginPath(); ctx.moveTo(x, y + dy); ctx.lineTo(x + (rnd() - 0.5) * 6, y + dy + 10 + rnd() * 30); ctx.stroke(); }); }
  } else if (style === 'bleached') {
    // silver-grey wood grain, no bark
    for (let n = 0; n < 40; n++) {
      const x = ox + rnd() * W, m = 0.75 + 0.45 * rnd();
      twice((dy) => { ctx.strokeStyle = srgb(b, m); ctx.lineWidth = 1 + rnd() * 3; ctx.beginPath(); ctx.moveTo(x, oy + dy); ctx.lineTo(x + (rnd() - 0.5) * 6, oy + dy + H); ctx.stroke(); });
    }
  } else {   // smooth (manzanita): a glossy red-brown
    for (let n = 0; n < 20; n++) { const y = oy + rnd() * H; twice((dy) => { ctx.fillStyle = srgb(b, 0.8 + 0.5 * rnd()); ctx.fillRect(ox, y + dy, W, 2 + rnd() * 6); }); }
  }
  ctx.restore();
}

function leafCard(ctx, ox, oy, S, sp, rnd) {
  // manzanita / huckleberry oak seen from above: a dense mat of small round grey-olive leaves (value and hue varied), the
  // dark twigs only a hint under them (the red-brown stems read as red dots in the photo's comparison: none drawn bright)
  ctx.save();
  const cx = ox + S / 2;
  ctx.strokeStyle = srgb(sp.bark, 0.7); ctx.lineWidth = S * 0.008;
  for (let n = 0; n < 4; n++) { const a = -Math.PI / 2 + (rnd() - 0.5) * 1.4; ctx.beginPath(); ctx.moveTo(cx, oy + S * 0.97); ctx.lineTo(cx + Math.cos(a) * S * 0.22, oy + S * 0.97 + Math.sin(a) * S * 0.22); ctx.stroke(); }
  for (let n = 0; n < 1100; n++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.5, d = S * (0.03 + 0.9 * Math.sqrt(rnd())), x = cx + Math.cos(a) * d * 0.95, y = oy + S * 0.97 + Math.sin(a) * d;
    const m = 0.55 + 0.75 * rnd(), grey = 0.12 * rnd();   // some leaves greyer (dusty), some richer
    ctx.fillStyle = srgb([sp.needle[0] * (1 + grey), sp.needle[1] * (1 + grey * 0.6), sp.needle[2] * (1 + grey * 1.8)], m);
    ctx.beginPath(); ctx.ellipse(x, y, S * 0.017, S * 0.012, rnd() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function forestAtlas(seed = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, ATLAS, ATLAS);
  const rnd = lcg(seed * 131 + 7);
  SPECIES.forEach((sp, i) => {
    const [cx, cy] = cardCell(i);
    if (sp.kind === 'shrub') leafCard(ctx, cx * CARD, cy * CARD, CARD, sp, rnd);
    else needleCard(ctx, cx * CARD, cy * CARD, CARD, sp, rnd);
    barkStrip(ctx, i * BARK_W, 512, BARK_W, BARK_H, sp, rnd);
  });
  barkStrip(ctx, 512, 768, BARK_W, BARK_H, { bark: [0.36, 0.26, 0.18], barkStyle: 'fissured' }, rnd);   // a fallen log
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return { canvas, texture };
}
