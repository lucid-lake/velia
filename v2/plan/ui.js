// Plan's left bar and plate (phase 1): the chart page's card becomes Plan's bar while the mode is on. Two states:
//   rail     64 px: a light V, PASSAGE set vertically, a hairline, the arrival, the distance and the wind as numbers with small
//            tracked captions, the clock's rate (a press cycles ‖ ×1 ×4 ×16 ×60) and one helm ring (Take the helm)
//   passage  the open panel: the route sentence, the sum line, the legs (course, distance, point of sail, the polar's speed, the
//            arrival time), the conditions, the rate, two doors (Take the helm; Watch from the deck, later); folds itself 6 s after
//            the last press, never while the pointer is in it; ‹ or Esc folds it now
// The plate names the leg for 9 s after the handover, and says why the clock slowed or a corner was refused.
// Glass: the glass language's tokens, defined here under #lk-load[data-plan] until the glass rollout's token file is on main.
// TODO(glass): replace the --plan-gl-* block with the shared --lk-glass-* tokens when feat/glass-ui merges (same values).
//   const ui = mountPlanUi({ plan, services, map })   map(o): the map layer's factory (mapLayer.js)
import { rateWord, PLAN_RATES, hm } from './plan.js';

const P = 'html[data-map-card=panel] #lk-load[data-plan]:not([data-pg])';
const CSS = `
#lk-load[data-plan]{--plan-gl-bg:rgba(255,255,255,.44);--plan-gl-bg2:rgba(255,255,255,.62);--plan-gl-solid:rgba(240,243,246,.92);--plan-gl-sat:1.5;--plan-gl-blur:22px;
  --plan-gl-edge:rgba(255,255,255,.55);--plan-gl-rim:rgba(255,255,255,.72);--plan-gl-shadow:0 10px 32px rgba(10,20,40,.16),0 1px 2px rgba(10,20,40,.08);
  --plan-gl-ink:12 22 38;--plan-gl-accent:28 150 170;--plan-gl-accent-ink:#0f6f80;--plan-hair:rgba(12,22,38,.14);--plan-route:255 255 255}
:root[data-lk-theme=night] #lk-load[data-plan]{--plan-gl-bg:rgba(18,22,32,.5);--plan-gl-bg2:rgba(18,22,32,.66);--plan-gl-solid:rgba(18,22,32,.92);--plan-gl-edge:rgba(255,255,255,.1);
  --plan-gl-rim:rgba(255,255,255,.16);--plan-gl-shadow:0 10px 32px rgba(0,0,0,.35);--plan-gl-ink:244 240 232;--plan-gl-accent:98 212 224;--plan-gl-accent-ink:#8fe3ec;--plan-hair:rgba(255,255,255,.12)}
/* the aerial photo, lightened (the chart's ground canvas); the chart's own pills that Plan replaces step aside */
#lk-load[data-plan] .lkc > canvas:first-child{filter:brightness(1.42) saturate(1.02) contrast(.93)}
#lk-load[data-plan] .lk-livechart .lkc-layers,#lk-load[data-plan] .lk-livechart .lkc-surprise,#lk-load[data-plan] .lkc-fact{display:none!important}
${P} .lk-card > :not(.lkp){display:none!important}
${P} .lk-card::before,${P} .lk-card::after{display:none!important}
${P}[data-plan=rail]{--lk-panel:64px}
${P} .lk-card{background:var(--plan-gl-bg2);border-right:1px solid var(--plan-gl-edge);box-shadow:var(--plan-gl-shadow),inset -1px 0 0 var(--plan-gl-rim);color:rgb(var(--plan-gl-ink));
  -webkit-backdrop-filter:blur(var(--plan-gl-blur)) saturate(var(--plan-gl-sat));backdrop-filter:blur(var(--plan-gl-blur)) saturate(var(--plan-gl-sat));transition:width .3s cubic-bezier(.2,0,0,1)}
${P}[data-plan=rail] .lk-card{padding:0;overflow:visible}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){${P} .lk-card{background:var(--plan-gl-solid)}}
#lk-load[data-plan] .lkp{position:relative;z-index:2;display:flex;flex-direction:column;height:100%;box-sizing:border-box;color:rgb(var(--plan-gl-ink));font:400 15px/1.35 var(--lk-ui);font-variant-numeric:tabular-nums}
#lk-load[data-plan=open] .lkp-rail,#lk-load[data-plan=rail] .lkp-panel{display:none}
.lkp button{font:inherit;color:inherit}
.lkp-rail{align-items:center;padding:22px 0 18px}
.lkp-rail .mono{font:300 24px/1 var(--lk-font);letter-spacing:.02em}
.lkp-rail .vert{margin:18px 0 0;writing-mode:vertical-rl;transform:rotate(180deg);font:500 10px/1 var(--lk-ui);letter-spacing:.32em;opacity:.55}
.lkp-rail hr{width:18px;border:0;border-top:1px solid var(--plan-hair);margin:18px 0 6px}
.lkp-rail button{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;width:64px;padding:11px 0;font-variant-numeric:tabular-nums}
.lkp-rail button b{font:300 19px/1 var(--lk-font)}
.lkp-rail button small{font:500 9px/1 var(--lk-ui);letter-spacing:.22em;opacity:.55}
.lkp-rail button:hover b,.lkp-rail button:focus-visible b{color:var(--plan-gl-accent-ink)}
.lkp-rail .sp{flex:1}
.lkp-rail .helm{width:36px;height:36px;padding:0;margin:10px 0 0;border-radius:50%;box-shadow:inset 0 0 0 1px rgb(var(--plan-gl-ink) / .5);align-items:center;justify-content:center}
.lkp-rail .helm::after{content:'';width:6px;height:6px;border-radius:50%;background:rgb(var(--plan-gl-accent))}
.lkp-rail .helm:hover{box-shadow:inset 0 0 0 1px rgb(var(--plan-gl-accent))}
.lkp-panel{padding:24px 24px 20px;overflow-y:auto}
.lkp-panel .hd{display:flex;align-items:baseline;justify-content:space-between}
.lkp-panel .hd .v{font:300 20px/1 var(--lk-font);letter-spacing:.2em}
.lkp-panel .hd button{all:unset;cursor:pointer;font:300 22px/1 var(--lk-ui);opacity:.6;padding:4px 8px}
.lkp-panel .hd button:hover{opacity:1}
.lkp-panel .kicker{margin:26px 0 6px;font:500 10px/1 var(--lk-ui);letter-spacing:.3em;opacity:.55}
.lkp-panel h2{margin:0;font:300 26px/1.15 var(--lk-font)}
.lkp-panel h2 i{font-style:italic;opacity:.8}
.lkp-panel .sum{opacity:.72;margin:6px 0 16px;font-size:14px}
.lkp-panel .hint{opacity:.72;font-size:14px;margin:8px 0 0;line-height:1.45}
.lkp-legs{display:flex;flex-direction:column;border-top:1px solid var(--plan-hair)}
.lkp-legs .lg{display:grid;grid-template-columns:20px 1fr auto;column-gap:12px;align-items:baseline;padding:10px 0 9px;border-bottom:1px solid var(--plan-hair)}
.lkp-legs .lg .n{font:500 11px/1 var(--lk-ui);opacity:.55}
.lkp-legs .lg[aria-current] .n{opacity:1;color:var(--plan-gl-accent-ink)}
.lkp-legs .lg .w{display:flex;flex-direction:column;gap:2px}
.lkp-legs .lg .w small{font-size:12.5px;opacity:.62}
.lkp-legs .lg .t{font:300 18px/1 var(--lk-font);text-align:right}
.lkp-legs .lg .t small{display:block;font:400 11px/1.4 var(--lk-ui);opacity:.55}
.lkp-cond{display:flex;flex-wrap:wrap;gap:6px 10px;margin:14px 0 0;opacity:.8;font-size:14px}
.lkp-cond .slow{color:var(--plan-gl-accent-ink)}
.lkp-rates{display:flex;gap:4px;margin:16px 0 0;padding:3px;border-radius:999px;background:rgb(var(--plan-gl-ink) / .06);align-self:flex-start}
.lkp-rates button{all:unset;cursor:pointer;min-width:40px;height:32px;border-radius:999px;text-align:center;font:400 13px/32px var(--lk-ui);opacity:.65}
.lkp-rates button:hover{opacity:1}
.lkp-rates button[aria-pressed=true]{opacity:1;background:rgb(var(--plan-gl-accent) / .18);color:var(--plan-gl-accent-ink);box-shadow:inset 0 0 0 1px rgb(var(--plan-gl-accent) / .35)}
.lkp-go{margin:22px 0 0;display:flex;flex-direction:column;gap:10px}
.lkp-go .pri{all:unset;cursor:pointer;text-align:center;min-height:44px;border-radius:999px;background:rgb(var(--plan-gl-accent) / .18);color:var(--plan-gl-accent-ink);box-shadow:inset 0 0 0 1px rgb(var(--plan-gl-accent) / .45);font:500 13px/44px var(--lk-ui);letter-spacing:.22em;text-transform:uppercase}
.lkp-go .pri:hover{background:rgb(var(--plan-gl-accent) / .28)}
.lkp-go .sec{all:unset;text-align:center;min-height:38px;border-radius:999px;box-shadow:inset 0 0 0 1px rgb(var(--plan-gl-ink) / .25);font:400 14px/38px var(--lk-ui);opacity:.5}
.lkp-go .clr{all:unset;cursor:pointer;align-self:center;font-size:13px;opacity:.6;padding:4px 8px}
.lkp-go .clr:hover{opacity:1}
.lkp-plate{position:fixed;z-index:60;left:50%;bottom:92px;transform:translateX(-50%);max-width:min(560px,90vw);padding:14px 24px;border-radius:14px;text-align:center;
  color:rgb(var(--plan-gl-ink,244 240 232));background:var(--plan-gl-bg2,rgba(18,22,32,.66));border:1px solid var(--plan-gl-edge,rgba(255,255,255,.1));box-shadow:var(--plan-gl-shadow);
  -webkit-backdrop-filter:blur(22px) saturate(1.5);backdrop-filter:blur(22px) saturate(1.5);font:400 15px/1.4 var(--lk-ui);font-variant-numeric:tabular-nums;opacity:0;transition:opacity .4s var(--lk-ease);pointer-events:none}
.lkp-plate[data-on]{opacity:1}
.lkp-plate b{display:block;font:300 22px/1.2 var(--lk-font);margin-bottom:4px}
`;
const pad3 = (n) => String(Math.round(((n % 360) + 360) % 360)).padStart(3, '0');
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function mountPlanUi({ plan, services, map, doc = globalThis.document }) {
  const root = doc.getElementById('lk-load');
  if (!doc.getElementById('lkp-css')) { const st = doc.createElement('style'); st.id = 'lkp-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const menu = () => services.get('menu') ?? null, chart = () => services.get('liveChart') ?? null;
  const rail = doc.createElement('div'); rail.className = 'lkp lkp-rail';
  const panel = doc.createElement('div'); panel.className = 'lkp lkp-panel';
  // the plate lives outside the shell (it shows over the lake after the chart has gone); it reads the tokens off the shell
  const plateEl = doc.createElement('div'); plateEl.className = 'lkp-plate'; plateEl.setAttribute('role', 'status');
  let shown = false, inside = false, layer = null, plateT = 0, paintT = 0, origTarget = null, key = '';
  const card = () => root?.querySelector('.lk-card');
  const enter = () => { inside = true; }, leaveP = () => { inside = false; };
  for (const el of [rail, panel]) { el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leaveP); }

  function plate(text, secs = 5) {
    if (!text) return;
    const [head, ...rest] = String(text).split('\n');
    plateEl.innerHTML = rest.length ? `<b>${esc(head)}</b>${esc(rest.join(' '))}` : `<b>${esc(head)}</b>`;
    if (!plateEl.isConnected) doc.body.appendChild(plateEl);
    for (const n of ['--plan-gl-ink', '--plan-gl-bg2', '--plan-gl-edge', '--plan-gl-shadow']) { const v = root ? getComputedStyle(root).getPropertyValue(n) : ''; if (v) plateEl.style.setProperty(n, v); }
    requestAnimationFrame(() => plateEl.setAttribute('data-on', ''));
    plateT = secs;
  }

  function paint() {
    if (!shown || !root) return;
    const s = plan.summary(), open = plan.fold.open;
    root.dataset.plan = open ? 'open' : 'rail';
    const pt = COMPASS[Math.round(s.windDir / 45) % 8];
    const k = JSON.stringify([open, s.corners, s.leg, s.arriveWord, s.nm.toFixed(1), Math.round(s.windKn), pt, s.rate, s.helm, s.arrived, s.lastSlow?.word, Math.round(s.windDir), s.legs.map((L) => [L.i, Math.round(L.course), L.nm.toFixed(1), L.word, Math.round(L.tws), hm(s.hour + L.t1), L.kn.toFixed(1)])]);
    if (k === key) return;
    key = k;
    rail.innerHTML = `<div class="mono" aria-hidden="true">V</div><div class="vert">PASSAGE</div><hr>
      <button type="button" data-k="open" title="The passage"><b>${s.arriveWord}</b><small>ARRIVE</small></button>
      <button type="button" data-k="open" title="The passage"><b>${s.nm.toFixed(1)}</b><small>NM</small></button>
      <button type="button" data-k="open" title="The wind at the boat"><b>${Math.round(s.windKn)}</b><small>KN · ${pt}</small></button>
      <span class="sp"></span>
      <button type="button" data-k="rate" title="The clock's rate" aria-label="Clock rate ${rateWord(s.rate)}"><b>${rateWord(s.rate)}</b><small>CLOCK</small></button>
      <button type="button" class="helm" data-k="helm" title="Take the helm" aria-label="Take the helm"></button>`;
    const left = s.corners - s.leg;
    const head = !s.corners ? '<h2>Lay your <i>passage</i></h2><p class="hint">Click the water to add a corner. The pilot keeps her off the land and the shallows.</p>'
      : s.arrived ? `<h2>Arrived <i>at</i> corner ${s.corners}</h2><p class="hint">Click the water to sail on.</p>`
      : `<h2>From here <i>to</i> corner ${s.corners}</h2><p class="sum">${s.nm.toFixed(1)} nm · ${left} leg${left === 1 ? '' : 's'} · arrive about ${s.arriveWord}</p>`;
    const legs = s.legs.map((L) => `<div class="lg" data-leg="${L.i}"${L.i === s.leg + 1 ? ' aria-current="true"' : ''}><span class="n">${String(L.i).padStart(2, '0')}</span><span class="w"><span>${pad3(L.course)}°T · ${L.nm.toFixed(1)} nm</span><small>${L.word}${L.beat ? ', tacking' : ''} · ${Math.round(L.tws)} kn at ${Math.round(L.twa)}°</small></span><span class="t">${hm(s.hour + L.t1)}<small>${L.kn.toFixed(1)} kn</small></span></div>`).join('');
    panel.innerHTML = `<div class="hd"><span class="v">VELIA</span><button type="button" data-k="fold" title="Fold the panel" aria-label="Fold the panel">‹</button></div>
      <div class="kicker">PASSAGE</div>${head}
      ${legs ? `<div class="lkp-legs">${legs}</div>` : ''}
      <div class="lkp-cond"><span>${Math.round(s.windKn)} kn from ${pad3(s.windDir)}°</span><span>·</span><span>${hm(s.hour)}</span>${s.lastSlow ? `<span>·</span><span class="slow">${esc(s.lastSlow.word)}</span>` : ''}</div>
      <div class="lkp-rates" role="group" aria-label="Clock rate">${PLAN_RATES.map((r) => `<button type="button" data-rate="${r}" aria-pressed="${r === s.rate}">${rateWord(r)}</button>`).join('')}</div>
      <div class="lkp-go"><button type="button" class="pri" data-k="helm">Take the helm</button><button type="button" class="sec" disabled title="Coming soon">Watch from the deck</button>${s.corners ? '<button type="button" class="clr" data-k="clear">Clear the passage</button>' : ''}</div>`;
  }
  function onClick(e) {
    e.stopPropagation();
    const k = e.target.closest('[data-k]')?.dataset.k, r = e.target.closest('[data-rate]')?.dataset.rate;
    plan.fold.press();
    if (r != null) plan.setRate(+r);
    else if (k === 'open') plan.open();
    else if (k === 'fold') plan.foldNow();
    else if (k === 'rate') { const i = PLAN_RATES.indexOf(plan.rate.target); plan.setRate(PLAN_RATES[(i + 1) % PLAN_RATES.length]); }
    else if (k === 'helm') plan.takeHelm();
    else if (k === 'clear') plan.clear();
    key = ''; paint();
  }
  rail.addEventListener('click', onClick); panel.addEventListener('click', onClick);
  for (const el of [rail, panel]) for (const ty of ['pointerdown', 'pointerup']) el.addEventListener(ty, (e) => e.stopPropagation());
  const onKey = (e) => {
    if (!shown || !menu()?.isOpen) return;
    if (e.code === 'Tab' && !plan.fold.open && !e.shiftKey && card()?.contains(doc.activeElement) === false) { plan.open(); }
    if (e.code === 'Escape' && plan.fold.open && (inside || card()?.contains(doc.activeElement))) { e.preventDefault(); e.stopImmediatePropagation(); plan.foldNow(); }
  };
  doc.addEventListener('keydown', onKey, true);

  // the water card steps back while Plan holds the chart: a click on the water is a corner (the chart's 'water' tap), not a card
  function holdWaterCard(on) {
    const ct = services.get('chartTarget');
    if (on && !origTarget && ct) { origTarget = ct; services.provide('chartTarget', Object.assign(Object.create(ct), { setWater: undefined })); }
    else if (!on && origTarget) { services.provide('chartTarget', origTarget); origTarget = null; }
  }
  function show(on) {
    shown = !!on;
    if (!root) return;
    if (shown) {
      const c = card(); if (c && !rail.isConnected) c.append(rail, panel);
      holdWaterCard(true);
      if (!layer && chart()) layer = map({ chart: chart(), say: (t) => plate(t, 5) });
      key = ''; paint();
    } else {
      delete root.dataset.plan; rail.remove(); panel.remove(); holdWaterCard(false);
      layer?.destroy(); layer = null;
    }
  }
  return {
    show, paint: () => { paint(); }, plate,
    get layer() { return layer; },
    inside: () => inside,
    menuOpen: () => !!menu()?.isOpen,
    canOpen: () => { const m = menu(); return !!m && (m.state === 'gone' || m.isOpen); },
    openChart: () => { const m = menu(); if (m && !m.isOpen) m.open(); },
    closeChart: () => { const m = menu(); if (m?.isOpen) m.close(); },
    zoomToBoat(dur, mpp = 1.6) { const c = chart(), st = plan.boatState(); if (!c || !st || !menu()?.isOpen) return; c.setView({ center: { x: st.x, z: st.z }, mpp, animate: true, duration: dur }); },
    update(dt) {
      if (plateT > 0) { plateT -= dt; if (plateT <= 0) plateEl.removeAttribute('data-on'); }
      if (!shown) return;
      if (!layer && chart()) layer = map({ chart: chart(), say: (t) => plate(t, 5) });
      if (!rail.isConnected) { const c = card(); if (c) c.append(rail, panel); }
      paintT += dt; if (paintT > 0.25) { paintT = 0; paint(); }
      if (menu()?.isOpen) layer?.frame(dt);
      root.dataset.plan = plan.fold.open ? 'open' : 'rail';
    },
    destroy() { show(false); doc.removeEventListener('keydown', onKey, true); plateEl.remove(); },
  };
}
