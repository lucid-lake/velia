// Setup's rows on v2 (BACKLOG-v2 #9): v1's home card Setup page (src/ui/homePages.js, home.js) as it is, and what v1's shell does
// with each row (src/shell.js applyAudio, applyControls, applyQuality, the theme, the tips), here on v2's systems. Every row on the
// page acts; a v1 row v2 has no system for is taken off the page (REMOVED_ROWS), never shown disabled.
//   SETUP_ROWS                              the per-row status table (v2/notes/ui.md's, the tests')
//   REMOVED_ROWS                            v1's rows v2 takes off the page: another on-screen path (owner, 2026-11-17), or none needed (owner, 2026-11-19)
//   removeRows(root)                        takes them off the card (front.js, once), with Aids' duplicate welcome button; the low-window fit CSS
//   v2Settings(settings)                    the store as v2 reads it: a retired key reads as its default (RETIRED_KEYS)
//   const s = applySetup({ settings, ui: () => ui, quality, B, flags, root });   with the card (front.js); s.wire() once Sail's UI is up
//   s.dispose()
//   qualityLevel('balanced') → 1            Setup's quality → the ladder's level (engine/quality.js pinnedLevel), null for auto
import { FLAGS } from '../../src/sim/core/flags.js';
import { pinnedLevel } from '../engine/quality.js';

// key: the settings key (src/ui/settings.js); tab: Setup's tab; data: the row's buttons (homePages.js data-t / data-r prefix);
// acts: true when v2 applies it
export const SETUP_ROWS = Object.freeze([
  { key: 'crewTrim', tab: 'sail', data: 'r:crewTrim:', acts: true, how: 'the crew trims the main: ctl.sheet null (v2/sim/boat.js assists.crewTrim)' },
  { key: 'shoalAssist', tab: 'sail', data: 'r:shoal:', acts: true, how: 'v1\'s shallow-water assist (src/sail/grounding.js setAssist)' },
  { key: 'steadyHands', tab: 'aids', data: 'sh:', acts: true, how: 'v2\'s own switch in the assists row, where v1\'s pilot toggle stood (ui/steadyHands.js, data-sh): steady hands, the let-go heading hold (assists.pilot) by profile: on for New, off by default for I sail, off for I race and Pro; its own stored key, applied each frame by ui/sail.js' },
  { key: 'gennaker', tab: 'aids', data: 'gk:', acts: true, how: 'v2\'s own row under assists (ui/gennakerRow.js, data-gk): auto | off, the crew flies the gennaker (v2/sim/gennakerCrew.js; sail.js sets B.gennakerCrew each frame)' },
  { key: 'crewNet', tab: 'aids', data: 'net:', acts: true, how: 'v2\'s own button in the assists row (ui/netRow.js, data-net): the crew\'s net, auto · 12 s · 25 s · off (skills.cycleNet); H + 5 went with the lean key set' },
  { key: 'pilot', tab: 'aids', data: 't:pilot', acts: true, how: 'v2 takes the toggle off its card (REMOVED_OPTS): steady hands, its switch in the same row, is the same hold by profile; the stored key stays v1\'s' },
  { key: 'hints', tab: 'aids', data: 't:hints', acts: true, how: 'the skipper\'s line shown or hidden (v1\'s setHints)' },
  { key: 'profile', tab: 'aids', data: 'r:profile:', acts: true, how: 'v1\'s applyProfile, and the skill model\'s "I sail" (skills.setISail)' },
  { key: 'words', tab: 'aids', data: 'r:words:', acts: true, how: 'the sailor\'s words (words.mode)' },
  { key: 'keyHints', tab: 'aids', data: 'r:keyHints:', acts: true, how: 'the key legend reads it each frame (src/ui/keyLegend.js)' },
  { key: 'tips', tab: 'aids', data: 'r:tips:', acts: true, how: 'button tips (src/ui/tips.js setTipsOn, front.js)' },
  { key: 'sound', tab: 'sound', data: 't:sound', acts: true, how: 'the page\'s master (beds, music, voice, thunder, VHF, fireworks) and the birds\' context (music.js setMuted)' },
  { key: 'music', tab: 'sound', data: 't:music', acts: true, how: 'the music bus: the pieces, the groove, Cruise\'s playlist, the fireworks\' music (music.js setBus)' },
  { key: 'effects', tab: 'sound', data: 't:effects', acts: true, how: 'the boat and the controls\' sounds (the beds\' effects switch, bedsLive.js)' },
  { key: 'musicPick', tab: 'sound', data: 'mp:', acts: true, how: 'v2\'s own row (ui/musicRow.js, buttons data-mp): Shuffle (the deck, default) or By time of day (v1\'s beds); its own stored key (audio/shuffle.js savePick), music.setPick' },
  { key: 'boatRadio', tab: 'sound', data: 't:boatRadio', acts: true, how: 'the Sousa marches on the fireworks evening (src/fireworks/music.js radioOn); the row shows with ?fireworks=1, as v1' },
  { key: 'skipperVoice', tab: 'sound', data: 'r:voice:', acts: true, how: 'the old skipper\'s spoken lines (src/ui/skipperVoice.js setEnabled)' },
  { key: 'display', tab: 'screen', data: 'r:display:', acts: true, how: 'the instruments\' palette: auto, day, night (src/ui/theme.js set)' },
  { key: 'hud', tab: 'screen', data: 'r:hud:', acts: true, how: 'the Calm HUD preset (src/ui/calmHud.js reads it)' },
  { key: 'largeText', tab: 'screen', data: 't:largeText', acts: true, how: 'the type at 1.25x (src/ui/theme.js setLargeText)' },
  { key: 'lang', tab: 'screen', data: 'r:lang:', acts: true, how: 'English; Chinese is disabled "(soon)", as v1' },
  { key: 'quality', tab: 'screen', data: 'r:quality:', acts: true, how: 'the quality ladder: auto (it measures), high L0, balanced L1, low (Battery) L2 (main.js quality.pin)' },
]);

// Setup holds only what has no other on-screen path (owner, 2026-11-17: "remove redundant settings from Setup if they can be done
// from the cockpit and the top bar"). These v1 rows leave v2's card; v1's page (/classic/) keeps them. set: the
// row's data-set; key: the stored key it wrote (null: never stored); other: the one place the function lives on v2.
export const REMOVED_ROWS = Object.freeze([
  { set: 'wind', key: null, other: "the top bar's Conditions sheet, Wind (keys 1 to 4)" },
  { set: 'weather', key: null, other: "the top bar's Conditions sheet, Weather" },
  { set: 'sailing', key: 'proMode', other: "the cockpit's PRO switch (desktop), the Pro row of the phone's drawer; proMode stays that switch's memory" },
  { set: 'autoReef', key: 'autoReef', other: "the reef selector A 0 1 2: the cockpit's REEF, the phone's Pro drawer (ui/autoReef.js)" },
  { set: 'edgeInstruments', key: 'edgeInstruments', other: 'the cockpit\'s PRO switch: the nav column follows Pro' },
  // owner 2026-11-19: no setting where the best behaviour can be fixed ("set the best experience for the customer and not let them set it")
  { set: 'steady', key: 'steadyHorizon', other: 'none: the Helm view steadies itself with the sea, always on (sim/steadyCamera.js); Reduce Motion holds the calm values' },
  // owner 2026-11-19: both were disabled "(soon)" rows for v1 features v2 does not have; v1 (/classic/) keeps them
  { set: 'kayakCam', key: 'kayakCam', other: 'none: v2 has no kayak camera notice (v1 only, at /classic/)' },
  { set: 'windlines', key: 'windLines', other: 'none: v2 has no wind lines (v1 only, at /classic/)' },
]);
// v1's single buttons v2 takes off a row it keeps: Aids' pilot toggle (owner, 2026-11-17: steady hands, a switch in its place, is the let-go
// hold now, by profile; the assists row keeps hints)
export const REMOVED_OPTS = Object.freeze([
  { id: 'pilot', sel: '.pg[data-page=settings] .opt[data-t="pilot"]', other: 'Setup › Aids › steady hands (ui/steadyHands.js)' },
]);
// The stored keys v2 no longer reads: whatever the store holds (an old Setup choice), v2 reads today's default. The store is shared
// with v1 on the same origin, so the value is left in place for v1, never cleared. edgeInstruments 'off' hid the nav column with Pro
// on (the owner's screenshot, 2026-11-17); 'always' showed it with Pro off. autoReef has its own store (ui/autoReef.js).
export const RETIRED_KEYS = Object.freeze({ edgeInstruments: 'auto' });
export function v2Settings(settings) {
  if (!settings) return settings;
  return { ...settings, get: (k) => (k in RETIRED_KEYS ? RETIRED_KEYS[k] : settings.get(k)), all: () => ({ ...settings.all?.(), ...RETIRED_KEYS }) };
}
// Aids' "show the welcome again" button: v2 asks no skill question (owner, 2026-11-21: "your sailing" is set here only), so it goes
const WELCOME_AGAIN = '.pg[data-page=settings] [data-act=welcome-again]';
export function removeRows(root, doc = globalThis.document) {
  const out = [];
  for (const r of REMOVED_ROWS) for (const n of root?.querySelectorAll?.(`.set[data-set="${r.set}"]`) ?? []) { n.remove(); out.push(r.set); }
  for (const n of root?.querySelectorAll?.(WELCOME_AGAIN) ?? []) { n.remove(); out.push('welcome-again'); }
  for (const o of REMOVED_OPTS) for (const n of root?.querySelectorAll?.(o.sel) ?? []) { n.remove(); out.push(o.id); }
  fitCss(doc);
  return out;
}

// Setup fits a low window with no scroll (owner, 2026-11-09: menu cards do not scroll; 2026-11-17: at 1280 x 720 and 844 x 390). A
// low layout (data-screen~=low: a sideways phone, a short desktop window) has about 254 px of page body at 844 x 390 and a row is a
// 44 px finger target, so each row is one line there: its label beside its choices (the narrow rule of homePages.js, here for low),
// and the quality cards one line of three, the "Now:" status under the label. v1's page keeps its own CSS.
export const SETUP_FIT_CSS = `
:where(:root[data-screen~=low]) #lk-load[data-help] .pg[data-page=settings] .set{grid-template-columns:5.4em minmax(0,1fr);align-items:center;column-gap:.5em;row-gap:0;padding:.1em 0}
:where(:root[data-screen~=low]) #lk-load[data-help] .pg[data-page=settings] .set .v{flex-wrap:wrap}
:where(:root[data-screen~=low]) #lk-load[data-help] .pg[data-page=settings] .set .k{letter-spacing:.06em}
:where(:root[data-screen~=low]) #lk-load[data-help] .pg[data-page=settings] .set .opt{padding-left:10px;padding-right:10px}
:where(:root[data-screen~=low]) #lk-load .pg[data-page=settings] #tp-set-sail:not([hidden]){display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:1.4em;align-content:start}
:where(:root[data-screen~=low]) #lk-load .pg[data-page=settings] .qset .qcs{grid-column:2;grid-row:1 / span 2}
:where(:root[data-screen~=low]) #lk-load .pg[data-page=settings] .qset .qnow{grid-column:1;grid-row:2;margin:0;font-size:.72em}
:where(:root[data-screen~=low]) #lk-load .pg[data-page=settings] .qc{flex-direction:row;min-height:44px;padding:.2em .4em;gap:.35em}
:where(:root[data-screen~=low]) #lk-load .pg[data-page=settings] .qc .ic{width:1.2em;height:1.2em}
`;
function fitCss(doc) {
  if (!doc?.getElementById || doc.getElementById('lk-setup-fit-css')) return;
  const st = doc.createElement('style'); st.id = 'lk-setup-fit-css'; st.textContent = SETUP_FIT_CSS; doc.head.appendChild(st);
}

// Setup's quality → the ladder's level: high L0, balanced L1, low L2 (engine/quality.js pinnedLevel, v1's words); auto → null
export const qualityLevel = (q) => (q === 'auto' ? null : pinnedLevel(q));
const selector = (data) => { const [kind, v] = [data.slice(0, 1), data.slice(2)]; return kind === 't' ? `.opt[data-t="${v}"]` : `[data-r^="${v}"]`; };

// ui: () => Sail's UI (sail.js) or null; quality: { pin(k), state() } (main.js); B: the boat sim. Sound, music and effects are the
// music's and the beds' own listeners (v2/audio/music.js, bedsLive.js); tips and Pro are front.js's.
export function applySetup({ settings, ui: getUi = () => null, quality = null, B = null, flags = FLAGS, root = globalThis.document?.getElementById?.('lk-load'), doc = globalThis.document } = {}) {
  if (!settings) return null;
  let ui = getUi();
  // the URL's own flags win at the start of a page (v1's shell urlSays)
  const urlSays = { crewTrim: flags.hand != null, words: flags.words != null, shoal: flags.shoal != null };
  const applied = {};
  const set = (k, fn) => { try { applied[k] = fn(settings.get(k)); } catch (e) { applied[k] = `error: ${e?.message ?? e}`; } };
  const H = doc?.documentElement;
  const apply = {
    crewTrim: (v) => { if (B?.assists) B.assists.crewTrim = !!v; B?.handBack?.(); return B?.assists?.crewTrim; },   // the switch hands every taken sheet back to the crew (owner, 2026-11-21)
    shoalAssist: (v) => ui?.grounding?.setAssist(!!v) ?? null,
    hints: (v) => { if (ui?.hint?.el) ui.hint.el.style.display = v ? '' : 'none'; return !!v; },
    words: (v) => { if (ui?.words) ui.words.mode = v; return ui?.words?.mode ?? null; },
    skipperVoice: (v) => ui?.voice?.setEnabled?.(v !== false) ?? null,
    display: (v) => { ui?.theme?.set?.(v); return v; },
    largeText: (v) => { if (ui?.theme?.setLargeText) ui.theme.setLargeText(!!v); else if (H) { if (v) H.dataset.lkText = 'large'; else delete H.dataset.lkText; } return !!v; },
    quality: (v) => quality?.pin?.(qualityLevel(v)) ?? null,
    profile: (v) => { if (ui?.skills?.setISail && settings.get('welcomed')) { const want = v !== 'new'; if (!!ui.skills.iSail !== want) ui.skills.setISail(want); } return v; },
  };
  // each row as the shell applies it at a mode's start (the URL's rows keep theirs); the quality is already the start's (main.js)
  function wire() {
    ui = getUi();
    for (const k of ['hints', 'skipperVoice', 'display', 'largeText']) set(k, apply[k]);
    if (!urlSays.crewTrim) set('crewTrim', apply.crewTrim);
    if (!urlSays.shoal) set('shoalAssist', apply.shoalAssist);
    if (!urlSays.words) set('words', apply.words);
    return applied;
  }
  set('largeText', apply.largeText);   // the card's own type too, before Sail's UI
  const off = settings.on((k) => { ui = getUi() ?? ui; if (apply[k]) set(k, apply[k]); });
  return { applied, rows: SETUP_ROWS, wire, dispose: () => off?.() };
}

// the home card's quality status ("Now: …") and its Auto card's reset (home.js createHome quality: { active, reset })
// the ladder's rungs in plain words for Setup's "Now:" line (owner 2026-11-15: no engine jargon such as "L0 full (cloud key full
// on reload)"); a rung's parts that wait for a reload are one plain clause
export const QUALITY_WORDS = ['High', 'Balanced', 'Light', 'Lightest'];
const rungWord = (s) => QUALITY_WORDS[s.id ?? +String(s.name ?? '').match(/^L(\d)/)?.[1]] ?? 'Auto';
export function qualityStatus(quality, settings) {
  return {
    active: () => { const s = quality?.state?.(); if (!s) return ''; return `${settings?.get('quality') === 'auto' ? 'auto: ' : ''}${rungWord(s)}${s.pending?.length ? ', more after a reload' : ''}`; },
    reset: () => { settings?.set('quality', 'auto'); },
  };
}
