// Plan's layer on the live chart (ui/chart/liveChart.js): the passage as solid legs from the boat through each corner (the planner's
// own path round the land and the shoal), the corners numbered with their arrival times, the boat (mapBoat.js: the dial's drawing at
// her trim), and the small wind dial at the top right (a thin ring, N, the true wind's needle and its one number). No wind lines on
// the map. A click on open water lays a corner (the chart's 'water' tap); a refusal says why on the plate.
//   const m = mountPlanMap({ chart, plan, B, windField, clock, say })   m.frame(dt) each frame while the chart shows; m.destroy()
import { mountMapBoat, mapBoatPx } from './mapBoat.js';
import { hm } from './plan.js';

const CSS = `
.lkp-map{position:absolute;inset:0;z-index:2;pointer-events:none}
.lkp-wind{position:absolute;z-index:4;right:22px;top:22px;width:84px;pointer-events:none;color:rgb(var(--plan-gl-ink));text-align:center}
.lkp-wind .face{width:84px;height:84px;border-radius:50%;background:var(--plan-gl-bg);border:1px solid var(--plan-gl-edge);box-shadow:var(--plan-gl-shadow),inset 0 1px 0 var(--plan-gl-rim);
  -webkit-backdrop-filter:blur(14px) saturate(var(--plan-gl-sat));backdrop-filter:blur(14px) saturate(var(--plan-gl-sat))}
.lkp-wind svg{width:84px;height:84px;display:block;overflow:visible}
.lkp-wind .k{margin-top:6px;font:500 10px/1 var(--lk-ui);letter-spacing:.2em;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.45);color:#fff;font-variant-numeric:tabular-nums}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.lkp-wind .face{background:var(--plan-gl-solid)}}
`;
const pad3 = (n) => String(Math.round(((n % 360) + 360) % 360)).padStart(3, '0');

export function mountPlanMap({ chart, plan, B, windField, clock, say = () => {} }) {
  const lkc = chart.el, doc = globalThis.document;
  if (!doc.getElementById('lkp-map-css')) { const st = doc.createElement('style'); st.id = 'lkp-map-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const cv = doc.createElement('canvas'); cv.className = 'lkp-map'; lkc.appendChild(cv);
  const g = cv.getContext('2d');
  const boat = mountMapBoat({ root: lkc, state: () => B.state });
  const wind = doc.createElement('div'); wind.className = 'lkp-wind'; lkc.appendChild(wind);
  wind.innerHTML = '<div class="face"><svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="34" fill="none" stroke="currentColor" stroke-opacity=".35"/><text x="42" y="17" text-anchor="middle" font-size="8" font-family="var(--lk-ui)" letter-spacing="1" fill="currentColor" opacity=".75">N</text><line class="nd" stroke="rgb(var(--plan-gl-accent))" stroke-width="1.8" stroke-linecap="round"/><circle class="nh" r="3" fill="rgb(var(--plan-gl-accent))"/><circle cx="42" cy="42" r="1.6" fill="currentColor" opacity=".6"/></svg></div><div class="k"></div>';
  const nd = wind.querySelector('.nd'), nh = wind.querySelector('.nh'), wk = wind.querySelector('.k');
  // a click on the water lays a corner (the chart sends the tap here while Plan holds its water card back: ui.js)
  const offWater = chart.on('water', (p) => { if (!p || !plan.on) return; const r = plan.addCorner(p.x, p.z); if (!r.ok) say(r.say); });
  const px = (x, z) => { const q = chart.toClient(x, z), r = lkc.getBoundingClientRect(); return [q.x - r.left, q.y - r.top]; };
  let windT = 1;
  const fit = (W, H, dpr) => { if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; } };
  const css = (n) => getComputedStyle(lkc).getPropertyValue(n).trim() || '255 255 255';

  function frame(dt) {
    const r = lkc.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
    if (!W || !H) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    fit(W, H, dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const o0 = px(0, 0), o1 = px(1000, 0), sc = (o1[0] - o0[0]) / 1000;
    const ink = css('--plan-route'), acc = css('--plan-gl-accent');
    const s = B.state, sm = plan.summary(), legs = sm.legs, corners = plan.corners, legI = plan.leg;
    // the passage: done legs faint, the rest solid ink 2 px (never the dashed passage-plan style, which stays Sail's)
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (let i = 0; i < legI && i < corners.length; i++) {
      const a = i ? corners[i - 1] : null, c = corners[i]; if (!a) continue;
      const A = px(...a), C = px(...c); g.strokeStyle = `rgb(${ink} / .35)`; g.lineWidth = 1.5; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(C[0], C[1]); g.stroke();
    }
    g.strokeStyle = 'rgb(0 0 0 / .28)'; g.lineWidth = 4;   // a soft under-stroke so the ink reads on the bright photo
    for (const L of legs) { g.beginPath(); L.path.forEach((p, k) => { const q = px(p[0], p[1]); if (k) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.stroke(); }
    g.strokeStyle = `rgb(${ink} / .95)`; g.lineWidth = 2;
    for (const L of legs) { g.beginPath(); L.path.forEach((p, k) => { const q = px(p[0], p[1]); if (k) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.stroke(); }
    // the corners: numbered, the next one ringed in the accent, the arrival time beside each
    g.textBaseline = 'middle';
    corners.forEach((c, i) => {
      const q = px(c[0], c[1]), done = i < legI, next = i === legI, last = i === corners.length - 1, L = legs.find((l) => l.i === i + 1);
      g.beginPath(); g.arc(q[0], q[1], last ? 8 : 7, 0, Math.PI * 2); g.fillStyle = done ? 'rgba(14,26,46,.45)' : 'rgba(14,26,46,.82)'; g.fill();
      g.lineWidth = next ? 2 : 1.4; g.strokeStyle = next ? `rgb(${acc})` : `rgb(${ink} / ${done ? 0.45 : 0.95})`; g.stroke();
      g.font = '500 10.5px var(--lk-ui)'; g.textAlign = 'center'; g.fillStyle = `rgb(255 255 255 / ${done ? 0.5 : 0.95})`; g.fillText(String(i + 1), q[0], q[1] + 0.5);
      if (L && !done) {
        g.textAlign = 'left'; g.font = '300 13px var(--lk-font)';
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.45)'; const t = hm(sm.hour + L.t1);
        g.strokeText(t, q[0] + 12, q[1] - 7); g.fillStyle = '#fff'; g.fillText(t, q[0] + 12, q[1] - 7);
        g.font = '500 9.5px var(--lk-ui)'; const w = last ? 'ARRIVE' : `CORNER ${i + 1}`;
        g.strokeText(w, q[0] + 12, q[1] + 7); g.fillStyle = 'rgba(255,255,255,.75)'; g.fillText(w, q[0] + 12, q[1] + 7);
      }
    });
    // the boat: the dial's drawing at her trim, turned to the heading
    const b = px(s.x, s.z);
    boat.place({ x: b[0], y: b[1], sizePx: mapBoatPx(sc), headingDeg: (s.heading * 180) / Math.PI });
    boat.update(dt);
    // the wind dial: 4 Hz is enough for one number
    windT += dt;
    if (windT > 0.25) {
      windT = 0;
      const dir = sm.windDir, th = ((dir + 180) * Math.PI) / 180, tip = [42 + Math.sin(th) * 26, 42 - Math.cos(th) * 26], tail = [42 - Math.sin(th) * 26, 42 + Math.cos(th) * 26];
      nd.setAttribute('x1', tail[0].toFixed(1)); nd.setAttribute('y1', tail[1].toFixed(1)); nd.setAttribute('x2', tip[0].toFixed(1)); nd.setAttribute('y2', tip[1].toFixed(1));
      nh.setAttribute('cx', tip[0].toFixed(1)); nh.setAttribute('cy', tip[1].toFixed(1));
      const k = `${Math.round(sm.windKn)} KN · ${pad3(dir)}°`; if (wk.textContent !== k) wk.textContent = k;
    }
  }
  return {
    frame,
    get wind() { return wk.textContent; },
    destroy() { offWater(); boat.destroy(); cv.remove(); wind.remove(); },
  };
}
