// The sloop's helm station, mounted by craft (refactor round 2, Phase C step 9):
// the helm view's pickable parts (helmPick.js), the pro trim panel (trimPanel.js), the helm station with its 3D cockpit
// (helmStation.js, cockpit3d.js), the control panel (controlPanel.js), the PRO recess (proRecess.js), the Tack pill
// (tackButton.js), the turn-the-phone line (ui/turnPhone.js) and the throttle column (throttleLever.js). The sail controller
// (src/controllers/sail.js) gets this through the station registry (src/stations/index.js: stationFor(craft.id)).
// Two calls, so every element is created at the point in the page it always was (tests/sailDomOrder.test.mjs): the mount
// itself where the trim panel was built (before the pads, the captain's tools and the seamanship add theirs), then
// S.mount({ … }) where the station block was (after them: the tools and the seamanship are its inputs).
//   const S = mountSloopStation(core, deck, { boat, phys, ctl, sfx, helmPick, live });   // helmPick: Cruise's own, or null
//   S.on                                   the station is up on this page (?station=0 or no 3D HUD: the old row and strip)
//   S.helmPick, S.trimPanel                built at once; the 'helmPick' service
//   S.mount({ pads, tools, sea, fly, hint, notes, once })   the rest; the 'station', 'panel', 'hud', 'throttle', 'tackBtn' services
//   S.station, S.panel, S.proRecess, S.tackBtn, S.turnLine, S.throttle   (null where the page has none)
//   S.begin(dt)        the Tack pill's frame (before the pads)          S.trimUpdate(dt)  the trim panel and the PRO recess
//   S.update(dt)       the station, the panel, the turn line, in that order (after boat.update)
//   S.helmView(dt, exposure)   the helm view's parts: hover under a still mouse, the gloss, the cursor, helmPick.update
//   S.dispose()        its parts, then its service names (station, panel, tackBtn, helmPick; 'throttle' and 'hud' stay with
//                      the mode's scope, as before)
// live: the controller's own state, read when needed: { pro: () => bool, handOn: () => bool }
import * as THREE from 'three/webgpu';
import { createHelmPick } from './helmPick.js';
import { createTrimPanel } from '../../../../src/stations/sloop/trimPanel.js';
import { createProRecess, demoAllowed, DEMO } from '../../../../src/stations/sloop/proRecess.js';
import { createHelmStation } from './helmStation.js';
import { createControlPanel } from '../../../../src/stations/sloop/controlPanel.js';
import { createThrottleColumn } from '../../../../src/stations/sloop/throttleLever.js';
import { createTackButton } from '../../../../src/stations/sloop/tackButton.js';
import { createTurnLine } from '../../ui/turnPhone.js';
import { isCoarse } from '../../../../src/ui/touchMap.js';

// the helm view's parts no longer gloss on hover (owner 2026-10-30: the wheel and the winches explain themselves); only the radio's LCD speaks in knots
const PART_TERM = { radio: 'knot' };
// the tab's session storage (the PRO demo's once-a-session mark), or null where it is blocked
const tabStore = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };

export function mountSloopStation(core, deck, { boat, phys, ctl, sfx = null, helmPick: sharedPick = null, live }) {
  const { flags, services } = core;
  const { fireKey, loadingUp, blend } = deck;
  // the helm view's pickable parts (helmPick.js): Cruise's hand-over passes the passenger's own, so its parts carry over
  const helmPick = sharedPick ?? createHelmPick({ boat, THREE }); services.provide('helmPick', helmPick);
  let tools = null, sea = null, hint = null, station = null, panel = null, proRecess = null, tackBtn = null, turnLine = null, throttle = null;
  const on = flags.station && !!core.hud;   // the helm station (helmStation.js): ?station=0 the old row and strip
  // TRIM+: the pro trim on screen (traveller, twist, backstay, jib lead, wing-on-wing); shown only in Pro; the keys stay for pros
  // the pro trim panel (trimPanel.js; owner 2026-10-30, it replaces the TRIM+ drawer): a second control panel on top of the first,
  // shown only in Pro; it draws and sets the four pro controls and wing-on-wing (the Q E Z X R F G keys stay for pros)
  const trimPanel = createTrimPanel({ get: () => ({ traveller: ctl.traveller, twist: ctl.twist, backstay: ctl.backstay, jibLead: ctl.jibLead, wing: !!ctl.jibSide }),
    set: (k, v) => { ctl[k] = v; deck.used(); }, wing: () => { fireKey('keydown', 'KeyG'); fireKey('keyup', 'KeyG'); },
    vhf: () => tools.on, onVhf: () => { tools.toggle(); dispatchEvent(new Event('lk-click')); },
    shown: () => live.pro() && flags.station && !loadingUp() && !deck.binoUp && !services.get('menu')?.isOpen && station?.rects?.form !== 'cockpit', onUse: (id) => services.get('playtest')?.log?.('press', { control: id, via: 'trim' }) });

  function mount({ pads, tools: toolsIn, sea: seaIn, fly, hint: hintIn, notes, once }) {
    tools = toolsIn; sea = seaIn; hint = hintIn;
    const dock = deck.dock;
    // the helm station (owner, 2026-10-30): the boat's own wheel and winches on the bottom row, and the control panel
    const dashHidden = () => loadingUp() || !!services.get('menu')?.isOpen || !!services.get('logbook')?.logbook?.isOpen || !!services.get('chart')?.chart?.toggle?.big || deck.binoUp || hint.current === 'keys';
    // the playtest's count of presses per control (?playtest=1): so the panel's order can be revisited with data
    const pressed = (control, via) => { services.get('playtest')?.log?.('press', { control, via }); };
    const anP = () => { const a = sea.tackle.state.anchor; if (['falling', 'down'].includes(a.phase)) return Math.min(1, a.out / Math.max(1, a.target)); if (['weighing', 'up'].includes(a.phase)) return 1 - Math.min(1, a.out / Math.max(1, a.target)); return null; };
    panel = on ? createControlPanel({ dock, hidden: dashHidden, onPress: pressed,
      // a rocker's state is "down": the sails lowered (the crew's target, so the half lights the moment it is pressed), the anchor out
      lit: { sails: () => (sea.furlWant ?? ctl.furl ?? 0) >= 0.5, anchor: () => sea.tackle.mode === 'anchor' && sea.tackle.state.anchor.phase !== 'stowed',
        binoculars: () => tools.latched || tools.bino.k > 0.5, pro: () => live.pro() },   // TRIM's ring: amber while Pro is on
      progress: { sails: () => { const f = phys.state.furl ?? 0, w = sea.furlWant ?? 0; return Math.abs(f - w) > 0.03 ? (w >= 0.5 ? f : 1 - f) : null; }, anchor: anP, reef: () => { const s = phys.state, d = Math.abs((s.reefing ?? 0) - (s.reef ?? 0)); return d > 0.03 ? 1 - d : null; } } }) : null;
    // the 3D cockpit (cockpit3d.js; owner 2026-11-06, stage 1: a desktop in Sail and Regatta): its switches, key, lever and TACK
    // drawn from the same states the DOM panel shows. Every path into Sail's helm has this one layout (the owner, 2026-11-06:
    // Cruise's "take the helm" showed the old panel): a Sail load, the menu's switch (the shell still says Cruise while Sail
    // mounts), Cruise's hand-over (these same controls, attached in place) and Regatta. Cruise's own UI is its strip, not these.
    const inCruise = false;
    // the PRO recess (proRecess.js; owner 2026-11-06, the cockpit's stage 2): its hit layer over the 3D trim controls; PRO is the
    // dock's 'pro' switch (the same as Settings → Sailing). Look C3 (owner 2026-11-12): BINOS and VHF are push-buttons by the
    // instruments (the same layer's targets, for every player); LOG left the cockpit (the Menu's Logbook, L)
    const proLit = { binoculars: () => tools.latched || tools.bino.k > 0.5, radio: () => !!tools.on };
    proRecess = on && !inCruise ? createProRecess({ get: () => ({ traveller: ctl.traveller, twist: ctl.twist, backstay: ctl.backstay ?? phys.state.backstay, jibLead: ctl.jibLead }),
      set: (k, v) => { if (!live.pro()) return; ctl[k] = v; deck.used(); }, open: () => live.pro(), onPro: () => dock.run('pro'),
      onTool: (id) => { if (id === 'radio') { tools.toggle(); dispatchEvent(new Event('lk-click')); } else dock.run(id); }, lit: proLit,
      onUse: (id) => { deck.used(); pressed(id, 'pro'); },
      // the one quiet demo (look/pro-sliders): the first PRO open of a session, a person's page only
      demo: demoAllowed({ flags, webdriver: !!globalThis.navigator?.webdriver, reduced: !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches, storage: tabStore() }),
      onDemo: () => tabStore()?.setItem(DEMO.key, '1') }) : null;
    const cockpitStates = () => {
      const up = (id) => !!dock.spec(id) && dock.visible(id);
      const e = phys.engine, pro = live.pro();
      return {
        pro: { open: pro, f: proRecess?.shownF, lit: { pro, binoculars: proLit.binoculars(), radio: proLit.radio() } },
        hover: proRecess?.hover ?? null,   // BINOS, VHF or a slider under the pointer, the focus or a press (its cap glows, its car brightens)
        toggles: { sails: (sea.furlWant ?? ctl.furl ?? 0) < 0.5, anchor: sea.tackle.mode === 'anchor' && sea.tackle.state.anchor.phase !== 'stowed', reef: (phys.state.reef ?? 0) > 0 },
        moor: up('lines') ? 'lines' : up('dawn') ? 'dawn' : null,   // MOOR only near a mooring or a pier (DAWN at anchor after dark)
        engine: e?.state ?? 'off', rpm: e?.rpm ?? 0, lever: e?.lever ?? 0,
        tack: { offer: !!tackBtn?.offer, active: !!tackBtn?.active, kind: tackBtn?.kind },
      };
    };
    station = on ? createHelmStation(core, { boat, state: () => phys.state, furl: () => ctl.furl ?? 0, hidden: dashHidden, helmView: () => deck.view === 'helm' || blend.k > 0.5,
      onUse: () => { deck.used(); }, cue: (k) => (k === 'chime' ? sfx?.cue('find', { hz: 659 }) : sfx?.cue(k)), coarse: isCoarse(), once: flags.once, panelRect: (lay) => { panel?.place(lay.panel, lay.form, lay); throttle?.place(lay.thr, { word: lay.word, knob: lay.knob, eng: lay.eng, steps: lay.steps, litAt: lay.litAt, form: lay.form === 'cockpit' ? 'cockpit' : null }); trimPanel.place(lay.trim); }, quietHints: () => trimPanel.shown,
      jibOn: () => live.handOn(), fade: () => (services.get('calm')?.slotTargets ?? null), free: () => fly.free, cockpit: inCruise ? null : cockpitStates,
      calm: () => services.get('calm'), pro: proRecess }) : null;
    // the Tack / Gybe pill above the wheel, for every pointer (the strip's plate is off with the station): the existing assist
    tackBtn = station ? createTackButton({ pads, state: () => phys.state, rects: () => station.rects, shown: () => station.shown && deck.view !== 'helm' && blend.k < 0.5, onUse: () => { deck.used(); } }) : null;
    services.provide('tackBtn', tackBtn);
    // an upright phone: the skipper says once that the phone sideways has the whole cockpit (turnPhone.js; never a blocking screen)
    turnLine = station ? createTurnLine({ storage: once ? globalThis.localStorage ?? null : null, text: notes.turnPhone.text, say: () => hint.note?.(notes.turnPhone.text, '', notes.turnPhone.speak), shown: () => hint.el?.textContent ?? '' }) : null;
    // the throttle lever (throttleLever.js): its own column beside the control panel (a phone: beside the wheel), always
    // on screen; it draws the engine's own lever. No ENGINE button: out of N it starts, at N it stops by state (seamanship.js)
    const eng = phys.engine;
    throttle = panel && eng ? createThrottleColumn({ lever: () => eng.lever, engineState: () => eng.state, step: (d) => sea.actions.step(d),
      set: (v, o) => sea.actions.lever(v, o), onUse: () => { deck.used(); pressed('throttle', 'lever'); } }) : null;
    if (throttle) { panel.attach(throttle); station?.relayout(); }
    services.provide('station', station); services.provide('panel', panel); services.provide('hud', core.hud); services.provide('throttle', throttle);
    return S;
  }

  let glossed = null;
  function glossPart(hp, xy) {
    const term = hp ? PART_TERM[hp.name ?? hp.id] ?? null : null;
    if (term && xy) { if (glossed !== term) dispatchEvent(new CustomEvent('lk-gloss', { detail: { term, x: xy[0], y: xy[1] } })); glossed = term; }
    else if (glossed) { dispatchEvent(new Event('lk-gloss-off')); glossed = null; }
  }

  const S = {
    on, helmPick, trimPanel, mount,
    get station() { return station; }, get panel() { return panel; }, get proRecess() { return proRecess; },
    get tackBtn() { return tackBtn; }, get turnLine() { return turnLine; }, get throttle() { return throttle; },
    begin(dt) { tackBtn?.update(dt, { handHeld: station?.steer != null }); },
    // a finger's JIB winch steps hang outboard of it: BINOS's target stands aside while they show (look C3)
    trimUpdate(dt) { trimPanel.update(dt); proRecess?.suppress?.('binoculars', !!document.querySelector('[data-input=touch] .lk-helm .grp[data-w=jib]:is(:hover, .hov, :focus-within)')); proRecess?.update(dt); },
    update(dt) {
      station?.update(dt); panel?.update(dt);   // the wheel and the drums draw the boat's own rudder and sheets, whatever moved them
      turnLine?.update(dt, { kind: station?.rects?.kind, sailing: !!station?.shown && deck.view !== 'helm', able: !!station?.cockpitAble });
    },
    // the helm view's parts: hover under a still mouse (one ray a frame at most), the glow, the working winch's side
    helmView(dt, exposure) {
      const press = deck.press, hoverXY = deck.hoverXY, canvas = deck.canvas;
      if (deck.view === 'helm' && hoverXY && !press) { const hp = helmPick.pick(deck.rayAt(hoverXY[0], hoverXY[1])); helmPick.hover(hp); glossPart(hp, hoverXY); canvas.style.cursor = hp ? (hp.kind === 'drag' ? 'grab' : 'pointer') : ''; }
      else if (!press?.part) { helmPick.hover(null); glossPart(null); if (deck.view !== 'helm' && canvas.style.cursor) canvas.style.cursor = ''; }
      helmPick.update(dt, phys.state, exposure);
    },
    dispose() {
      trimPanel.dispose(); proRecess?.dispose(); tackBtn?.dispose(); station?.dispose(); panel?.dispose(); throttle?.dispose();
      for (const k of ['station', 'panel', 'tackBtn', 'helmPick']) services.remove(k);
    },
  };
  return S;
}
