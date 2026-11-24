// The first-race pieces on the page (owner, 2026-10-30): the briefing card with its animated mini-chart and the difficulty choice, the
// rival intro's caption, the rival's marker at the screen edge. Brand: navy glass, cream type, amber only lit. Models: src/race/newbie.js.
import { ensureTokens } from '../../../../src/ui/tokens.js';
import { briefModel, RULES_TEXT, DIFFICULTY, BRIEF } from '../../../../src/sim/race/newbie.js';
import { cruiseLine, touchNow } from '../../../../src/ui/modeLines.js';
import { isCoarse } from '../../../../src/ui/touchMap.js';

const CSS = `
.lk-bf{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:calc(var(--lk-z-dock) + 3);width:min(44em,92vw);max-height:92vh;overflow:auto;padding:1em 1.3em 1.1em;
  font:var(--lk-regular) var(--lk-fs-body)/1.3 var(--lk-ui);color:var(--lk-ink);background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);border-radius:var(--lk-glass-r);box-shadow:var(--lk-glass-shadow);letter-spacing:var(--lk-track)}
.lk-bf[hidden]{display:none}
.lk-bf h3{margin:0 0 .5em;font:var(--lk-medium) var(--lk-fs-label)/1.1 var(--lk-font);letter-spacing:var(--lk-track-wide);text-transform:uppercase;color:var(--lk-ink-faint)}
.lk-bf .body{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:1em;align-items:start}
:where(:root[data-screen~=slim]) .lk-bf .body{grid-template-columns:1fr}
.lk-bf svg.chart{width:100%;height:auto;display:block;background:rgb(var(--lk-shade) / .45);border:var(--lk-line) solid var(--lk-glass-edge);border-radius:var(--lk-radius)}
.lk-bf .legs{fill:none;stroke:var(--lk-ink);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:4 3}
.lk-bf .draw{fill:none;stroke:var(--lk-ink);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:var(--len) var(--len);stroke-dashoffset:var(--len);animation:lk-bf-draw 8s var(--lk-ease) .6s forwards}
@keyframes lk-bf-draw{to{stroke-dashoffset:0}}
.lk-bf .ln{stroke:var(--lk-ink);stroke-width:2.2;stroke-linecap:round}
.lk-bf .mk{fill:var(--lk-glass-dense);stroke:var(--lk-ink);stroke-width:1.6}
.lk-bf text{fill:var(--lk-ink);font:var(--lk-medium) 7px var(--lk-ui)}
.lk-bf text.soft{fill:var(--lk-ink-soft);font-weight:var(--lk-regular)}
.lk-bf .arrow{fill:var(--lk-ink)}
.lk-bf ol{margin:0 0 .7em;padding-left:1.2em}.lk-bf li{margin:.25em 0}
.lk-bf .dif{display:flex;gap:.5em;margin:.4em 0 .2em;flex-wrap:wrap}
.lk-bf .dif button,.lk-bf .btns button{all:unset;box-sizing:border-box;cursor:pointer;padding:.4em .85em;border:var(--lk-line) solid var(--lk-hair);border-radius:var(--lk-radius);color:var(--lk-ink);font-weight:var(--lk-medium);touch-action:manipulation}
.lk-bf .dif button[aria-checked=true]{color:var(--lk-lit-ink);background:var(--lk-lit-fill);border-color:var(--lk-lit)}
.lk-bf button:hover,.lk-bf button:focus-visible{color:var(--lk-lit-ink);border-color:var(--lk-lit)}
.lk-bf .btns{display:flex;gap:.8em;margin-top:.5em;justify-content:flex-end}
.lk-intro{position:fixed;left:50%;bottom:calc(var(--lk-my) + 6em);transform:translateX(-50%);z-index:calc(var(--lk-z-dock) + 2);padding:.5em 1.1em;text-align:center;font:var(--lk-medium) var(--lk-fs-label)/1.2 var(--lk-ui);letter-spacing:var(--lk-track);color:var(--lk-ink);
  background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);border-radius:var(--lk-glass-r);box-shadow:var(--lk-glass-shadow);pointer-events:none}
.lk-intro small{display:block;margin-top:.2em;font-size:var(--lk-fs-caption);color:var(--lk-ink-soft);font-weight:var(--lk-regular)}
.lk-intro[hidden]{display:none}
.lk-edge{white-space:nowrap;position:fixed;z-index:calc(var(--lk-z-dock) + 1);display:flex;align-items:center;gap:.4em;padding:.25em .55em;transform:translate(-50%,-50%);pointer-events:none;
  font:var(--lk-medium) var(--lk-fs-caption)/1 var(--lk-ui);color:var(--lk-ink);background:var(--lk-glass);border:var(--lk-line) solid var(--lk-glass-edge);border-radius:var(--lk-glass-r)}
.lk-edge svg{width:1.3em;height:1.3em;fill:var(--lk-ink);flex:none}
.lk-edge[hidden]{display:none}
`;
const style = () => { ensureTokens(); if (!document.getElementById('lk-bf-css')) { const st = document.createElement('style'); st.id = 'lk-bf-css'; st.textContent = CSS; document.head.appendChild(st); } };

function briefChartSvg(model) {
  const { w, h } = model, d = model.route.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const arrows = model.route.slice(1).map((p, i) => { const a = model.route[i], ang = Math.atan2(p[0] - a[0], -(p[1] - a[1])) * 180 / Math.PI, mx = (a[0] + p[0]) / 2, my = (a[1] + p[1]) / 2;
    return `<path class="arrow" transform="translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${ang.toFixed(0)})" d="M0 -4L3.2 3L0 1.4L-3.2 3Z"/>`; }).join('');
  const marks = model.marks.map((m) => `<g><circle class="mk" cx="${m.at[0]}" cy="${m.at[1]}" r="4.2"/><text x="${m.at[0] + 7}" y="${m.at[1] + 2.5}">${m.id}</text></g>`).join('');
  const [c, p] = model.line;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="the course: start line, then the island mark, then back to the line">`
    + `<path class="legs" d="${d}"/><path class="draw" style="--len:${Math.round(model.route.reduce((s, q, i, a) => s + (i ? Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) : 0), 0) + 4)}" d="${d}"/>${arrows}`
    + `<line class="ln" x1="${c[0]}" y1="${c[1]}" x2="${p[0]}" y2="${p[1]}"/><text class="soft" x="${model.finish[0] - 8}" y="${model.finish[1] + 14}" text-anchor="end">Start and finish</text>${marks}`
    + `<text class="soft" x="6" y="12">N</text><path class="arrow" d="M12 15 L12 24 M9 19 L12 15 L15 19" style="stroke:var(--lk-ink-soft);fill:none;stroke-width:1.2"/><text class="soft" x="${w - 74}" y="12">wind from SSW</text></svg>`;
}

export function createBriefing({ course, flow, onStart, root = document.body, help = false, services = null }) {   // services: Sail's modality (lines.js touchNow)
  style();
  const model = briefModel(course), el = document.createElement('div');
  el.className = 'lk-bf'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'race briefing'); el.hidden = true;
  const paint = () => {
    el.innerHTML = `<h3>${course.name} · your briefing</h3><div class="body"><div>${briefChartSvg(model)}</div><div>`
      + `<ol>${RULES_TEXT.map((r) => `<li>${r}</li>`).join('')}</ol>`
      + `<div class="dif" role="radiogroup" aria-label="difficulty">${DIFFICULTY.map((x) => `<button type="button" role="radio" data-d="${x.id}" aria-checked="${x.id === flow.difficulty}" title="${x.line}" aria-label="${x.label}: ${x.line}">${x.label}</button>`).join('')}</div>`
      + `</div></div><div class="btns"><button type="button" data-act="skip">Skip</button><button type="button" data-act="go">${help ? 'Close' : cruiseLine('start', { touch: touchNow(null, isCoarse, services) })}</button></div>`;
  };
  paint();
  root.appendChild(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest?.('button'); if (!b) return;
    if (b.dataset.d) { if (!help) { flow.choose(b.dataset.d); paint(); } return; }
    if (b.dataset.act === 'go' || b.dataset.act === 'skip') onStart();
  });
  const key = (e) => { if (!el.hidden && (e.code === 'Enter' || (e.code === 'Escape' && help))) { e.stopPropagation?.(); onStart(); } };
  addEventListener('keydown', key, true);
  return { el, model, show() { paint(); el.hidden = false; }, hide() { el.hidden = true; }, get visible() { return !el.hidden; }, dispose() { removeEventListener('keydown', key, true); el.remove(); } };
}

export function createIntroCaption({ root = document.body, services = null } = {}) {
  style();
  const el = document.createElement('div'); el.className = 'lk-intro'; el.hidden = true;
  el.innerHTML = `Your rival: Wren on Osprey · sail 17<small>${cruiseLine('skipIntro', { touch: touchNow(null, isCoarse, services) })}</small>`;
  root.appendChild(el);
  return { el, show(on) { el.hidden = !on; }, dispose() { el.remove(); } };
}

export function createEdgeMarker({ root = document.body } = {}) {
  style();
  const el = document.createElement('div'); el.className = 'lk-edge'; el.hidden = true;
  el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L20 20L12 16L4 20Z"/></svg><span></span>';
  root.appendChild(el);
  const arrow = el.querySelector('svg'), tx = el.querySelector('span');
  return { el, paint(m, text) { el.hidden = !m.offscreen; if (m.offscreen) { el.style.left = `${m.x}px`; el.style.top = `${m.y}px`; arrow.style.transform = `rotate(${m.angleDeg.toFixed(0)}deg)`; if (tx.textContent !== text) tx.textContent = text; } }, dispose() { el.remove(); } };
}
export { BRIEF };
