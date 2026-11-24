// The engine and the ground tackle's live half on v2 (#8, #14): what v1's src/sail/seamanship.js wires on a Sail page around
// its pure rules (v2/sim/seamanship.js): the keys (I the engine, + − the lever a notch, held a notch every 0.3 s, 0 N, J the anchor,
// Y the sails: v1's KEY table, src/sail/keys.js; the lean set,: U, the lines, is the MOOR button's alone), the dock's switches the cockpit's panel reads (SAILS, ANCHOR, the
// engine, MOOR while a pier is near, DAWN at anchor after dark), the skipper's lines (src/ui/skipper.js NOTES, a finger's
// wording on a touch screen), the sunrise veil, the arrival's hand-back on any input, and the 'seamanship' service v1's logbook
// ("at anchor") and the VHF read.
//   const seaUi = mountSeamanship({ sea, services, dock, hint, icons, used });
import { KEY } from '../../src/sail/keys.js';
import { NOTES } from '../../src/ui/skipper.js';
import { ICONS as SEA_ICONS } from '../../src/sail/seamanshipRules.js';

// v2's own anchor lines (the anchor seen, owner 2026-11-17; src/ui/skipper.js NOTES' shape, v1's table untouched): the crew stops
// her for it, the nearest charted anchorage when it is too deep ({d}: the depth and the spot, "38 m here. Shallows by the narrows,
// 200 m ahead"), one line when it holds and one when it drags. Voiced in the old skipper's voice into their own folder
// (audio/skipper-v2/, tools/v2-sea-voice.py; v1's manifest stays v1's lines); the deep line speaks its fixed part.
// status: the line is the status line's (ui/sail.js sayStatus shows it at once, as the crew's work), not a queued note
// shows: the words the skipper's row shows when the line is up (the voice waits for them); lean: its class for the lean skipper
// (v2/ui/leanSkipper.js LEAN_CLASS, feat/v2-lean-skipper: must at once, a tip once ever, chat never)
export const SEA_NOTES = Object.freeze({
  rounding: { text: 'Rounding up to {anchor}', speak: 'Rounding up to anchor.', status: true, shows: 'Rounding up to anchor', lean: 'chat' },
  deepSpot: { text: 'Too deep — {d}', speak: 'Too deep here. There is a good spot on the chart.', shows: 'Too deep', lean: 'must' },
  holding:  { text: '{anchor|Anchor}’s holding.', speak: 'Anchor’s holding.', status: true, shows: 'Anchor’s holding', lean: 'tip' },
  dragging: { text: 'We’re dragging.', speak: 'We are dragging.', shows: 'We’re dragging', lean: 'must' },
  up:       { text: '{anchor|Anchor}’s up.', speak: 'Anchor’s up.', status: true, shows: 'Anchor’s up', lean: 'chat' },
});
// the anchor lines' kinds and their lean classes (for v2/ui/leanSkipper.js LEAN_CLASS): deepSpot and dragging must be acted on,
// "Anchor's holding." teaches once that it held, the rest (the crew at work, "Anchor's up.", the anchorage tap's reply) is chatter
export const SEA_KINDS = Object.freeze({ ...Object.fromEntries(Object.entries(SEA_NOTES).map(([id, n]) => [`sea.${id}`, n.lean])), 'sea.anchorage': 'chat' });

// The anchor's voice speaks a line only once the skipper's row really shows it (a line the row drops is never spoken over another):
// say(id) arms it; each poll looks for the line's words in the row (shownText()); seen within waitS it speaks, else it is dropped.
//   const v = createShownVoice({ speak, shownText, now });   v.say(id);   v.poll()   (the page polls every 100 ms while armed)
export function createShownVoice({ speak = () => {}, shownText = () => '', now = () => 0, waitS = 2.5 } = {}) {
  let pending = null;
  return {
    say(id) { const n = SEA_NOTES[id]; if (n) pending = { n, until: now() + waitS }; return !!n; },
    poll() {
      if (!pending) return false;
      if (String(shownText() ?? '').includes(pending.n.shows)) { const n = pending.n; pending = null; speak(n.speak); return true; }
      if (now() > pending.until) pending = null;
      return false;
    },
    get pending() { return pending ? pending.n.shows : null; },
  };
}
const noteOf = (id) => SEA_NOTES[id] ?? NOTES[id];

const LEVER_KEYS = { [KEY.ahead]: 1, NumpadAdd: 1, [KEY.astern]: -1, NumpadSubtract: -1 };

// the keys (pure): e → an action name or null (v1's seamanship keydown, the codes from src/sail/keys.js KEY)
export function seaKey({ code, repeat = false, ctrlKey = false, metaKey = false, typing = false } = {}) {
  if (ctrlKey || metaKey || typing || repeat) return null;
  if (code === KEY.engine) return { engine: true };
  if (LEVER_KEYS[code]) return { lever: LEVER_KEYS[code] };
  if (code === KEY.neutral) return { neutral: true };
  if (code === KEY.anchor) return { anchor: true };
  if (code === KEY.sails) return { sails: true };
  return null;
}
export const isLeverKey = (code) => !!LEVER_KEYS[code];

export function mountSeamanship({ sea, services, dock, hint = null, icons = {}, used = () => {}, doc = globalThis.document, statusLine = false, speak = null }) {
  // v2's own clips (audio/skipper-v2/: tools/v2-sea-voice.py), spoken only once the row shows the line
  const win = doc?.defaultView ?? globalThis, clockS = () => (win.performance?.now?.() ?? 0) / 1000;
  const voice = speak ? createShownVoice({ speak, shownText: () => hint?.el?.textContent ?? '', now: clockS }) : null;
  let polling = false;
  const pollVoice = () => { if (!voice?.pending) { polling = false; return; } voice.poll(); win.setTimeout?.(pollVoice, 100); };
  const arm = (id) => { if (voice?.say(id) && !polling) { polling = true; win.setTimeout?.(pollVoice, 50); } };
  const say = (id, key = '', d = '') => {
    const N = noteOf(id); if (!N) return;
    arm(id);
    if (N.status && statusLine) return;   // the status line says it (ui/sail.js)
    const touch = !!services.get('modality')?.touch, th = touch && !!N.thumb && !!doc?.documentElement?.classList?.contains('lk-one-thumb');   // the one-thumb controls (thumb.js)
    const f = touch && N.touch;
    const fl = touch && !!N.flat && !!doc?.documentElement?.classList?.contains('lk-flat');   // the phone's flat controls (flat.js)
    const kind = { kind: `sea.${id}` };   // a phone keeps only the ones src/ui/phoneQuiet.js lists
    if (fl) { hint?.note?.(N.flat.replace('{d}', d), '', N.flatSpeak ?? N.flat, kind); return; }
    if (th) { hint?.note?.(N.thumb.replace('{d}', d), '', N.thumbSpeak ?? N.thumb, kind); return; }
    hint?.note?.((f ? N.touch : N.text).replace('{d}', d), f ? '' : key, f ? N.touchSpeak ?? N.touch : N.speak, kind);
  };
  // the pure half's voice, the controls' click and the sunrise veil go through this page
  const veilEl = doc?.createElement?.('div');
  if (veilEl) { veilEl.style.cssText = 'position:fixed;inset:0;background:#05080b;opacity:0;pointer-events:none;z-index:9;transition:opacity 1.6s cubic-bezier(.4,0,.6,1)'; doc.body.appendChild(veilEl); }
  const api = sea;
  Object.assign(sea.hooks, { say, veil: (op, s) => { if (!veilEl) return; veilEl.style.transition = `opacity ${s}s cubic-bezier(.4,0,.6,1)`; veilEl.style.opacity = String(op); } });
  const icon = (k) => icons[k] ?? SEA_ICONS[k] ?? icons.pro;
  const eng = sea.engine;
  // v1's dock rows (seamanship.js): the panel's rockers and push-buttons read them (controlPanel.js), the key legend their keys
  dock.register({ id: 'sails', key: 'Y', name: 'sails up / down', icon: icon('sails'), order: 30, action: () => { sea.actions.sails(); used(); }, lit: () => (sea.ctl.furl ?? 0) < 0.5 });
  dock.register({ id: 'anchor', key: 'J', name: 'anchor', icon: icon('anchor'), order: 31, action: () => { sea.actions.anchor(); used(); }, lit: () => (sea.tackle.mode === 'anchor' && sea.tackle.state.anchor.phase !== 'stowed') || sea.tackle.mode === 'moored' });   // on a ball picked up with J: lit too, J lets it go
  dock.register({ id: 'engine', key: 'I', name: 'engine', icon: icon('engine'), order: 33, action: () => { sea.actions.engine(); used(); }, lit: () => eng.on, badge: () => (eng.on ? (eng.gear > 0 ? '▲' : eng.gear < 0 ? '▼' : '·') : '') });
  dock.register({ id: 'lines', key: '', name: 'lines', icon: icon('lines'), order: 46, action: () => { sea.actions.lines(); used(); }, lit: () => sea.tackle.mode === 'moored' || sea.tackle.mode === 'docked', visible: () => sea.linesUp() });
  dock.register({ id: 'dawn', key: '', name: 'wait for dawn', icon: icon('dawn'), order: 45.5, action: () => { sea.actions.sunrise(); used(); }, visible: () => sea.dawnUp() });
  const typing = () => /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(doc?.activeElement?.tagName ?? '');
  addEventListener('keydown', (e) => {
    if (e.lkVirtual) return;
    if (!e.lkDock) sea.touched();
    const a = seaKey({ code: e.code, repeat: e.repeat, ctrlKey: e.ctrlKey, metaKey: e.metaKey, typing: typing() });
    if (!a) return;
    if (a.engine) sea.actions.engine();
    else if (a.lever) sea.hold(a.lever);
    else if (a.neutral) sea.actions.neutral();
    else if (a.anchor) sea.actions.anchor();
    else if (a.sails) sea.actions.sails();
    used();
  });
  addEventListener('keyup', (e) => { if (isLeverKey(e.code)) sea.release(); });
  addEventListener('blur', () => sea.release());
  for (const ev of ['pointerdown', 'wheel']) addEventListener(ev, (e) => { if (!e.lkVirtual && !e.lkDock) sea.touched(); }, { passive: true });   // the bow look hands back only on a real look (v2/sim/boat.js camera() calls sea.looked()): a click on the cockpit or the water is not one
  services.provide('seamanship', api);   // v1's service: the logbook's anchoredNow ("at anchor"), the VHF's anchored
  return {
    // the cockpit's states (v1's stations/sloop/index.js cockpitStates): the ANCHOR rocker, MOOR (or DAWN) on the cap
    toggles: () => ({ sails: (sea.furlWant ?? sea.ctl.furl ?? 0) < 0.5, anchor: (sea.tackle.mode === 'anchor' && sea.tackle.state.anchor.phase !== 'stowed') || sea.tackle.mode === 'moored' }),
    // the anchorage cue: inside a charted anchorage or by a free ball, the ANCHOR control glows faintly (not while lit)
    cue: () => !!sea.cue?.on,
    moor: () => (dock.spec?.('lines') && dock.visible?.('lines') ? 'lines' : dock.spec?.('dawn') && dock.visible?.('dawn') ? 'dawn' : null),
    // the panel's rocker progress (v1's anP): the chain out (or in) of its target
    anchorProgress: () => { const a = sea.tackle.state.anchor; if (['falling', 'down'].includes(a.phase)) return Math.min(1, a.out / Math.max(1, a.target)); if (['weighing', 'up'].includes(a.phase)) return 1 - Math.min(1, a.out / Math.max(1, a.target)); return null; },
    say, armVoice: arm,   // armVoice(id): the voice waits again for the row to show the line (ui/sail.js: the holding line's retry)
    dispose() { veilEl?.remove(); services.remove?.('seamanship'); },
  };
}
