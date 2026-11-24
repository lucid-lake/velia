// The pro trim panel (owner, 2026-10-30; replaces the TRIM+ drawer): a second control panel in the helm station's family,
// shown only in Pro (it fades in when Pro turns on, then stays), on top of the control panel, right-aligned with it, clear
// of the boat. Real hardware, Blender sprites at the panel's quality (blender/dash_protrim.py → brand/dash/knob*, track*),
// no plate, engraved words with a soft dark halo:
//   TRAVELLER and JIB LEAD: a car on a short track (drag it along, scroll, a click on an end word steps it);
//   TWIST and BACKSTAY: a rotary knob with its two ends engraved (drag up / down, scroll, a click on an end word);
//   WING: a toggle (wing-on-wing: the jib held out opposite the boom; G).
//   VHF: the stainless illuminated push-button of the control panel's family (ring amber while the radio is on; it is on by default and the choice is saved):
//     the forecast, the harbour master and the race hails. A basic player never sees this button, and the radio stays on for them.
// The values are the controls' own (src/boat.js PRO: traveller −1 … +1, twist −1 … +1, backstay 0 … 1, jib lead −1 … +1):
// the panel always draws them, whatever moved them (the Q E Z X R F keys stay for pros).
//   const tp = createTrimPanel({ get: () => ({ traveller, twist, backstay, jibLead, wing }), set: (k, v) => …, wing: () => …, shown: () => bool });
//   tp.place(rect); tp.update(dt); tp.dispose()
// Pure parts (TRIM, frameOfValue, valueAtX, stepValue): tests/trimPanel.test.mjs.
import { wheelPx } from './helmInput.js';

export const TRIM = [
  { id: 'traveller', word: 'TRAVELLER', kind: 'track', lo: -1, hi: 1, ends: ['DOWN', 'UP'], frames: 11 },
  { id: 'twist', word: 'TWIST', kind: 'knob', lo: -1, hi: 1, ends: ['CLOSED', 'OPEN'], frames: 13 },
  { id: 'wing', word: 'WING', kind: 'toggle' },
  { id: 'jibLead', word: 'JIB LEAD', kind: 'track', lo: -1, hi: 1, ends: ['FWD', 'AFT'], frames: 11 },
  { id: 'backstay', word: 'BACKSTAY', kind: 'knob', lo: 0, hi: 1, ends: ['EASE', 'ON'], frames: 13 },
  { id: 'vhf', word: 'VHF', kind: 'push' },   // owner 2026-10-30: the radio's switch lives here; on by default, the ring is amber while it is on
];
export const STEP = 0.1;   // a click or a scroll notch: a tenth of the range
import { clampT as clamp } from '../../sim/core/math.js';
export const frameOfValue = (spec, v) => Math.round(clamp(((v ?? (spec.lo + spec.hi) / 2) - spec.lo) / (spec.hi - spec.lo), 0, 1) * (spec.frames - 1));
// a track's value from the pointer's x across its travel (0 … 1)
export const valueAtX = (spec, f) => spec.lo + clamp(f, 0, 1) * (spec.hi - spec.lo);
export const stepValue = (spec, v, dir, step = STEP) => clamp((v ?? (spec.lo + spec.hi) / 2) + dir * step * (spec.hi - spec.lo) / 2, spec.lo, spec.hi);

const IS = (n) => `image-set(url(/brand/dash/${n}@1x.webp) 1x,url(/brand/dash/${n}@2x.webp) 2x,url(/brand/dash/${n}@3x.webp) 3x)`;
const U = 'var(--tp-u,1px)';
const HALO = 'text-shadow:0 0 3px rgb(10 14 28 / .95),0 0 6px rgb(10 14 28 / .7),0 1px 1px rgb(0 0 0 / .9)';
const CSS = `
.lk-tp{position:fixed;z-index:var(--lk-z-dock);display:grid;grid-template-columns:calc(${U} * 92) calc(${U} * 52) calc(${U} * 44);grid-template-rows:auto auto;column-gap:calc(${U} * 6);row-gap:calc(${U} * 4);
  align-items:start;justify-items:center;user-select:none;-webkit-user-select:none;font:600 calc(${U} * 7.4)/1 var(--lk-ui);letter-spacing:.1em;color:rgb(242 244 250 / .93);
  filter:drop-shadow(0 1px 3px rgb(0 0 0 / .4));opacity:0;pointer-events:none;transform:translateY(calc(${U} * 6));transition:opacity .45s var(--lk-ease-out),transform .45s var(--lk-ease-out)}
.lk-tp.in{opacity:1;pointer-events:auto;transform:none}
.lk-tp .c{position:relative;display:flex;flex-direction:column;align-items:center;gap:calc(${U} * 3);touch-action:none}
.lk-tp .w{display:block;white-space:nowrap;${HALO}}
.lk-tp .tk{display:block;width:calc(${U} * 88);height:calc(${U} * 24.6);background:${IS('track')} 0 0/100% 1100% no-repeat;background-position:0 calc(var(--f,5) * 100% / 10);cursor:ew-resize}
.lk-tp .kn{display:block;width:calc(${U} * 30);height:calc(${U} * 30);background:${IS('knob')} 0 0/1300% 100% no-repeat;background-position:calc(var(--f,6) * 100% / 12) 0;cursor:ns-resize}
.lk-tp .kn{position:relative}
/* the knob's white index line (and a fine engraved arc of its travel, −135° … +135°) */
.lk-tp .kn i{position:absolute;left:50%;top:14%;width:calc(${U} * 1.6);height:30%;margin-left:calc(${U} * -0.8);border-radius:1px;background:#f4f2ea;box-shadow:0 0 1px rgb(0 0 0 / .8);transform-origin:50% 120%;transform:rotate(var(--a,0deg))}
.lk-tp .kn::before{content:'';position:absolute;inset:calc(${U} * -3);border-radius:50%;border:1px solid rgb(242 244 250 / .45);clip-path:polygon(50% 50%,0 100%,0 0,100% 0,100% 100%);filter:drop-shadow(0 0 1px rgb(0 0 0 / .8))}
.lk-tp .tg{display:block;width:calc(${U} * 30);height:calc(${U} * 30);background:${IS('ctl')} 0 0/300% 300% no-repeat;cursor:pointer}
.lk-tp .c.on .tg{background-position:50% 0}
.lk-tp .pb{all:unset;position:relative;display:block;width:calc(${U} * 30);height:calc(${U} * 30);cursor:pointer;background:${IS('ctl')} 0 50%/300% 300% no-repeat;-webkit-tap-highlight-color:transparent}
.lk-tp .c.on .pb{background-position:50% 50%}.lk-tp .pb:active{background-position:100% 50%}
.lk-tp .pb svg{position:absolute;inset:28%;width:44%;height:44%;fill:none;stroke:rgb(18 22 34 / .78);stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 .5px 0 rgb(255 255 255 / .45))}
.lk-tp .ends{display:flex;justify-content:space-between;width:100%;font-size:calc(${U} * 5.8);letter-spacing:.06em;opacity:.82}
.lk-tp .ends button{all:unset;cursor:pointer;padding:0 calc(${U} * 1);${HALO}}
.lk-tp .ends button:hover{opacity:1;color:#fff}
.lk-tp .c[data-id=twist] .ends,.lk-tp .c[data-id=backstay] .ends{width:calc(${U} * 52)}
.lk-tp [tabindex]:focus-visible{outline:var(--lk-line) solid var(--lk-lit);outline-offset:1px;border-radius:calc(${U} * 3)}
:root[data-lk-theme=night] .lk-tp{color:rgb(255 140 120 / .92)}
:root[data-lk-theme=night] .lk-tp .tk{background-image:${IS('track-night')}}:root[data-lk-theme=night] .lk-tp .kn{background-image:${IS('knob-night')}}:root[data-lk-theme=night] .lk-tp .tg,:root[data-lk-theme=night] .lk-tp .pb{background-image:${IS('ctl-night')}}
[data-input=touch] .lk-tp .ends button{min-height:44px;display:flex;align-items:center}
@media (prefers-reduced-motion:reduce){.lk-tp{transition:opacity .2s;transform:none}}
`;

export function createTrimPanel({ get = () => ({}), set = () => {}, wing = () => {}, vhf = () => true, onVhf = () => {}, shown = () => false, onUse = () => {}, root = document.body, step = STEP } = {}) {   // step: a click, a scroll notch or a key (v2: 0.2)
  if (!document.getElementById('lk-tp-css')) { const st = document.createElement('style'); st.id = 'lk-tp-css'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div'); el.className = 'lk-tp'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'pro trim');
  el.innerHTML = TRIM.map((t) => `<div class="c" data-id="${t.id}"><span class="w">${t.word}</span>`
    + (t.kind === 'push' ? `<button type="button" class="pb" aria-pressed="true" aria-label="VHF radio"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8.5" width="8.5" height="13" rx="2"/><path d="M12.2 8.5V2.8M8 11.5H6.6v4H8"/><rect x="10" y="11" width="4.4" height="3" rx=".6"/></svg></button>`
    : t.kind === 'toggle' ? `<span class="tg" role="switch" tabindex="0" aria-label="wing on wing (G)"></span>`
      : `<span class="${t.kind === 'track' ? 'tk' : 'kn'}" role="slider" tabindex="0" aria-label="${t.word.toLowerCase()}">${t.kind === 'knob' ? '<i></i>' : ''}</span><span class="ends"><button type="button" data-d="-1">${t.ends[0]}</button><button type="button" data-d="1">${t.ends[1]}</button></span>`)
    + '</div>').join('');
  // the order on the grid: TRAVELLER TWIST WING / JIB LEAD BACKSTAY
  root.appendChild(el);
  const cell = (id) => el.querySelector(`.c[data-id=${id}]`);
  const val = (id) => get()[id];
  const put = (t, v) => { set(t.id, clamp(v, t.lo, t.hi)); onUse(t.id); };
  for (const t of TRIM) {
    const c = cell(t.id);
    c.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (t.kind === 'push') { const b = c.querySelector('.pb'); b.addEventListener('click', (e) => { e.stopPropagation(); onVhf(); onUse('vhf'); b.blur(); }); continue; }
    if (t.kind === 'toggle') { c.querySelector('.tg').addEventListener('click', (e) => { e.stopPropagation(); wing(); onUse('wing'); }); c.querySelector('.tg').addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); wing(); } }); continue; }
    const ctlEl = c.querySelector(t.kind === 'track' ? '.tk' : '.kn');
    let pid = null, y0 = 0, v0 = 0;
    ctlEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button > 0) return;
      pid = e.pointerId; try { ctlEl.setPointerCapture(pid); } catch { /* synthetic */ }
      y0 = e.clientY; v0 = val(t.id) ?? (t.lo + t.hi) / 2;
      if (t.kind === 'track') { const r = ctlEl.getBoundingClientRect(); put(t, valueAtX(t, (e.clientX - r.left - r.width * 0.16) / (r.width * 0.68))); }
      e.preventDefault();
    });
    ctlEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      if (t.kind === 'track') { const r = ctlEl.getBoundingClientRect(); put(t, valueAtX(t, (e.clientX - r.left - r.width * 0.16) / (r.width * 0.68))); }
      else put(t, v0 + (y0 - e.clientY) / 80 * (t.hi - t.lo));   // a knob: up turns it clockwise (toward its right-hand end)
      e.preventDefault();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) ctlEl.addEventListener(ev, (e) => { if (e.pointerId === pid) pid = null; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); const d = wheelPx(e, { horizontal: true }); if (Math.abs(d) > 1) put(t, stepValue(t, val(t.id), d < 0 ? 1 : -1, step)); }, { passive: false });
    for (const b of c.querySelectorAll('.ends button')) b.addEventListener('click', (e) => { e.stopPropagation(); put(t, stepValue(t, val(t.id), +b.dataset.d, step)); });
    ctlEl.addEventListener('keydown', (e) => {
      const d = e.code === 'ArrowRight' || e.code === 'ArrowUp' ? 1 : e.code === 'ArrowLeft' || e.code === 'ArrowDown' ? -1 : 0;
      if (d) { put(t, stepValue(t, val(t.id), d, step)); e.preventDefault(); e.stopPropagation(); }
    });
  }
  const place = (r) => {
    if (!r) return;
    const u = r.h / 96;
    el.style.setProperty('--tp-u', `${u.toFixed(3)}px`);
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  };
  function update() {
    el.classList.toggle('in', !!shown());
    if (!el.classList.contains('in')) return;
    const v = get();
    for (const t of TRIM) {
      const c = cell(t.id);
      if (t.kind === 'push') { const on = !!vhf(); c.classList.toggle('on', on); c.querySelector('.pb').setAttribute('aria-pressed', String(on)); continue; }
      if (t.kind === 'toggle') { c.classList.toggle('on', !!v.wing); continue; }
      const f = frameOfValue(t, v[t.id]);
      c.style.setProperty('--f', String(f));
      if (t.kind === 'knob') c.style.setProperty('--a', `${-135 + 270 * f / (t.frames - 1)}deg`);
      c.querySelector('[role=slider]').setAttribute('aria-valuenow', String(+(v[t.id] ?? 0).toFixed(2)));
    }
  }
  return { el, place, update, get shown() { return el.classList.contains('in'); }, dispose() { el.remove(); } };
}
