// The keys, said once (owner, 2026-10-30: "too hard to read and remember"). One table feeds the Keys page of the home card (keysPageHtml) and the H list held in play
// (LIST, PRO_LIST in controlsHint.js), so the two always say the same words. A row is: keys (caps) on the left, a plain verb phrase (four words or fewer), a quiet
// sailing term only where it helps (markup {id} / {id|text|plain} of words.js, so it glosses on hover), and, on the page, the mouse or touch way as a small second column.
// Every cap names a real key of the table in src/sail/keys.js (tests/keysContent.test.mjs); drag, wheel, pinch and tap are not keys and name the hand.
export const CODE = { A: 'KeyA', D: 'KeyD', W: 'KeyW', S: 'KeyS', C: 'KeyC', V: 'KeyV', H: 'KeyH', B: 'KeyB', I: 'KeyI', J: 'KeyJ', U: 'KeyU', Y: 'KeyY', N: 'KeyN', L: 'KeyL', O: 'KeyO', M: 'KeyM',
  Space: 'Space', Q: 'KeyQ', E: 'KeyE', Z: 'KeyZ', X: 'KeyX', R: 'KeyR', F: 'KeyF', K: 'KeyK', G: 'KeyG', '⇧Z': 'KeyZ', '⇧X': 'KeyX',
  '+': 'Equal', '−': 'Minus', 0: 'Digit0', 1: 'Digit1', 2: 'Digit2', 3: 'Digit3', 4: 'Digit4', '`': 'Backquote', Esc: 'Escape' };
export const HANDS = ['drag', 'wheel', 'click', 'tap', 'pinch'];

// the five to learn first
export const ESSENTIALS = [
  { k: ['A', 'D'], v: 'steer' },
  { k: ['W', 'S'], v: 'sails in, out' },
  { k: ['C'], v: 'change view' },
  { k: ['Esc'], v: 'menu' },
  { k: ['H'], v: 'this list; tap: cockpit' },   // a tap lowers or raises the cockpit, as its fold button (calmHud.js)
];

export const GROUPS = [
  { id: 'sailing', title: 'Sailing', rows: [
    { k: ['A', 'D'], v: 'steer', g: 'let go: the pilot holds; through the wind she keeps turning', a: 'click the water' },
    { k: ['W', 'S'], v: 'sails in, sails out', g: '{trim}', a: 'drag up, down' },
    { k: ['Space'], v: '{tack} or {gybe}', g: 'the whole turn for you', a: 'the Tack button' },
    { k: ['W'], v: 'sails in, then turn', g: '{gybe}', a: 'drag in, then click' },
  ] },
  { id: 'views', title: 'Views', rows: [
    { k: ['C'], v: 'boat or {helm|helm|wheel} view', a: 'tap Boat | Helm' },
    { k: ['V'], v: 'the boat from above' },
    { k: ['drag'], v: 'look around', a: 'two fingers' },
    { k: ['wheel'], v: 'zoom', a: 'pinch' },
    { k: ['B'], v: 'binoculars up, down', a: 'the mouse aims' },
    { k: ['H'], v: 'cockpit down, up', a: 'the mark on the wheel' },
  ] },
  { id: 'boat', title: 'The boat', rows: [
    { k: ['I'], v: 'engine on, off' },
    { k: ['+', '−'], v: 'ahead, {astern|astern|back}' },
    { k: ['0'], v: 'neutral' },
    { k: ['J'], v: '{anchor} down, up' },
    { k: ['U'], v: 'moor: ball or pier' },
    { k: ['Y'], v: 'sails up, down' },
    { k: ['`'], v: 'let her sail herself', g: 'Cruise: any key steers again' },
  ] },
  { id: 'tools', title: 'Tools', rows: [
    { k: ['N'], v: 'chart', g: 'tap opens the whole bay, tap again closes; or hold' },
    { k: ['L'], v: 'logbook' },
    { k: ['O'], v: 'VHF weather, now', g: 'the radio is on; its button is on the pro panel' },
    { k: ['M'], v: 'sound on, off' },
  ] },
  { id: 'wind', title: 'Wind', rows: [
    { k: ['1', '2', '3', '4'], v: 'wind level', g: 'light to strong' },
  ] },
];

// shown folded on the page and listed under H only once trim is learned or pro is on (controlsHint.js)
export const PRO = { id: 'pro', title: 'Pro trim', rows: [
  { k: ['Q', 'E'], v: '{traveller} down, up' },
  { k: ['Z', 'X'], v: '{twist} open, closed' },
  { k: ['⇧Z', '⇧X'], v: '{backstay} ease, on' },
  { k: ['R', 'F'], v: '{jib-lead|jib lead} forward, aft' },
  { k: ['K'], v: '{reef}' },
  { k: ['G'], v: '{wing-on-wing}' },
] };
const PAD_LINE = 'pad: d-pad ◀ ▶ {traveller} · LB RB {twist} · hold A / B with ◀ ▶ lead / {backstay}';

const cap = (k) => `<span class="cap${k.length > 2 ? ' wide' : ''}" data-k="${k}">${k}</span>`;
const capsHtml = (ks) => `<span class="caps">${ks.map(cap).join('')}</span>`;

// The finger's sheet (owner, 2026-10-31: iOS showed keys): what to tap or drag, never a cap. It is the first tab of the Keys card
// on a touch device (keysPageHtml({ touch: true }), home.js asks the input modality) and replaces the Mouse, touch tab.
export const TOUCH_ROWS = [
  ['Steer', 'drag the wheel, or slide the helm strip'],
  ['{tack|Tack}, {gybe|gybe}', 'tap the Tack or Gybe button'],
  ['{trim|Trim}', 'drag a {winch}: down pulls in, up eases'],
  ['View', 'tap Boat | Helm; two fingers to look, pinch to zoom'],
  ['Chart', 'tap the chart, top right'],
  ['Menu', 'tap ≡, top left'],
];
// v2's finger sheets (front.js): sideways phones and tablets have no helm strip (the left half of the water is the tiller, v2/ui/touch.js);
// an upright phone's one-thumb controls (v2/ui/thumb.js) name what is on screen: the steer zone low on the screen, the Auto
// chip, the Tack / Gybe button, ⋯ and its drawer, the rail under motor
export const V2_TOUCH_ROWS = [['Steer', 'drag the wheel, or drag on the left half of the water'], ...TOUCH_ROWS.slice(1)];
export const THUMB_ROWS = [
  ['Steer', 'drag sideways low on the screen'],
  ['{tack|Tack}, {gybe|gybe}', 'tap the Tack or Gybe button'],
  ['{trim|Trim}', 'Auto trims for you; drag low on the screen to take it: down pulls in, up eases'],
  ['Motor', 'tap ⋯, Drive: Motor, then slide the rail'],
  ['More', 'tap ⋯: sails, anchor, the chart and the rest'],   // no binoculars on a phone (owner 2026-11-15)
  ['Look', 'two fingers to look, pinch to zoom'],
];
// (V2_TOUCH_ROWS shares TOUCH_ROWS' row arrays, so a setTouchRow reaches it too)
const touchRows = (rows = TOUCH_ROWS) => rows.map(([a, b]) => `<div class="tr"><span class="kv">${a}</span><span class="ka">${b}</span></div>`).join('');
// a page whose bar differs from v1's names its own places (v2's new top bar): setTouchRow('Chart', 'tap Menu on the top bar')
export function setTouchRow(key, text) { const r = TOUCH_ROWS.find(([a]) => a === key); if (r) r[1] = text; }

// The Keys page is a cheat card (owner, 2026-10-30: compact, no scroll), in tabs. Keys: the groups in two columns, one row =
// caps | a plain verb (+ the sailing word, which glosses on hover); a plain note rides on the row's title; the wind and the
// two keys to remember sit in the foot; the first five to learn have filled caps. Mouse, touch: the other hand's way for each
// row that has one. Pro trim: the pro rows and the pad line (its tab is lit while Pro is on). A phone shows the second column
// as its own tab (Boat), so its card stays in the lower half.
const COLUMNS = [['sailing', 'views'], ['boat', 'tools']];
const isEssential = (r) => ESSENTIALS.some((e) => e.k.join(' ') === r.k.join(' ') && (r.k.length > 1 || r.k[0] === 'C'));
const filled = (ks) => `<span class="caps ess">${ks.map(cap).join('')}</span>`;
const isTerm = (g) => /^\{[^}]*\}$/.test(g ?? '');
const plain = (g) => String(g).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const rowHtml = (r, seen = new Set()) => {
  const ess = isEssential(r) && !seen.has(r.k.join(' ')) && (seen.add(r.k.join(' ')), true);
  const note = r.g && !isTerm(r.g) ? ` title="${plain(r.g)}"` : '';
  return `<div class="kr2"${note}>${ess ? filled(r.k) : capsHtml(r.k)}<span class="kv">${r.v}${isTerm(r.g) ? `<span class="kq"> · ${r.g}</span>` : ''}</span></div>`;
};
const tab = (k, name, on, extra = '') => `<button class="tab${extra}" type="button" role="tab" id="tab-keys-${k}" aria-controls="tp-keys-${k}" aria-selected="${on}" data-tab="${k}">${name}</button>`;
const panel = (k, body, on) => `<div class="tp" role="tabpanel" id="tp-keys-${k}" aria-labelledby="tab-keys-${k}" data-tp="${k}"${on ? '' : ' hidden'}>${body}</div>`;
const two = (wide, narrow) => `<span class="lw">${wide}</span><span class="ln">${narrow}</span>`;
// phone: the finger's Controls page alone (v2, owner 2026-11-15: "lots of desktop version info on the phone"): the touch rows,
// no tabs, no cap, no pad line; v1's card keeps its Touch tab first (touch: true)
export function keysPageHtml({ pro = false, touch = false, phone = false, rows = TOUCH_ROWS, proRows: proList = PRO.rows, table = null, cruise = false } = {}) {   // proRows: a page's own Pro rows (v1's card); table: a page's own key table (v2/ui/keyMap.js)
  if (phone) return `<div class="kpage"><div class="hands phone" data-tp="touch">${touchRows(rows)}</div></div>`;
  if (table) return tablePageHtml(table, { pro, cruise });
  const byId = Object.fromEntries(GROUPS.map((g) => [g.id, g])), seen = new Set();
  const group = (id) => `<section class="ks"><h3 class="kh">${byId[id].title}</h3>${byId[id].rows.map((r) => rowHtml(r, seen)).join('')}</section>`;
  const cols = COLUMNS.map((c) => `<div class="kcol">${c.map(group).join('')}</div>`).join('');
  const wind = byId.wind.rows[0];
  const foot = `<p class="kfoot">${filled(['Esc'])}<span>menu</span>${filled(['H'])}<span>this list</span>${capsHtml(wind.k)}<span title="${plain(wind.g ?? '')}">${wind.v}</span></p>`;
  const hands = GROUPS.flatMap((g) => g.rows).filter((r) => r.a).map((r) => `<div class="hr">${capsHtml(r.k)}<span class="kv">${r.v}</span><span class="ka">${r.a}</span></div>`).join('');
  const proRows = proList.map((r) => rowHtml(r)).join('') + `<p class="kpad">${PAD_LINE}</p>`;
  const boat = `<div class="kcols one"><div class="kcol">${COLUMNS[1].map((id) => `<section class="ks"><h3 class="kh">${byId[id].title}</h3>${byId[id].rows.map((r) => rowHtml(r)).join('')}</section>`).join('')}</div></div>`;
  const head = touch ? tab('touch', 'Touch', true) + tab('keys', two('Keys', 'Sailing'), false) : tab('keys', two('Keys', 'Sailing'), true);
  const hand = touch ? '' : tab('hand', two('Mouse, touch', 'Touch'), false);
  const tp = touch ? panel('touch', `<div class="hands">${touchRows(rows)}</div>`, true) : '';
  return `<span class="tabs" role="tablist" aria-label="Keys">${head}${tab('boat', 'Boat', false, ' phone')}${hand}${tab('pro', two(PRO.title, 'Pro'), false, pro ? ' lit' : '')}</span>`
    + `<div class="kpage">${tp}${panel('keys', `<div class="kcols">${cols}</div>${foot}`, !touch)}${panel('boat', boat, false)}${touch ? '' : panel('hand', `<div class="hands">${hands}</div>`, false)}${panel('pro', `<div class="kpro">${proRows}</div>`, false)}</div>`;
}

// The H list in play (the same words, two items to a line, the group's rows together): rows in the controlsHint.js row shape
const item = (r) => `${capsHtml(r.k)}<span class="label">${r.v}</span>${r.g ? `<span class="label soft">· ${r.g}</span>` : ''}`;
const lines = (rows) => { const out = []; for (let i = 0; i < rows.length; i += 2) out.push(rows.slice(i, i + 2).map(item).join('<span class="dot">·</span>')); return out; };
export const LIST_ROWS = GROUPS.flatMap((g) => lines(g.rows));
export const PRO_ROWS = [...lines(PRO.rows), `<span class="label soft" style="margin-left:0">${PAD_LINE}</span>`];

// A page's own key table (v2/ui/keyMap.js KEY_TABLE: { groups, columns, foot, pro, extra, hands }): the same card, tabs Keys
// (a narrow window stacks its two columns) | each extra group (Cruise, lit while it sails) | Mouse, touch | Pro trim. A row's
// alt keys (the arrows) and a plain note ride on its title; a term note shows quietly after the verb.
const altNote = (r) => [r.alt ? `or ${r.alt.join(' ')}` : null, r.g && !isTerm(r.g) ? r.g : null].filter(Boolean).join('; ');
const tRow = (r, seen) => {
  const ess = seen && isEssential(r) && !seen.has(r.k.join(' ')) && (seen.add(r.k.join(' ')), true);
  const note = altNote(r);
  return `<div class="kr2" data-row="${r.id}"${note ? ` title="${plain(note)}"` : ''}>${ess ? filled(r.k) : capsHtml(r.k)}<span class="kv">${r.v}${isTerm(r.g) ? `<span class="kq"> · ${r.g}</span>` : ''}</span></div>`;
};
function tablePageHtml(T, { pro = false, cruise = false } = {}) {
  const byId = Object.fromEntries(T.groups.map((g) => [g.id, g])), seen = new Set();
  const group = (g, s) => `<section class="ks"><h3 class="kh">${g.title}</h3>${g.rows.map((r) => tRow(r, s)).join('')}</section>`;
  const cols = T.columns.map((c) => `<div class="kcol">${c.map((id) => group(byId[id], seen)).join('')}</div>`).join('');
  const foot = `<p class="kfoot">${T.foot.map((r) => `${(r.k[0] === 'Esc' || r.k[0] === 'H') ? filled(r.k) : capsHtml(r.k)}<span data-row="${r.id}"${altNote(r) ? ` title="${plain(altNote(r))}"` : ''}>${r.v}</span>`).join('')}</p>`;
  const extra = (T.extra ?? []);
  const all = [...T.groups.flatMap((g) => g.rows), ...(T.hands ?? []), ...extra.flatMap((g) => g.rows)];   // hands: the ways with no key (drag, wheel), on the Mouse, touch tab only
  const hands = all.filter((r) => r.a).map((r) => `<div class="hr" data-row="${r.id}">${capsHtml(r.k)}<span class="kv">${r.v}</span><span class="ka">${r.a}</span></div>`).join('');
  const proRows = T.pro.rows.map((r) => tRow(r)).join('');
  const half = (g) => Math.ceil(g.rows.length / 2);
  const extraPanel = (g) => `<div class="kcols">${[g.rows.slice(0, half(g)), g.rows.slice(half(g))].map((rs) => `<div class="kcol"><section class="ks">${rs.map((r) => tRow(r)).join('')}</section></div>`).join('')}</div>${g.note ? `<p class="kpad">${g.note}</p>` : ''}`;
  return `<span class="tabs" role="tablist" aria-label="Keys">${tab('keys', two('Keys', 'Sailing'), true)}${extra.map((g) => tab(g.id, g.title, false, cruise && g.id === 'cruise' ? ' lit' : '')).join('')}${tab('hand', two('Mouse, touch', 'Touch'), false)}${tab('pro', two(T.pro.title, 'Pro'), false, pro ? ' lit' : '')}</span>`
    + `<div class="kpage">${panel('keys', `<div class="kcols t2">${cols}</div>${foot}`, true)}${extra.map((g) => panel(g.id, extraPanel(g), false)).join('')}${panel('hand', `<div class="hands">${hands}</div>`, false)}${panel('pro', `<div class="kpro">${proRows}</div>`, false)}</div>`;
}
