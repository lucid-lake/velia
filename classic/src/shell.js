// The shell: what sits between the core and the modes on a live page. It mounts
// the home card (src/ui/home.js: Esc, ≡), applies the settings (src/ui/settings.js) to whichever mode runs, and switches modes in
// play: the old mode goes, the new one starts on the same core (core.switchMode), hidden behind the
// loading card's horizon line for 1.5–2 s, and ?mode= follows in the URL. Not the core (no mode names there), not a
// mode (it outlives them). src/main.js loads it after the first frame; ?headless pages never do.
//
//   installShell({ services, modes: { sail: () => import(…), cruise: … }, current: 'sail' })   services: the page's registry (src/core/services.js)
import { QUALITY_NOTICE, tierOf } from './quality/tiers.js';
import { createHome } from '../../src/ui/home.js';
import { installDesktopNote } from '../../src/ui/desktopNote.js';
import { attachFirstSail } from './ui/firstSail.js';
import { attachStage } from './ui/firstStage.js';
import { attachNightMoment } from './ui/nightMoment.js';
import { applyProfile } from '../../src/ui/profile.js';
import { createFullscreen } from '../../src/ui/fullscreen.js';
import { MODE_LABELS } from '../../src/modeNames.js';
import { createSettings } from '../../src/ui/settings.js';
import { browserName } from '../../src/ui/feedback.js';
import { keysPageHtml } from '../../src/ui/keysContent.js';
import { isCoarse } from '../../src/ui/touchMap.js';
import { createWords } from '../../src/ui/words.js';
import { ensureTokens } from '../../src/ui/tokens.js';
import { createTheme } from '../../src/ui/theme.js';
import { setTipsOn } from '../../src/ui/tips.js';
import { createDashboard } from './ui/dashboard.js';
import { createCalmHud } from '../../src/ui/calmHud.js';
import { createKeyLegend } from '../../src/ui/keyLegend.js';
import { createNavColumn } from '../../src/ui/navColumn.js';
import { createPassage } from '../../src/ui/passage.js';
import { watchDevice } from '../../src/ui/device.js';
import { markMode } from '../../src/ui/loading.js';
import { playtestOn, createRecorder, createWatcher, downloadSession } from '../../src/ui/playtest.js';
import { attachWatchdog } from './ui/watchdog.js';
import { track, deviceClass } from '../../src/metrics.js';
import { FLAGS } from '../../src/sim/core/flags.js';

export const SWITCH = { inS: 0.6, minS: 0.9, outS: 0.7 };   // the veil: in, the least it holds, out (≈ 1.5–2 s in all)

const CSS = `
.lk-switch{position:fixed;inset:0;z-index:calc(var(--lk-z-card) - 1);pointer-events:none;opacity:0;background:rgb(var(--lk-navy));
  transition:opacity ${SWITCH.outS}s var(--lk-ease-out)}
.lk-switch.on{opacity:1;pointer-events:auto;transition:opacity ${SWITCH.inS}s var(--lk-ease)}
.lk-switch .h{position:absolute;left:0;right:0;top:54%;height:1px;background:rgb(var(--lk-cream) / .11)}
.lk-switch .h i{position:absolute;inset:0;background:rgb(var(--lk-cream) / .74);transform:scaleX(var(--p,0));transform-origin:50% 50%;
  box-shadow:0 0 10px rgb(var(--lk-cream) / .28);transition:transform .8s var(--lk-ease)}
.lk-switch .m{position:absolute;left:50%;top:calc(54% + clamp(22px,4vh,40px));transform:translateX(-50%);white-space:nowrap;
  font:var(--lk-medium) var(--lk-fs-label)/1 var(--lk-ui);letter-spacing:var(--lk-track-wide);color:var(--lk-ink)}
`;

export function installShell({ services, modes, current }) {
  ensureTokens();
  // the registry: the core's api (core, switchMode, stats …), what the modes provide (boat, controls, logbook, chart) and
  // what the shell provides here (settings, menu, calm …), lasting the page
  const core = services.get('core');
  const settings = createSettings();
  const firstVisit = !settings.get('welcomed');   // before the welcome is answered (metrics: first_visit)
  services.provide('settings', settings);   // the one shared copy (the VHF button in the Pro trim panel and Regatta's hails read and write 'vhf')
  // the language chip on the loading card (src/ui/loading.js setLang): show the saved choice, save a new one
  window.__veliaLoading?.setLang?.(settings.get('lang'), { silent: true });
  addEventListener('lakeshore:lang', (e) => settings.set('lang', e.detail?.lang));
  // ask the browser to keep our saves (skills, logbook, settings): without it, storage may be cleared under pressure or,
  // on Safari, after 7 days without a visit. Best effort; the game runs the same if refused.
  try { navigator.storage?.persist?.().catch(() => {}); } catch {}
  // a mode that changed in place before the shell was in (Cruise's hand-over in its first seconds: src/modes/inPlace.js)
  const early = services.get('mode');
  let mode = current, switching = false;
  // the mode in force's options (its coreOptions: hud, card, stage, firstSail, fullscreenKey; src/modes/README.md): the core
  // provides them at boot and on a switch, Cruise's hand-over with setMode
  const modeOptions = () => services.get('modeOptions') ?? {};
  services.provide('mode', mode);
  services.provide('modeSwitchLog', []);

  // ---- the settings, applied to whatever runs now ----
  const audio = core.audio;
  // Full screen: Shift+F (plain F is the jib sheet; in pro-raw Shift+F is the lead, so there the bar's button is the way)
  const fs = createFullscreen(document); services.provide('fullscreen', fs);
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || !e.shiftKey || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target?.matches?.('textarea, input:not([type=checkbox])')) return;
    if (modeOptions().fullscreenKey === false) return;   // Cruise's Shift+F is a pro-trim key that would take the helm: the bar's button there
    const c = services.get('controls'); if (c?.pro && c.ctl?.autoTrim === false) return;
    fs.toggle();
  });
  const applyAudio = () => { audio?.setMuted?.(!settings.get('sound')); audio?.setBus?.('music', settings.get('music')); audio?.setBus?.('effects', settings.get('effects')); };
  // the URL's own flags win at the start of a page (?pilot=0, ?hand=0): a stored setting does not override them
  const urlSays = { pilot: FLAGS.pilot != null, crewTrim: FLAGS.hand != null, words: FLAGS.words != null, shoal: FLAGS.shoal != null, pro: FLAGS.pro != null };
  let pendingISail = null;   // the profile's "I sail" flag for the skill model, applied when the controls exist (src/ui/profile.js)
  // the staged first visit (src/main.js decided it, src/ui/firstVisit.js): no home card, no "How do you sail?". The crew
  // trims ("New to it"); the level choice is in Settings, and R. says so once (src/ui/firstStage.js)
  const staged = !!services.get('firstVisit')?.stage && !!modeOptions().stage;
  if (staged && !settings.get('welcomed')) { applyProfile(settings, 'new'); pendingISail = false; }   // ?first=1 on a returning browser keeps its own profile
  let appliedTo = null;
  const applyControls = (force = false) => {
    const c = services.get('controls'); if (!c || (c === appliedTo && !force)) return;
    if (!urlSays.pilot || appliedTo) c.setPilot?.(settings.get('pilot'));
    if (!urlSays.crewTrim || appliedTo) c.setCrewTrim?.(settings.get('crewTrim'));
    c.setAutoReef?.(settings.get('autoReef'));
    c.setHints?.(settings.get('hints'));
    c.setWindLines?.(settings.get('windLines'));
    c.setVoice?.(settings.get('skipperVoice'));
    if (!urlSays.shoal || appliedTo) c.setShoalAssist?.(settings.get('shoalAssist'));
    c.setSteady?.(settings.get('steadyHorizon'));
    if ((!urlSays.pro || appliedTo) && settings.get('proMode') && c.setPro && !c.pro) c.setPro(true);   // Pro on from the setting; off only by a change (below), so Cruise's hand-over keeps its trim
    if (pendingISail != null && c.skills?.setISail) { if (!!c.skills.iSail !== pendingISail) c.skills.setISail(pendingISail); pendingISail = null; }
    if (!urlSays.words || appliedTo) c.setWords?.(settings.get('words'));
    appliedTo = c;
  };
  const applyQuality = () => {
    services.get('setQuality')?.(settings.get('quality'));   // src/core/index.js: the render scale and the live knobs now; the build knobs at the next start
  };
  const theme = createTheme({ sunElev: () => core.sun?.elevationDeg, setting: settings.get('display'), largeText: settings.get('largeText') });
  services.provide('theme', theme);
  setTipsOn(settings.get('tips'));   // Settings › Screen › button tips (src/ui/tips.js)
  settings.on((k) => {
    if (k === 'proMode' && !settings.get('proMode') && services.get('controls')?.pro) services.get('controls').setPro?.(false);
    if (k === 'profile') pendingISail = settings.get('profile') !== 'new';
    if (k === 'windLines') services.get('controls')?.setWindLines?.(settings.get('windLines'));
    if (k === 'display') theme.set(settings.get('display'));
    else if (k === 'largeText') theme.setLargeText(settings.get('largeText'));
    else if (k === 'tips') setTipsOn(settings.get('tips'));
    else if (k === 'sound' || k === 'music' || k === 'effects') applyAudio();
    else if (k === 'quality') applyQuality();
    else applyControls(true);
  });
  applyAudio(); applyQuality();

  // ---- the menu ----
  const plainWords = createWords();   // no controls running (the title, Cruise): the list says it plain, with the terms beside it
  const keysHtml = () => (services.get('controls')?.words ?? plainWords).expand(keysPageHtml({ pro: !!services.get('controls')?.pro, touch: services.get('modality') ? !!services.get('modality').touch : isCoarse() }));   // the Keys page: keysContent.js, the same words as the H list; on the title card no controls run yet, so a coarse device is a finger
  const scene = () => {
    const s = services.get('player')?.phys?.state, st = services.get('stats')?.();
    return {
      mode, windLevel: services.get('controls')?.level ?? core.wind?.level ?? null, hour: core.sun?.hour,
      x: s?.x, z: s?.z, headingDeg: s ? ((s.heading * 180 / Math.PI) % 360 + 360) % 360 : undefined,
      browser: browserName(), gpuMs: st?.gpuMsMedian ?? st?.gpuMs ?? undefined, viewport: `${innerWidth}×${innerHeight} @${(globalThis.devicePixelRatio || 1).toFixed(2)}`,
    };
  };
  // play-test session log (?playtest=1): local only, no network, exported by the player
  const rec = playtestOn() ? createRecorder({ storage: globalThis.localStorage }) : null;
  const islandAt = () => { const I = services.get('terrain')?.lake?.island; return I ? { x: I.x, z: I.z, r: Math.max(I.a, I.b) + 80 } : null; };   // the world's lake (its terrain, the 'terrain' service)
  const watch = rec ? createWatcher(rec, { island: islandAt }) : null;
  if (rec) { rec.log('start', { browser: browserName(), viewport: `${innerWidth}×${innerHeight}` }); services.provide('playtest', rec); }
  const reloadWith = (k, v) => { const p = new URLSearchParams(location.search); p.set(k, v); location.search = p.toString(); };
  const menu = createHome({
    current: mode,
    onMode: (id) => switchTo(id),
    go: {
      logbook: () => services.get('logbook')?.logbook?.open(),
      chart: () => { const t = services.get('chart')?.chart?.toggle; if (t) { t.shown = true; t.pin(); } },
    },
    can: { logbook: () => !!services.get('logbook'), chart: () => !!services.get('chart'), wind: () => !!services.get('controls'), assists: () => !!services.get('controls') },
    settings,
    sail: () => services.get('controls'),   // the Sail controls, for the Settings rows that act on the live boat (sailing: basic | pro)
    wind: { get: () => services.get('controls')?.level ?? core.wind?.level ?? null, set: (n) => services.get('controls')?.setLevel?.(n) },
    weather: { get: () => core.sky?.current?.() ?? null, set: (w) => core.sky?.pick?.(w) },   // clear | fair | the afternoon storm, now (the top bar's Weather state, src/weather/weatherMenu.js; not saved)
    keysHtml, scene,
    // the other modes' code, fetched when the menu opens (on the picker's open, never at start), so a
    // switch spends its veil on starting the mode, not on the network
    // another lake or boat is another world: it reloads the page with the choice in the URL (one of each today, so this waits)
    onProfile: (id) => { pendingISail = id !== 'new'; applyControls(true); },
    onWaters: (id) => reloadWith('waters', id), onVessel: (id) => reloadWith('vessel', id),
    quality: {
      // what auto is running now (Settings shows it) and the 'reset auto' action
      active: () => { const Q = services.get('quality'); if (!Q) return ''; const pct = Q.px ? `, render ${Q.px[0]} \u00d7 ${Q.px[1]} px (${+Q.ratio.toFixed(2)}\u00d7)` : ''; return `${Q.setting === 'auto' ? 'auto: ' : ''}${tierOf(Q.name).label}${pct}`; },
      reset: () => { settings.set('quality', 'auto'); services.get('resetAuto')?.(); },
    },
    exportSession: rec ? () => downloadSession(rec) : null,
    hud: { get: () => services.get('calm')?.mode ?? null },   // Settings → Screen → HUD shows the one in force
    staged,
    escFirst: () => !!(services.get('logbook')?.logbook?.isOpen || services.get('chart')?.chart?.toggle?.pinned || services.get('captainTools')?.latched),
    onOpen: () => { for (const [id, load] of Object.entries(modes)) if (id !== mode && !load.dev) load().catch(() => {}); },   // a dev mode (src/main.js) is not fetched ahead
  });
  services.provide('menu', menu);
  services.provide('desktopNote', installDesktopNote({ storage: globalThis.localStorage }));   // phones and tablets: "Best on a desktop browser", once on the card, always in About
  // the P key, the dock and the Settings row move Pro mode: the setting follows (unless the URL's ?pro= decides this page)
  addEventListener('lk-pro', (e) => { if (!urlSays.pro) settings.set('proMode', !!e.detail?.pro); });
  // the staged first five minutes (src/ui/firstStage.js): this session only
  const stage = staged ? attachStage({ services, settings, calm: { wake: (w) => services.get('calm')?.wake?.(w) }, getOptions: modeOptions, menu, track }) : null;
  services.provide('firstStage', stage);
  // the night moment (ui/nightMoment.js): the first clear dark night of a session, the camera looks up to the Milky Way once
  const nightMoment = services.provide('nightMoment', attachNightMoment({ services, menu, enabled: FLAGS.nightmoment }));
  const firstSail = attachFirstSail({ settings, services, core, getOptions: modeOptions, menu, stage });
  services.provide('firstSail', firstSail);
  // a step-down by the governor: one line in the top capsule (the view switch in Day Sail, the camera switch in Cruise)
  if (services.get('quality')) services.get('quality').onStepDown = () => { (services.get('viewSwitch') ?? services.get('cruiseView'))?.say?.(QUALITY_NOTICE); menu.paint?.(); };

  // ---- the mode switch, through the horizon line ----
  const veil = document.createElement('div'); veil.className = 'lk-switch'; veil.setAttribute('aria-hidden', 'true');
  veil.innerHTML = '<div class="h"><i></i></div><div class="m"></div>';
  if (!document.getElementById('lk-shell-css')) { const st = document.createElement('style'); st.id = 'lk-shell-css'; st.textContent = CSS; document.head.appendChild(st); }
  document.body.appendChild(veil);
  const fill = veil.querySelector('.h i'), label = veil.querySelector('.m');
  const NAMES = MODE_LABELS;
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

  // An in-place switch, no veil: the mode that is running changes what it is (Cruise's hand-over to Sail and back,
  // src/modes/chill/index.js), with the options now in force. The mode label, the card's plan row, the URL and the settings follow.
  function setMode(id, options = null) {
    if (id === mode) return;
    if (options) services.provide('modeOptions', options);
    mode = id; services.provide('mode', id); menu.setMode(id); markMode(modeOptions().card);
    const p = new URLSearchParams(location.search); p.set('mode', id);
    history.replaceState(history.state, '', `${location.pathname}?${p}${location.hash}`);
    appliedTo = null; applyControls(); applyAudio();
  }
  services.provide('setMode', setMode);

  // The last pick wins (a Cruise then a Sail pick within one switch): a request that lands mid-switch is kept, the newest one
  // only, and runs when the switch ends; asking for the mode being switched to drops it.
  let target = null, queued = null;
  async function switchTo(id) {
    if (!modes[id]) return false;
    if (switching) { queued = id === target ? null : id; return false; }
    target = id;
    let ok = await switchOnce(id);
    while (queued && queued !== mode) { const q = queued; queued = null; target = q; ok = await switchOnce(q); }
    queued = null; target = null;
    return ok;
  }
  async function switchOnce(id) {
    if (switching || !modes[id]) return false;
    // a mode that can change in place says so (the 'quickSwitch' service's [id]): no horizon line, the boat and the camera stay.
    // Asked before the same-mode check: Cruise with the helm taken is still mode 'cruise', and its quick switch is the hand back
    const quick = services.get('quickSwitch')?.[id];
    if (!quick && id === mode) return false;
    if (quick) {
      switching = true; menu.close();
      let ok = false;
      try { ok = await quick(); } catch (e) { console.error(e); }
      services.get('modeSwitchLog').push({ from: mode, to: id, ms: 0, horizon: false, error: ok ? null : 'quick switch failed' });
      switching = false;
      return ok;
    }
    switching = true;
    const t0 = performance.now(), from = mode;
    menu.close();
    const next = modes[id]();   // fetch while the veil comes in
    label.textContent = NAMES[id] ?? id;
    fill.style.setProperty('--p', '0.12');
    veil.classList.add('on');
    await wait(SWITCH.inS);
    fill.style.setProperty('--p', '0.6');
    // the boat stays where it is: the new mode starts from its pose (or the start, from Fly)
    const p = new URLSearchParams(location.search); p.set('mode', id);
    const s = services.get('player')?.phys?.state;
    const pass = new URLSearchParams(p);
    if (s) { pass.set('start', `${s.x.toFixed(1)},${s.z.toFixed(1)}`); pass.set('heading', ((s.heading * 180 / Math.PI) % 360 + 360) % 360 + ''); }
    let err = null;
    try { await core.switchMode(next, { params: pass }); } catch (e) { err = e; console.error(e); }
    mode = id; services.provide('mode', id); menu.setMode(id); markMode(modeOptions().card);
    history.replaceState(history.state, '', `${location.pathname}?${p}${location.hash}`);
    appliedTo = null; applyControls(); applyAudio();
    fill.style.setProperty('--p', '1');
    const held = (performance.now() - t0) / 1000;
    await wait(Math.max(0.35, SWITCH.inS + SWITCH.minS - held));
    veil.classList.remove('on');
    await wait(SWITCH.outS);
    fill.style.setProperty('--p', '0');
    const ms = Math.round(performance.now() - t0);
    services.get('modeSwitchLog').push({ from, to: id, ms, horizon: true, error: err ? String(err.message ?? err) : null });
    if (!err) track('mode_change', { from, to: id });
    switching = false;
    return !err;
  }
  services.provide('switchMode', switchTo);

  // a pick on the loading card (src/ui/loading.js): switch to it now that the core is up
  const pickNow = (m) => { if (m && m !== mode) switchTo(m); };
  pickNow(window.__veliaLoading?.pick);
  addEventListener('lakeshore:pick', (e) => pickNow(e.detail?.mode));

  // each frame: the controls that arrive later (Cruise's hand-over, a switch) get the settings; the mark hides in the
  // full-screen views (the helm view) where only the hint row survives
  let skillsSeen = null;
  // the Calm HUD (ui/calmHud.js): the bar and the dashboard fade at rest; live pages only, as the whole shell
  const calm = createCalmHud({ services, settings, getOptions: modeOptions }); services.provide('calm', calm); let calmAt = performance.now();
  const keyLegend = createKeyLegend({ services, settings, getMode: () => mode }); services.provide('keyLegend', keyLegend);   // the key legend (ui/keyLegend.js)
  services.provide('passage', createPassage({ services }));   // the mark in force and the leg to it (ui/passage.js): the nav column's passage block,'s route
  const navColumn = createNavColumn({ services, settings, getMode: () => mode }); services.provide('navColumn', navColumn);   // the nav column on the left edge (ui/navColumn.js)
  const tick = () => {
    if (watch) {
      const sk = services.get('skills');
      if (sk && sk !== skillsSeen) { skillsSeen = sk; skillsSeen.onChange?.((ev) => { if (ev.type === 'mastered') watch.skill(ev.id); }); }
      const s = services.get('player')?.phys?.state;
      watch.frame({ t: performance.now() / 1000, mode, ui: menu.state, page: menu.view, hint: services.get('controls')?.hint?.current, twa: s?.trueWind?.angle,
        depth: services.get('seamanship')?.state?.depth, anchored: services.get('seamanship')?.anchoredNow, x: s?.x, z: s?.z,
        logbook: !!services.get('logbook')?.logbook?.isOpen, chart: !!services.get('chart')?.chart?.toggle?.pinned });
    }
    applyControls(); theme.update(1 / 60); stage?.update(); firstSail.update(); nightMoment.update();
    const now = performance.now(); calm.update(Math.min(0.1, (now - calmAt) / 1000)); calmAt = now; keyLegend.update(); navColumn.update();
    const full = services.get('controls')?.view === 'helm';
    if (!menu.isOpen) menu.showMark(!full);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const kind = watchDevice();   // the device tier's classes on <html>: lk-phone(-l/-p), lk-tablet (ui/device.js)
  track('session_start', { mode: current, device: deviceClass(kind), backend: services.get('diag')?.backend, tier: services.get('quality')?.name, first_visit: firstVisit, lang: settings.get('lang'), gpu: services.get('diag')?.gpuClass || undefined });   // anonymous (src/metrics.js)
  services.provide('dashboard', createDashboard());   // the dimming at rest (ui/dashboard.js)
  if (FLAGS.watchdog && services.get('diag')) services.provide('watchdog', attachWatchdog({ services, core, D: services.get('diag') }));   // the play watchdog: a stuck sim is restarted, then reloaded once (ui/watchdog.js)
  if (early !== mode && modes[early]) setMode(early);   // the hand-over before the shell: the label, the URL and the controls follow now
  return { menu, settings, switchTo, get mode() { return mode; } };
}
