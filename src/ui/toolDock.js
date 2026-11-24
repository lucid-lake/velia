// (Round family, 2026-10-30: each tool is a round push-button in the instruments' bezel)
// The tool dock (owner, 2026-10-29: "people won't remember all the keys"): a quiet column of small
// cream line icons on the left edge (the screen map,: "the left edge the dock"), in the hints' style (the design tokens, src/ui/tokens.css: Jost, the cream, hairlines, the soft dark halo, no box). It fades in
// when the mouse moves and out after DOCK.idleS of stillness, or DOCK.leaveS after the pointer leaves it. Each icon
// shows its name and key on a hover or a long-press (the page's one tip, tips.js: "Chart · N"), so a player learns the keys.
// A click does what the key does.
// The left edge, above the middle, collides with nothing: the hints are bottom-left (the H list, which grows up the
// same edge, hides the dock while it shows: hidden()), the glyph and the chart's large view
// bottom-right, the small chart top-right, the menu mark top-left (feat/design-system), the loading card is the whole screen above it (z 20,
// ready()), the logbook's page covers it (z 12). At phone width it stays a column on the left edge (the bottom is the hints' and the glyph's).
//
// A registry, so each feature brings its own icon (the chart, the binoculars and the radio are built elsewhere):
//   const dock = createToolDock();            // the 'dock' service
//   dock.register({ id, key, name, icon, order, action, visible })
//     id: unique; key: the key's label ('N'); name: 'chart'; icon: SVG markup in a 24 × 24 box (hairline strokes);
//     action(): what a click does (default: the key pressed and released on window, marked e.lkDock);
//     code: the KeyboardEvent code for the default action ('KeyN'); visible(): false hides it (polled at 2 Hz).
//   dock.stub({ id, key, name, icon, order })  // a hidden placeholder until the feature registers the same id
//   dock.update(dt); dock.dispose();
// Plain DOM; DockFade (the timing) is pure: tests/mouse.test.mjs.
import { ensureTokens, TOKENS } from './tokens.js';
import { sharedTips } from './tips.js';

export const DOCK = { idleS: 3, leaveS: 0.6, fadeIn: 0.25, fadeOut: 0.7, on: TOKENS.ink };   // on: the ink token

// The timing: show on a move, hide after idleS of stillness unless the pointer is over the dock; after it leaves,
// hide in leaveS. A press on an icon counts as a move.
export class DockFade {
  constructor({ idleS = DOCK.idleS, leaveS = DOCK.leaveS } = {}) { this.idleS = idleS; this.leaveS = leaveS; this.since = Infinity; this.over = false; this.leftAt = null; this.shown = false; this.t = 0; }
  move() { this.since = 0; }
  enter() { this.over = true; this.leftAt = null; this.since = 0; }
  leave() { this.over = false; this.leftAt = this.t; this.since = 0; }
  update(dt) {
    this.t += dt; this.since += dt;
    if (this.over) { this.shown = true; this.since = 0; }
    else if (this.leftAt != null && this.t - this.leftAt >= this.leaveS) { this.shown = false; this.leftAt = null; this.since = Infinity; }
    else this.shown = this.since < this.idleS;
    return this.shown;
  }
}

// Icons: 24 × 24, strokes only (the CSS sets the colour and the hairline)
export const ICONS = {
  chart: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z"/><path d="M9 4v13.5M15 6.5V20"/>',
  logbook: '<path d="M5 4.5h11.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2Z"/><path d="M5 18a2 2 0 0 1 2-2h11.5M9 8.5h6M9 11.5h4"/>',
  binoculars: '<circle cx="7" cy="15.5" r="3.6"/><circle cx="17" cy="15.5" r="3.6"/><path d="M7 11.9 8.4 5h2.4l.5 6M17 11.9 15.6 5h-2.4l-.5 6M10.6 14h2.8"/>',
  radio: '<rect x="8" y="8.5" width="8.5" height="13" rx="2"/><path d="M12.2 8.5V2.8M8 11.5H6.6v4H8"/><rect x="10" y="11" width="4.4" height="3" rx=".6"/><path d="M10.2 17.2h.01M12.2 17.2h.01M14.2 17.2h.01M10.2 19.4h.01M12.2 19.4h.01M14.2 19.4h.01"/>',   // a handheld VHF: antenna, PTT, display, keys
  helm: '<circle cx="12" cy="12" r="6.25"/><circle cx="12" cy="12" r="1.75"/><path d="M12 10.25V2.5M12 13.75v7.75M10.5 11.1 3.8 7.25M13.5 12.9l6.7 3.85M10.5 12.9l-6.7 3.85M13.5 11.1l6.7-3.85"/>',   // six spokes (was eight): reads at 20 px (feat/portrait)
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7"/>',
  keys: '<rect x="2.5" y="6.5" width="19" height="11" rx="1.6"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7.5 14h9"/>',
  sails: '<path d="M11 3v15M11 4.5C7.2 8 5.8 12.5 6.4 17H11M12.5 7C15.8 10 17.2 13.5 17 17h-4.5"/><path d="M4 20.5h16"/>',
  dawn: '<path d="M3 17h18M6.5 17a5.5 5.5 0 0 1 11 0M12 5.5v3.5M5 9.5l2 2M19 9.5l-2 2"/>',
  pro: '<path d="M7 3.5v14L17.5 17.5Z"/><path d="M4 20.5h16M7 3.5l5.5 9"/>',
  photo: '<rect x="3" y="6.8" width="18" height="12.7" rx="2.2"/><circle cx="12" cy="13.1" r="3.5"/><path d="M8.6 6.8 10 4.4h4l1.4 2.4"/>',
  locker: '<rect x="3.5" y="6" width="17" height="13" rx="2"/><path d="M3.5 11h17M12 11v3"/><path d="M8.5 6V4.6a3.5 3.5 0 0 1 7 0V6"/>',   // a cockpit locker: a lid, its hasp, a handle
};

// The Locker (owner, 2026-11-11): a mode with no cockpit (Cruise) keeps the passenger's gear in one bar menu,
// its rows the dock's own tools: Chart · Glasses · VHF · Logbook, then a hairline and the extras (Photo). A row runs its dock tool
// (or its own go), is lit while its thing is on (lit), dims while the dock has no live tool for it (live), and may say a state in
// its name (Chart · Fannette). Pure: it reads the registry, so a tool that registers later (the chunk's binoculars) just goes live.
//   const m = lockerMenu({ dock, lit: { binoculars: () => bool }, name: { chart: () => 'Chart · Fannette' }, go: { chart: () => … },
//                          extra: [{ id: 'photo', name: 'Photo', icon, go }] });
//   m.rows → [{ id, name, icon, sep }]   m.lit(id) → bool   m.live(id) → bool   m.name(id) → word   m.pick(id) → bool (it ran)
export const LOCKER = [['chart', 'Chart'], ['binoculars', 'Glasses'], ['radio', 'VHF'], ['logbook', 'Logbook']];
export function lockerMenu({ dock, lit = {}, name = {}, go = {}, extra = [] } = {}) {
  const safe = (f) => { try { return f(); } catch { return null; } };
  const tools = LOCKER.map(([id, word]) => ({ id, name: word, icon: ICONS[id], sep: false }));
  const more = extra.map((x, i) => ({ id: x.id, name: x.name, icon: x.icon ?? '', sep: i === 0 }));
  const isTool = (id) => LOCKER.some(([t]) => t === id);
  const live = (id) => (isTool(id) ? !!dock?.spec?.(id) && !!dock.visible(id) : true);
  return {
    rows: [...tools, ...more],
    live,
    lit: (id) => live(id) && !!safe(() => lit[id]?.()),
    name: (id) => safe(() => name[id]?.()) || [...tools, ...more].find((r) => r.id === id)?.name || id,
    pick(id) {
      const x = extra.find((e) => e.id === id);
      if (x) { x.go?.(); return true; }
      if (!live(id)) return false;
      if (go[id]) { go[id](); return true; }
      return !!dock.run(id);
    },
  };
}

// The helm dashboard's button row (owner, 2026-10-30): the dock registry now draws ONE row across the bottom centre, between
// the two instrument circles: small buttons and toggles, an icon over a short word, grouped by thin dividers (tools | propulsion | ground
// tackle | sails | passage). What belongs to the game (chart, helm view, wind, keys, pro) is registered here too (the registry is the one
// place the keys live) but shows in the top capsule, not in this row (data-g="top").
export const GROUP = { logbook: 'tools', chart: 'tools', binoculars: 'tools', radio: 'tools', engine: 'prop', anchor: 'tackle', dawn: 'tackle', lines: 'tackle', sails: 'sails', cruise: 'passage' };
export const WORD = { logbook: 'Log', chart: 'Chart', binoculars: 'Binoculars', radio: 'VHF', engine: 'Engine', anchor: 'Anchor', dawn: 'Dawn', lines: 'Moor', sails: 'Sails', cruise: 'Cruise' };   // the crew's label tape prints them in capitals
// The sprites (round 3, owner 2026-10-30: "the switches don't feel real"): offline PBR renders (blender/dash_switches.py, packed by tools/dash/pack_sprites.py)
// of sealed marine hardware on a small navy mounting plate: a rocker with a panel LED for a toggle (off, on, pressed), a turned stainless button for a
// momentary key (up, pressed); the word is a placard (an engraved laminate plate, an image) with the word as live text on it. One strict grid:
// every slot is --lk-kw wide (the same for all), one gap between slots, one wider gap between groups.
export const SPRITE = { rows: ['engine', 'anchor', 'lines', 'sails', 'logbook', 'binoculars', 'radio', 'cruise', 'chart'], cols: { toggle: { off: 0, on: 1, mid: 2 }, button: { up: 0, down: 1 } } };
const IS = (n) => `image-set(url(/brand/dash/${n}@1x.webp) 1x,url(/brand/dash/${n}@2x.webp) 2x,url(/brand/dash/${n}@3x.webp) 3x)`;
const U = 'var(--lk-u)';
const CSS = `
/* Round 3b (owner 2026-10-30: "unnecessarily big"; then "one continuous switch panel"): the row is compact. ONE rendered plate for ALL the keys (a 9-slice sprite; two small screws cap its ends),
   groups told apart by a thin engraved divider, never a gap; its switches (38 x 32 u cells, no plate of their own) in equal 48 u slots, the word engraved on the plate under each switch. A plate is 46 u tall
   (u = 1 px at 1280 x 720, --lk-u in tokens.css). The hit boxes are the slots (48 x 46 u), padded to 44 px on touch without growing the picture. */
.lk-dock{position:fixed;left:50%;bottom:var(--lk-by);transform:translateX(-50%);z-index:var(--lk-z-dock);display:flex;align-items:flex-end;gap:calc(${U} * 8);
  font:var(--lk-medium) var(--lk-fs-caption)/1 var(--lk-ui);color:var(--lk-ink);user-select:none;-webkit-user-select:none;
  opacity:0;pointer-events:none;transition:opacity .5s var(--lk-ease-out);-webkit-font-smoothing:antialiased}
.lk-dock.in{opacity:${DOCK.on};pointer-events:auto;transition:opacity .25s var(--lk-ease)}
.lk-dock .gp{position:relative;display:flex;box-sizing:border-box;height:calc(${U} * 46);padding:calc(${U} * 3) calc(${U} * 9) 0;
  border:0 solid transparent;border-radius:calc(${U} * 6.4);
  background:rgb(var(--lk-brand-navy) / .78);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);
  border-image-source:${IS('plate')};border-image-slice:25% fill;border-image-width:calc(${U} * 14);border-image-outset:calc(${U} * 4);border-image-repeat:stretch}
.lk-dock .gp:not(:has(.it:not([hidden]))){display:none}
.lk-cpanel .lk-dock .gp{display:none}   /* the control panel (controlPanel.js) is the row now */
.lk-dock .gp::before,.lk-dock .gp::after{content:'';position:absolute;top:calc(50% - ${U} * 5);width:calc(${U} * 8);height:calc(${U} * 8);background:${IS('screw')} center/100% 100% no-repeat;pointer-events:none}
.lk-dock .gp::before{left:calc(${U} * 1)}.lk-dock .gp::after{right:calc(${U} * 1)}
.lk-dock .it{all:unset;position:relative;box-sizing:border-box;flex:none;display:flex;flex-direction:column;align-items:center;width:calc(${U} * 48);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.lk-dock .it[hidden],.lk-dock .it[data-g=top]{display:none}
/* the engraved divider between groups: a dark cut with a pale lip, on the plate */
.lk-dock .it[data-gs]::before{content:'';position:absolute;left:0;top:calc(${U} * 6);height:calc(${U} * 30);width:calc(${U} * 2);pointer-events:none;
  background:linear-gradient(90deg,rgb(0 0 0 / .55) 0 50%,rgb(255 255 255 / .16) 50% 100%)}
/* the switch: one cell of the sheet; its row is the key's, its column the state */
.lk-dock .obj{display:block;position:relative;width:calc(${U} * 38);height:calc(${U} * 32);background-repeat:no-repeat;background-size:300% 900%;background-image:${IS('switches')};
  background-position:var(--cx,0%) calc(var(--ry,0) * 100% / 8)}
.lk-dock .it[data-kind=toggle]{--cx:0%}.lk-dock .it[data-kind=toggle].on{--cx:50%}.lk-dock .it[data-kind=toggle]:active{--cx:100%}
.lk-dock .it[data-kind=button]{--cx:0%}.lk-dock .it[data-kind=button]:active{--cx:100%}
.lk-dock .it[data-id=engine]{--ry:0}.lk-dock .it[data-id=anchor]{--ry:1}.lk-dock .it[data-id=lines]{--ry:2}.lk-dock .it[data-id=sails]{--ry:3}
.lk-dock .it[data-id=logbook]{--ry:4}.lk-dock .it[data-id=binoculars]{--ry:5}.lk-dock .it[data-id=radio]{--ry:6}.lk-dock .it[data-id=cruise]{--ry:7}.lk-dock .it[data-id=chart]{--ry:8}
/* the engraving: the word cut into the plate under its switch, pale and a hair recessed */
.lk-dock .lb{display:block;height:calc(${U} * 10);margin-top:calc(${U} * -1);font-size:calc(${U} * 9.5);font-weight:var(--lk-medium);letter-spacing:.05em;line-height:calc(${U} * 10);text-transform:uppercase;white-space:nowrap;
  color:rgb(236 240 248 / .92);text-shadow:0 -.5px 0 rgb(0 0 0 / .65),0 .5px 0 rgb(255 255 255 / .14);transition:opacity .4s}
.lk-dock .it:focus-visible{outline:none}
.lk-dock .it:focus-visible .obj{outline:var(--lk-line) solid var(--lk-lit);outline-offset:-2px;border-radius:calc(${U} * 4)}
.lk-dock .cap{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:1.7em;height:1.7em;padding:0 .45em;
  border:var(--lk-line) solid var(--lk-hair);border-radius:var(--lk-radius);font-weight:var(--lk-medium);font-size:var(--lk-fs-caption);letter-spacing:.02em}
.lk-dock .lvl{position:absolute;right:calc(${U} * 2);top:calc(${U} * 2);font-size:calc(${U} * 10);font-weight:var(--lk-medium);font-variant-numeric:tabular-nums;color:var(--lk-lit-ink);text-shadow:0 1px 2px rgb(var(--lk-shade))}
/* the glass: the plate's face is navy glass at 78 % over a 12 px blur (the circles' own), the sprite's face adds its brushed grain; the switches are solid. Night: the red sheets (pack_sprites.py night()) */
:root[data-lk-theme=night] .lk-dock .gp{border-image-source:${IS('plate-night')}}
:root[data-lk-theme=night] .lk-dock .gp::before,:root[data-lk-theme=night] .lk-dock .gp::after{background-image:${IS('screw-night')}}
:root[data-lk-theme=night] .lk-dock .obj{background-image:${IS('switches-night')}}
:root[data-lk-theme=night] .lk-dock .lb{color:rgb(255 140 120 / .92)}
/* Cruise lifts the row over its own strip; at rest (8 s without input, never in the first minute) the engraving fades and the row dims */
.lk-m-cruise .lk-dock{display:none}   /* Cruise's tools are the bar's Locker (lockerMenu below); the registry still runs its tools and keys */
.lk-dim .lk-dock .lb{opacity:0}.lk-dim .lk-dock{opacity:.7}
/* phone width: no engraving (the name is the title), a plate is the switches only; seven slots across */
:where(:root[data-screen~=narrow]) .lk-dock{max-width:none}
  :where(:root[data-screen~=narrow]) .lk-dock .lb{display:none}
  :where(:root[data-screen~=narrow]) .lk-dock .gp{height:calc(${U} * 36)}
  :where(:root[data-screen~=narrow]) .lk-dock .it{min-height:44px;min-width:44px}:where(:root[data-screen~=narrow]) .lk-dock .it::after{content:'';position:absolute;inset:-6px -4px}
/* a touch screen: every slot is 44 px to hit, in both directions, whatever its plate's size (an invisible pad: the picture does not grow) */
[data-input=touch] .lk-dock .it{min-height:44px;min-width:44px}[data-input=touch] .lk-dock .it::after{content:'';position:absolute;inset:-6px -4px}
`;

const press = (code) => {
  for (const type of ['keydown', 'keyup']) {
    const e = new KeyboardEvent(type, { code, key: code.replace(/^Key|^Digit/, ''), bubbles: true });
    e.lkDock = true; dispatchEvent(e);
  }
};

export function createToolDock({ root = document.body, target = globalThis, ready = () => true, hidden = () => false } = {}) {
  ensureTokens();
  if (!document.getElementById('lk-dock-css')) {
    const st = document.createElement('style'); st.id = 'lk-dock-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = document.createElement('nav'); el.className = 'lk-dock'; el.setAttribute('aria-label', 'tools'); root.appendChild(el);
  const fade = new DockFade();
  const items = new Map();   // id → { spec, btn, stub }
  const tips = sharedTips();   // each switch's name and key above it ("Binoculars · B"; tips.js)
  let pollT = 0, disposed = false;

  const render = () => {
    const list = [...items.values()].sort((a, b) => (a.spec.order ?? 50) - (b.spec.order ?? 50));
    el.textContent = '';
    let g = null; const gp = document.createElement('div'); gp.className = 'gp'; el.appendChild(gp);   // ONE panel for every key
    for (const it of list) {
      const gr = it.btn.dataset.g;
      if (gr === 'top') { el.appendChild(it.btn); continue; }
      if (g && gr !== g) it.btn.dataset.gs = ''; else delete it.btn.dataset.gs;   // a group's first slot carries the engraved divider, not a gap
      g = gr; gp.appendChild(it.btn);
    }
  };
  const vis = (it) => { if (it.stub) return false; try { return it.spec.visible ? !!it.spec.visible() : true; } catch { return false; } };
  const build = (spec, stub) => {
    const old = items.get(spec.id); if (old) { tips.forget(old.btn); old.btn.remove(); }
    const btn = document.createElement('button'); btn.className = 'it'; btn.dataset.g = GROUP[spec.id] ?? 'top'; btn.type = 'button'; btn.dataset.id = spec.id;
    btn.setAttribute('aria-label', `${spec.name}${spec.key ? ` (${spec.key})` : ''}`);
    btn.dataset.kind = spec.lit ? 'toggle' : 'button';
    btn.innerHTML = `<span class="obj" aria-hidden="true"></span><span class="lb" aria-hidden="true">${WORD[spec.id] ?? spec.name}</span>${spec.badge ? '<span class="lvl"></span>' : ''}`;
    tips.add(btn, { side: 'up' });
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); if (tips.consumed(btn)) return;   // a long-press named it: not a press
      fade.move(); dispatchEvent(new Event('lk-click'));   // the switch's quiet click (controls.js plays winch_click)
      if (spec.action) spec.action(); else if (spec.code) press(spec.code);
      btn.blur();
    });
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());   // not the camera's press
    const it = { spec, btn, stub };
    items.set(spec.id, it);
    btn.hidden = !vis(it);
    render();
    return it;
  };
  const onMove = (e) => { if (e.pointerType !== 'touch') fade.move(); };
  const onTouch = (e) => { if (e.pointerType === 'touch') fade.move(); };
  target.addEventListener('pointermove', onMove, { passive: true });
  target.addEventListener('pointerdown', onTouch, { passive: true });
  el.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') fade.enter(); });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') fade.leave(); });

  function update(dt) {
    if (disposed) return;
    fade.update(dt); el.classList.toggle('in', ready() && !hidden());   // the row is always up (the old fade is kept for its tests)   // ready(): not under the loading card; hidden(): the H list is up
    pollT += dt;
    if (pollT > 0.5) {
      pollT = 0;
      for (const it of items.values()) {
        it.btn.hidden = !vis(it);
        if (it.spec.lit) { let on = false; try { on = !!it.spec.lit(); } catch { /* not ready */ } it.btn.classList.toggle('on', on); it.btn.setAttribute('aria-pressed', String(on)); }
        if (it.spec.badge) { const b = it.btn.querySelector('.lvl'); const v = String(it.spec.badge() ?? ''); if (b.textContent !== v) b.textContent = v; }
      }
    }
  }
  return {
    el, fade, update,
    register: (spec) => build(spec, false).btn,
    stub: (spec) => (items.get(spec.id)?.stub === false ? items.get(spec.id).btn : build(spec, true).btn),
    unregister: (id) => { const it = items.get(id); if (it) { tips.forget(it.btn); it.btn.remove(); } items.delete(id); },
    get items() { return [...items.values()].map((it) => ({ id: it.spec.id, key: it.spec.key, name: it.spec.name, hidden: it.btn.hidden, stub: it.stub })); },
    get shown() { return fade.shown; },
    // the control panel (controlPanel.js) draws the bottom row's switches itself: it reads their specs and runs their actions here
    spec: (id) => items.get(id)?.spec ?? null,
    run(id) { const it = items.get(id); if (!it || it.stub) return false; dispatchEvent(new Event('lk-click')); if (it.spec.action) it.spec.action(); else if (it.spec.code) press(it.spec.code); return true; },
    visible: (id) => { const it = items.get(id); return !!it && vis(it); },
    dispose() { disposed = true; target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerdown', onTouch); for (const it of items.values()) tips.forget(it.btn); el.remove(); },
  };
}
