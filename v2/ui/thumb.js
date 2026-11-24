// The one-thumb controls of an upright phone (concept A with D's motor rail; owner, 2026-11-15: "go with your
// recommendations"). They replace the portrait cluster (the 3D wheel and winches in their slots, the SAILS and ANCHOR rockers,
// PANEL and CHART, the chrome lever, the Tack pill) on an upright phone only; a phone sideways, a tablet and a desktop keep theirs.
// Flat navy glass, cream ink, amber only for a lit state, red and green only on the rudder arc's port and starboard ends
// (an owner exception to principle 13 for the upright phone).
//   - the steer zone: the lower third, below the buttons. A sideways drag steers from where the finger landed, as the water's
//     tiller (v2/ui/touch.js tillerFromDrag: full helm at TOUCH.helmFrac of the width); let go and the pilot holds the course. A
//     vertical drag of THUMB.trimPx before any sideways move is the sheet instead (v1's rope: down pulls in, up eases) and hands
//     the trim to the player (Auto off). A thin rudder arc shows the rudder.
//   - one action button (the right thumb): Tack or Gybe while one is offered (tackButton.js, TackAssist), lit amber; Sails up
//     while the sails are down; else nothing. Under motor the throttle rail takes its place.
//   - the Auto chip: the crew trims (B.assists.crewTrim) or you do. Under motor it is the Sail | Motor switch.
//   - "⋯": a navy drawer from the bottom with every other function (sails, anchor, drive, trim, chart, VHF, reef,
//     moor, log, view, menu); a tap outside or a swipe down closes it.
//   - the throttle rail (motor): ▲ ahead, N, ▼ astern; a drag moves the engine's lever, the release snaps it to a notch
//     (throttleLever.js NOTCHES; N is a detent), the arrows step a notch.
// The DOM is built on the first upright frame, so another device pays nothing; a frame writes the DOM only when a shown value
// changes and reads no layout (the rects come from pointer events).
//   const th = createThumb({ ... });  each frame before the boat's step: th.update(dt, hands)  (adds its steer and pull to hands)
import { ensureTokens } from '../../src/ui/tokens.js';
import { HELM_IN } from '../../src/stations/sloop/helmInput.js';
import { NOTCHES, notchIndex } from '../../src/stations/sloop/throttleLever.js';
import { TouchSheet } from '../../src/sail/pads.js';
import { TOUCH, tillerFromDrag, ropeDrag } from './touch.js';

export const THUMB = Object.freeze({
  trimPx: 12,        // a vertical drag this long before any sideways move is the sheet
  steerPx: 6,        // a sideways move this long settles the drag as steering
  zoneTop: 2 / 3,    // the steer zone: the lower third of the screen …
  edgePx: TOUCH.edgePx,   // … down to the phone's own swipe band
  arcHalfDeg: 32,    // the rudder arc's half sweep on screen (full rudder)
  detent: 0.1,       // the rail's N: a lever this near 0 is neutral
  swipePx: 50,       // a swipe this far down closes the drawer
});

// the action button's job (pure): the throttle rail under motor; the running manoeuvre; Sails up with the sails down; the offer
export function actionFor({ motor = false, active = null, offer = null, sailsDown = false } = {}) {
  if (motor) return null;
  if (active) return { id: active, lit: true, go: true };
  if (sailsDown) return { id: 'sails', lit: false, go: false };
  if (offer) return { id: offer, lit: true, go: false };
  return null;
}
// a drag's first move (pure): 'trim' (vertical first), 'steer' (sideways), or null (not yet decided)
export function dragKind(dx, dy, { trimPx = THUMB.trimPx, steerPx = THUMB.steerPx } = {}) {
  if (Math.abs(dy) >= trimPx && Math.abs(dy) > Math.abs(dx)) return 'trim';
  if (Math.abs(dx) >= steerPx && Math.abs(dx) >= Math.abs(dy)) return 'steer';
  return null;
}
// the rudder arc's knob angle in degrees (pure): − to port (left), + to starboard
export const arcDeg = (rudder, max = HELM_IN.rudderMax, half = THUMB.arcHalfDeg) => Math.max(-half, Math.min(half, (rudder / max) * half));
// the rail (pure): a finger's height on the track → the lever (ahead up), with N's detent; and back
export function railLever(y, top, len, detent = THUMB.detent) {
  const v = Math.max(-1, Math.min(1, 1 - 2 * (y - top) / Math.max(1, len)));
  return Math.abs(v) < detent ? 0 : v;
}
export const railY = (v, len) => (1 - Math.max(-1, Math.min(1, v))) / 2 * len;
// the notch a released lever snaps to
export const railSnap = (v) => NOTCHES[notchIndex(v)].v;

const ICON = {
  tack: '<path d="M5 15a7 7 0 0 1 13-4"/><path d="M18 5v6h-6"/>',
  gybe: '<path d="M19 9a7 7 0 0 1-13 4"/><path d="M6 19v-6h6"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  sail: '<path d="M11 3v16"/><path d="M11 4c4 4 6 9 6 14h-6"/><path d="M4 20h16"/>',
  sails: '<path d="M11 3v16"/><path d="M11 4c4 4 6 9 6 14h-6"/><path d="M4 20h16"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13"/><path d="M5 13a7 7 0 0 0 14 0"/><path d="M8 10h8"/>',
  engine: '<rect x="5" y="8" width="12" height="9" rx="1.5"/><path d="M17 11h3v3h-3M8 8V5h6v3"/>',
  chart: '<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"/><path d="M9 4v14M15 6v14"/>',
  bino: '<circle cx="7" cy="15" r="3.5"/><circle cx="17" cy="15" r="3.5"/><path d="M10 13h4M6 11l2-6h2l1 6M18 11l-2-6h-2l-1 6"/>',
  radio: '<rect x="7" y="7" width="10" height="14" rx="2"/><path d="M10 7l-2-4M10 12h4M10 15h4"/>',
  reef: '<path d="M11 3v16"/><path d="M11 4c4 4 6 9 6 14h-6"/><path d="M11 13h5.5M11 16h6"/>',
  moor: '<path d="M6 20V9a6 6 0 0 1 12 0v11"/><path d="M4 20h16"/>',
  log: '<path d="M6 4h10l2 2v14H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  view: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const WORD = { tack: 'Tack', gybe: 'Gybe', sails: 'Sails up' };

// the arc's geometry (steer_arc: r 270, ±32°, the top 742 of 844), in the svg's own box
const ARC = (() => {
  const W = 310, Hh = 74, r = 270, cx = W / 2, cy = 16 + r, half = THUMB.arcHalfDeg, rad = (a) => a * Math.PI / 180;
  const pt = (a, rr = r) => [cx + rr * Math.sin(rad(a)), cy - rr * Math.cos(rad(a))];
  const [x0, y0] = pt(-half), [x1, y1] = pt(half);
  const tick = (a, cls) => { const [ax, ay] = pt(a, r - 9), [bx, by] = pt(a, r + 9); return `<line class="${cls}" x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"/>`; };
  const d = `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  return { W, H: Hh, cx, cy, html: `<svg class="arc" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" aria-hidden="true"><path class="bed" d="${d}"/><path class="ln" d="${d}"/>`
    + `${tick(-half, 'p')}${tick(half, 's')}${tick(0, 'c')}<g class="kn"><circle cx="${cx}" cy="16" r="11"/></g></svg>` };
})();

export const THUMB_CSS = `
.lk-thumb{position:fixed;inset:0;pointer-events:none;z-index:var(--lk-z-hud);font:var(--lk-medium) 15px/1.2 var(--lk-ui);letter-spacing:.02em;color:var(--lk-ink);
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.lk-thumb[hidden]{display:none}
.lk-thumb .zone{position:absolute;left:0;right:0;top:calc(100% * ${THUMB.zoneTop.toFixed(4)});bottom:${THUMB.edgePx}px;pointer-events:auto;touch-action:none}
.lk-thumb .shade{position:absolute;left:0;right:0;bottom:0;height:300px;background:linear-gradient(rgb(var(--lk-brand-navy) / 0),rgb(var(--lk-brand-navy) / .42))}
.lk-thumb .b{all:unset;box-sizing:border-box;position:absolute;display:flex;align-items:center;justify-content:center;gap:8px;min-width:44px;min-height:44px;border-radius:999px;
  background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);color:var(--lk-ink);box-shadow:var(--lk-glass-shadow);pointer-events:auto;touch-action:manipulation;
  -webkit-tap-highlight-color:transparent;cursor:pointer;transition:opacity .2s var(--lk-ease-out)}
.lk-thumb .b:focus-visible{outline:2px solid var(--lk-lit);outline-offset:2px}
.lk-thumb .b svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.lk-thumb .b.lit{border-color:var(--lk-lit);color:var(--lk-lit-ink);background:linear-gradient(var(--lk-lit-fill),var(--lk-lit-fill)),var(--lk-glass-dense)}
.lk-thumb .b.cue,.lk-thumb .pair button.cue{box-shadow:inset 0 0 0 1px rgb(var(--lk-amber) / .45),0 0 10px rgb(var(--lk-amber) / .22)}
.lk-thumb .b.go{background:linear-gradient(rgb(var(--lk-amber) / .3),rgb(var(--lk-amber) / .3)),var(--lk-glass-dense)}
.lk-thumb .more{left:16px;bottom:192px;width:52px;height:52px}
.lk-thumb .chip{left:78px;bottom:196px;width:104px;height:44px;font-size:15px}
.lk-thumb .act{right:16px;bottom:190px;width:146px;height:60px;font-size:18px}
.lk-thumb .act svg{width:24px;height:24px}
.lk-thumb .act.off,.lk-thumb .drive.off,.lk-thumb .chip.off,.lk-thumb .rail.off{opacity:0;visibility:hidden;pointer-events:none}
.lk-thumb .drive{left:78px;bottom:196px;height:44px;display:flex;padding:3px;border-radius:22px;background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);pointer-events:auto;position:absolute}
.lk-thumb .drive button{all:unset;box-sizing:border-box;width:72px;display:flex;align-items:center;justify-content:center;border-radius:19px;font-size:14px;cursor:pointer;color:var(--lk-ink);-webkit-tap-highlight-color:transparent}
.lk-thumb .drive button.on{color:var(--lk-lit-ink);background:var(--lk-lit-fill);box-shadow:inset 0 0 0 1px var(--lk-lit)}
.lk-thumb .arc{position:absolute;left:50%;bottom:44px;margin-left:-${ARC.W / 2}px;overflow:visible;pointer-events:none;transition:transform .25s var(--lk-ease)}
.lk-thumb.motor .arc{transform:translateX(-25px) scale(.92)}
.lk-thumb .arc path{fill:none;stroke-linecap:round}
.lk-thumb .arc .bed{stroke:rgb(var(--lk-brand-navy) / .55);stroke-width:7}
.lk-thumb .arc .ln{stroke:rgb(var(--lk-cream) / .78);stroke-width:2}
.lk-thumb .arc line{stroke-width:2.5;stroke-linecap:round}
.lk-thumb .arc .p{stroke:rgb(var(--lk-port))}.lk-thumb .arc .s{stroke:rgb(var(--lk-stbd))}.lk-thumb .arc .c{stroke:rgb(var(--lk-cream) / .9);stroke-width:2}
.lk-thumb .arc circle{fill:rgb(var(--lk-cream) / .96);stroke:rgb(var(--lk-brand-navy) / .9);stroke-width:2}
.lk-thumb.held .arc circle{stroke:var(--lk-lit);stroke-width:3}
.lk-thumb .rail{position:absolute;right:14px;bottom:48px;width:58px;height:230px;border-radius:29px;background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);
  pointer-events:auto;touch-action:none;box-shadow:var(--lk-glass-shadow)}
.lk-thumb .rail .t{position:absolute;left:27px;top:30px;bottom:30px;width:4px;border-radius:2px;background:rgb(var(--lk-cream) / .55)}
.lk-thumb .rail .n{position:absolute;left:19px;top:114px;width:20px;height:2px;background:rgb(var(--lk-cream) / .9)}
.lk-thumb .rail .nl{position:absolute;left:-26px;top:106px;width:20px;text-align:center;font-size:15px;color:var(--lk-ink);text-shadow:var(--lk-halo-soft)}
.lk-thumb .rail .k{position:absolute;left:11px;top:-18px;width:36px;height:36px;border-radius:50%;background:rgb(var(--lk-cream) / .96);border:2px solid rgb(var(--lk-brand-navy) / .9);
  margin-top:30px;will-change:transform}
.lk-thumb .rail .k.lit{border:3px solid var(--lk-lit);box-shadow:0 0 0 3px var(--lk-lit-fill)}
.lk-thumb .rail .ar{position:absolute;left:0;right:0;height:30px;display:flex;align-items:center;justify-content:center;font-size:15px;color:var(--lk-ink-soft);pointer-events:none}
.lk-thumb .rail .ar.up{top:0}.lk-thumb .rail .ar.dn{bottom:0}
.lk-thumb .scrim{position:absolute;inset:0;background:rgb(var(--lk-brand-navy) / .35);pointer-events:auto;touch-action:none}
.lk-thumb .sheet{position:absolute;left:0;right:0;bottom:0;z-index:1;border-radius:22px 22px 0 0;background:var(--lk-glass-dense);border-top:var(--lk-line) solid var(--lk-glass-edge);
  padding:12px 16px calc(20px + env(safe-area-inset-bottom,0px));pointer-events:auto;touch-action:none;transition:transform .22s var(--lk-ease)}
.lk-thumb .scrim[hidden],.lk-thumb .sheet[hidden]{display:none}
.lk-thumb .grab{width:40px;height:5px;border-radius:3px;background:var(--lk-hair);margin:0 auto 12px}
.lk-thumb .seg{height:52px;border:var(--lk-line) solid var(--lk-glass-edge);border-radius:14px;display:flex;align-items:center;padding:0 5px 0 12px;gap:10px;margin-bottom:8px}
.lk-thumb .seg svg,.lk-thumb .dc svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.lk-thumb .seg .lbl{flex:1;min-width:0;white-space:nowrap}
.lk-thumb .pair{display:flex;border:var(--lk-line) solid var(--lk-hair);border-radius:10px;overflow:hidden}
.lk-thumb .pair button{all:unset;box-sizing:border-box;width:72px;padding:0 8px;white-space:nowrap;height:44px;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer;color:var(--lk-ink);-webkit-tap-highlight-color:transparent}
.lk-thumb .pair button.on{background:var(--lk-lit-fill);color:var(--lk-lit-ink)}
.lk-thumb .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px}
.lk-thumb .dc{all:unset;box-sizing:border-box;height:72px;border:var(--lk-line) solid var(--lk-glass-edge);border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:6px;font-size:14px;color:var(--lk-ink);cursor:pointer;-webkit-tap-highlight-color:transparent}
.lk-thumb .dc.on{border-color:var(--lk-lit);color:var(--lk-lit-ink);background:var(--lk-lit-fill)}
.lk-thumb .dc[aria-disabled=true]{opacity:.45}
.lk-thumb .dc:focus-visible,.lk-thumb .pair button:focus-visible{outline:2px solid var(--lk-lit);outline-offset:-2px}
html.lk-one-thumb .lk-tackb{display:none!important}
`;

// io: the page's pieces (v2/ui/sail.js): every function is a call into the code the old cluster already used
//   active()          the upright-phone form is up (station.form === 'thumb')
//   hidden()          the dashboard steps aside (the menu, the logbook, the binoculars, the big chart, Cruise)
//   state()           the boat's state; tack: tackButton.js's object; sea, eng: the seamanship and its engine
//   assists           v2/sim/boat.js's assists (crewTrim); urlTrim: the URL's ?hand holds the trim
//   run(id)           the dock's action (sails, anchor, binoculars, radio, reef, lines, dawn)
//   lit: { sails, anchor, binoculars, radio, reef }, moor() → 'lines' | 'dawn' | null
//   chart(), log(), view(), menu()   open the big chart, the logbook, the other view, the Menu card
export function createThumb({ active = () => false, hidden = () => false, state = () => null, tack = null, sea = null, eng = null, assists = null, urlTrim = false,
  run = () => {}, lit = {}, cue = {}, moor = () => null, chart = () => {}, log = () => {}, view = () => {}, menu = () => {}, onUse = () => {}, settings = null, root = document.body } = {}) {
  const H = document.documentElement;
  let el = null, on = false, shownNow = null;
  let auto = urlTrim ? !!assists?.crewTrim : true;   // decision 2: the crew trims on an upright phone unless the URL says
  settings?.on?.((k) => { if (k === 'crewTrim') auto = !!settings.get('crewTrim'); });   // Setup's own row still sets it
  const rope = new TouchSheet();
  const g = { id: null, x0: 0, y0: 0, x: 0, y: 0, kind: null };
  let steer = 0, pull = 0, drawerOpen = false;
  const shown = { ak: undefined, act: null, motor: undefined, chip: undefined, held: undefined, knob: NaN, rail: NaN, railLit: undefined, cue: undefined };
  let E = null;

  function build() {
    ensureTokens();
    if (!document.getElementById('lk-thumb-css')) { const st = document.createElement('style'); st.id = 'lk-thumb-css'; st.textContent = THUMB_CSS; document.head.appendChild(st); }
    el = document.createElement('div'); el.className = 'lk-thumb'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'boat controls'); el.hidden = true;
    const seg = (id, icon, word, a, b) => `<div class="seg" data-seg="${id}">${svg(icon)}<span class="lbl">${word}</span><span class="pair" role="group" aria-label="${word.toLowerCase()}">`
      + `<button type="button" data-v="0">${a}</button><button type="button" data-v="1">${b}</button></span></div>`;
    const cell = (id, icon, word) => `<button type="button" class="dc" data-id="${id}">${svg(icon)}<span>${word}</span></button>`;
    el.innerHTML = '<div class="shade"></div><div class="zone" aria-hidden="true"></div>' + ARC.html
      + `<button type="button" class="b more" aria-label="more controls" aria-expanded="false">${svg('more')}</button>`
      + `<button type="button" class="b chip" aria-label="sail trim: auto">${svg('sail')}<span class="w">Auto</span></button>`
      + '<div class="drive off" role="group" aria-label="drive"><button type="button" data-v="0">Sail</button><button type="button" data-v="1">Motor</button></div>'
      + `<button type="button" class="b act off" aria-label="Tack">${svg('tack')}<span class="w">Tack</span></button>`
      + '<div class="rail off" role="slider" aria-label="throttle" aria-valuemin="-1" aria-valuemax="1" aria-valuenow="0" tabindex="0"><span class="ar up" aria-hidden="true">▲</span>'
      + '<div class="t"></div><div class="n"></div><span class="nl" aria-hidden="true">N</span><div class="k"></div><span class="ar dn" aria-hidden="true">▼</span></div>'
      + '<div class="scrim" hidden></div><div class="sheet" role="dialog" aria-label="more controls" hidden><div class="grab"></div>'
      + seg('sails', 'sails', 'Sails', 'Up', 'Down') + seg('anchor', 'anchor', 'Anchor', 'Up', 'Down') + seg('drive', 'engine', 'Drive', 'Sail', 'Motor') + seg('trim', 'sail', 'Trim', 'Auto', 'Manual')
      + '<div class="grid">' + cell('chart', 'chart', 'Chart') + cell('radio', 'radio', 'VHF') + cell('reef', 'reef', 'Reef')
      + cell('moor', 'moor', 'Moor') + cell('log', 'log', 'Logbook') + cell('view', 'view', 'View') + cell('menu', 'more', 'Menu') + '</div></div>';
    root.appendChild(el);
    const q = (s) => el.querySelector(s);
    E = { zone: q('.zone'), kn: q('.arc .kn'), more: q('.more'), chip: q('.chip'), chipW: q('.chip .w'), drive: q('.drive'), act: q('.act'), actIcon: q('.act svg'), actW: q('.act .w'),
      rail: q('.rail'), knob: q('.rail .k'), scrim: q('.scrim'), sheet: q('.sheet') };
    // nothing here is the canvas's press (the camera, the water's tiller)
    for (const n of el.querySelectorAll('button,.zone,.rail,.sheet,.scrim')) n.addEventListener('pointerdown', (e) => e.stopPropagation());

    // the steer zone
    const z = E.zone;
    z.addEventListener('pointerdown', (e) => {
      if (g.id != null) return;
      e.preventDefault();
      Object.assign(g, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, kind: null });
      try { z.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== g.id) return;
      e.preventDefault();
      const dy = e.clientY - g.y;
      g.x = e.clientX; g.y = e.clientY;
      if (!g.kind) {
        g.kind = dragKind(g.x - g.x0, g.y - g.y0);
        if (g.kind === 'trim') { auto = false; rope.drag(ropeDrag(g.y - g.y0, innerHeight)); return; }
      }
      if (g.kind === 'trim') rope.drag(ropeDrag(dy, innerHeight));
    });
    const up = (e) => { if (e.pointerId !== g.id) return; g.id = null; g.kind = null; rope.release(); };
    z.addEventListener('pointerup', up); z.addEventListener('pointercancel', up); z.addEventListener('lostpointercapture', up);
    z.addEventListener('contextmenu', (e) => e.preventDefault());

    // the buttons
    const click = (n, fn) => n.addEventListener('click', (e) => { e.stopPropagation(); n.blur?.(); fn(e); onUse(); });
    click(E.more, () => setDrawer(!drawerOpen));
    click(E.chip, () => { auto = !auto; });
    for (const b of E.drive.querySelectorAll('button')) click(b, () => setDrive(b.dataset.v === '1'));
    click(E.act, () => { const a = shown.act; if (a === 'sails') run('sails'); else tack?.press?.(); });
    // the rail: a drag moves the lever (N a detent), the release snaps to a notch, an arrow steps one
    const rail = E.rail;
    // the arrows are the rail's own ends, not nested buttons (a phone's touch adjustment snapped a drag near the end onto them)
    let rid = null, railBox = null, arrow = 0, y0 = 0;
    const leverAt = (y) => railLever(y, railBox.top + 30, railBox.height - 60);
    rail.addEventListener('pointerdown', (e) => {
      e.preventDefault(); rid = e.pointerId; railBox = rail.getBoundingClientRect();   // one read per press
      try { rail.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const y = e.clientY - railBox.top; y0 = e.clientY;
      arrow = y < 30 ? 1 : y > railBox.height - 30 ? -1 : 0;
      if (!arrow) sea?.actions.lever(leverAt(e.clientY));
      onUse();
    });
    rail.addEventListener('pointermove', (e) => {
      if (e.pointerId !== rid) return;
      e.preventDefault();
      if (arrow && Math.abs(e.clientY - y0) > 8) arrow = 0;
      if (!arrow) sea?.actions.lever(leverAt(e.clientY));
    });
    const rup = (e) => {
      if (e.pointerId !== rid) return;
      rid = null;
      if (arrow) { sea?.actions.step(arrow); arrow = 0; return; }
      if (eng) sea?.actions.lever(railSnap(eng.lever), { snap: true });
    };
    rail.addEventListener('pointerup', rup); rail.addEventListener('pointercancel', (e) => { if (e.pointerId === rid) { arrow = 0; rup(e); } });
    rail.addEventListener('keydown', (e) => { if (e.code === 'ArrowUp') { sea?.actions.step(1); e.preventDefault(); } else if (e.code === 'ArrowDown') { sea?.actions.step(-1); e.preventDefault(); } });

    // the drawer: a tap outside or a swipe down closes it
    E.scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); setDrawer(false); });
    let sw = null;
    E.sheet.addEventListener('pointerdown', (e) => { sw = { id: e.pointerId, y0: e.clientY, dy: 0 }; });
    E.sheet.addEventListener('pointermove', (e) => { if (!sw || e.pointerId !== sw.id) return; sw.dy = Math.max(0, e.clientY - sw.y0); E.sheet.style.transform = sw.dy > 4 ? `translateY(${sw.dy}px)` : ''; });
    const sup = (e) => { if (!sw || e.pointerId !== sw.id) return; const far = sw.dy >= THUMB.swipePx; sw = null; E.sheet.style.transform = ''; if (far) setDrawer(false); };
    E.sheet.addEventListener('pointerup', sup); E.sheet.addEventListener('pointercancel', sup);
    for (const s of E.sheet.querySelectorAll('.seg')) for (const b of s.querySelectorAll('button')) click(b, () => segPress(s.dataset.seg, b.dataset.v === '1'));
    for (const c of E.sheet.querySelectorAll('.dc')) click(c, () => cellPress(c.dataset.id));
  }

  function setDrive(motor) {
    if (!sea || !eng) return;
    if (motor && !eng.on) sea.actions.engine();
    else if (!motor && eng.on) { sea.actions.neutral(); sea.actions.engine(); }
  }
  // a segment's half: only a change runs the action (as the old rockers: a toggle under the hood)
  function segPress(id, second) {
    if (id === 'sails') { const down = !lit.sails?.(); if (second !== down) run('sails'); }
    else if (id === 'anchor') { const down = !!lit.anchor?.(); if (second !== down) run('anchor'); }
    else if (id === 'drive') setDrive(second);
    else if (id === 'trim') auto = !second;
    drawerFrame(true);
  }
  function cellPress(id) {
    if (id === 'moor') { const m = moor(); if (!m) return; run(m); }
    else if (id === 'chart') chart();
    else if (id === 'log') log();
    else if (id === 'view') view();
    else if (id === 'menu') menu();
    else run(id);
    if (id !== 'reef') setDrawer(false); else drawerFrame(true);
  }
  function setDrawer(open) {
    drawerOpen = !!open && on;
    if (!E) return;
    E.scrim.hidden = !drawerOpen; E.sheet.hidden = !drawerOpen;
    E.more.setAttribute('aria-expanded', String(drawerOpen));
    if (drawerOpen) drawerFrame(true);
  }
  const drawerKey = { v: '' };
  function drawerFrame(force = false) {
    const motor = !!eng?.on, m = moor();
    const st = { sails: lit.sails?.() ? 0 : 1, anchor: lit.anchor?.() ? 1 : 0, drive: motor ? 1 : 0, trim: auto ? 0 : 1 };
    const cells = { radio: !!lit.radio?.(), reef: !!lit.reef?.() };   // no binoculars on a phone (owner 2026-11-15: "binoculars is not needed for phone")
    const key = JSON.stringify([st, cells, m, !!cue.anchor?.()]);
    if (!force && key === drawerKey.v) return;
    drawerKey.v = key;
    const cq = !!cue.anchor?.() && !lit.anchor?.();
    for (const s of E.sheet.querySelectorAll('.seg')) for (const b of s.querySelectorAll('button')) { const o = +b.dataset.v === st[s.dataset.seg]; b.classList.toggle('on', o); b.classList.toggle('cue', cq && s.dataset.seg === 'anchor' && b.dataset.v === '1'); b.setAttribute('aria-pressed', String(o)); }
    for (const [id, o] of Object.entries(cells)) { const c = E.sheet.querySelector(`.dc[data-id=${id}]`); c.classList.toggle('on', o); c.setAttribute('aria-pressed', String(o)); }
    const mc = E.sheet.querySelector('.dc[data-id=moor]');
    mc.setAttribute('aria-disabled', String(!m)); mc.querySelector('span').textContent = m === 'dawn' ? 'Dawn' : 'Moor';
  }

  function show(v) {
    if (v === shownNow) return;
    shownNow = v; el.hidden = !v;
    if (!v) { setDrawer(false); g.id = null; g.kind = null; rope.release(); }
  }

  // each frame, before the boat's step: the shown state, then this frame's steer and pull into the page's hands
  function update(dt, hands = null) {
    const want = !!active();
    if (want !== on) {
      on = want;
      H.classList.toggle('lk-one-thumb', on);
      if (on && !el) build();
      if (el) show(false);
      if (assists && !on && !urlTrim && settings?.get) assists.crewTrim = !!settings.get('crewTrim');   // the other layouts: Setup's row again
    }
    steer = 0; pull = 0;
    if (!on) return;
    const vis = !hidden();
    show(vis);
    if (!vis) return;
    if (hands?.pull) auto = false;   // the sheet in the player's hand elsewhere (the water's rope, W / S): the trim is theirs
    if (assists) assists.crewTrim = auto;
    const s = state();
    // the drag: steer from where it landed (the water's tiller), or the rope
    if (g.id != null && g.kind !== 'trim') steer = tillerFromDrag(g.x - g.x0, innerWidth);
    pull = g.kind === 'trim' ? rope.update(dt) : 0;
    if (hands) {
      if (steer) hands.steer = Math.max(-1, Math.min(1, (hands.steer ?? 0) + steer));
      if (pull) hands.pull = Math.max(-1, Math.min(1, (hands.pull ?? 0) + pull));
    }
    const motor = !!eng?.on;
    // the anchorage cue: More glows faintly while she is inside an anchorage or by a free ball (the anchor is in its sheet)
    const cq = !!cue.anchor?.() && !lit.anchor?.();
    if (cq !== shown.cue) { shown.cue = cq; E.more.classList.toggle('cue', cq); if (drawerOpen) drawerFrame(true); }
    // the arc's knob: the boat's rudder
    const deg = Math.round(arcDeg(s?.rudderAngle ?? 0) * 4) / 4;
    if (deg !== shown.knob) { shown.knob = deg; E.kn.setAttribute('transform', `rotate(${deg} ${ARC.cx} ${ARC.cy})`); }
    const held = g.id != null && g.kind !== 'trim';
    if (held !== shown.held) { shown.held = held; el.classList.toggle('held', held); }
    if (motor !== shown.motor) {
      shown.motor = motor; el.classList.toggle('motor', motor);
      E.rail.classList.toggle('off', !motor); E.drive.classList.toggle('off', !motor); E.chip.classList.toggle('off', motor);
      for (const b of E.drive.querySelectorAll('button')) { const o = (b.dataset.v === '1') === motor; b.classList.toggle('on', o); b.setAttribute('aria-pressed', String(o)); }
    }
    // the action button
    const a = actionFor({ motor, active: tack?.active ? tack.assist?.kind ?? tack.kind : null, offer: tack?.offer ?? null, sailsDown: !lit.sails?.() });
    const ak = a ? `${a.id}:${a.lit ? 1 : 0}:${a.go ? 1 : 0}` : '';
    if (ak !== shown.ak) {
      shown.ak = ak; shown.act = a?.id ?? null;
      E.act.classList.toggle('off', !a);
      if (a) {
        E.act.classList.toggle('lit', a.lit); E.act.classList.toggle('go', a.go);
        E.actW.textContent = WORD[a.id]; E.act.setAttribute('aria-label', WORD[a.id]);
        E.actIcon.innerHTML = ICON[a.id];
      }
    }
    if (auto !== shown.chip) { shown.chip = auto; E.chipW.textContent = auto ? 'Auto' : 'Manual'; E.chip.setAttribute('aria-label', `sail trim: ${auto ? 'auto, the crew trims' : 'manual, drag up or down low on the screen'}`); }
    if (motor) {
      const v = eng.lever ?? 0, y = Math.round(railY(v, 170));
      if (y !== shown.rail) { shown.rail = y; E.knob.style.transform = `translateY(${y}px)`; E.rail.setAttribute('aria-valuenow', v.toFixed(2)); }
      const rl = Math.abs(v) >= THUMB.detent;
      if (rl !== shown.railLit) { shown.railLit = rl; E.knob.classList.toggle('lit', rl); }
    }
    if (drawerOpen) drawerFrame();
  }

  return {
    update,
    get el() { return el; }, get on() { return on; }, get shown() { return !!shownNow; },
    get steer() { return steer; }, get pull() { return pull; }, get steering() { return g.id != null && g.kind !== 'trim'; },
    get auto() { return auto; }, setAuto(v) { auto = !!v; },
    get drawer() { return drawerOpen; }, open(v = true) { setDrawer(v); },
    get action() { return shown.act ?? null; },
    dispose() { H.classList.remove('lk-one-thumb'); el?.remove(); },
  };
}
