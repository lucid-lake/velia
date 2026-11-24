// The binoculars' instruments (owner, 2026-10-30: "advanced marine binoculars"): drawn inside the figure-eight field
// (binocularsView.js VIGNETTE) as a pair of 7 × 50 marine binoculars with a compass and a rangefinder would show them:
//   - the compass: the true bearing of the view's centre on a scale at the bottom of the field, ticks every 5°, numbers
//     every 10°, the bearing itself in a small window over a fixed index;
//   - a fine reticle in the left eyepiece: a mil scale, ticks every 5 mil, longer every 10;
//   - the rangefinder: the distance to what lies under the centre (the terrain, else the water), "1,240 m", or "– – – m";
//   - 7×50 and the focus (the range, or ∞) small in the right eyepiece;
//   - a subtle coated-glass tint over the field, and a soft lens glare when the sun is near the view.
// Navy and cream, thin but legible (a soft dark halo under every line). Plain DOM + SVG; pure parts tested
// (bearingOf, rangeTo, compassTicks): tests/binocularsHud.test.mjs.
//   const hud = createBinocularsHud({ terrain }); hud.update(k, camera, sunDir); hud.dispose()
import { VIGNETTE } from './binocularsView.js';

const DEG = 180 / Math.PI;
// the true bearing (°, 0 = north, clockwise) of a world direction (x east, z south)
export const bearingOf = (dx, dz) => ((Math.atan2(dx, -dz) * DEG) % 360 + 360) % 360;
// the distance along a ray to the terrain, else to the water (y = 0); null past maxM or looking up at nothing
export function rangeTo(o, d, heightAt, { maxM = 8000 } = {}) {
  let prev = 0;
  for (let s = 20; s <= maxM; s *= 1.03) {
    const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
    const h = heightAt ? heightAt(x, z) : -Infinity;
    if (y <= Math.max(0, h)) {   // refine between the last two samples
      let a = prev, b = s;
      for (let i = 0; i < 12; i++) { const m = (a + b) / 2, hy = heightAt ? heightAt(o.x + d.x * m, o.z + d.z * m) : -Infinity; if (o.y + d.y * m <= Math.max(0, hy)) b = m; else a = m; }
      return b;
    }
    prev = s;
  }
  return null;
}
// the compass scale's marks for a centre bearing: { deg, major, label } from −span to +span about it
export function compassTicks(center, span = 18) {
  const out = [];
  for (let b = Math.ceil((center - span) / 5) * 5; b <= center + span; b += 5) {
    const deg = ((b % 360) + 360) % 360, major = deg % 10 === 0;
    out.push({ off: b - center, deg, major, label: major ? String(deg).padStart(3, '0') : null });
  }
  return out;
}
export const fmtRange = (m) => (m == null ? '– – – m' : `${Math.round(m).toLocaleString('en-US')} m`);

const CSS = `
.lk-bhud{position:fixed;inset:0;z-index:8;pointer-events:none;opacity:0;display:none;color:rgb(239 230 210);font:500 12px/1 var(--lk-ui,system-ui);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.lk-bhud svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.lk-bhud .ln{stroke:rgb(239 230 210 / .82);stroke-width:1;fill:none;vector-effect:non-scaling-stroke}
.lk-bhud .halo{stroke:rgb(12 16 32 / .55);stroke-width:3;fill:none;vector-effect:non-scaling-stroke}
.lk-bhud text{fill:rgb(239 230 210 / .9);paint-order:stroke;stroke:rgb(12 16 32 / .6);stroke-width:2.5px;letter-spacing:.06em}
.lk-bhud .win{fill:rgb(28 35 64 / .78);stroke:rgb(239 230 210 / .55);stroke-width:1;vector-effect:non-scaling-stroke}
.lk-bhud .tint{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgb(120 170 210 / .07),rgb(160 120 210 / .05) 70%,transparent);mix-blend-mode:screen}
.lk-bhud .glare{position:absolute;width:46vh;height:46vh;margin:-23vh 0 0 -23vh;border-radius:50%;opacity:0;
  background:radial-gradient(circle,rgb(255 244 220 / .32),rgb(255 214 170 / .12) 35%,rgb(150 190 255 / .05) 58%,transparent 70%);mix-blend-mode:screen}
:root[data-lk-theme=night] .lk-bhud{color:rgb(255 140 120)}
:root[data-lk-theme=night] .lk-bhud .ln{stroke:rgb(255 120 100 / .8)}:root[data-lk-theme=night] .lk-bhud text{fill:rgb(255 140 120 / .92)}
`;

export function createBinocularsHud({ terrain = null, root = document.body } = {}) {
  if (!document.getElementById('lk-bhud-css')) { const st = document.createElement('style'); st.id = 'lk-bhud-css'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div'); el.className = 'lk-bhud'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="tint"></div><div class="glare"></div><svg><g class="ret"></g><g class="cmp"></g><g class="rng"></g><g class="mag"></g></svg>';
  root.appendChild(el);
  const svg = el.querySelector('svg'), gRet = el.querySelector('.ret'), gCmp = el.querySelector('.cmp'), gRng = el.querySelector('.rng'), gMag = el.querySelector('.mag'), glare = el.querySelector('.glare');
  let W = 0, H = 0, geo = null, shown = -1, rangeT = 0, range = null, lastB = null;
  const NS = 'http://www.w3.org/2000/svg';
  // the field's geometry in css px, the same numbers as the mask (binocularsView.js)
  const layout = () => {
    W = innerWidth; H = innerHeight; const r = VIGNETTE.r * H, dx = VIGNETTE.sep * r / 2;
    geo = { r, cl: [W / 2 - dx, H / 2], cr: [W / 2 + dx, H / 2], fs: Math.max(11, Math.round(H * 0.019)) };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    // the reticle: a mil scale in the left eyepiece (1 mil at this field = r / 60 px: a 6.5° field over 2r ≈ 113 mil)
    const [x, y] = geo.cl, mil = geo.r / 56, len = 30;
    let d = `M${x - len * mil} ${y}H${x + len * mil}M${x} ${y - 20 * mil}V${y + 20 * mil}`;
    for (let i = -len; i <= len; i += 5) { if (!i) continue; const t = i % 10 === 0 ? 3.2 * mil : 1.8 * mil; d += `M${x + i * mil} ${y - t}V${y + t}`; }
    for (let i = -20; i <= 20; i += 5) { if (!i) continue; const t = i % 10 === 0 ? 3.2 * mil : 1.8 * mil; d += `M${x - t} ${y + i * mil}H${x + t}`; }
    gRet.innerHTML = `<path class="halo" d="${d}"/><path class="ln" d="${d}"/>`;
    lastB = null;
  };
  addEventListener('resize', layout); layout();

  const drawCompass = (b) => {
    const [cx] = [W / 2], y = H / 2 + geo.r * 0.8, pxPerDeg = geo.r * 1.05 / 22, fs = geo.fs;
    let d = `M${cx - 18 * pxPerDeg} ${y}H${cx + 18 * pxPerDeg}`, txt = '';
    for (const t of compassTicks(b)) {
      const x = cx + t.off * pxPerDeg, h = t.major ? fs * 0.75 : fs * 0.4;
      d += `M${x} ${y}V${y - h}`;
      if (t.label && Math.abs(t.off) > 2.6) txt += `<text x="${x}" y="${y - fs * 1.05}" text-anchor="middle" font-size="${fs * 0.82}">${t.label}</text>`;
    }
    d += `M${cx} ${y + 3}l-4 6h8z`;   // the fixed index under the centre
    gCmp.innerHTML = `<path class="halo" d="${d}"/><path class="ln" d="${d}"/>${txt}`
      + `<rect class="win" x="${cx - fs * 1.9}" y="${y - fs * 2.25}" width="${fs * 3.8}" height="${fs * 1.45}" rx="3"/>`
      + `<text x="${cx}" y="${y - fs * 1.12}" text-anchor="middle" font-size="${fs * 1.05}" font-weight="600">${String(Math.round(b) % 360).padStart(3, '0')}°</text>`;
  };
  const drawRange = (m) => {
    const x = geo.cr[0], y = H / 2 - geo.r * 0.72, fs = geo.fs;
    gRng.innerHTML = `<rect class="win" x="${x - fs * 4.2}" y="${y - fs * 1.1}" width="${fs * 8.4}" height="${fs * 1.6}" rx="3"/>`
      + `<text x="${x - fs * 3.8}" y="${y + fs * 0.12}" font-size="${fs * 0.7}" opacity=".75">RNG</text><text x="${x + fs * 3.8}" y="${y + fs * 0.15}" text-anchor="end" font-size="${fs}" font-weight="600">${fmtRange(m)}</text>`;
    const mx = geo.cr[0] + geo.r * 0.42, my = H / 2 + geo.r * 0.52;
    gMag.innerHTML = `<text x="${mx}" y="${my}" text-anchor="middle" font-size="${fs * 0.78}">7×50</text><text x="${mx}" y="${my + fs * 1.05}" text-anchor="middle" font-size="${fs * 0.72}" opacity=".8">FOCUS ${m == null || m > 3000 ? '∞' : `${(m / 1000).toFixed(1)} km`}</text>`;
  };
  const v = { x: 0, y: 0, z: 0 };
  function update(k, camera, sunDir = null, dt = 1 / 60) {
    const o = Math.round(k * 100) / 100;
    if (o !== shown) { shown = o; el.style.opacity = String(Math.max(0, (o - 0.6) / 0.4)); el.style.display = o > 0.6 ? 'block' : 'none'; }
    if (o <= 0.6 || !camera) return;
    const e = camera.matrixWorld.elements; v.x = -e[8]; v.y = -e[9]; v.z = -e[10];   // the view's direction
    const b = bearingOf(v.x, v.z);
    if (lastB == null || Math.abs(b - lastB) > 0.05) { drawCompass(b); lastB = b; }
    if ((rangeT -= dt) <= 0) {   // the rangefinder pulses 4 × a second, as a laser one does
      rangeT = 0.25;
      range = rangeTo({ x: camera.position.x, y: camera.position.y, z: camera.position.z }, v, terrain?.heightAt?.bind(terrain));
      drawRange(range);
    }
    // the lens glare: the sun near the view, toward its side of the field
    if (sunDir) {
      const c = v.x * sunDir.x + v.y * sunDir.y + v.z * sunDir.z;   // cos of the angle between the view and the sun
      const a = Math.max(0, Math.min(1, (c - 0.94) / 0.05)) * (sunDir.y > -0.02 ? 1 : 0);
      if (a > 0.01) {
        const rx = (e[0] * sunDir.x + e[1] * sunDir.y + e[2] * sunDir.z), ry = (e[4] * sunDir.x + e[5] * sunDir.y + e[6] * sunDir.z);   // the sun in the camera's right / up
        glare.style.left = `${W / 2 + rx * H * 2.2}px`; glare.style.top = `${H / 2 - ry * H * 2.2}px`;
      }
      glare.style.opacity = a.toFixed(3);
    }
  }
  return { el, update, get range() { return range; }, get bearing() { return lastB; }, dispose() { removeEventListener('resize', layout); el.remove(); } };
}
