// The panel's side plates (owner, 2026-11-20): all five ledger rows open the same glass plate beside the
// panel, one kind each. This file is the plates' words and markup (pure: strings in, strings out, no DOM); panelPlan.js mounts them.
//   waters   Waters: Emerald Bay (lit) and a greyed "More lakes later" cell (not mounted since 2026-11-20: the waters row is a plain label
//            while there is one lake; panelPlan.js WATERS_OPENS brings it back)
//   (boat    gone,: the vessel row is two buttons, Halcyon | Tessie, panelPlan.js; BOATS and boatsShown stay as the boats' words)
//   start    Start: the birthplaces (names as on the map) and Surprise me; a pick lights its pin and selects it, it never starts the sail
//   cond     Time of day · Weather · Wind: the top bar's quick picks (the one conditions row opens it; owner, 2026-11-20)
// Every group wears a short caption (the segment's own aria-label made visible: no new words).
// THE TESSIE CELL (on): a boat row with `gate: 'playTessie'` is shown only when plateHtml gets { tessie: true };
// panelPlan.js asks its `showTessie()` mount option, and mapScreen.js passes `() => feature('playTessie').on` (src/core/features.js: a
// desktop or a tablet at L0-L2; a phone has no panel at all).

export const KIND_OF = Object.freeze({ waters: 'waters', place: 'start', cond: 'cond' });   // cond: the one conditions row (owner, 2026-11-20: the clock and weather rows merged); the vessel row has no plate since)
export const CAPTIONS = Object.freeze({ waters: 'Waters', boat: 'Boat', start: 'Start', time: 'Time of day', weather: 'Weather', wind: 'Wind' });
const WATERS_CELLS = Object.freeze([
  Object.freeze({ id: 'emerald', name: 'Emerald Bay' }),
  Object.freeze({ id: 'more', name: 'More lakes later', disabled: true }),
]);
export const BOATS = Object.freeze([
  Object.freeze({ id: 'halcyon', name: 'Halcyon 28 ft', line: 'A cruising sloop. Sail her, or hand the helm to the skipper.' }),
  Object.freeze({ id: 'tessie', name: 'Tessie', line: 'The lake’s legend, 19 m of granite. Swim, dive and knock boats over.', gate: 'playTessie' }),
]);
export const SURPRISE_ID = 'random';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const group = (cap, label, cls, inner) => `<div class="grp"><div class="cap" aria-hidden="true">${esc(cap)}</div><div class="${cls}" role="radiogroup" aria-label="${esc(label)}">${inner}</div></div>`;
const cell = (key, name, { line = '', disabled = false } = {}) => `<button type="button" role="radio" data-pc="${esc(key)}" aria-checked="false"${disabled ? ' disabled aria-disabled="true"' : ''}><span class="nm">${esc(name)}</span>${line ? `<span class="ln">${esc(line)}</span>` : ''}</button>`;
const seg = (kind, label, rows) => group(CAPTIONS[kind], label, 'seg', rows.map((r) => `<button type="button" role="radio" data-pc="${kind}:${esc(r.id)}" aria-checked="false">${esc(r.name)}</button>`).join(''));

// the boats shown: the Tessie cell only where `tessie` is on
export const boatsShown = ({ tessie = false } = {}) => BOATS.filter((b) => !b.gate || tessie);

// kind: 'waters' | 'boat' | 'start' | 'cond'; d: { tessie, births: [{ id, name }], times, weather, levels } (the conditions rows as the plan reads them)
export function plateHtml(kind, d = {}) {
  if (kind === 'waters') return group(CAPTIONS.waters, 'Waters', 'cells', WATERS_CELLS.map((w) => cell(`waters:${w.id}`, w.name, { disabled: w.disabled })).join(''));
  if (kind === 'start') {
    const rows = (d.births ?? []).concat([{ id: SURPRISE_ID, name: 'Surprise me' }]);
    return group(CAPTIONS.start, 'Where she starts', 'grid', rows.map((r) => cell(`start:${r.id}`, r.name, { disabled: !!r.disabled })).join(''));   // disabled: a shallow pin while Tessie is picked
  }
  if (kind === 'cond') {
    return (d.times?.length ? seg('time', 'Time of day', d.times) : '') + (d.weather?.length ? seg('weather', 'Weather', d.weather) : '') + (d.levels?.length ? seg('wind', 'Wind', d.levels) : '');
  }
  return '';
}

export const PLATES_CSS = `#lk-load .lk-cond[data-kind=boat],#lk-load .lk-cond[data-kind=start]{width:326px}
#lk-load .lk-cond .grp{display:flex;flex-direction:column;gap:7px}
#lk-load .lk-cond .cap{font:500 11px/1 var(--lk-ui);letter-spacing:.14em;text-transform:uppercase;color:var(--lk-ink);opacity:.62;padding:0 2px}
#lk-load .lk-cond .cells{display:flex;flex-direction:column;gap:8px}
#lk-load .lk-cond .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#lk-load .lk-cond .cells button,#lk-load .lk-cond .grid button{all:unset;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:5px;min-height:40px;padding:9px 12px;cursor:pointer;border:1px solid rgb(var(--lk-cream) / .4);border-radius:10px;color:var(--lk-ink);font:400 15px/1.2 var(--lk-ui)}
#lk-load .lk-cond .grid button{align-items:center;text-align:center;padding:8px 6px;font-size:14px}
#lk-load .lk-cond .cells .ln{font-size:13px;line-height:1.3;opacity:.72}
#lk-load .lk-cond .cells button:hover,#lk-load .lk-cond .grid button:hover{background:rgb(var(--lk-cream) / .1)}
#lk-load .lk-cond .cells button:focus-visible,#lk-load .lk-cond .grid button:focus-visible{outline:2px solid rgb(var(--lk-cream));outline-offset:-3px}
#lk-load .lk-cond .cells button[aria-checked=true],#lk-load .lk-cond .grid button[aria-checked=true]{color:rgb(var(--lk-amber));background:rgb(var(--lk-amber) / .12);box-shadow:inset 0 0 0 1px rgb(var(--lk-amber) / .95)}
#lk-load .lk-cond .cells button[aria-checked=true] .nm,#lk-load .lk-cond .grid button[aria-checked=true] .nm{font-weight:500}
#lk-load .lk-cond .cells button[disabled]{cursor:not-allowed;opacity:.45;background:none}
html[data-hand=touch] #lk-load .lk-cond .cells button,html[data-hand=touch] #lk-load .lk-cond .grid button{min-height:44px}`;
