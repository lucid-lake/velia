// The front door's live half (a chunk of its own, loaded after the first frame beside Sail's UI, as v1's src/shell.js is): v1's
// home card (src/ui/home.js: the float plan, ENTER, the action row, the Help sheet's pages, Setup) as it is, wired
// to v2's sim, wind and views. No staged first minute (owner, 2026-11-13: "in v2 we do not need that"; v1 keeps
// src/ui/firstStage.js): a first visit gets the same card. What v1's shell does for it, here for v2:
//   the settings        the page's one store (settingsStore.js); applied to what v2 has: Pro, the HUD preset (calmHud reads
//                       it), button tips; the rest is kept for when v2 has the system
//   the modes           Sail and Cruise (v2/cruise, the page's modes.go): the pill's Cruise
//                       enters Cruise; Regatta stays in the pill, disabled, "soon" (frontPlan.js pickStates); v1's idle attract
//                       (45 s untouched on the card: the card slides aside and Cruise plays; a touch brings the card and the plan back)
//   the menu            the card is the 'menu' service in Sail's UI: the bar's Menu, Setup and the Calm mark open it
//   the logbook         LOG on the card and on the in-play Menu card opens v1's logbook (ui/logbook.js), as v1's shell
//   the first visit     no welcome (owner, 2026-11-21: "remove the skill question"): a player never asked starts as New
//                       (frontPlan.js seedProfile, DEFAULT_PROFILE) and picks I sail or I race in Setup › Aids › your sailing
//   const front = installFront({ settings, B, windField, clock, views, weather });
//   front.wire(ui)  once Sail's UI is up
import { createHome, MODES, boatLine } from '../../src/ui/home.js';
import { installDesktopNote } from '../../src/ui/desktopNote.js';
import { keysPageHtml, V2_TOUCH_ROWS, THUMB_ROWS } from '../../src/ui/keysContent.js';
import { keyTable, FLAT_ROWS } from './keyMap.js';   // v2's own desktop keys (every handler's binding)
import { createWords } from '../../src/ui/words.js';
import { touchHand } from '../../src/ui/hand.js';
import { feature } from '../../src/core/features.js';
import { browserName } from '../../src/ui/feedback.js';
import { setTipsOn } from '../../src/ui/tips.js';
import { attractSettings } from '../../src/ui/attract.js';
import { FLAGS } from '../../src/sim/core/flags.js';
import { SOON, pickStates, seedProfile } from './frontPlan.js';
import { isPlayed } from '../engine/modes.js';   // the picks v2 plays: the mode table's rows
import { mountBirthplaceCard } from './birthplaceCard.js';   // the card's pins: where a sail starts (Phase 1b)
import { mountPhoneCard } from './phoneCard.js';   // the phone's thumb-first card (feature phoneCard)
import { mountMenuCard } from './menuCard.js';   // the in-play Menu card: a mode tap enters it at once, no Resume (owner 2026-11-15)
import { enterLandscape } from './landscape.js';   // phones are landscape-only
import { applySetup, qualityStatus, removeRows } from './setup.js';   // Setup's rows on v2's systems (BACKLOG-v2 #9)
import { mountLevelRow } from './raceLevelRow.js';
import { mountNetRow } from './netRow.js';   // Setup › Aids › the crew's net (H + 5 went)
import { mountGennakerRow } from './gennakerRow.js';   // Setup › Aids › gennaker: auto | off (round 2)
import { mountSteadyRow } from './steadyHands.js';   // Setup › Aids › steady hands (owner 2026-11-17)
import { mountTessieRow } from './tessieSettings.js';   // play as Tessie, phase 2a: her two settings
import { mountPerfRow } from './perfHud.js';
import { mountProRow } from './proHud.js';   // Setup › Screen › Pro instruments (the top-left panel, a desktop only)   // Setup › Screen › performance stats (the top-right panel, a desktop only)
import { mountMusicRow } from './musicRow.js';   // Setup › Sound › music: Shuffle or By time of day (v2/audio/shuffle.js)   // Regatta R3: Setup's race level row (tiny; the race's chunk stays out)
import { V2_NEWS } from './news.js';
import { mountTutorials } from './tutorials.js';   // Help › Tutorials: twelve short chapters (owner 2026-11-18: "a true tutorial")
import { mountAbout } from './aboutPage.js';   // Help › About: Contact, Support and About as one page (owner 2026-11-18)
import { parseV2Flags } from '../engine/flags.js';   // ?livechart: the phone card drops its engraving when the live map takes its box
import { buildGate } from '../engine/buildGate.js';   // a phone: the modes wait for every pipeline (owner 2026-11-17: "build the shaders, then present")
import { mountBuildCard } from './buildCard.js';   // and the card says what it is doing meanwhile   // v2's What's new (v1 at /classic/ keeps src/ui/news.js)

// a mode v2 does not play: its pill cell (and the strip's) disabled, v1's own "soon" small (the shell's .lk-pick small style)
export function markSoon(root, picks = pickStates(MODES), doc = globalThis.document) {   // doc: a test's own
  const out = [];
  for (const p of picks) {
    if (p.ready) continue;
    for (const b of root.querySelectorAll(`.lk-pick[data-mode="${p.id}"], .lk-sp[data-mode="${p.id}"], .choice[data-w="start:${p.id}"]`)) {
      b.disabled = true; b.setAttribute('aria-disabled', 'true'); b.classList.add('lk-soon');
      if (!b.querySelector('small.lk-soon-w')) { const s = doc.createElement('small'); s.className = 'lk-soon-w'; s.textContent = SOON; b.appendChild(s); }
      out.push(`${p.id}:${b.className.split(' ')[0]}`);
    }
  }
  return out;
}

// LOG on the card (v1's shell): the card closes first, then the logbook opens (ui/logbook.js, v1's attachLogbook as Sail's
// 'logbook' service); lit once it is up (until then v1's own italic "in Sail"); an open logbook takes Esc first (it closes, the
// card stays down). CHART (owner 2026-11-17) opens the enlarged chart, as the top bar's Chart does. getUi: Sail's UI or null.
export function logLinks(getUi) {
  const log = () => getUi()?.services.get('logbook') ?? null;
  const chart = () => getUi()?.services.get('chart')?.chart?.toggle ?? null;   // mounted once the terrain has streamed
  return {
    go: { logbook: () => log()?.logbook?.open(), chart: () => { const ms = getUi()?.services.get('mapScreen'); if (ms) { ms.showAll(); return; } if (document.documentElement?.classList?.contains?.('lk-livechart-on')) { let k = 0; const wait = () => { const m = getUi()?.services.get('mapScreen'); if (m) m.showAll(); else if (++k < 40) setTimeout(wait, 250); }; wait(); return; }   // the map screen: CHART shows the whole bay at the entrance, the boat in the menu
 let n = 0; const open = () => { const tg = chart(); if (tg) { tg.shown = true; if (tg.pinned) tg.unpin(); else tg.pin(); } else if (++n < 40) setTimeout(open, 250); }; open(); } },   // the chart mounts once the terrain has streamed: wait up to 10 s   // CHART: the top bar's Chart button and the N key (sail.js)
    can: { logbook: () => !!log(), chart: () => true, wind: () => !!getUi(), assists: () => !!getUi() },
    // v1's shell: the logbook, the pinned chart or the raised binoculars take Esc first (captain.js lowers them; the Menu opens only when they are down)
    // U8: and the pinned chart (its own Esc unpins it; the next Esc opens the Menu card)
    escFirst: () => !!(log()?.logbook?.isOpen || getUi()?.chartEsc?.() || getUi()?.services.get('captainTools')?.latched || getUi()?.viewSwitch?.topBar?.isOpen || getUi()?.services.get('cruiseView')?.topBar?.isOpen || document.documentElement.classList.contains('v2-rg-hub') || document.documentElement.classList.contains('v2-rg-ask')),   // the new bar: the open Conditions sheet takes Esc first (v2/ui/topBar.js); Regatta's hub: its Esc goes back to the lake (v2/regatta/hub.js)
  };
}

const SOON_CSS = `
:root:has(#lk-load[data-state=menu]:not([data-off])) .lk-hint,:root:has(.lk-log[data-state=open]) .lk-hint{visibility:hidden}   /* the skipper's line waits while the Menu card or the logbook covers the helm (owner 2026-11-15) */
#lk-load .lk-sp.lk-soon{cursor:not-allowed;opacity:.9}
#lk-load .lk-soon small.lk-soon-w{font-family:var(--lk-font);font-style:italic;font-size:max(.74em,12.5px);margin-left:.35em;letter-spacing:.05em}
#lk-load .lk-card .lk-pick.lk-soon{cursor:not-allowed}
#lk-load .choice.lk-soon{cursor:not-allowed;opacity:.72}
/* the Keys page fits the card at 1280 × 720 and at a short 1280 × 650 window with no scroll (the 15 px type floor of the help pages left it 11 and 85 px over): tighter rows and gaps */
#lk-load[data-help] .keys .kcol{gap:.18em}
#lk-load[data-help] .keys .kr2,#lk-load[data-help] .keys .hr{min-height:1.3em;padding:0;line-height:1.12}
#lk-load[data-help] .keys .kh{margin:0 0 .05em;padding-bottom:.05em}
#lk-load[data-help] .keys .kfoot{margin:.25em 0 0;padding-top:.22em}
#lk-load .set .k small.lk-soon-w{font-family:var(--lk-font);font-style:italic;text-transform:none;letter-spacing:.04em;font-size:max(.9em,12.5px);margin-left:.5em}
#lk-load .set .opt.lk-soon{cursor:not-allowed}
`;

export function installFront({ settings, B, windField = null, clock, views = null, weather = null, music = null, quality = null, modes = null }) {   // music, quality: Setup's sound and quality rows (v2/ui/setup.js); modes: { current, go(id) } (main.js: Sail | Cruise)   // M5e: weather (the Weather menu's state) for Setup's row
  const root = document.getElementById('lk-load');
  if (!root) return null;
  let ui = null;
  setTipsOn(settings.get('tips'));
  if (!document.getElementById('lk-front-v2-css')) { const st = document.createElement('style'); st.id = 'lk-front-v2-css'; st.textContent = SOON_CSS; document.head.appendChild(st); }

  let bp = null;   // the birthplaces' service once main.js mounts it (mountBirthplaces below): the voyage line's place
  const plainWords = createWords();
  const urlPro = FLAGS.pro != null;
  seedProfile(settings);   // no skill question: a new player starts as New (Setup › Aids › your sailing changes it)
  const home = createHome({
    current: modes?.current ?? 'sail',
    voyage: (w, v) => ({ waters: w.place, vessel: boatLine(v).replace(' · ', ' '), place: bp ? bp.name() : '' }),   // "Emerald Bay · Halcyon 28 ft · Off Fannette ›"
    onMode: (id) => { if (!isPlayed(id)) return false; enterLandscape(); return modes?.go?.(id) ?? true; },   // a phone: full screen and the landscape lock on the tap (ui/landscape.js; refused: the CSS turn stands)   // Sail | Cruise: the page switches (it tells the card when it lands: home.setMode)
    ...logLinks(() => ui),
    inside: (t) => !!ui?.services.get('mapScreen')?.insideHost(t),   // a press on the map behind the panel keeps the menu open
    mapKeys: (e) => { const ms = ui?.services.get('mapScreen'); return !!ms?.insideHost(e.target) && !ms.plan?.contains(e.target); },   // the map's own keys (Tab, Enter, arrows, + −) reach it; the panel's conditions plate keeps the card's
    menuEsc: () => !!menuCard?.escTaken?.() || !!ui?.services.get('mapScreen')?.escTaken(),   // Leave race?'s Esc is No (the card stays)   // Esc closes the map's own card first
    deskEnter: () => feature('deskEnter').on,   // src/core/features.js: unless the device is finger-only   // owner 2026-11-17: on a desktop Sail is lit on the first card and Enter (or Space) starts the lit mode; arrows and Tab move it; a phone or tablet: unchanged
    canEnter: () => buildGate.ready,   // a phone: Sail, Cruise and Regatta start once every pipeline is built (a tap before is remembered); a tablet or a desktop: at once
    modeSelects: () => document.documentElement.dataset.mapCard === 'panel',   // the desktop and tablet panel on the live map (owner, 2026-11-18: "bring back the ENTER / RESUME button"): a mode press selects, Set sail starts it, Resume in play; the phone card keeps a tap entering
    remembered: () => settings.get('lastMode'),   // the mode last entered is lit first on the panel (?mode= wins)
    goWord: 'Set sail',
    welcome: false,   // no "How do you sail?" and no "show the welcome again" (owner, 2026-11-21): the profile lives in Setup
    pickToEnter: true,   // no ENTER button on the first card (menuCard.js removes it); a desk lights Sail and Enter starts it (deskEnter below, owner 2026-11-17), touch has no lit mode
    settings,
    sail: () => (ui ? { get pro() { return ui.pro; }, setPro: (on) => { ui.setPro(on); if (!urlPro) settings.set('proMode', !!on); } } : null),
    wind: { get: () => windField?.level ?? null, set: (n) => ui?.setLevel(n) },
    weather: weather ? { get: () => weather.current(), set: (id) => weather.pick(id) } : null,   // M5e: Setup's Weather row on the same state as the top bar's menu
    keysHtml: () => (ui?.words ?? plainWords).expand(keysPageHtml({ pro: !!ui?.pro, phone: touchHand(), table: keyTable({ tessie: feature('playTessie').on }), cruise: ui?.mode === 'cruise',   // a finger: the Controls page alone (src/ui/hand.js; owner 2026-11-15)
      rows: document.documentElement.classList.contains('lk-one-thumb') ? THUMB_ROWS : feature('flatControls').on ? FLAT_ROWS : V2_TOUCH_ROWS })),   // a phone's flat controls: their own rows (keyMap.js FLAT_ROWS); an iPad's cockpit keeps the wheel and winch   // the finger's sheet for the layout on screen (thumb.js)
    scene: () => {
      const s = B?.phys?.state;
      return { mode: modes?.now?.() ?? 'sail', windLevel: windField?.level ?? null, hour: clock?.hour, x: s?.x, z: s?.z, headingDeg: s ? ((s.heading * 180 / Math.PI) % 360 + 360) % 360 : undefined,
        browser: browserName(), viewport: `${innerWidth}×${innerHeight} @${(globalThis.devicePixelRatio || 1).toFixed(2)}` };
    },
    hud: { get: () => ui?.calm?.mode ?? null },
    feedbackFrom: 'about',   // Send feedback sits under About (Contact is part of it on v2: ui/aboutPage.js)
    news: V2_NEWS,   // v2's own What's new (v2/ui/news.js; v1 at /classic/ keeps its list)
    quality: quality ? qualityStatus(quality, settings) : null,   // Setup's "Now: L…" and its Auto card (v1's shell)
    onProfile: (id) => { const want = id !== 'new'; if (ui?.skills?.setISail && !!ui.skills.iSail !== want) ui.skills.setISail(want); },   // v1's shell: the profile's "I sail" to the skill model
    onOpen: () => { menuCard?.refresh?.(); ui?.services.get('hint')?.hush?.(true); setTimeout(() => menuCard?.focusLit(), 120); },   // Leave race shown while a race is on   // in play the keyboard starts on the lit mode (ENTER is hidden there: menuCard.js); the skipper hushes while the card covers the helm (owner 2026-11-15)
    onClose: () => ui?.services.get('hint')?.hush?.(false),
    attract: modes ? attractSettings(FLAGS, globalThis.navigator?.webdriver) : { ...attractSettings(FLAGS, globalThis.navigator?.webdriver), on: false },   // the idle attract (v1's: 45 s untouched on the card, the world plays Cruise; an automated browser and ?attract=0 keep it off)
  });
  removeRows(root);   // Setup keeps only what has no other on-screen path (owner 2026-11-17): wind, weather, Pro, auto-reef and edge instruments leave v2's card (setup.js REMOVED_ROWS); v1's page keeps them
  const soon = markSoon(root);
  const setup = applySetup({ settings, ui: () => ui, quality, B, root });   // every row acts (setup.js SETUP_ROWS)
  let levelRow = mountLevelRow(root);   // Regatta R3: Beginner, Club, Pro (and Pro's laylines) on Setup's fifth tab, Race
  let netRow = null;   // the crew's net's cycle button: mounts at wire(), when the skill model exists
  let gkRow = null;   // Setup › Aids › gennaker (round 2): mounts at wire()
  let steadyRow = mountSteadyRow(root, { settings });   // the let-go heading hold by profile; ui/sail.js applies it each frame
  let tessieRow = feature('playTessie').on ? mountTessieRow(root) : null;   // play as Tessie, phase 2a: Invert up/down, Camera follows her (only where she is playable)
  const perfRow = feature('perfHud').on ? mountPerfRow(root) : null;   // Setup › Screen › performance stats (a desktop only: ui/perfHud.js)
  const proRow = feature('proHud').on ? mountProRow(root) : null;   // Setup › Screen › Pro instruments (a desktop only: ui/proHud.js)
  let musicRow = mountMusicRow(root, { music });   // the music listens to the store itself (v2/audio/music.js): sound, music, effects; the pick row tells it
  installDesktopNote({ storage: globalThis.localStorage });   // phones and tablets: "Best on a desktop browser", once on the card

  // the settings v2 can apply now
  const tutorials = mountTutorials(root);   // v1 keeps its Tutorials list; v2's page is the chaptered sheet
  mountAbout(root, { versionLine: V2_NEWS.versionLine });
  // owner 2026-11-19: About has no classic link and no loading report link (the no-WebGPU page, v2/start.js, still links /classic/; ?loadreport=1 and the long press still open the report)
  const menuCard = mountMenuCard(root, home, { race: modes?.race ? { now: () => modes.race(), leave: () => modes.leaveRace() } : null });   // Leave race (owner 2026-11-20): the row in play during a race
  const phoneCard = feature('phoneCard').on ? mountPhoneCard(root, { liveChart: parseV2Flags(globalThis.location?.search ?? '').livechart !== false }) : null;   // liveChart: the map takes its box (sail.js liveChartOn)
  // a phone: the build's stage, percentage and a rotating fact on the first card; the modes dimmed until it is done, then a
  // remembered tap enters (engine/buildGate.js; a gate already open, or off, mounts nothing)
  const buildCard = buildGate.enabled && !buildGate.ready ? mountBuildCard(root, buildGate, { onReady: () => home.released() }) : null;   // the in-play Menu card: a mode tap enters it and closes the card; Esc, ×, outside, the lit mode go back
  settings.on((k) => {
    if (k === 'tips') setTipsOn(settings.get('tips'));
    else if (k === 'proMode' && ui && !!settings.get('proMode') !== !!ui.pro) ui.setPro(!!settings.get('proMode'));   // CAP-3, U7: on too (the first sail's chip, the welcome's "I race")
  });
  // CAP-2, U6: the player's own Pro switch (the dock's pro, the PRO recess, the TRIM button: ui/sail.js lk-pro) is saved, unless
  // the URL's ?pro holds it (v1's shell)
  addEventListener('lk-pro', (e) => { if (!urlPro) settings.set('proMode', !!e.detail?.pro); });

  return {
    home, soon, setup, phoneCard, tutorials,
    // the birthplaces' service is up (main.js): the card's pins and the voyage line's place
    mountBirthplaces(service) {
      const name = () => { const r = service.list().find((x) => x.id === (service.current ?? service.chosen)); return r?.name ?? ''; };
      bp = { name };
      this.birthplaceCard = mountBirthplaceCard(root, { service, home, touch: () => !!phoneCard });
      home.paint();
      return this.birthplaceCard;
    },
    birthplaceCard: null, menuCard, buildCard, perfRow, proRow, get musicRow() { return musicRow; }, get steadyRow() { return steadyRow; },
    get ui() { return ui; },
    // Sail's UI is up: the card is its 'menu'; Pro from the setting
    wire(u) {
      ui = u;
      ui.services.provide('menu', home);
      if (!urlPro && settings.get('proMode') && !ui.pro) ui.setPro(true);
      setup?.wire();   // the rows on Sail's systems (the pilot, crew trim, auto-reef, shallow water, hints, words, voice, display)
      levelRow ??= mountLevelRow(root); levelRow?.paint();
      musicRow ??= mountMusicRow(root, { music }); musicRow?.paint();
      steadyRow ??= mountSteadyRow(root, { settings }); steadyRow?.paint();
      if (feature('playTessie').on) { tessieRow ??= mountTessieRow(root); tessieRow?.paint(); }
      netRow ??= mountNetRow(root, { skills: ui.skills }); netRow?.paint();
      gkRow ??= mountGennakerRow(root, { settings }); gkRow?.paint();
      home.paint();
    },
  };
}
