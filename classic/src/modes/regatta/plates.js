// The five race plates: the countdown watch, the position, the gap, the next-mark pointer, the finish card. Brand: navy glass,
// cream type, amber only for a lit state (OCS), red/green only for port/starboard (not used here). Each borrows from a boat: a regatta
// countdown watch, the committee's flags, a plotter's waypoint, a results board. The models (watchText, positionText, pointer, cardRows)
// are pure and tested (tests/race-officer.test.mjs) and live in src/race/plates.js; createPlates builds the DOM on the page.
import { ensureTokens } from '../../../../src/ui/tokens.js';
import { GAP_SHOW_S, mmss, mmss1, watchText, ordinal, positionText, pointer, cardRows } from '../../../../src/sim/race/plates.js';

export { GAP_SHOW_S, mmss, mmss1, watchText, ordinal, positionText, pointer, cardRows };

const CSS = `
.lk-rg{position:fixed;left:var(--lk-mx);bottom:calc(var(--lk-my) + 9em);z-index:var(--lk-z-dock);display:flex;flex-direction:column;gap:.4em;align-items:flex-start;pointer-events:none;
  font:var(--lk-regular) var(--lk-fs-caption)/1.1 var(--lk-ui);color:var(--lk-ink);letter-spacing:var(--lk-track);-webkit-font-smoothing:antialiased}
.lk-rg .p{padding:var(--lk-glass-pad);display:flex;align-items:center;gap:.7em}
.lk-rg .watch .t{font:var(--lk-medium) calc(var(--lk-fs-num) * 1.5)/1 var(--lk-font);font-variant-numeric:tabular-nums;letter-spacing:var(--lk-track-caps);min-width:2.6em}
.lk-rg .watch .fl{display:flex;gap:.3em;align-items:center}
.lk-rg .watch .fl svg{width:1.3em;height:.9em;fill:none;stroke:var(--lk-ink);stroke-width:var(--lk-stroke)}
.lk-rg .watch .ocs{font-weight:var(--lk-medium);letter-spacing:var(--lk-track-caps);color:var(--lk-lit-ink);display:none}
.lk-rg .watch.over .ocs{display:inline}
.lk-rg .pos .n{font:var(--lk-medium) var(--lk-fs-num)/1 var(--lk-font)}
.lk-rg .pos .o{display:flex;flex-direction:column;gap:.15em;color:var(--lk-ink-soft)}
.lk-rg .pos .o i{font-style:normal;font-weight:var(--lk-regular);color:var(--lk-ink-soft)}
.lk-rg .pos .gap{color:var(--lk-ink);font-weight:var(--lk-medium);font-variant-numeric:tabular-nums}
.lk-rg .pos .gap:empty{display:none}
.lk-rg .ptr .tri{width:1.5em;height:1.5em;fill:var(--lk-ink);transition:transform .25s var(--lk-ease)}
.lk-rg .ptr .tx{font-weight:var(--lk-medium)}
.lk-rg .ptr[hidden]{display:none}
.lk-rg .how{all:unset;box-sizing:border-box;background:var(--lk-glass);border:var(--lk-line) solid var(--lk-glass-edge);pointer-events:auto;cursor:pointer;padding:.3em .7em;border-radius:var(--lk-glass-r);color:var(--lk-ink-soft);font-weight:var(--lk-medium);touch-action:manipulation}
.lk-rg .how:hover,.lk-rg .how:focus-visible{color:var(--lk-lit-ink)}
.lk-rg .how[hidden]{display:none}
.lk-rg-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:var(--lk-z-dock);padding:1em 1.4em;min-width:min(32em,88vw);
  font:var(--lk-regular) var(--lk-fs-body)/1.25 var(--lk-ui);color:var(--lk-ink);background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);border-radius:var(--lk-glass-r);box-shadow:var(--lk-glass-shadow)}
.lk-rg-card[hidden]{display:none}
.lk-rg-card h3{margin:0 0 .5em;font:var(--lk-medium) var(--lk-fs-label)/1.1 var(--lk-font);letter-spacing:var(--lk-track-wide);text-transform:uppercase;color:var(--lk-ink-faint)}
.lk-rg-card .r{display:grid;grid-template-columns:3em 1fr auto;gap:.2em .8em;align-items:baseline;padding:.3em 0}
.lk-rg-card .r b{font:var(--lk-medium) var(--lk-fs-num)/1 var(--lk-font);font-variant-numeric:tabular-nums}
.lk-rg-card .r small{grid-column:2/4;color:var(--lk-ink-soft);font-size:var(--lk-fs-caption)}
.lk-rg-card .best{margin-top:.4em;color:var(--lk-ink-soft);font-size:var(--lk-fs-caption)}
.lk-rg-card .btns{display:flex;gap:.8em;margin-top:.8em}
.lk-rg-card button{all:unset;box-sizing:border-box;cursor:pointer;padding:.45em .9em;border:var(--lk-line) solid var(--lk-hair);border-radius:var(--lk-radius);color:var(--lk-ink);font-weight:var(--lk-medium);touch-action:manipulation}
.lk-rg-card button:hover,.lk-rg-card button:focus-visible{color:var(--lk-lit-ink);background:var(--lk-lit-fill);border-color:var(--lk-lit)}
/* the plates stand above the chart circle (it fills the bottom-left corner), not over it; a phone on its side keeps the circle above its wheel, so the plates sit to the right of it */
.lk-rg{bottom:calc(var(--lk-by) + var(--lk-d) + 12px)}
:root:where([data-screen~=slim]):not([data-screen~=compact]:where(:not([data-screen~=portrait]))) .lk-rg{bottom:calc(var(--lk-my) + 11em)}
:root[data-screen~=compact]:where(:not([data-screen~=portrait])) .lk-rg{left:calc(var(--lk-mx) + 190px);top:132px;bottom:auto}
`;
const PENNANT = '<svg viewBox="0 0 26 18" aria-hidden="true"><path d="M2 2H24L16 9L24 16H2Z"/></svg>';

export function createPlates({ root = document.body, onRematch = () => {}, onHome = () => {}, onHelp = null } = {}) {
  ensureTokens();
  if (!document.getElementById('lk-rg-css')) { const st = document.createElement('style'); st.id = 'lk-rg-css'; st.textContent = CSS; document.head.appendChild(st); }
  const box = document.createElement('div'); box.className = 'lk-rg'; box.setAttribute('aria-label', 'race');
  box.innerHTML = `<div class="p watch lk-plate"><span class="t">1:00</span><span class="fl"></span><span class="ocs">OCS</span></div>`
    + `<div class="p pos lk-plate"><span class="n">1st</span><span class="o"><i class="who">Osprey</i><b class="gap"></b></span></div>`
    + `<button type="button" class="how lk-plate"${onHelp ? '' : ' hidden'}>How to race</button>`
    + `<div class="p ptr lk-plate" hidden><svg class="tri" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L20 20L12 16L4 20Z"/></svg><span class="tx">W</span></div>`;
  const card = document.createElement('div'); card.className = 'lk-rg-card'; card.hidden = true; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'results');
  root.append(box, card);
  const q = (s) => box.querySelector(s);
  const el = { watch: q('.watch'), t: q('.watch .t'), fl: q('.watch .fl'), n: q('.pos .n'), who: q('.pos .who'), gap: q('.pos .gap'), ptr: q('.ptr'), tri: q('.ptr .tri'), tx: q('.ptr .tx') };
  const last = {};
  const set = (k, node, v, prop = 'textContent') => { if (last[k] !== v) { last[k] = v; node[prop] = v; } };
  let gapT = 0;
  box.querySelector('.how')?.addEventListener('click', (e) => { e.currentTarget.blur(); onHelp?.(); });
  card.addEventListener('click', (e) => { const b = e.target.closest?.('button'); if (!b) return; if (b.dataset.act === 'rematch') onRematch(); else onHome(); });
  return {
    el: box, card,
    // state: { clock, flags: ['class','P'], ocs, place, other, pointer, gap: text | null }
    paint(dt, s) {
      set('t', el.t, watchText(s.clock));
      set('fl', el.fl, (s.flags ?? []).map((f) => `<span title="${f === 'P' ? 'P flag' : 'class flag'}">${PENNANT}</span>`).join(''), 'innerHTML');
      el.watch.classList.toggle('over', !!s.ocs);
      set('n', el.n, s.place); set('who', el.who, s.other);
      if (s.gap) { gapT = GAP_SHOW_S; set('gapText', el.gap, s.gap); }
      gapT = Math.max(0, gapT - dt); if (gapT === 0) set('gapText', el.gap, '');
      el.gap.textContent = last.gapText ?? '';
      if (s.pointerText) set('tx', el.tx, s.pointerText);
      if (s.pointer) { el.ptr.hidden = !s.pointer.show; el.tri.style.transform = `rotate(${s.pointer.rel.toFixed(0)}deg)`; set('tx', el.tx, s.pointer.text); }
    },
    showCard(data) {
      card.hidden = false;
      card.innerHTML = `<h3>Results</h3>` + data.rows.map((r) => `<div class="r"><b>${r.place}</b><span>${r.name}</span><b>${r.time}</b><small>start ${r.start} · ${r.splits || 'no marks'} · top ${r.topKn} kn</small></div>`).join('')
        + (data.best ? `<div class="best">${data.best}</div>` : '') + `<div class="btns"><button type="button" data-act="rematch">Rematch (R)</button><button type="button" data-act="home">Home</button></div>`;
    },
    hideCard() { card.hidden = true; },
    dispose() { box.remove(); card.remove(); },
  };
}
