// Steady hands (owner, 2026-11-17: "If I don't press any key, why doesn't the boat hold my course?"): with no hand on the helm a
// real boat rounds up (weather helm) and wanders in the gusts, the waves and the wind's shifts; nobody steers. Steady hands is a
// quiet helmsman: with no steer input the helm holds the heading she had when the hand let go (v2/sim/boat.js: the pilot assist's
// heading hold, its grip easing in over STEADY.rampS). Not a target and not AUTO: any steer input takes over at once and the hold
// starts again on the new heading; a knockdown gust still lays her over (the player eases or reefs); AUTO and Cruise steer
// themselves. It is the boat's old let-go pilot (B.assists.pilot), now chosen by the player's profile (this module) instead of a
// separate Aids switch:
//   New to it   on (a choice: Setup › Aids › steady hands)
//   I sail      off by default (an experienced sailor feels the boat round up); a choice: Setup › Aids › steady hands
//   I race, Pro off, no choice (the full boat)
// ?pilot=0|1 still pins it for a page (v1's flag). The choice is remembered per profile (a new profile starts at its default).
// Pure rules + a small Setup row (DOM), mounted by ui/front.js; applied each frame by ui/sail.js. v2/tests/steady-hands.test.mjs.
//   steadyOn({ profile, pro, choice, url }) → bool      loadSteady(store) / saveSteady(store, profile, on)
//   mountSteadyRow(root, { settings, store, onChange })  → { row, paint, dispose }
export const STEADY = Object.freeze({ rampS: 1, key: 'lakeshore.v2.steadyHands' });   // rampS: v2/sim/boat.js STEADY_RAMP_S (the test holds them equal)
export const STEADY_DEFAULT = Object.freeze({ new: true, sail: false, race: false });

export function steadyOn({ profile = 'new', pro = false, choice = null, url = null } = {}) {
  if (url === true || url === false) return url;
  if (pro || profile === 'race') return false;
  if (choice && choice.profile === profile && typeof choice.on === 'boolean') return choice.on;
  return STEADY_DEFAULT[profile] ?? STEADY_DEFAULT.new;
}
// ?pilot= as steadyOn's url: true, false or null (absent)
export const steadyUrl = (flags = {}) => (flags.pilot == null ? null : !(flags.pilot === '0' || flags.pilot === false || flags.pilot === 0));

export const pageStore = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
export function loadSteady(store = pageStore()) {
  try { const v = JSON.parse(store?.getItem?.(STEADY.key) ?? 'null'); return v && typeof v.on === 'boolean' && typeof v.profile === 'string' ? v : null; } catch { return null; }
}
let memo;   // the choice as last read or saved (sail.js reads it each frame; a private window: this page keeps it)
export function saveSteady(store = pageStore(), profile = 'new', on = true) {
  memo = { profile, on: !!on };
  try { store?.setItem?.(STEADY.key, JSON.stringify(memo)); } catch { /* private mode: this page only */ }
  return memo;
}
export const steadyChoice = (store = pageStore()) => (memo !== undefined ? memo : (memo = loadSteady(store)));
export const forgetSteady = () => { memo = undefined; };   // tests: read the store again

// Setup › Aids › assists: a "steady hands" switch beside hints, where v1's pilot toggle stood (Setup's tabs never scroll at 844 x 390:
// Sail has no room for a row; v1's row style, homePages.js opt('toggle')); lit for the profile in force; under "I race" disabled and
// off (Pro decides it in play)
export function mountSteadyRow(root, { settings = null, store = pageStore(), onChange = () => {}, doc = globalThis.document } = {}) {
  const v = root?.querySelector?.('#tp-set-aids [data-set="assists"] .v');
  if (!v || v.querySelector('[data-sh]')) return null;
  const btn = doc.createElement('button');
  btn.className = 'opt'; btn.type = 'button'; btn.setAttribute('role', 'switch'); btn.dataset.sh = 'toggle'; btn.textContent = 'steady hands';
  v.insertBefore(btn, v.firstChild);   // first: where the pilot toggle stood (removeRows takes that one off v2's card)
  const profile = () => settings?.get?.('profile') ?? 'new';
  const paint = () => {
    const p = profile(), on = steadyOn({ profile: p, choice: steadyChoice(store) }), locked = p === 'race';
    btn.setAttribute('aria-checked', String(on)); btn.disabled = locked; btn.setAttribute('aria-disabled', String(locked));
  };
  const click = (e) => {
    if (btn.disabled) return;
    e.stopPropagation();
    const p = profile();
    saveSteady(store, p, !steadyOn({ profile: p, choice: steadyChoice(store) }));
    paint(); onChange();
  };
  btn.addEventListener('click', click);
  const off = settings?.on?.((k) => { if (k === 'profile') paint(); }) ?? null;
  paint();
  return { row: btn, btn, paint, dispose() { btn.removeEventListener('click', click); off?.(); btn.remove(); } };
}
