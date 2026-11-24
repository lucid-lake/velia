// The pages of the home card: Waters, Vessel, the welcome, and the Help sheet (Solaria stage 2,
//): one sheet with a vertical nav, Tutorials · Keys · Settings · What's new · Credits · Contact · Support ·
// About, plus Send feedback under Contact. Each is a page of the same chart card, in the same hand (parchment, navy ink, Jost for the headings, the
// small-text face --lk-ui where the tokens give one). This file is markup and style only; src/ui/home.js wires them.
import { CREDITS, CREDIT_TOPICS } from './credits.js';
import { CONTACT, FEEDBACK, RATINGS, techLines } from './feedback.js';
import { SUPPORT, CUP_ICON, supportLink } from './support.js';
import { EXPORT_NOTE } from './playtest.js';
import { PROFILE_CHOICES } from './profile.js';
import { NEWS, VERSION_LINE, newsReleases, prettyDate } from './news.js';   // v1's list; v2 passes its own (v2/ui/news.js)

export const ICONS = {   // hairline vectors on a 24 grid (the ≡ mark and the pages' small marks)
  mark: '<path d="M5 8h14M5 12h14M5 16h9"/>',
  back: '<path d="M14 6.5L8.5 12l5.5 5.5"/>',
  close: '<path d="M7 7l10 10M17 7L7 17"/>',
  feedback: '<path d="M12 5c4.7 0 8 2.6 8 5.8s-3.3 5.8-8 5.8c-.9 0-1.8-.1-2.6-.3L5.6 19l.9-3.4C5 14.4 4 12.7 4 10.8 4 7.6 7.3 5 12 5Z"/><path d="M8.8 9.8h6.4M8.8 12.2h4.2"/>',
  contact: '<rect x="3.5" y="6" width="17" height="12" rx="1.2"/><path d="M4 6.6l8 6.2 8-6.2"/>',
  cup: CUP_ICON,
};
export const icon = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function coordsLine(w, dm) { return `${dm(w.lat, 'N', 'S')} ${dm(w.lon, 'E', 'W')}`; }
export function dm(deg, pos, neg) {   // 38.954 -> 38°57′ N
  const a = Math.abs(deg); let d = Math.floor(a), m = Math.round((a - d) * 60);
  if (m === 60) { d += 1; m = 0; }
  return `${d}°${String(m).padStart(2, '0')}′ ${deg >= 0 ? pos : neg}`;
}

// one page: a back link and esc on one line, the title (with the page's tabs on its right), the body. A page is a card
// of one height (owner, 2026-10-30); a long list (What's new, Credits) is one page whose body scrolls under the fixed
// title and nav, with a fade at the bottom edge while more is below (scroll: true; src/ui/helpScroll.js).
// by the hand (src/ui/hand.js, data-hand on <html>; owner 2026-11-15: no desktop words on a phone): both words in the markup,
// PAGES_CSS shows one. byHand('Keys', 'Controls'): a finger reads Controls
export const byHand = (keys, touch) => `<span class="hk-k">${esc(keys)}</span><span class="hk-t">${esc(touch)}</span>`;
const HAND_TITLE = { keys: ['Keys', 'Controls'] };
const page = (id, title, body, { back = 'Float plan', to = 'home', help = false, scroll = false } = {}) =>
  `<section class="pg${help ? ' hs' : ''}${scroll ? ' scr' : ''}" data-page="${id}" hidden><header class="pg-h"><button class="pg-back${to === 'help' ? ' hb' : ''}" type="button" data-go="${to}">${icon('back')}${esc(back)}</button><span class="pg-esc"><span class="kc">esc</span></span></header><h2>${HAND_TITLE[id] ? byHand(...HAND_TITLE[id]) : esc(title)}</h2><div class="pg-b">${body}</div></section>`;

// tabs: a tablist (sits on the title's line) and its panels; home.js switches them (a click, Enter or Space)
export const tabList = (id, list, label) => `<span class="tabs" role="tablist" aria-label="${esc(label)}">${list.map(([k, name], i) =>
  `<button class="tab" type="button" role="tab" id="tab-${id}-${k}" aria-controls="tp-${id}-${k}" aria-selected="${i === 0}" data-tab="${k}">${name}</button>`).join('')}</span>`;
export const tabPanel = (id, k, body, first = false) => `<div class="tp" role="tabpanel" id="tp-${id}-${k}" aria-labelledby="tab-${id}-${k}" data-tp="${k}"${first ? '' : ' hidden'}>${body}</div>`;

// the Help sheet (Solaria stage 2): its sections, in the nav's order. A section's back link is "‹ Help" (a phone shows the nav
// as its own screen first); on a wider screen the nav stands beside the section and carries the way back to the card.
export const HELP = [['tutorials', 'Tutorials'], ['keys', 'Keys'], ['settings', 'Setup'], ['news', 'What’s new'], ['credits', 'Credits'], ['contact', 'Contact'], ['support', 'Support'], ['about', 'About']];
const help = (id, title, body, o = {}) => page(id, title, body, { back: 'Help', to: 'help', help: true, ...o });
const helpNav = () => `<nav class="hnav" aria-label="Help"><header class="pg-h"><button class="pg-back" type="button" data-go="home">${icon('back')}Float plan</button></header><h2 class="hn-t">Help</h2><div class="hn-list">${HELP.map(([k, name]) =>
  `<button class="hn" type="button" data-go="${k}" data-nav="${k}">${HAND_TITLE[k] ? byHand(...HAND_TITLE[k]) : esc(name)}<i class="ch" aria-hidden="true">›</i></button>`).join('')}</div></nav>`;
// what can be learnt in Velia today (Help › Tutorials): each row names a real feature and where it lives; nothing promised
export const TUTORIALS = [
  ['First sail', 'New to it: you steer, the crew trims, and a first goal waits at Fannette Island.', 'Setup, Aids, show the welcome again.'],
  ['Hints', 'One quiet line at a time while you sail, spoken by the skipper.', 'Setup, Under way, hints.'],
  ['Wind lines', 'Lines on the water that show where the wind blows.', 'Setup, Aids, wind lines.'],
  ['Sailor’s words', 'Plain words first, with the sailor’s word beside them.', 'Setup, Aids, words.'],
  ['Every key', 'The whole list over the lake while you sail.', 'Hold H, or Keys in this sheet.'],
];
// a finger's words for a row whose desktop words name a key (owner 2026-11-15): [title, line, where]
export const TUTORIALS_TOUCH = { 'Every key': ['Controls', 'What to tap and drag.', 'Controls in this sheet.'] };
// the quality cards (Settings, Screen): Auto · High · Battery. Battery pins the lightest tier (Low); a Balanced pin
// (?quality=balanced, or one saved before) shows on the Battery card. Auto reads the device: a strong Mac starts at High.
const QICON = {
  auto: '<path d="M4.5 16a7.5 7.5 0 1 1 15 0"/><path d="M12 16l3.6-4.4"/><path d="M7 16h.01M17 16h.01M12 8.5v.01"/>',
  high: '<path d="M3 18l6-9 4 5.5 2.5-3L21 18Z"/><circle cx="17" cy="6.5" r="1.8"/>',
  low: '<rect x="3.5" y="8" width="15" height="8.5" rx="1.6"/><path d="M20.5 11v2.5"/><path d="M6.5 11v2.6"/>',
};
const qCard = (k, label) => `<button class="qc" type="button" role="radio" data-r="quality:${k}" aria-checked="false"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${QICON[k]}</svg><b>${esc(label)}</b></button>`;

function waterTiles(list, chosen, soon) {   // the Waters page's tiles
  return list.map((w) => `<button class="tile" type="button" role="radio" data-waters="${esc(w.id)}" aria-checked="${w.id === chosen}"${w.ready ? '' : ' disabled aria-disabled="true"'}>
    <span class="ph" style="background-image:url(${esc(w.stills.hero960)})" aria-hidden="true"><span class="phl">${esc(w.place)}<br>${esc(coordsLine(w, dm))}</span></span>
    <span class="tx"><b>${esc(w.place)}</b><span>${esc(w.region)}</span><span class="co">${esc(coordsLine(w, dm))}</span><i>${esc(w.wind)}</i></span>
    <span class="stamp">${w.ready ? 'Chosen' : 'Soon'}</span></button>`).join('')
    + `<div class="tile soon" aria-disabled="true"><span class="tx"><b>${esc(soon)}</b></span></div>`;
}

function vesselTiles(list, chosen, soon) {   // the Vessel page: the builder's plate and the profile
  return list.map((v) => {
    const P = v.profile, [w, h] = P.box;
    const svg = `<svg class="prof" viewBox="-4 0 ${w + 8} ${h}" aria-hidden="true"><path class="wl" d="M -4 ${P.water ?? 90} H ${w + 4}"/><path class="kl" d="${P.keel}"/><path class="kl" d="${P.rudder}"/><path class="hl" d="${P.hull}"/><path class="ml" d="${P.mast}"/><path class="sl" d="${P.main}"/><path class="sl" d="${P.jib}"/></svg>`;
    return `<button class="tile vessel" type="button" role="radio" data-vessel="${esc(v.id)}" aria-checked="${v.id === chosen}"${v.ready ? '' : ' disabled aria-disabled="true"'}>
      ${svg}<span class="plate"><b class="nm">${esc(v.name)}</b><span class="kind">${esc(v.type)}</span>
      ${v.plate.map((r) => `<span class="pr"><span>${esc(r[0])}</span><span>${esc(r[1])} <i>${esc(r[2])}</i></span></span>`).join('')}</span>
      <span class="stamp">${v.ready ? 'Chosen' : 'Soon'}</span></button>`;
  }).join('') + `<div class="tile soon" aria-disabled="true"><span class="tx"><b>${esc(soon)}</b></span></div>`;
}

const grp = (k, head, rows) => `<div class="sgrp" data-grp="${k}"><h3 class="ch3">${esc(head)}</h3>${rows.join('')}</div>`;
const setRow = (k, label, opts) => `<div class="set" data-set="${k}"><span class="k">${label}</span><span class="v">${opts}</span></div>`;
const opt = (k, v, label) => `<button class="opt" type="button" role="${k === 'toggle' ? 'switch' : 'radio'}" data-${k === 'toggle' ? 't' : 'r'}="${v}" aria-checked="false">${label}</button>`;

// the first-visit welcome: no header, no Esc chip; a choice per step, the default marked
const welcomePage = (id, title, lead, choices) =>
  `<section class="pg welcome" data-page="${id}" hidden><h2>${esc(title)}</h2><p class="wl">${esc(lead)}</p><div class="choices" role="radiogroup" aria-label="${esc(title)}">${choices.map((c) =>
    `<button class="choice" type="button" role="radio" data-w="${esc(c.key)}" aria-checked="${c.def ? 'true' : 'false'}"><b>${esc(c.title)}</b><span>${esc(c.note)}</span></button>`).join('')}</div><p class="wskip">esc skips: new to it, take the helm</p></section>`;
export const welcomeHtml = () => [
  welcomePage('welcome', 'How do you sail?', 'One tap. You can change it any time in Setup.', PROFILE_CHOICES.map((c) => ({ key: `profile:${c.id}`, title: c.title, note: c.note, def: c.id === 'new' }))),
  welcomePage('welcome2', 'How would you like to start?', 'Cruise is a quiet ride. Sail is yours.', [
    { key: 'start:cruise', title: 'Just enjoy the view', note: 'Cruise: the boat sails herself, with music and light. Take the helm any time.' },
    { key: 'start:sail', title: 'Take the helm', note: 'Sail: you steer, the crew trims. A first goal is waiting.', def: true },
  ]),
].join('');

// Credits: one scrolling page, the opening line, then a heading per topic (credits.js CREDIT_TOPICS) over its lines
const creditRow = (c) => `<div class="credit"><span class="w">${esc(c.what)}</span><span><span class="n">${esc(c.who)}</span><span class="d">${esc(c.note)}</span></span></div>`;
function creditsHtml(list = CREDITS, lake = null) {
  return `<p>Velia, by Lucid Lake Studio.${lake ? ` The lake is real: ${esc(lake.place)}, ${esc(lake.region)}.` : ''}</p>`
    + CREDIT_TOPICS.map(([k, head]) => { const rows = list.filter((c) => c.topic === k); return rows.length ? `<div class="cgrp" data-topic="${k}"><h3 class="ch3">${esc(head)}</h3>${rows.map(creditRow).join('')}</div>` : ''; }).join('');
}
// What's new: one scrolling page, newest first; a date heading per release (news.js newsReleases). The newest is open, the
// older ones folded under their date: a native <details>, so a tap, a click, Enter or Space opens one (no script)
const newsRow = (n) => `<div class="nw"><span class="n">${n.touchText ? byHand(n.text, n.touchText) : esc(n.text)}</span><span class="d">${n.touchSee ? byHand(n.see, n.touchSee) : esc(n.see)}</span></div>`;
function newsHtml(list = NEWS, versionLine = VERSION_LINE) {
  return newsReleases(list).map((r, i) => `<details class="rel" data-rel="${esc(r.date)}"${i ? '' : ' open'}><summary class="rh"><span class="rd">${esc(prettyDate(r.date))}</span><svg class="ic chv" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg></summary><div class="rb">${r.items.map(newsRow).join('')}</div></details>`).join('')
    + `<p class="stamp-b">${esc(versionLine)}</p>`;
}

// news: an app's What's new (src/ui/news.js newsMeta: { list, versionLine }); none: v1's
// features: the Setup rows the features contribute (src/features/index.js featureSettings: 'camera to kayaks', the boat's radio)
export function pagesHtml({ waters, vessels, wChosen, vChosen, wSoon, vSoon, mark = '', playtest = false, features = [], news = null }) {
  const nl = news?.list ?? NEWS, vl = news?.versionLine ?? VERSION_LINE;
  const radios = (tab) => features.filter((s) => s.tab === tab && s.radio).map((s) => setRow(s.key, s.label, s.radio.map(([v, w]) => opt('radio', v, w)).join('')));
  const toggles = (row) => features.filter((s) => s.toggleIn === row).map((s) => opt('toggle', s.key, s.label)).join('');
  const lake = waters.find((w) => w.id === wChosen) ?? waters[0];   // the credits name the chosen waters, not a lake of ours
  return helpNav() + [
    welcomeHtml(),
    // the chooser behind the card's one summary line (V2, owner 2026-11-06): the lake, then the boat, one page (its body scrolls)
    page('waters', 'Lake and boat', `<h3 class="ch3">Lake</h3><div class="tiles" role="radiogroup" aria-label="Waters">${waterTiles(waters, wChosen, wSoon)}</div><h3 class="ch3">Boat</h3><div class="tiles" role="radiogroup" aria-label="Boat">${vesselTiles(vessels, vChosen, vSoon)}</div>`),
    page('vessel', 'Boat', `<div class="tiles" role="radiogroup" aria-label="Boat">${vesselTiles(vessels, vChosen, vSoon)}</div>`),
    '<section class="pg hs" data-page="help" hidden></section>',   // a phone's Help screen: the nav alone (home.js); a wider screen opens Tutorials beside it
    help('tutorials', 'Tutorials', TUTORIALS.map(([w, n, d]) => { const t = TUTORIALS_TOUCH[w], two = (i, x) => (t ? byHand(x, t[i]) : esc(x));
      return `<div class="credit"><span class="w">${two(0, w)}</span><span><span class="n">${two(1, n)}</span><span class="d">${two(2, d)}</span></span></div>`; }).join('')
      + '<p class="tut-go"><button class="pbtn" type="button" data-act="welcome-again">show the welcome again</button></p>'),
    help('keys', 'Keys', '<div class="keys"></div>'),
    // Setup (was Settings; owner, 2026-11-09: the one page that scrolled): the same 20 rows under four short tabs, so each tab fits the card
    // with no scroll (menu cards do not scroll). Sail: the boat and the weather; Aids: the helps; Sound; Screen. Every row keeps its
    // data-set key, its options and its storage; the last tab is kept while the card lives (home.js pickTab leaves the DOM as it was).
    help('settings', 'Setup', tabList('set', [['sail', 'Sail'], ['aids', 'Aids'], ['sound', 'Sound'], ['screen', 'Screen']], 'Setup')
      + tabPanel('set', 'sail', [
      setRow('wind', 'wind', [1, 2, 3, 4].map((n) => opt('radio', `wind:${n}`, String(n))).join('')),
      setRow('weather', 'weather', ['clear', 'fair', 'storm'].map((w) => opt('radio', `weather:${w}`, w)).join('')),   // the top bar's Weather (weatherMenu.js), the same state; a phone has it only here (not saved)
      setRow('sailing', 'sailing', opt('radio', 'pro:basic', 'basic') + opt('radio', 'pro:pro', 'pro')),
      setRow('crewTrim', 'crew trims', opt('radio', 'crewTrim:on', 'on') + opt('radio', 'crewTrim:off', 'off')),
      setRow('autoReef', 'auto-reef', opt('radio', 'autoReef:on', 'on') + opt('radio', 'autoReef:off', 'off')),
      setRow('shoalAssist', 'shallow water', opt('radio', 'shoal:on', 'on') + opt('radio', 'shoal:off', 'off')),
      setRow('steady', 'steady horizon', opt('radio', 'steady:on', 'on') + opt('radio', 'steady:off', 'off')),
      ...radios('sail'),   // the features' rows: 'camera to kayaks' with the kayaks on (§ 11)
    ].join(''), true)
      + tabPanel('set', 'aids', [
      setRow('assists', 'assists', opt('toggle', 'pilot', 'pilot') + opt('toggle', 'hints', 'hints')),
      setRow('profile', 'your sailing', ['new', 'sail', 'race'].map((q) => opt('radio', `profile:${q}`, q === 'new' ? 'new' : q === 'sail' ? 'I sail' : 'I race')).join('') + '<button class="pbtn" type="button" data-act="welcome-again">show the welcome again</button>'),
      setRow('words', 'words', opt('radio', 'words:both', 'plain + sailor’s') + opt('radio', 'words:sailor', 'sailor’s only')),
      setRow('windlines', 'wind lines', ['on', 'auto', 'off'].map((q) => opt('radio', `windLines:${q}`, q)).join('')),
      setRow('keyHints', 'key hints', opt('radio', 'keyHints:on', 'on') + opt('radio', 'keyHints:off', 'off')),   // the key legend on the right edge, desktop Sail (keyLegend.js)
      setRow('edgeInstruments', 'edge instruments', ['auto', 'always', 'off'].map((q) => opt('radio', `edgeInst:${q}`, q)).join('')),   // the nav column on the left edge (navColumn.js): auto shows it only when it has something to say
      setRow('tips', 'button tips', opt('radio', 'tips:on', 'on') + opt('radio', 'tips:off', 'off')),   // the icon buttons' names and keys on a hover or a long-press (tips.js)
    ].join(''))
      + tabPanel('set', 'sound', [
      setRow('sound', 'sound', opt('toggle', 'sound', 'sound') + opt('toggle', 'music', 'music') + opt('toggle', 'effects', 'effects') + toggles('sound')),   // the features' toggles: the boat's radio, on the fireworks evening (src/fireworks/music.js)
      setRow('skipperVoice', 'skipper’s voice', opt('radio', 'voice:on', 'on') + opt('radio', 'voice:off', 'off')),
    ].join(''))
      + tabPanel('set', 'screen', [
      setRow('display', 'display', ['auto', 'day', 'night'].map((q) => opt('radio', `display:${q}`, q)).join('')),
      setRow('hud', 'HUD', ['full', 'calm', 'instruments', 'clear'].map((q) => opt('radio', `hud:${q}`, q)).join('')),
      setRow('text', 'text', opt('toggle', 'largeText', 'larger text')),
      setRow('lang', 'language', opt('radio', 'lang:en', 'English') + '<button class="opt" type="button" role="radio" aria-checked="false" disabled aria-disabled="true" lang="zh">中文 (soon)</button>'),   // also the card's corner (EN ▾); Chinese is P2
      `<div class="set qset" data-set="quality"><span class="k">quality</span><span class="qcs" role="radiogroup" aria-label="Quality">${qCard('auto', 'Auto')}${qCard('high', 'High')}${qCard('low', 'Battery')}</span><span class="qnow" data-qnow role="status"></span></div>`,
    ].join(''))),
    // About: the studio, the plays note, the skipper's coffee line and the version (the old About list's rows are the nav's now)
    help('about', 'About', `<div class="studio">${mark}<span class="by">Velia is made by Zhao Lou at Lucid Lake Studio.</span></div>
      <p class="note"><a href="https://lucidlakelabs.com" target="_blank" rel="noopener">lucidlakelabs.com</a></p>
      <p class="note">Velia counts anonymous plays to improve the game. No cookies, no personal data.</p>${playtest ? `<p class="note">${EXPORT_NOTE}</p><p><button class="pbtn" type="button" data-act="export-session">Export session ↓</button></p>` : ''}
      <p class="kofi">${esc(SUPPORT.aboutLine)}</p><p class="kofib">${supportLink('about', `${icon('cup')}${esc(SUPPORT.aboutLink)}`, 'pbtn kl')}</p><p class="stamp-b">${esc(vl)}</p>`),
    help('credits', 'Credits', creditsHtml(CREDITS, lake), { scroll: true }),
    help('news', 'What’s new', newsHtml(nl, vl), { scroll: true }),
    help('contact', 'Contact us', `<p>Lucid Lake Studio. Questions, press, a bug, a kind word: one address.</p>
      <div class="addr"><span class="mail">${CONTACT}</span><button class="pbtn" type="button" data-act="copy">copy</button><a class="pbtn" href="mailto:${CONTACT}">write</a></div>
      <p><button class="pbtn" type="button" data-go="feedback">${icon('feedback')}Send feedback</button></p>`),
    // Support (Solaria stage 2): the card foot's gold Support Velia and its one line; a plain Ko-fi link, support_click source 'help'
    help('support', 'Support', `<p class="supl">${esc(SUPPORT.cardLine)}</p><p>${supportLink('help', `${icon('cup')}${esc(SUPPORT.label)}`, 'pbtn kl')}</p>`),
    // Send feedback (Solaria stage 1): the note, five quick 1–5 rows, the technical details shown exactly as they will be sent; still a mailto.
    // Three tabs, so the card never scrolls; the send row stays under all three.
    page('feedback', 'Send feedback', tabList('fb', [['note', 'Note'], ['rate', 'Rate'], ['tech', 'Details']], 'Send feedback') + tabPanel('fb', 'note', `<p>What you liked, what broke, what you would change. A person reads every one.</p>
      <label class="f" for="lk-fb-text">your note</label>
      <textarea id="lk-fb-text" maxlength="${FEEDBACK.maxText}" placeholder="The light at dusk…"></textarea>
      <label class="f" for="lk-fb-mail">your email, if you would like a reply</label>
      <input id="lk-fb-mail" type="email" placeholder="optional" autocomplete="email" />`, true)
      + tabPanel('fb', 'rate', `<p class="rlead">1 is low, 5 is high. Skip any.</p>${RATINGS.map(([k, label]) => setRow(`rate-${k}`, esc(label), [1, 2, 3, 4, 5].map((n) => opt('radio', `rate:${k}:${n}`, String(n))).join(''))).join('')}`)
      + tabPanel('fb', 'tech', `<label class="tick"><input type="checkbox" name="scene" checked /><span>include technical details</span></label>
      <pre class="fbtech" data-fbtech aria-live="polite">${esc(techLines({}).join('\n'))}</pre>`)
      + `<div class="send"><a class="pbtn" data-act="send" href="#">${icon('feedback')}send by email</a><span class="how">opens your mail app; nothing is sent until you press send there</span></div>`, { back: 'Contact', to: 'contact', help: true }),
  ].join('');
}

// All of it scoped to the card's pages. --navy and --paper come from the card (src/ui/loading-shell.html).
export const PAGES_CSS = `
#lk-load .hk-t{display:none}
:root[data-hand=touch] #lk-load .hk-k{display:none}
:root[data-hand=touch] #lk-load .hk-t{display:inline}
:root[data-hand=touch] #lk-load .set[data-set=keyHints],:root[data-hand=touch] #lk-load .pg-esc{display:none}   /* the desktop key legend's switch and the esc chip: no keyboard here */
#lk-load .lk-pg{position:absolute;inset:0;z-index:2;background:rgb(var(--lk-brand-navy) / .98);--navy:rgb(var(--lk-cream));--ink2:rgb(var(--lk-cream) / .84);color:var(--navy);overflow:hidden auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgb(var(--lk-cream) / .5) transparent;
  padding:1.65em 1.7em 1.5em;box-sizing:border-box;font-family:var(--lk-ui,var(--lk-font));font-weight:var(--lk-book);letter-spacing:.03em;opacity:0;visibility:hidden;transition:opacity .35s var(--lk-ease),visibility 0s linear .35s;user-select:text}
#lk-load[data-pg] .lk-pg{opacity:1;visibility:visible;transition:opacity .35s var(--lk-ease),visibility 0s}
#lk-load .pg{display:none}
#lk-load .pg.on{display:block}
:where(#lk-load .pg button,#lk-load .pg a){all:unset;box-sizing:border-box;cursor:pointer;color:inherit}
#lk-load .pg button:focus-visible,#lk-load .pg a:focus-visible{box-shadow:inset 0 0 0 .12em var(--navy);outline:none}
#lk-load .pg{position:relative}
#lk-load .pg-h{display:flex;align-items:center;justify-content:space-between;height:1.9em;margin:0}
#lk-load .pg-back{display:inline-flex;align-items:center;gap:.2em;padding:.2em .5em .2em .1em;font-size:max(.78em,12.5px);letter-spacing:.16em;text-transform:uppercase;color:var(--ink2)}
#lk-load .pg-back:hover,#lk-load .pg-back:focus-visible{background:rgb(var(--lk-cream) / .09)}
#lk-load .ic{width:1.4em;height:1.4em;flex:none;fill:none;stroke:currentColor;stroke-width:var(--lk-stroke);stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;overflow:visible}
#lk-load .kc{display:inline-flex;align-items:center;padding:.1em .5em;border:1px solid var(--navy);border-radius:.2em;font-size:max(.76em,13px);letter-spacing:.1em;text-transform:uppercase}
#lk-load .pg h2{all:unset;display:block;font-family:'Velia Sub A',var(--lk-font);font-weight:500;font-size:1.45em;line-height:1.55;letter-spacing:.02em;margin:0 0 .45em;padding-bottom:.25em;border-bottom:1px solid rgb(var(--lk-cream) / .45);color:var(--navy)}
/* tabs: a small segmented strip on the title's line, right (the lit tab is the cream block, as a chosen option) */
#lk-load .pg .tabs{position:absolute;right:0;top:1.9em;height:calc(1.45em * 1.55);display:flex;align-items:center;gap:.15em}
#lk-load .pg .tab{padding:.18em .6em .16em;border-radius:999px;border:1px solid rgb(var(--lk-cream) / .4);font-size:max(.8em,12.5px);letter-spacing:.06em;color:var(--ink2);transition:background-color .2s,color .2s}
#lk-load .pg .tab:hover{background:rgb(var(--lk-cream) / .12)}
#lk-load .pg .tab[aria-selected=true]{background:rgb(var(--lk-cream) / .13);border-color:var(--navy);color:var(--navy)}   /* outline, a faint tint (owner, 2026-11-06: no solid cream fills) */
#lk-load .pg .tab.lit::after{content:'';display:inline-block;width:.42em;height:.42em;margin:0 0 .1em .4em;border-radius:50%;background:var(--lk-lit)}   /* Pro is on: the lit state */
#lk-load .tp[hidden]{display:none}
#lk-load .pg p{margin:0 0 .8em;line-height:1.5;font-size:.98em}
#lk-load .tx i,#lk-load .note,#lk-load .how,#lk-load .tile.soon,#lk-load .keys .credit{font-family:var(--lk-font)}   /* italic chart notes: Jost (Atkinson has no italic cut) */
/* tiles: the Waters chart tiles and the Vessel plates */
#lk-load .tiles{display:flex;flex-direction:column;gap:.8em}
#lk-load .tile{position:relative;display:grid;grid-template-columns:minmax(0,.46fr) minmax(0,.54fr);gap:.9em;align-items:center;padding:.6em;border:1px solid rgb(var(--lk-cream) / .6);border-radius:.25em;background:rgb(var(--lk-cream) / .07);text-align:left}
#lk-load .tile:hover{background:rgb(var(--lk-cream) / .14)}
#lk-load .tile[aria-checked=true]{box-shadow:inset 0 0 0 .13em var(--navy);background:rgb(var(--lk-cream) / .12)}
#lk-load .tile.soon{display:block;border-style:dashed;background:none;padding:.9em .8em;font-style:italic;cursor:default}
#lk-load .ph{display:block;position:relative;aspect-ratio:16/10;border-radius:.15em;background:#5a6a7a center/cover;overflow:hidden;box-shadow:0 0 0 1px rgb(var(--lk-cream) / .6)}
#lk-load .phl{position:absolute;left:0;right:0;bottom:0;padding:1.6em .5em .4em;text-align:right;font-size:.62em;letter-spacing:.2em;line-height:1.5;text-transform:uppercase;color:rgb(var(--lk-cream));background:linear-gradient(0deg,rgb(8 12 20 / .72),transparent)}
#lk-load .opt{border-radius:999px;padding:.3em .95em .26em;transition:background-color .2s,border-color .2s}
#lk-load .opt:hover{border-color:rgb(var(--lk-cream) / .95);background:rgb(var(--lk-cream) / .16)}
#lk-load .tile:hover,#lk-load .tile:focus-visible{border-color:rgb(var(--lk-cream) / .95)}
#lk-load .pg button:focus-visible,#lk-load .pg a:focus-visible{box-shadow:none;outline:2px solid var(--navy);outline-offset:2px}
:where(:root[data-f-finger-targets=on]) #lk-load .opt,:where(:root[data-f-finger-targets=on]) #lk-load .pbtn,:where(:root[data-f-finger-targets=on]) #lk-load .pg-back,:where(:root[data-f-finger-targets=on]) #lk-load .pg .tab{min-height:36px;min-width:36px;justify-content:center;display:inline-flex;align-items:center}   /* 36 px: above the 24 px floor of WCAG 2.5.8, so seven rows fit the lower half of a phone */
#lk-load .tx{display:flex;flex-direction:column;gap:.15em;min-width:0}
#lk-load .tx b{font-family:var(--lk-font);font-weight:var(--lk-book);font-size:1.18em;letter-spacing:.1em;text-transform:uppercase}
#lk-load .tx .co{font-size:.86em;letter-spacing:.1em}
#lk-load .tx i{font-size:.9em;line-height:1.35;margin-top:.3em}
#lk-load .stamp{position:absolute;top:.5em;right:.6em;padding:.1em .55em;border:1px solid var(--navy);border-radius:.2em;font-size:.7em;letter-spacing:.2em;text-transform:uppercase;transform:rotate(3deg);opacity:0}
#lk-load .tile[aria-checked=true] .stamp{opacity:1}
#lk-load .tile[disabled]{cursor:default}
/* the builder's plate */
#lk-load .tile.vessel{grid-template-columns:1fr;gap:.6em;padding:.8em .9em .9em}
#lk-load .prof{display:block;width:100%;max-height:7.6em;height:auto}
#lk-load .prof path{fill:none;stroke:var(--navy);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
#lk-load .prof .hl{fill:var(--navy)}
#lk-load .prof .sl{fill:rgb(var(--lk-cream) / .9)}
#lk-load .prof .kl{fill:var(--navy);stroke-width:1}
#lk-load .prof .wl{stroke-dasharray:4 3;opacity:.7}
#lk-load .plate{position:relative;display:block;padding:.7em .9em .65em;border-radius:.3em;background:linear-gradient(160deg,color-mix(in srgb,rgb(var(--lk-brand-navy)),rgb(var(--lk-cream)) 12%),rgb(var(--lk-brand-navy)));box-shadow:inset 0 0 0 .1em rgb(var(--lk-cream) / .55),inset 0 0 0 .2em rgb(var(--lk-brand-navy)),inset 0 0 0 .25em rgb(var(--lk-cream) / .3),0 .1em .3em rgb(var(--lk-shade) / .5);color:var(--navy)}
#lk-load .plate .nm{display:block;font-family:var(--lk-font);font-size:1.5em;letter-spacing:.34em;text-transform:uppercase;font-weight:var(--lk-book);line-height:1.2}
#lk-load .plate .kind{display:block;font-size:.8em;letter-spacing:.22em;text-transform:uppercase;margin:.1em 0 .5em;padding-bottom:.4em;border-bottom:1px solid rgb(var(--lk-cream) / .6)}
#lk-load .plate .pr{display:flex;justify-content:space-between;gap:1em;padding:.14em 0;font-size:.92em;font-variant-numeric:tabular-nums}
#lk-load .plate .pr i{font-style:normal;margin-left:.5em}
#lk-load .tile.vessel .stamp{top:.7em;right:.8em;background:rgb(var(--lk-brand-navy) / .95)}
/* settings, in rows */
#lk-load .set{display:grid;grid-template-columns:8.6em 1fr;align-items:center;column-gap:.6em;min-height:2.05em;padding:.16em 0;border-bottom:1px solid rgb(var(--lk-cream) / .16)}
#lk-load .tp .set:last-of-type{border-bottom:0}
#lk-load .set .k{font-size:max(.74em,12px);letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);white-space:nowrap}
#lk-load .set .v{display:flex;flex-wrap:wrap;gap:.2em .2em;align-items:center}
#lk-load .set .info{font-size:.92em}
#lk-load .qnow{flex-basis:100%;order:9;font-size:.8em;opacity:.8;letter-spacing:.02em;line-height:1.3}
#lk-load .set[data-set=quality] .pbtn{padding:.1em .5em;font-size:.8em;letter-spacing:.04em}
#lk-load .opt{display:inline-block;padding:.1em .55em .08em;border-radius:.18em;border:1px solid rgb(var(--lk-cream) / .5);font-size:.92em;line-height:1.35;transition:background-color .2s,color .2s}
#lk-load .opt:hover{background:rgb(var(--lk-cream) / .1)}
#lk-load .opt[aria-checked=true]{background:rgb(var(--lk-cream) / .13);color:var(--navy);border-color:var(--navy);font-weight:var(--lk-medium)}   /* the choice: its hairline full cream and a faint tint, never a solid cream fill (owner, 2026-11-06) */
#lk-load .opt[role=switch]::before{content:'';display:inline-block;width:.5em;height:.5em;margin:0 .45em .1em 0;border-radius:50%;box-shadow:inset 0 0 0 1px currentColor}
#lk-load .opt[role=switch][aria-checked=true]::before{background:currentColor}
#lk-load .opt[disabled]{opacity:.8;cursor:default;border-style:dashed}
/* the first-visit welcome: big choices, the default marked, 44 px targets */
#lk-load .welcome .wl{font-size:1.05em;margin:0 0 1em}
#lk-load .choices{display:flex;flex-direction:column;gap:.7em}
#lk-load .choice{display:flex!important;flex-direction:column;gap:.25em;min-height:44px;padding:.8em 1em .75em;border:1px solid rgb(var(--lk-cream) / .6);border-radius:.3em;background:rgb(var(--lk-cream) / .07);text-align:left;transition:background-color .2s,border-color .2s}
#lk-load .choice b{font-family:var(--lk-font);font-weight:var(--lk-book);font-size:1.3em;letter-spacing:.14em;text-transform:uppercase}
#lk-load .choice span{font-size:.94em;line-height:1.4;color:var(--ink2)}
#lk-load .choice:hover,#lk-load .choice:focus-visible{background:rgb(var(--lk-cream) / .15);border-color:rgb(var(--lk-cream) / .95)}
#lk-load .choice[aria-checked=true]{box-shadow:inset 0 0 0 .14em var(--navy);background:rgb(var(--lk-cream) / .13)}
#lk-load .wskip{margin:1.1em 0 0;font-size:.82em;letter-spacing:.06em;opacity:.8}
:where(:root[data-f-finger-targets=on]) #lk-load .wskip{display:none}
/* keys: a laminated cheat card (owner, 2026-10-30: compact, no scroll). Two columns of short groups; one row = caps | verb;
   the first five have filled caps; the mouse and touch ways and the pro trim are the card's other tabs. */
#lk-load .kcols{display:grid;grid-template-columns:1fr 1fr;column-gap:1.1em}
#lk-load .kcol{display:flex;flex-direction:column;gap:.45em;min-width:0}
#lk-load .kh{all:unset;display:block;font-size:max(.72em,11.5px);letter-spacing:.18em;text-transform:uppercase;color:var(--ink2);margin:0 0 .15em;padding-bottom:.12em;border-bottom:1px solid rgb(var(--lk-cream) / .22)}
#lk-load .kr2,#lk-load .hr{display:grid;grid-template-columns:4.1em 1fr;align-items:baseline;column-gap:.45em;min-height:1.6em;line-height:1.25;padding:.06em 0}
#lk-load .kr2 .caps,#lk-load .hr .caps{display:inline-flex;gap:.2em;flex-wrap:nowrap;align-self:center}
#lk-load .keys .cap{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:1.45em;height:1.45em;padding:0 .3em;border:1px solid rgb(var(--lk-cream) / .8);border-radius:.22em;font-weight:var(--lk-medium);font-size:.84em;color:var(--navy)}
#lk-load .keys .caps.ess .cap{background:var(--navy);border-color:var(--navy);color:rgb(var(--lk-brand-navy))}
#lk-load .kv{font-size:.92em}
#lk-load .kq{color:var(--ink2);font-size:.86em}
#lk-load .ka{color:var(--ink2);font-size:.86em;text-align:right;white-space:nowrap}
#lk-load .hr{grid-template-columns:4.1em 1fr auto}
#lk-load .tr{display:grid;grid-template-columns:5.6em 1fr;align-items:baseline;column-gap:.6em;min-height:1.6em;line-height:1.25;padding:.1em 0}   /* the Touch sheet: a name, then what to tap or drag (no caps) */
#lk-load .tr .ka{text-align:left;white-space:normal}
#lk-load .keys .term{pointer-events:auto;border-bottom:1px dotted var(--navy)}
#lk-load .kfoot{display:flex;flex-wrap:wrap;align-items:center;gap:.3em .45em;margin:.55em 0 0;padding-top:.4em;border-top:1px solid rgb(var(--lk-cream) / .22);font-size:.92em}
#lk-load .kfoot .caps{display:inline-flex}
#lk-load .kfoot > span:not(.caps){margin-right:.5em}
#lk-load .kfoot .kq{margin-left:auto;margin-right:0;font-family:var(--lk-font);font-style:italic}
#lk-load .kpad{margin:.5em 0 0;font-size:.86em;color:var(--ink2);line-height:1.4}
#lk-load .tab .ln,#lk-load .tab.phone{display:none}
#lk-load .credit{padding:.32em 0}
#lk-load .credit .d{font-size:.84em;line-height:1.35;margin-top:.05em}
#lk-load .pg-b > p:first-child,#lk-load .tp > p:first-child{margin-bottom:.5em}
:where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .ka{white-space:normal}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tab .lw{display:none}:where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tab .ln{display:inline}:where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tab.phone{display:inline-flex}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load #tp-keys-keys .kcol + .kcol{display:none}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load #tp-keys-keys .kcols.t2 .kcol + .kcol{display:flex}   /* a page's own table (v2) has no Boat tab: its columns stack */
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .kcols{grid-template-columns:1fr}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load textarea{min-height:0;height:2.9em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=feedback] .note{margin-bottom:.25em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tile.soon{padding:.45em .7em;font-size:.9em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .plate{padding:.5em .8em .45em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .plate .pr{padding:.06em 0}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load label.f{margin:.4em 0 .2em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tick{margin:.45em 0 .15em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .note{margin-bottom:.4em;font-size:.8em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=feedback] .tp[data-tp=note] > p:first-child,:where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .rlead{display:none}   /* the title says it; the form is the page */
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .send{flex-wrap:nowrap}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .how{font-size:.78em;line-height:1.3}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg-esc{display:none}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .prof{max-height:3.8em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tiles{gap:.5em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tile.vessel{padding:.6em .7em .7em}
/* about, credits, contact, feedback */
#lk-load .studio{display:flex;align-items:center;gap:.9em;margin:0 0 1em}
#lk-load .studio .lk-mk{flex:none;width:3.4em;height:auto;color:var(--navy)}
#lk-load .studio .by{line-height:1.45}
#lk-load .credit{display:grid;grid-template-columns:8.4em 1fr;column-gap:.9em;padding:.5em 0;border-top:1px solid rgb(var(--lk-cream) / .3)}
#lk-load .credit .w{font-size:.84em;letter-spacing:.1em;text-transform:uppercase;padding-top:.15em}
#lk-load .credit .d{display:block;font-size:.88em;line-height:1.45;margin-top:.15em}
#lk-load .stamp-b{margin:.8em 0 0;font-size:.7em;letter-spacing:.12em;opacity:.55;text-align:right}
#lk-load .addr{display:flex;align-items:center;flex-wrap:wrap;gap:.5em .8em;margin:.2em 0 1em;font-size:1.04em}
#lk-load .addr .mail{border-bottom:1px solid var(--navy);padding-bottom:.1em;user-select:text}
#lk-load .pbtn{display:inline-flex!important;align-items:center;gap:.45em;padding:.35em .8em .3em;border:1px solid var(--navy);border-radius:.2em;font-size:.9em;letter-spacing:.1em;transition:background-color .2s,color .2s}
#lk-load .pbtn:hover,#lk-load .pbtn.done{background:var(--navy);color:rgb(var(--lk-brand-navy))}
#lk-load label.f{display:block;font-size:.8em;letter-spacing:.18em;text-transform:uppercase;margin:.9em 0 .35em}
#lk-load textarea,#lk-load input[type=email]{all:unset;box-sizing:border-box;display:block;width:100%;padding:.5em .65em;border-radius:.2em;font:var(--lk-book) 1em/1.45 var(--lk-ui,var(--lk-font));letter-spacing:.02em;color:var(--navy);background:rgb(var(--lk-cream) / .08);box-shadow:inset 0 0 0 1px var(--navy);cursor:text;user-select:text}
#lk-load textarea{min-height:6em;white-space:pre-wrap}
#lk-load textarea:focus,#lk-load input[type=email]:focus{box-shadow:inset 0 0 0 .13em var(--navy)}
#lk-load ::placeholder{color:rgb(var(--lk-cream) / .72);opacity:1}
#lk-load .tick{display:flex;align-items:flex-start;gap:.6em;margin:1em 0 .3em;cursor:pointer}
#lk-load .tick input{appearance:none;-webkit-appearance:none;flex:none;width:1.05em;height:1.05em;margin:.2em 0 0;border-radius:.15em;box-shadow:inset 0 0 0 1px var(--navy);cursor:pointer}
#lk-load .tick input:checked{background:var(--navy) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.4l3 3 6-6.6' fill='none' stroke='%231C2340' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/86% no-repeat}
#lk-load .tick input:focus-visible{outline:2px solid var(--navy);outline-offset:2px}
#lk-load .note{font-size:.86em;margin:0 0 1em 1.6em;line-height:1.45;font-style:italic}
#lk-load .send{display:flex;align-items:center;gap:.8em;flex-wrap:wrap}
#lk-load .how{font-size:.84em;font-style:italic}
/* The page is the card (owner, 2026-11-06: one fixed height): every page keeps the card's own box in that state (the home card,
   the in-play menu card), so the outline never jumps. A shorter page sits at the top with the rest empty; a longer one scrolls
   inside its body (a thin, quiet bar; the back link, the title and its tabs pinned), as What's new and Credits do.
   The card drops its chart art for the page and keeps its double neatline; the larger-text setting reaches the pages. */
@font-face{font-family:'Velia Sub A';font-style:normal;font-weight:400 700;font-display:swap;src:url(/fonts/sub/fraunces-soft.woff2) format('woff2')}
#lk-load .lk-pg{font-size:calc(max(16px, var(--F) * 1.08) * var(--lk-text))}
#lk-load[data-pg] .lk-card{background:rgb(var(--lk-brand-navy));transition:none}
#lk-load[data-pg] .lk-pg{position:absolute;inset:0;z-index:2;background:none;padding:1.15em 1.35em 1.1em;overflow:hidden}
#lk-load .pg.on{display:flex;flex-direction:column;height:100%;min-height:0}
#lk-load .pg.on > .pg-h,#lk-load .pg.on > h2{flex:none}
#lk-load .pg.on > .pg-b{flex:1 1 auto;min-height:0;overflow:hidden auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgb(var(--lk-cream) / .35) transparent;padding-right:.2em}
#lk-load .pg.on.welcome{overflow:hidden auto;scrollbar-width:thin;scrollbar-color:rgb(var(--lk-cream) / .35) transparent}
#lk-load[data-pg] .lk-sheet,#lk-load[data-pg] .lk-voyage,#lk-load[data-pg] .lk-links,#lk-load[data-pg] .lk-map,#lk-load[data-pg] .lk-art,#lk-load[data-pg] .lk-art-n,#lk-load[data-pg] .lk-light{display:none}
:where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .lk-pg{font-size:calc(16px * var(--lk-text))}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load[data-pg] .lk-pg{padding:1em 1.1em .95em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load[data-pg] .lk-osm{display:none}   /* the map credit would sit on the page card; the Credits page carries it */
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tile{grid-template-columns:minmax(0,.4fr) minmax(0,.6fr);gap:.6em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .set{grid-template-columns:7.4em 1fr}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .credit{grid-template-columns:1fr}
@media (prefers-reduced-motion:reduce){#lk-load .lk-pg,#lk-load[data-pg] .lk-card{transition:none}}
#lk-load .pg .ch3{all:unset;display:block;margin:.4em 0 .45em;font-size:max(.78em,13px);letter-spacing:.18em;text-transform:uppercase;color:var(--ink2)}
#lk-load .pg .tiles + .ch3{margin-top:1em}
/* Support Velia: the Support section's gold pill, and the skipper's line at the end of About */
#lk-load .kofi{margin:.6em 0 0;font-family:var(--lk-font);font-style:italic;font-size:.94em;line-height:1.45}
#lk-load .kofi{margin-bottom:.45em}
/* the support row's cup and the end button: the card foot's gold (--brass, the compass rose's; tokens.css notes the exception) */
#lk-load .kofib{margin:0}
#lk-load .pbtn.kl{border-color:var(--brass);border-radius:999px;background:color-mix(in srgb,var(--brass) 11%,transparent);letter-spacing:.04em}
#lk-load .pbtn.kl .ic{stroke:var(--brass)}
#lk-load .pbtn.kl:hover,#lk-load .pbtn.kl:focus-visible{background:color-mix(in srgb,var(--brass) 20%,transparent);color:var(--navy)}
#lk-load .pbtn.kl:hover .ic .st{animation:lk-steam .6s var(--lk-ease) both}
#lk-load .ic .st{transform-box:fill-box;transform-origin:50% 100%}
@media (prefers-reduced-motion:reduce){#lk-load .pbtn.kl:hover .ic .st{animation:none}}
/* the feedback's rows and its details: the quick ratings as setting rows, the details as the exact lines the mail will carry */
#lk-load .rlead{font-size:.86em;color:var(--ink2);font-family:var(--lk-font);font-style:italic;margin:0 0 .3em}
#lk-load .pg[data-page=feedback] .set .opt{min-width:2.1em;text-align:center;justify-content:center}
#lk-load .fbtech{margin:.2em 0 .8em 1.6em;padding:.45em .7em;border-radius:.2em;background:rgb(var(--lk-cream) / .07);box-shadow:inset 0 0 0 1px rgb(var(--lk-cream) / .3);
  font:var(--lk-book) max(.8em,13px)/1.45 var(--lk-ui,var(--lk-font));letter-spacing:.02em;white-space:pre-wrap;color:var(--ink2);user-select:text}
#lk-load .fbtech.off{opacity:.6;font-style:italic;font-family:var(--lk-font)}
#lk-load .pg[data-page=feedback] .send{margin-top:.7em;padding-top:.6em;border-top:1px solid rgb(var(--lk-cream) / .22)}
/* ---- the Help sheet (Solaria stage 2) ----
   One sheet: a vertical nav (Tutorials · Keys · Setup · What's new · Credits · Contact · Support · About) beside the section.
   It keeps the card's fixed height; on a wide screen the card grows to its right by the nav's width, so each section keeps
   the width it had as a page. A phone shows the nav as its own screen, then the section under "‹ Help".
   The sheet's system: cream ink on navy, outline controls of one height (32 px, 44 px on touch), radii 14 (a plate) and
   16 (a pill), text at 15 px or more, one hairline (under the title), motion 120 ms (a control) and 400 ms (the sheet). */
#lk-load .lk-card{--hnw:calc(var(--F) * 10.4)}
#lk-load .hnav{display:none}
#lk-load[data-help] .lk-card{width:min(calc(var(--cw) + var(--hnw)),calc(100vw - 2 * clamp(24px,5vw,84px)));transition:width .4s cubic-bezier(.2,0,0,1)}
#lk-load[data-help] .lk-pg{display:grid;grid-template-columns:var(--hnw) minmax(0,1fr);grid-template-rows:minmax(0,1fr);column-gap:1.3em}
#lk-load[data-help] .hnav{display:flex;flex-direction:column;min-height:0;grid-column:1;grid-row:1}
#lk-load[data-help] .pg.on{grid-column:2;grid-row:1}
#lk-load[data-pg=help] .pg[data-page=help]{display:none}
#lk-load .hnav .hn-t{all:unset;display:block;font-family:var(--lk-font);font-weight:var(--lk-book);font-size:1.45em;line-height:1.55;letter-spacing:.06em;margin:0 0 .45em;padding-bottom:.25em;color:var(--navy)}
#lk-load .hn-list{display:flex;flex-direction:column;gap:.2em;min-height:0;overflow:hidden auto;scrollbar-width:none}
#lk-load :where(.hnav button){all:unset;box-sizing:border-box;cursor:pointer;color:inherit}
#lk-load .hn{display:flex;align-items:center;justify-content:space-between;min-height:32px;padding:0 .75em;border:1px solid transparent;border-radius:16px;font-size:max(1em,15px);letter-spacing:.03em;color:var(--ink2);transition:background-color .12s cubic-bezier(.2,0,0,1),border-color .12s cubic-bezier(.2,0,0,1),color .12s}
#lk-load .hn .ch{font-style:normal;font-size:1.2em;line-height:1;opacity:0}
#lk-load .hn:hover{background:rgb(var(--lk-cream) / .08);color:var(--navy)}
#lk-load .hn[aria-current=page]{background:rgb(var(--lk-cream) / .13);border-color:var(--navy);color:var(--navy);font-weight:var(--lk-medium)}   /* the section on: a faint tint in its hairline (owner, 2026-11-06) */
#lk-load .hn:focus-visible,#lk-load .hnav .pg-back:focus-visible{outline:2px solid var(--navy);outline-offset:2px}
#lk-load .hnav .pg-back{display:inline-flex;align-items:center;gap:.2em;padding:.2em .5em .2em .1em;font-size:max(.78em,15px);letter-spacing:.16em;text-transform:uppercase;color:var(--ink2)}
#lk-load .hnav .pg-back:hover{background:rgb(var(--lk-cream) / .09)}
/* on a wide screen the nav carries the way back to the card: a section's own "‹ Help" stays, hidden, so the title lines up */
#lk-load[data-help] .pg.on .pg-back.hb{visibility:hidden}
/* the sheet's type: nothing under 15 px; the section titles keep their size */
#lk-load[data-help] .pg-back,#lk-load[data-help] .kc,#lk-load[data-help] .pg .tab,#lk-load[data-help] .set .k,#lk-load[data-help] .stamp-b,#lk-load[data-help] .credit .w,#lk-load[data-help] .credit .d,#lk-load[data-help] .note,#lk-load[data-help] .how,#lk-load[data-help] .rlead,#lk-load[data-help] label.f,#lk-load[data-help] .fbtech,#lk-load[data-help] .pg .ch3,#lk-load[data-help] .qnow{font-size:max(.86em,15px)}
#lk-load[data-help] .stamp-b{opacity:.86}
#lk-load[data-help] .opt,#lk-load[data-help] .pbtn{font-size:max(.92em,15px)}
#lk-load[data-help] .keys .kh,#lk-load[data-help] .keys .cap,#lk-load[data-help] .kv,#lk-load[data-help] .kq,#lk-load[data-help] .ka,#lk-load[data-help] .kpad{font-size:max(.86em,15px)}
/* one control height: 32 px (44 px on touch); a pill is a button you press (radius 16) */
#lk-load[data-help] .opt,#lk-load[data-help] .pbtn,#lk-load[data-help] .pg .tab{display:inline-flex!important;align-items:center;justify-content:center;box-sizing:border-box;min-height:32px;padding:0 .8em;border-radius:16px;line-height:1.1;transition:background-color .12s cubic-bezier(.2,0,0,1),border-color .12s cubic-bezier(.2,0,0,1),color .12s}
#lk-load[data-help] .set .v{gap:.35em}
#lk-load[data-help] .pbtn:hover{background:rgb(var(--lk-cream) / .13);color:var(--navy)}   /* an outline button: a tint, never a solid cream fill */
#lk-load[data-help] .pbtn.done{background:rgb(var(--lk-cream) / .13);color:var(--navy)}
:where(:root[data-f-finger-targets=on]) #lk-load .hn,:where(:root[data-f-finger-targets=on]) #lk-load[data-help] .opt,:where(:root[data-f-finger-targets=on]) #lk-load[data-help] .pbtn,:where(:root[data-f-finger-targets=on]) #lk-load[data-help] .pg .tab,:where(:root[data-f-finger-targets=on]) #lk-load[data-help] .pg-back{min-height:44px}
/* Setup: four tabs (Sail, Aids, Sound, Screen), each fits the card with no scroll (owner, 2026-11-09). On a phone a row is its label beside its choices
   (they wrap in their own column), and the tab strip is tighter, so every tab fits at 390 x 844 */
#lk-load .sgrp + .sgrp{margin-top:1.1em}
#lk-load .sgrp .ch3{margin:.2em 0 .3em}
#lk-load .sgrp .set:last-child{border-bottom:0}
#lk-load[data-help] .set{border-bottom:0;padding:.22em 0}
#lk-load[data-help] .set{grid-template-columns:minmax(0,1fr);row-gap:.3em;padding:.4em 0}   /* the sheet's column is narrow: the label over its choices */
#lk-load[data-help] .set .k{white-space:normal;letter-spacing:.12em}
/* Setup's Sail tab on a wide screen: Wind and Weather share one line (eight rows of label-over-choices would scroll at 1280 x 720) */
:where(:root:not([data-screen~=narrow])) #lk-load[data-help] .pg[data-page=settings] .set[data-set=wind],:where(:root:not([data-screen~=narrow])) #lk-load[data-help] .pg[data-page=settings] .set[data-set=weather]{display:inline-grid;width:50%;vertical-align:top}
:where(:root[data-screen~=narrow]) #lk-load[data-help] .pg[data-page=settings] .set{grid-template-columns:minmax(5.6em,.75fr) minmax(0,2fr);align-items:center;column-gap:.5em;row-gap:0;padding:.1em 0}
  :where(:root[data-screen~=narrow]) #lk-load[data-help] .pg[data-page=settings] .set .v{flex-wrap:wrap}
  :where(:root[data-screen~=narrow]) #lk-load[data-help] .pg[data-page=settings] .set .k{letter-spacing:.06em}
  :where(:root[data-screen~=narrow]) #lk-load .pg[data-page=settings] .tabs{gap:.1em}
  :where(:root[data-screen~=narrow]) #lk-load .pg[data-page=settings] .tab{padding:.18em .5em .16em;letter-spacing:.02em}
/* quality as three cards (Auto · High · Battery) and a "Now: …" status under them */
#lk-load .qcs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.45em}
#lk-load .qc{display:flex!important;flex-direction:column;align-items:center;justify-content:center;gap:.25em;min-height:64px;padding:.5em .3em;border:1px solid rgb(var(--lk-cream) / .5);border-radius:14px;color:var(--ink2);transition:background-color .12s cubic-bezier(.2,0,0,1),border-color .12s cubic-bezier(.2,0,0,1),color .12s}
#lk-load .qc b{font-weight:var(--lk-medium);font-size:max(.92em,15px);letter-spacing:.04em}
#lk-load .qc .ic{width:1.5em;height:1.5em}
#lk-load .qc:hover{background:rgb(var(--lk-cream) / .08);border-color:rgb(var(--lk-cream) / .9)}
#lk-load .qc[aria-checked=true]{background:rgb(var(--lk-cream) / .13);border-color:var(--navy);color:var(--navy)}
#lk-load .qset .qnow{margin:.15em 0 0;opacity:1;color:var(--ink2);line-height:1.35}
/* Tutorials and Support */
#lk-load[data-help] .credit{border-top:0;padding:.45em 0}   /* one hairline (under the title): rows are set apart by space */
#lk-load .tut-go{margin:.9em 0 0}
#lk-load .supl{font-family:var(--lk-font);font-style:italic}
/* the sheet comes in over 400 ms; reduced motion: no width move */
#lk-load[data-pg] .lk-pg{transition:opacity .4s cubic-bezier(.2,0,0,1),visibility 0s}
@media (prefers-reduced-motion:reduce){#lk-load[data-help] .lk-card{transition:none}}
/* a phone: the nav is its own screen (Help), then the section with "‹ Help"; the card keeps its width */
:where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load[data-help] .lk-card{width:var(--cw)}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load[data-help] .lk-pg{display:block}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load[data-help] .hnav{display:none}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load[data-pg=help] .hnav{display:flex;height:100%}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load[data-help] .pg.on .pg-back.hb{visibility:visible}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .hn{font-size:1.06em;padding:0 .9em}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .hn .ch{opacity:.8}
  :where(:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .hn-list{gap:.3em}
/* What's new and Credits: one page each, its body scrolls under the fixed title and the Help nav (no numbered pages). Momentum on touch, a wheel or the keys on a desk (home.js), and a fade at the bottom edge while more is
   below (helpScroll.js sets data-more). What's new: a date per release, the newest open, the older folded under their date. */
#lk-load .pg.scr > .pg-b{touch-action:pan-y;-webkit-overflow-scrolling:touch;scroll-behavior:smooth}
#lk-load .pg.scr > .pg-b[data-more]{-webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 3.2em),rgb(0 0 0 / .08));mask-image:linear-gradient(180deg,#000 calc(100% - 3.2em),rgb(0 0 0 / .08))}
@media (prefers-reduced-motion:reduce){#lk-load .pg.scr > .pg-b{scroll-behavior:auto}}
#lk-load .cgrp + .cgrp{margin-top:.9em}
#lk-load .pg .cgrp > .ch3{margin:.3em 0 .1em;font-family:'Velia Sub A',var(--lk-font);font-weight:500;font-size:max(1.1em,16px);letter-spacing:.02em;text-transform:none;color:var(--navy)}   /* a topic: the title's face, smaller (the rows' labels keep the small caps) */
#lk-load .rel + .rel{border-top:1px solid rgb(var(--lk-cream) / .2)}
#lk-load .rh{display:flex;align-items:center;justify-content:space-between;gap:.6em;min-height:36px;padding:.2em .35em .2em .1em;border-radius:.2em;cursor:pointer;list-style:none;font-size:max(.84em,15px);letter-spacing:.16em;text-transform:uppercase;color:var(--ink2);transition:background-color .12s,color .12s}
#lk-load .rh::-webkit-details-marker{display:none}
#lk-load .rh:hover{background:rgb(var(--lk-cream) / .08);color:var(--navy)}
#lk-load .rh:focus-visible{outline:2px solid var(--navy);outline-offset:2px}
#lk-load .rel[open] > .rh{color:var(--navy)}
#lk-load .rh .chv{transition:transform .12s cubic-bezier(.2,0,0,1)}
#lk-load .rel[open] > .rh .chv{transform:rotate(180deg)}
:where(:root[data-f-finger-targets=on]) #lk-load .rh{min-height:44px}
#lk-load .rb{padding:0 0 .7em}
#lk-load .nw{padding:.4em 0}
#lk-load .nw .n{display:block;line-height:1.45}
#lk-load .nw .d{display:block;font-size:max(.88em,15px);line-height:1.45;margin-top:.12em;color:var(--ink2)}
#lk-load .pg[data-page=news] .stamp-b{margin-top:1em}
`;
