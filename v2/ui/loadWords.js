// The loading page's words and its hold (owner, 2026-11-21: "a flash of the old menu card"; "the user always has text to read";
// on a phone, "add Velia to the Home Screen, or use a computer"). Installed by ui/loading.js, the
// page's first module, on the shell's progress line (#lk-load .lk-prog). The stage caption over the line is the text to read
// (ui/loading.js); the lake facts that ran under it left on 2026-11-24 (owner: nobody had the time to read a second line there) for the
// chart, one a visit (ui/chart/chartFact.js).
//   the advice     a phone (feature loadPhoneAdvice: the device profile's form) gets one plate above the line, from the first line to
//                  the card, never rotated away: Add to Home Screen or a computer (in the Home Screen app: the computer line alone);
//                  it stands at least ADVICE_MIN_MS, so a fast load never flashes it
//   the hold       the shell turns to data-state=home at the first frame, but the card's own layout (the desktop panel on the live
//                  map, the phone's card in its box: ui/chart/mapScreen.js sets data-map-card) arrives with Sail's UI chunk after it.
//                  Until then v1's big home card would paint (the old card's flash on a cold load: 11 s at 12 Mbit/s and 150 ms latency, no cache). While
//                  <html data-lk-hold> is set the card, its credits and the place label stay hidden, the golden still, the brand,
//                  the line, its caption (HOLD_LINE) and the advice stay; the hold lifts when data-map-card is set (or at once with
//                  ?livechart=0, where no map comes), when the shell leaves home (a mode entered, a failure), or after HOLD_MAX_MS
//   const w = installLoadWords({ root, phone, waitMap });   w.release(why), w.dispose(), w.state()
export const FIRST_MS = 900;          // the advice, once the mark has thinned (ui/noReel.js: 150 ms + its 0.6 s fade)
export const ADVICE_MIN_MS = 5000;    // the phone's advice stands this long at least before the card may cover it
export const HOLD_MAX_MS = 20000;     // the hold never outlasts this from the first frame (a map that never comes)
export const HOLD_LINE = 'Unrolling the chart…';
// each 60 characters or fewer a line (two lines at most on a sideways phone)
export const ADVICE = Object.freeze({
  tab: ['Add Velia to your Home Screen.', 'A computer runs it best.'],   // the UI audit (owner, 2026-11-21): short sentences
  app: ['A computer runs Velia best.'],
});
export const adviceLines = ({ standalone = false } = {}) => (standalone ? ADVICE.app : ADVICE.tab);

// when the hold may lift (pure): the map's layout is there (or none will come), the advice has had its time
export function holdDone({ mapSet = false, waitMap = true, adviceAt = null, now = 0, homeAt = null } = {}) {
  if (homeAt != null && now - homeAt >= HOLD_MAX_MS) return true;
  const advised = adviceAt == null || now - adviceAt >= ADVICE_MIN_MS;
  return (mapSet || !waitMap) && advised;
}

const CSS = `#lk-load .lk-prog .lk-psay{width:max-content;max-width:calc(100vw - 32px);box-sizing:border-box;margin-left:auto;margin-right:auto;padding:.2em .75em;border-radius:8px;background:rgb(var(--lk-brand-navy) / .5)}   /* legible over the still's white sail */
#lk-load .lk-padv{position:absolute;left:50%;bottom:calc(100% + clamp(30px,5vh,48px));transform:translateX(-50%);box-sizing:border-box;width:max-content;max-width:calc(100vw - 32px);margin:0;padding:.7em 1.1em;border:1px solid rgb(var(--lk-cream) / .4);border-radius:12px;background:rgb(var(--lk-brand-navy) / .82);text-align:center;font:var(--lk-regular) 16px/1.4 var(--lk-ui);color:var(--lk-ink);opacity:0;transition:opacity .4s var(--lk-ease)}
#lk-load .lk-padv.on{opacity:1}
#lk-load .lk-padv span{display:block}
html[data-lk-hold] #lk-load[data-state=home] .lk-prog{opacity:1}
html[data-lk-hold] #lk-load[data-state=home] .lk-brand{opacity:1}
html[data-lk-hold] #lk-load[data-state=home] .lk-bg{opacity:1!important}
html[data-lk-hold] #lk-load[data-state=home] :is(.lk-card,.lk-osm,.lk-plabel,.lk-tab,.lk-veil){visibility:hidden!important;opacity:0!important;animation:none!important}
@media (prefers-reduced-motion:reduce){#lk-load .lk-padv{transition:none}}`;

export function installLoadWords({ root, phone = false, waitMap = true, standalone = () => false, doc = globalThis.document,
  clock = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t), now: () => performance.now() } } = {}) {
  const prog = root?.querySelector?.('.lk-prog');
  if (!prog || !doc) return null;
  const H = doc.documentElement;
  if (!doc.getElementById('lk-loadwords-css')) { const s = doc.createElement('style'); s.id = 'lk-loadwords-css'; s.textContent = CSS; doc.head.appendChild(s); }
  let adv = null, adviceAt = null, homeAt = null, held = true, done = false;
  const timers = new Set();
  const later = (f, ms) => { const t = clock.set(() => { timers.delete(t); f(); }, ms); timers.add(t); return t; };
  H.dataset.lkHold = '1';

  function showAdvice() {
    if (!phone || done) return;
    adv = doc.createElement('p'); adv.className = 'lk-padv'; adv.setAttribute('role', 'note');
    for (const l of adviceLines({ standalone: !!standalone() })) { const s = doc.createElement('span'); s.textContent = l; adv.appendChild(s); }
    prog.appendChild(adv);
    adviceAt = clock.now();
    later(() => adv?.classList.add('on'), 30);
    later(check, ADVICE_MIN_MS + 50);
  }
  later(showAdvice, FIRST_MS);

  function check() {
    if (!held || done) return;
    const st = root.dataset.state;
    if (st !== 'company' && st !== 'home') { release(st); return; }
    if (st !== 'home') return;
    if (homeAt == null) {
      homeAt = clock.now();
      holdSay();
      if (say) sayMo?.observe(say, { childList: true, characterData: true, subtree: true });   // the card's "Pick a mode" waits for the card
      later(check, HOLD_MAX_MS + 50);
    }
    if (holdDone({ mapSet: !!H.dataset.mapCard, waitMap, adviceAt, now: clock.now(), homeAt })) release('ready');
  }
  function holdSay() { if (held && !done && say && say.textContent !== HOLD_LINE) { say.textContent = HOLD_LINE; say.classList.remove('off'); } }
  function release(why) {
    if (!held) return;
    sayMo?.disconnect();
    held = false; delete H.dataset.lkHold; api.why = why;
    later(dispose, 900);   // the words fade with the line (the shell's .lk-prog transition), then go
  }
  function dispose() {
    if (done) return;
    done = true; held = false; delete H.dataset.lkHold;
    for (const t of timers) clock.clear(t); timers.clear();
    mo?.disconnect(); sayMo?.disconnect(); adv?.remove();
  }
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(check) : null;
  const say = root.querySelector('.lk-psay'), sayMo = typeof MutationObserver === 'function' ? new MutationObserver(holdSay) : null;
  mo?.observe(root, { attributes: true, attributeFilter: ['data-state'] });
  mo?.observe(H, { attributes: true, attributeFilter: ['data-map-card'] });
  const api = { why: null, release, dispose, check, state: () => ({ held, done, advice: adv?.textContent ?? null, adviceAt, homeAt }) };
  return api;
}
