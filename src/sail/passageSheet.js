// The plan sheet (§ 6; owner decision 4: beside the enlarged chart on a desktop, below it on an upright
// phone, so the chart's art stays uncovered): one glass plate, the title "Passage · 3 legs", the totals "2.4 nm · about 38
// min · ETA 16:46", one row a leg (n, bearing, distance, point of sail and tacks, time; the active row amber), then the wind
// at the boat and up to two notes in plain words (desktop only). No supplies, fuel or risk table. Read-only: a tap on it
// keeps the chart open.
//   const sh = createPassageSheet({ anchor: () => bigPaneElement });
//   sh.render(plan, { active, wind })   // routePlan()'s answer; active: the plan's leg index that is in force (0) or −1
//   sh.update(show)                      // each frame: shown beside or below the anchor while show is true
//   sheetRows(plan, { active }) → { title, total, rows: [{ n, brg, nm, words, time, on }] }   pure (tests)
import { ensureTokens } from '../ui/tokens.js';
import { etaText } from '../ui/passage.js';

export const SHEET = { widthPx: 372, phoneWidthPx: 300, gapPx: 16, edgePx: 14, minBesidePx: 300 };

const CSS = `
.lk-psheet{position:fixed;z-index:var(--lk-z-chart);box-sizing:border-box;padding:12px 16px;border-radius:14px;overflow:auto;
  background:rgb(var(--lk-brand-navy) / .8);-webkit-backdrop-filter:blur(12px) saturate(.9);backdrop-filter:blur(12px) saturate(.9);
  box-shadow:0 0 0 1px rgb(var(--lk-cream) / .22),0 6px 28px rgb(var(--lk-shade) / .45);color:rgb(var(--lk-cream) / .94);
  font:400 15px/1.35 var(--lk-ui);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;
  opacity:0;pointer-events:none;transition:opacity var(--lk-out) var(--lk-ease-out)}
.lk-psheet.in{opacity:1;pointer-events:auto;transition:opacity var(--lk-in) var(--lk-ease)}
.lk-psheet h2{margin:0 0 8px;font:500 17px/1.2 var(--lk-ui);letter-spacing:.04em}
.lk-psheet h2 small{display:block;font:400 15px/1.3 var(--lk-ui);color:rgb(var(--lk-cream) / .84);letter-spacing:0;margin-top:2px}
.lk-psheet table{border-collapse:collapse;width:100%}
.lk-psheet td{padding:3px 0;vertical-align:baseline;white-space:nowrap}
.lk-psheet td.n{text-align:right;padding-left:10px}
.lk-psheet td.w{width:100%;padding-left:10px;color:rgb(var(--lk-cream) / .84);white-space:normal}
.lk-psheet tr.on td{color:rgb(var(--lk-amber))}
.lk-psheet .note{margin:8px 0 0;padding-top:6px;border-top:1px solid rgb(var(--lk-cream) / .22);color:rgb(var(--lk-cream) / .84)}
.lk-psheet .note p{margin:2px 0}
.lk-psheet.compact .note{display:none}
@media (prefers-reduced-motion:reduce){.lk-psheet{transition:none}}
`;

const pad3 = (d) => String(Math.round(d) % 360).padStart(3, '0');
const nmText = (nm) => (nm < 10 ? nm.toFixed(1) : String(Math.round(nm)));
const minText = (m) => { if (m == null || !Number.isFinite(m)) return '—'; const r = Math.max(1, Math.round(m)); return r < 60 ? `${r} min` : `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')}`; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function sheetRows(plan, { active = 0, eta = false } = {}) {
  const legs = plan?.legs ?? [];
  const title = `Passage · ${plural(legs.length, 'leg', 'legs')}`;
  // no ETA (owner, 2026-11-12, on the nav column: the bar's clock already shows game time, and it runs 10x the boat's minutes)
  const total = [`${nmText(plan?.nm ?? 0)} nm`, plan?.minutes == null ? '— min' : `${plan.about ? 'about ' : ''}${minText(plan.minutes)}`, ...(eta && plan?.eta != null ? [`ETA ${etaText(plan.eta)}`] : [])].join(' · ');
  const rows = legs.map((L, i) => {
    const what = !L.ok ? 'no safe way' : [L.words, L.tacks ? plural(L.tacks, 'tack', 'tacks') : '', L.gybes ? plural(L.gybes, 'gybe', 'gybes') : '', L.name ?? ''].filter(Boolean).join(' · ');
    return { n: String(i + 1), brg: `${pad3(L.brg)}°`, nm: `${nmText(L.distNm ?? L.nm)} nm`, words: what, time: minText(L.minutes), on: i === active };
  });
  return { title, total, rows };
}

export function createPassageSheet({ anchor, doc = globalThis.document, win = globalThis } = {}) {
  ensureTokens(doc);
  if (!doc.getElementById('lk-psheet-css')) { const st = doc.createElement('style'); st.id = 'lk-psheet-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const el = doc.createElement('div'); el.className = 'lk-psheet'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'passage plan');
  el.addEventListener('pointerdown', (e) => e.stopPropagation());   // a tap on the sheet keeps the chart open
  doc.body.appendChild(el);
  let html = '', shown = false, layoutKey = '';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render(plan, { active = 0, wind = '' } = {}) {
    const { title, total, rows } = sheetRows(plan, { active });
    const notes = [wind, ...(plan?.notes ?? [])].filter(Boolean).slice(0, 3);
    const h = `<h2>${esc(title)}<small>${esc(total)}</small></h2><table>${rows.map((r) => `<tr${r.on ? ' class="on"' : ''}><td>${r.n}</td><td class="n">${r.brg}</td><td class="n">${r.nm}</td><td class="w">${esc(r.words)}</td><td class="n">${r.time}</td></tr>`).join('')}</table>${notes.length ? `<div class="note">${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : ''}`;
    if (h !== html) { html = h; el.innerHTML = h; }
  }
  // beside the chart when there is room (a desktop, a sideways phone), else below it (an upright phone)
  function place() {
    const a = anchor?.(); if (!a) return;
    const r = a.getBoundingClientRect(), W = win.innerWidth ?? 0, H = win.innerHeight ?? 0;
    const coarse = !!doc.documentElement?.dataset?.input === 'touch';
    const room = W - r.right - SHEET.gapPx - SHEET.edgePx;
    const key = `${Math.round(r.left)}|${Math.round(r.top)}|${Math.round(r.right)}|${Math.round(r.bottom)}|${W}|${H}|${coarse}`;
    if (key === layoutKey) return;
    layoutKey = key;
    const s = el.style;
    if (room >= SHEET.minBesidePx) {
      const w = Math.min(coarse ? SHEET.phoneWidthPx : SHEET.widthPx, room);
      // a sideways phone stands the sheet on the chart's foot: its top would cover the skipper's line under the bar
      Object.assign(s, { left: `${Math.round(r.right + SHEET.gapPx)}px`, width: `${Math.round(w)}px`, ...(coarse
        ? { top: 'auto', bottom: `${Math.round(H - r.bottom)}px`, maxHeight: `${Math.round(r.height * 0.72)}px` }
        : { top: `${Math.round(r.top)}px`, bottom: 'auto', maxHeight: `${Math.round(r.height)}px` }) });
      el.classList.toggle('compact', coarse);
    } else {
      const top = r.bottom + SHEET.edgePx;
      Object.assign(s, { left: `${SHEET.edgePx}px`, top: `${Math.round(top)}px`, bottom: 'auto', width: `${Math.max(0, W - 2 * SHEET.edgePx)}px`, maxHeight: `${Math.max(80, Math.round(H - top - SHEET.edgePx))}px` });
      el.classList.add('compact');
    }
  }
  return {
    el, render,
    update(show) { if (show) place(); if (show !== shown) { shown = show; el.classList.toggle('in', show); } },
    get shown() { return shown; },
    dispose() { el.remove(); },
  };
}
