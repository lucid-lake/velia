// The panel's float plan (owner, 2026-11-18: "the left side is blank … we need a good, scalable design for the left side card"; the
// pick of renders/panel-scalable option A). On the desktop and tablet panel (mapScreen.js, data-map-card=panel) the voyage line
// becomes a short ledger of rows, one thing a player may change per row, each with its own small mark instead of a label:
//   ⧉ Emerald Bay            the waters: a plain label while there is one lake (owner, 2026-11-20: no chevron, no press, no plate;
//                            WATERS_OPENS brings the Waters plate back when a second lake exists)
//   [⛵ Halcyon] [~ Tessie]  the vessel (owner, 2026-11-20): two buttons in the row's slot, each an icon and a name, the
//                            chosen one lit amber; a press picks at once (no plate). Where feature('playTessie') is off (a phone) Halcyon
//                            alone, a plain label
//   ⌖ Tessie's water ›      the start: the Start plate (a pick selects its pin on the map, like a click on it)
//   ◷ 4 Jul · 15:00 · Fair · 16 kn S ›   the conditions (owner, 2026-11-20: one row for the clock, the weather and the wind; a narrow
//                            panel drops the wind's speed, then its word): the conditions plate (Time of day · Weather · Wind)
// The other rows open the same small glass plate beside the panel (owner, 2026-11-20; the plates' words and
// markup are panelPlates.js): Waters, Boat and Start each their own, the clock and weather rows the top bar's three quick picks (Time of
// day, Weather, Wind: one segmented bar each under a caption, the lit part amber). One plate at a time; it closes on Esc, a press
// outside, a second press on its row, or a pick that completes it (waters, boat, start; the conditions stay for more than one pick). Later rows join by data, never by a new screen: an activity row ("Sail · Kayak")
// when a second activity exists, the lake word growing to "Lake Tahoe · Emerald Bay" when a second region opens.
// The panel's art also lives here: the N3 card's gold compass rose (top right) and its lighthouse coast (bottom left, sized to the
// free gap between the page links and the foot, gone when the gap is short), both behind the glass and clear of the text.
//   const plan = mountPanelPlan({ root, services, chart });  plan.paint(), plan.escTaken(), plan.contains(el), plan.dispose()
// showTessie: () => bool, the Tessie cell on the Boat plate (mapScreen.js passes feature('playTessie').on); onBoat(id): a boat picked.
// deepAt(x, z) → m of water: with Tessie picked the Start plate offers only the pins in DEEP_M or more.
// Tessie picked (owner, 2026-11-20: one way to play, no Swim · Hunt): the boat row reads Tessie, the mode pill goes, Set
// sail reads Dive in (Sail is the mode under her); back to the Halcyon the pill returns with the mode lit before; the pick is
// the service 'vesselPick' ({ get(), set(id), mode() }): the play's swap reads it when the card closes and sets it when T swaps.
// services: 'conditions' (v2/ui/sail.js: { hour(), date(), wind(), level(), setLevel(n), levels, weather: { current(), pick(id), rows },
// time: { rows, current(), pick(id) } }), 'birthplace'. Without 'conditions' the two rows stay hidden.
import { shipClock } from '../../../src/ui/shipClock.js';
import { plateHtml, KIND_OF, PLATES_CSS, SURPRISE_ID } from './panelPlates.js';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass8 = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const ART = '/brand/card/card-art-navy-1.webp';
const ART_MIN_GAP = 64;   // px: under this the lighthouse coast stays away (a short window)
const TIME_NAMES = { golden: 'Golden' };   // the top bar's segment names (topBar.js SEG_NAMES)
export const WATERS_OPENS = false;   // the Waters plate: back when a second lake exists (owner, 2026-11-20)
export const DEEP_M = 10;            // m: the pins Tessie may start from (her behaviours' depth)

const ic = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const MARKS = {
  waters: ic('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  vessel: ic('<path d="M12 3v13M12 4l6 11h-6M11 6L6 15h5"/><path d="M3 18h18l-2 3H6z"/>'),
  tessie: '<svg viewBox="0 0 32 20" aria-hidden="true"><path d="M2 15c3-1 4-6 7-6s3 5 6 5 3-6 6-6c2 0 3 2 3 4M24 12c1-4 1-8 4-9 1.5-.5 2.5.6 2 2"/><path d="M1 17.5h30" stroke-width="1" opacity=".55"/></svg>',   // her small engraved mark (living/tessiePlayer.js MARK)
  place: ic('<circle cx="12" cy="12" r="3"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  time: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  sky: ic('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>'),
};

const P = 'html[data-map-card=panel] #lk-load:not([data-pg])';
const F = `${P} .lk-card .lk-links .lk-foot`;   // the foot: specific enough to beat the front door's own rules (v2/index.html)
const PLAN_CSS = `#lk-load .lk-ledger{display:none}
${P} .lk-row.lk-sum{display:none!important}
${P} .lk-ledger{order:3;display:flex;flex-direction:column;margin:20px 0 0}
${P} .lk-sheet .lk-row.plan{margin-top:20px!important}
${P} .lk-ledger .lr{all:unset;box-sizing:border-box;display:grid;grid-template-columns:22px 1fr auto;align-items:center;column-gap:12px;min-height:40px;padding:0;cursor:pointer;
  border-top:1px solid rgb(var(--ink3) / .14);border-radius:6px;color:var(--navy);font:400 max(1em,15px)/1.2 var(--lk-ui);letter-spacing:.01em}
${P} .lk-ledger .lr:first-child{border-top-color:transparent}
${P} .lk-ledger .lr[hidden]{display:none}
${P} .lk-ledger .lr{pointer-events:auto}
${P} .lk-ledger .lr svg{width:20px;height:20px;margin-left:-2px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;opacity:.78}
${P} .lk-ledger .lr .v{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
${P} .lk-ledger .lr .ch{font-size:20px;line-height:1;opacity:.8;padding-bottom:2px}
${P} .lk-ledger .lr.lbl{cursor:default}
${P} .lk-ledger .lr.lbl:hover{background:none}
/* the vessel row: Halcyon | Tessie, two buttons in the ledger's slot; the chosen one lit amber (decision D), the other outlined */
${P} .lk-ledger .lr.vs{cursor:default;grid-template-columns:1fr 1fr;column-gap:8px;padding:5px 0}
${P} .lk-ledger .lr.vs:hover{background:none}
${P} .lk-ledger .lr.vs .vb{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;min-height:36px;padding:0 10px;cursor:pointer;border:1px solid rgb(var(--ink3) / .42);border-radius:999px;color:var(--navy);font:400 max(1em,15px)/1 var(--lk-ui);letter-spacing:.02em;white-space:nowrap}
${P} .lk-ledger .lr.vs .vb svg{width:20px;height:20px;margin:0;opacity:.9;flex:none}
${P} .lk-ledger .lr.vs .vb[data-vb=tessie] svg{width:26px;height:17px}
${P} .lk-ledger .lr.vs .vb:hover{background:rgb(var(--ink3) / .1)}
${P} .lk-ledger .lr.vs .vb[aria-checked=true]{background:rgb(var(--lk-amber) / .12);border-color:rgb(var(--lk-amber) / .95);color:rgb(var(--lk-amber));font-weight:500}   /* the chosen one lit amber, as Conditions' lit part (the UI audit's decision D: amber for any on/lit choice) */
${P} .lk-ledger .lr.vs .vb:focus-visible{outline:2px solid var(--navy);outline-offset:2px}
html[data-hand=touch] ${P} .lk-ledger .lr.vs .vb{min-height:44px}
${P}[data-vessel-tessie] .lk-sheet .lk-row.plan{display:none!important}   /* Tessie: one way to play, no mode pill (owner, 2026-11-20) */
${P}[data-vessel-tessie][data-state=home] .lk-card .lk-links .lk-go .pq{font-size:0!important}
${P}[data-vessel-tessie][data-state=home] .lk-card .lk-links .lk-go .pq::after{content:'Dive in';font:500 16px/1 var(--lk-ui);letter-spacing:.2em}
${P} .lk-ledger .lr:hover,${P} .lk-ledger .lr[aria-expanded=true]{background:rgb(var(--ink3) / .1)}
${P} .lk-ledger .lr:focus-visible{outline:2px solid var(--navy);outline-offset:-2px}
${P} .lk-card::before,${P} .lk-card::after{content:'';display:block;position:absolute;z-index:0;pointer-events:none;border:0;opacity:0;background:url(${ART}) no-repeat 0 0 / 100% auto;aspect-ratio:880 / 1180;transition:opacity .8s var(--lk-ease)}
${P}[data-art] .lk-card::before{opacity:.22}
${P}[data-art] .lk-card::after{opacity:.66}
${P} .lk-card::before{inset:auto;left:calc(var(--lk-panel) * -.557);top:calc(var(--lk-panel) * -.37);width:calc(var(--lk-panel) * 1.86);-webkit-mask-image:radial-gradient(circle at 81% 20.5%,#000 0 10.5%,rgba(0,0,0,.55) 15%,rgba(0,0,0,.18) 22%,transparent 30%);mask-image:radial-gradient(circle at 81% 20.5%,#000 0 10.5%,rgba(0,0,0,.55) 15%,rgba(0,0,0,.18) 22%,transparent 30%)}
${P} .lk-card::after{inset:auto;left:-3%;bottom:var(--lk-art-b,44px);width:var(--lk-art-w,124%);-webkit-mask-image:radial-gradient(ellipse 46% 26% at 16% 86%,#000 0 50%,transparent 100%);mask-image:radial-gradient(ellipse 46% 26% at 16% 86%,#000 0 50%,transparent 100%)}
${P}[data-art-low] .lk-card::after{display:none}
${P} .lk-card > .lk-sheet,${P} .lk-card > .lk-links{z-index:1}
#lk-load .lk-hero{display:none}
@font-face{font-family:'Velia Script';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/pinyon-script-400.woff2) format('woff2')}
${P} .lk-hero{display:block;order:2;margin:8px 0 0;color:var(--navy)}
/* the header, one type set (owner, 2026-11-24): three faces across the block, the brand's two and the UI's.
   VELIA and the slogan's second line in Jost (the wordmark's face: tracked capitals, so the two caps lines bracket the script), the first
   line in the copperplate script (Pinyon Script, the slogan's pick A, 2026-11-19), the rows under it in Atkinson. "Free · no sign-up" left
   the card. One rhythm: 8 px VELIA to the script, 6 to the wave, 8 to the caps, 20 to the rows (the ledger's own margin) */
${P} .lk-hero .hs1{display:block;font:400 calc(var(--lk-panel) * .102)/1.05 'Velia Script','Snell Roundhand',Georgia,serif;font-style:italic;font-synthesis:none;letter-spacing:.01em;white-space:nowrap}
${P} .lk-hero .hs2{display:block;font:var(--lk-brand) calc(var(--lk-panel) * .039)/1 var(--lk-font);letter-spacing:.3em;text-transform:uppercase;white-space:nowrap;opacity:.9}
${P} .lk-hero .hw{display:block;width:calc(var(--lk-panel) * .45);height:9px;margin:6px 0 8px 2px;fill:none;stroke:var(--brass);stroke-width:1;stroke-linecap:round;opacity:.9;overflow:visible}
${P} .lk-by{display:none!important}
/* the foot (owner, 2026-11-19: "four different design languages, quite messy"): four actions in one quiet system, the extras row's tracked
   type, hairline dividers, no pill, caret or chevron; Support Velia keeps one accent, a small brass dot; the source link carries the GitHub mark
   (14 px, the text's ink), the one icon, so a player knows the link. Order: Support, GitHub, v0.8, About */
${F}{display:flex;align-items:center;justify-content:space-between;gap:0;margin:4px 0 0!important;padding:4px 0 0}   /* spread across the content width like the extras row; --xg (fitArt) is the gap, so each divider sits at its middle */
${F} > *{flex:none;display:flex;align-items:center;justify-content:center;position:relative;min-width:0;margin:0;padding:0;background:none}
${F} .lk-supl,${F} .lk-sup .lk-cup,${F} .lk-news .t i{display:none!important}
${F} .lk-sup,${F} .lk-gh,${F} .lk-ver,${F} .lk-news{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:.5em;min-height:40px;padding:0!important;cursor:pointer;white-space:nowrap;font:400 14px/1 var(--lk-ui,var(--lk-font));letter-spacing:.04em;color:var(--navy);opacity:.86;border-radius:4px}
${F} .lk-news .t{font:inherit;letter-spacing:inherit}
${F} .lk-supc{order:1}
${F} .lk-gh{order:2;gap:.45em}
${F} .lk-gh .lk-ghm{width:14px;height:14px}
${F} .lk-ver{order:3}
${F} .lk-news{order:4}
${F} .lk-ver{font-size:0}
${F} .lk-gh::before,${F} .lk-ver::before,${F} .lk-news::before{content:''!important;position:absolute;left:calc(var(--xg,18px) / -2);top:28%;bottom:28%;width:1px;height:auto;margin:0!important;background:rgb(var(--ink3) / .34)}
${F} .lk-gh,${F} .lk-ver,${F} .lk-news{position:relative}
${F} .lk-ver::after{content:attr(data-short)!important;font:400 14px/1 var(--lk-ui,var(--lk-font));letter-spacing:.04em;font-variant-numeric:tabular-nums}
${F} .lk-sup::before{content:'';flex:none;width:6px;height:6px;border-radius:50%;background:var(--brass)}
${F} .lk-sup:hover,${F} .lk-gh:hover,${F} .lk-ver:hover,${F} .lk-news:hover,${F} .lk-sup:focus-visible,${F} .lk-gh:focus-visible,${F} .lk-ver:focus-visible,${F} .lk-news:focus-visible{opacity:1;background:none;color:var(--navy);text-decoration:underline;text-underline-offset:.3em;text-decoration-thickness:1px}
${F} .lk-sup:focus-visible,${F} .lk-gh:focus-visible,${F} .lk-ver:focus-visible,${F} .lk-news:focus-visible{outline:2px solid var(--navy);outline-offset:1px}
html[data-hand=touch] ${F} .lk-sup,html[data-hand=touch] ${F} .lk-gh,html[data-hand=touch] ${F} .lk-ver,html[data-hand=touch] ${F} .lk-news{min-height:44px}
${P} .lk-links{grid-template-columns:repeat(4,max-content)!important;justify-content:space-between!important;column-gap:0!important;padding:16px 1.5em 1em!important;grid-template-rows:auto auto 1fr!important}
${P} .lk-card .lk-links .lk-link[data-go=chart]{display:none!important}
${P} .lk-card .lk-links .lk-link.lk-tut{display:inline-flex!important}
${P} .lk-card .lk-links .lk-link[data-go=settings]{order:1}
${P} .lk-card .lk-links .lk-link[data-go=settings]::before{content:none!important}
${P} .lk-card .lk-links .lk-link[data-go=keys]{order:2}
${P} .lk-card .lk-links .lk-link.lk-tut{order:3}
${P} .lk-card .lk-links .lk-link[data-go=logbook]{order:4}
${P} .lk-card .lk-links .lk-link[data-go=logbook]::before,${P} .lk-card .lk-links .lk-link[data-go=keys]::before,${P} .lk-card .lk-links .lk-link.lk-tut::before{content:''!important}
${P} .lk-card .lk-links .lk-link:not(.lk-go){font-size:15px!important;letter-spacing:.05em!important;padding-left:0!important;padding-right:0!important;white-space:nowrap;min-height:40px!important;height:40px!important}
${P} .lk-card .lk-links .lk-link:not(.lk-go)::before{left:calc(var(--xg,18px) / -2)!important}
html[data-hand=touch] ${P} .lk-card .lk-links .lk-link:not(.lk-go){min-height:44px!important;height:44px!important}
${P} .lk-card .lk-links .lk-foot{order:9;contain:inline-size}
${P} .lk-card .lk-links .lk-link.lk-go{contain:inline-size}   /* the spanning go button and foot add no width to the four columns */
${P} .lk-card .lk-links .lk-link:not(.lk-go){justify-self:start}
html[data-map-card=panel][data-lk-theme=night] #lk-load:not([data-pg])[data-state=menu] .lk-card{filter:brightness(.86)!important}
${P} .lk-card .lk-links .lk-link.lk-go{display:inline-flex!important;grid-column:1 / -1;order:-1;height:48px;min-height:48px;margin:0 0 20px!important;padding:0 1em!important;border:0!important;border-radius:999px!important;background:var(--navy)!important;color:var(--paper)!important;opacity:1!important;
  font:500 max(1.05em,16px)/1 var(--lk-ui)!important;letter-spacing:.2em!important;text-transform:uppercase;text-shadow:none}
${P} .lk-card .lk-links .lk-link.lk-go::before{content:none!important}
${P} .lk-card .lk-links .lk-link.lk-go{outline:none!important}
${P} .lk-card .lk-links .lk-link.lk-go:hover{background:var(--navy2)!important}
${P}[data-kbd] .lk-card .lk-links .lk-link.lk-go:focus-visible{background:var(--navy2)!important;outline:2px solid var(--navy)!important;outline-offset:3px!important}
${P} .lk-card .lk-links .lk-link.lk-go + .lk-link{padding-left:.4em!important}
${P} .lk-card .lk-links .lk-link.lk-go + .lk-link::before{content:none!important}
${P} .lk-sheet .lk-row.plan .v.picks{padding:3px;box-sizing:border-box;height:auto}
${P} .lk-card .lk-pick{border-radius:999px!important;box-shadow:none!important;border:0!important}
${P} .lk-card .lk-pick[aria-checked=true]{background:rgb(var(--lk-amber) / .12)!important;box-shadow:inset 0 0 0 1px rgb(var(--lk-amber) / .95)!important;color:rgb(var(--lk-amber))!important;font-weight:500}   /* the mode chosen: lit amber, as Conditions' lit part (decision D) */
${P} .lk-card .lk-pick[aria-checked=true]::before{content:none!important}
#lk-load .lk-cond{position:absolute;z-index:5;left:calc(var(--lk-panel-px,330px) + 10px);top:var(--lk-cond-y,200px);width:300px;box-sizing:border-box;padding:12px;display:flex;flex-direction:column;gap:10px;
  background:var(--lk-glass-dense);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);border:1px solid var(--lk-glass-edge);border-radius:14px;box-shadow:0 8px 28px rgb(var(--lk-shade) / .45);
  color:var(--lk-ink);pointer-events:auto;font:400 15px/1 var(--lk-ui);animation:lk-condin .24s cubic-bezier(.2,0,0,1) both}
#lk-load .lk-cond[hidden]{display:none}
@keyframes lk-condin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
#lk-load .lk-cond .seg{display:flex;border:1px solid rgb(var(--lk-cream) / .4);border-radius:10px;overflow:hidden}
#lk-load .lk-cond .seg button{all:unset;box-sizing:border-box;flex:1 1 0;display:flex;align-items:center;justify-content:center;min-height:36px;padding:0 4px;cursor:pointer;font:400 15px/1 var(--lk-ui);color:var(--lk-ink);white-space:nowrap}
#lk-load .lk-cond .seg button + button{border-left:1px solid rgb(var(--lk-cream) / .3)}
#lk-load .lk-cond .seg button:hover{background:rgb(var(--lk-cream) / .1)}
#lk-load .lk-cond .seg button:focus-visible{outline:2px solid rgb(var(--lk-cream));outline-offset:-3px}
#lk-load .lk-cond .seg button[aria-checked=true]{color:rgb(var(--lk-amber));background:rgb(var(--lk-amber) / .12);box-shadow:inset 0 0 0 1px rgb(var(--lk-amber) / .95);font-weight:500}
#lk-load[data-help] .pg[data-page=keys] .tabs{gap:.1em}#lk-load[data-help] .pg[data-page=keys] .tabs .tab{padding:0 .5em;letter-spacing:.02em}   /* five tabs where Tessie is playable: they keep clear of the page's title */
#lk-load .lk-cond .seg button[disabled]{cursor:not-allowed;opacity:.5}
html[data-hand=touch] #lk-load .lk-cond .seg button{min-height:44px}
html[data-hand=touch] ${P} .lk-ledger .lr{min-height:44px}
${P} .lk-card{container:lk-panel / inline-size}
@container lk-panel (max-width:320px){${P} .lk-card .lk-links .lk-link:not(.lk-go){font-size:14px!important;letter-spacing:.02em!important}}   /* the narrowest panel (300 px): the four extras keep one row with air round the ticks */
@media (prefers-reduced-motion:reduce){#lk-load .lk-cond{animation:none}}`;

export function mountPanelPlan({ root, services, chart = null, showTessie = () => false, onBoat = null, deepAt = null, doc = root?.getRootNode?.() ?? globalThis.document } = {}) {
  if (!root) return null;
  if (!doc.getElementById('lk-panelplan-css')) { const s = doc.createElement('style'); s.id = 'lk-panelplan-css'; s.textContent = PLAN_CSS + '\n' + PLATES_CSS; doc.head.appendChild(s); }
  const card = root.querySelector('.lk-card'), plan = root.querySelector('.lk-plan'), sum = root.querySelector('.lk-sum');
  if (!card || !plan) return null;
  const cond = () => services?.get?.('conditions') ?? null;
  const bp = () => services?.get?.('birthplace') ?? null;
  const win = doc.defaultView ?? globalThis;

  // the ledger, before the mode row (the voyage line stays in the DOM for v1's page code and the phone, hidden on the panel)
  const led = doc.createElement('div'); led.className = 'lk-ledger'; led.setAttribute('role', 'group'); led.setAttribute('aria-label', 'Voyage');
  const POP = ' aria-haspopup="true" aria-expanded="false" aria-controls="lk-cond"', IDS = WATERS_OPENS ? ['waters', 'place', 'cond'] : ['place', 'cond'];
  const row = (id, label, extra = '') => `<button class="lr" type="button" data-lr="${id}" aria-label="${label}"${extra}>${MARKS[id === 'cond' ? 'time' : id]}<span class="v"></span><i class="ch" aria-hidden="true">›</i></button>`;
  const label = (id, lab) => `<div class="lr lbl" data-lr="${id}" role="note" aria-label="${lab}">${MARKS[id]}<span class="v"></span><i aria-hidden="true"></i></div>`;   // a plain label (one lake)
  // the vessel: a radio group of two buttons (one tab stop, ← → move, Space or Enter picks); a phone: Halcyon, a plain label
  const vb = (id, name) => `<button type="button" class="vb" role="radio" data-vb="${id}" aria-checked="false" tabindex="-1">${MARKS[id === 'tessie' ? 'tessie' : 'vessel']}<span>${name}</span></button>`;
  const vessel = `<div class="lr vs" data-lr="vessel" role="radiogroup" aria-label="Boat">${vb('halcyon', 'Halcyon')}${vb('tessie', 'Tessie')}</div><div class="lr lbl" data-lr="vessel1" role="note" aria-label="Boat" hidden>${MARKS.vessel}<span class="v"></span><i aria-hidden="true"></i></div>`;
  led.innerHTML = (WATERS_OPENS ? row('waters', 'Waters', POP) : label('waters', 'Waters')) + vessel + row('place', 'Where she starts', POP) + row('cond', 'Conditions', POP);
  plan.insertBefore(led, plan.querySelector('.lk-row.plan'));
  const R = (id) => led.querySelector(`[data-lr=${id}]`);

  // the side plate: one element, rebuilt for the row that opens it (waters · boat · start · conditions)
  const pl = doc.createElement('div'); pl.className = 'lk-cond'; pl.id = 'lk-cond'; pl.hidden = true; pl.setAttribute('role', 'group'); pl.setAttribute('aria-label', 'Conditions');
  root.appendChild(pl);
  let opener = null, boat = 'halcyon', modeBefore = null;   // modeBefore: the mode lit when Tessie was picked (back on the Halcyon)
  const deepOk = (r) => !deepAt || !(Number.isFinite(r.x)) || deepAt(r.x, r.z) >= DEEP_M;
  const LABEL = { waters: 'Waters', boat: 'Boat', start: 'Start', cond: 'Conditions' };
  function buildPlate(k) {
    const c = cond();
    const d = { tessie: !!showTessie?.(), births: (bp()?.list?.() ?? []).filter((r) => !r.locked).map((r) => ({ id: r.id, name: r.name, disabled: boat === 'tessie' && !deepOk(r) })) };
    if (k === 'cond') {
      if (!c) return false;
      d.times = (c.time?.rows ?? []).filter((r) => r.id !== 'fireworks').map((r) => ({ id: r.id, name: TIME_NAMES[r.id] ?? r.name }));
      d.weather = c.weather?.rows ?? [];
      d.levels = (c.levels ?? []).map((l, i) => ({ id: String(i + 1), name: l.name }));
    }
    if (k === 'start' && !d.births.length) return false;
    pl.innerHTML = plateHtml(k, d); pl.dataset.kind = k; pl.setAttribute('aria-label', LABEL[k]);
    return true;
  }
  function paintPlate() {
    if (pl.hidden) return;
    const c = cond(), s = bp();
    const now = { time: c?.time?.current?.() ?? null, weather: c?.weather?.current?.() ?? null, wind: String(c?.level?.() ?? ''), waters: 'emerald', boat, start: s ? (s.current ?? (s.chosen === SURPRISE_ID ? null : s.chosen)) : null };
    for (const b of pl.querySelectorAll('[data-pc]')) { const [k, id] = b.dataset.pc.split(':'); b.setAttribute('aria-checked', String(now[k] === id)); }
  }
  function placePlate() {
    const cr = card.getBoundingClientRect(), rr = (opener ?? R('cond')).getBoundingClientRect(), hr = root.getBoundingClientRect();
    root.style.setProperty('--lk-panel-px', `${Math.round(cr.right - hr.left)}px`);
    const h = pl.offsetHeight || 140, top = Math.max(8, Math.min(rr.top - hr.top - 6, hr.height - h - 8));
    root.style.setProperty('--lk-cond-y', `${Math.round(top)}px`);
  }
  function openPlate(btn) {
    const k = KIND_OF[btn.dataset.lr];
    if (!pl.hidden && opener === btn) { closePlate(true); return; }
    if (!buildPlate(k)) return;
    opener = btn; pl.hidden = false;
    for (const id of IDS) R(id).setAttribute('aria-expanded', String(R(id) === btn));
    placePlate(); paintPlate();
    const sel = k === 'cond' ? '[data-pc^="time:"]' : '[data-pc]';
    const first = pl.querySelector(`${sel}[aria-checked=true]`) ?? pl.querySelector(`${sel}:not([disabled])`);
    if (btn.matches(':focus-visible')) first?.focus({ preventScroll: true });
  }
  function closePlate(focusBack = false) {
    if (pl.hidden) return false;
    pl.hidden = true;
    for (const id of IDS) R(id).setAttribute('aria-expanded', 'false');
    if (focusBack) opener?.focus({ preventScroll: true });
    opener = null; return true;
  }
  // a pick on the Start plate: the pin is selected like a click on it (at the entrance that picks it and lights it; in play it opens its
  // card), never a start; Surprise me picks one of the other places
  function pickStart(id) {
    const s = bp(); if (!s) return;
    let pid = id;
    if (id === SURPRISE_ID) {
      const ids = s.list().filter((r) => !r.locked && (boat !== 'tessie' || deepOk(r))).map((r) => r.id), lit = s.current ?? s.chosen, pool = ids.filter((i) => i !== lit);   // Tessie: her deep pins only
      const from = pool.length ? pool : ids; pid = from[Math.floor(Date.now() / 1000) % from.length];
    }
    if (!chart?.focus?.(pid)) s.pick(pid);
  }
  pl.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-pc]'); if (!b || b.disabled) return;
    const [k, id] = b.dataset.pc.split(':'), c = cond();
    if (k === 'waters') { closePlate(true); return; }   // Emerald Bay is the one lake (the greyed cell is disabled)
    if (k === 'start') { closePlate(false); pickStart(id); return; }
    if (!c) return;
    if (k === 'time') c.time?.pick?.(id);
    else if (k === 'weather') c.weather?.pick?.(id);
    else if (k === 'wind') c.setLevel?.(+id);
    setTimeout(() => { paintPlate(); paint(); }, 30);
  });

  // the boat picked: Tessie reads Dive in, no mode pill, her deep pins only; the pick is the service 'vesselPick'
  function setBoat(id, { quiet = false } = {}) {
    if (id === 'tessie' && !showTessie?.()) id = 'halcyon';
    boat = id;
    const was = root.hasAttribute('data-vessel-tessie');
    root.toggleAttribute('data-vessel-tessie', boat === 'tessie');
    if (!quiet && boat !== 'tessie' && was && modeBefore && root.dataset.state === 'home') { root.querySelector(`.lk-pick[data-mode=${modeBefore}]:not([aria-checked=true])`)?.click?.(); modeBefore = null; }   // the remembered mode lit again
    if (!quiet && boat === 'tessie' && root.dataset.state === 'home') {
      // Dive in starts Sail as her (Sail selected under the hidden pill, the mode lit before kept for the way back); a shallow pin moves to her water
      if (!was) modeBefore = root.querySelector('.lk-pick[aria-checked=true]')?.dataset.mode ?? null;
      root.querySelector('.lk-pick[data-mode=sail]:not([aria-checked=true])')?.click?.();
      const s = bp(), cur = s?.list?.().find((r) => r.id === (s.current ?? s.chosen));
      if (s && cur && !deepOk(cur)) { const deep = s.list().find((r) => !r.locked && deepOk(r)); if (deep) pickStart(deep.id); }
    }
    paint();
  }
  services?.provide?.('vesselPick', { get: () => boat, set: (id, o) => setBoat(id, o) });
  // Dive in at the entrance: Sail is the mode under her (selected first, then the go button's own press starts it)
  const goBtn = root.querySelector('.lk-links .lk-go');
  goBtn?.addEventListener('click', () => { if (boat === 'tessie' && root.dataset.state === 'home') root.querySelector('.lk-pick[data-mode=sail]:not([aria-checked=true])')?.click?.(); }, true);

  // a row opens (or closes) its plate; the rows carry no page link any more (the waters choice lives in its plate); the vessel's two
  // buttons pick at once (setBoat and onBoat, as the old plate's pick)
  led.addEventListener('click', (e) => {
    const v = e.target.closest?.('button[data-vb]');
    if (v) { e.stopPropagation(); closePlate(); if (v.dataset.vb !== boat) { setBoat(v.dataset.vb); onBoat?.(boat); } return; }
    const b = e.target.closest?.('button[data-lr]'); if (!b) return;
    e.stopPropagation(); openPlate(b);
  });
  led.addEventListener('keydown', (e) => {
    const v = e.target.closest?.('button[data-vb]'); if (!v || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const all = [...led.querySelectorAll('button[data-vb]')], o = all[(all.indexOf(v) + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? all.length - 1 : 1)) % all.length];
    e.preventDefault(); e.stopPropagation(); for (const b of all) b.tabIndex = b === o ? 0 : -1; o.focus({ preventScroll: true });
  });
  // a press anywhere else closes the plate (not the rows that open it)
  const onDown = (e) => { if (pl.hidden) return; if (pl.contains(e.target) || led.contains(e.target)) return; closePlate(); };
  doc.addEventListener('pointerdown', onDown, true);
  win.document?.fonts?.load?.("34px 'Velia Script'", 'The water is real.')?.catch?.(() => {});
  // the Set sail ring is for a keyboard player: any key sets the flag, a press clears it (the first focus on load shows no ring)
  const onKey = () => root.setAttribute('data-kbd', ''), onPtr = () => root.removeAttribute('data-kbd');
  doc.addEventListener('keydown', onKey, true); doc.addEventListener('pointerdown', onPtr, true);

  // the words: the hidden voyage line keeps the waters, vessel and place (home.js paint); the clock and the wind from 'conditions'
  const text = (sel) => sum?.querySelector(sel)?.textContent?.trim() ?? '';
  function paint() {
    const set = (id, v) => { const el = R(id); if (!el) return; el.hidden = !v; const s = el.querySelector('.v'); if (s.textContent !== v) s.textContent = v; };
    set('waters', text('[data-v=waters]'));
    // the vessel: the two buttons where Tessie may be played, the chosen one filled; else Halcyon, a plain label
    { const two = !!showTessie?.(), seg = R('vessel'), one = R('vessel1');
      seg.hidden = !two; one.hidden = two; one.querySelector('.v').textContent = text('[data-v=vessel]') || 'Halcyon';
      for (const b of seg.querySelectorAll('[data-vb]')) { const on = b.dataset.vb === boat; b.setAttribute('aria-checked', String(on)); if (doc.activeElement?.parentNode !== seg) b.tabIndex = on ? 0 : -1; } }
    const place = text('[data-v=place]') || bp()?.name?.() || '';
    set('place', place);
    const c = cond();
    const clock = c ? shipClock({ hour: c.hour?.(), date: c.date?.() }) : null;
    // the one conditions row: the clock, the weather and the wind; a narrow panel drops the wind's speed, then its word
    const w = c?.wind?.(), sky = c ? (c.weather?.rows ?? []).find((r) => r.id === c.weather?.current?.())?.name ?? '' : '';
    const kn = w && Number.isFinite(w.kn) ? `${Math.round(w.kn)} kn` : '', dir = w && Number.isFinite(w.fromDeg) ? compass8(w.fromDeg) : '';
    const tries = [[clock?.full, sky, [kn, dir].filter(Boolean).join(' ')], [clock?.full, sky, dir], [clock?.full, sky]].map((a) => a.filter(Boolean).join(' · '));
    const el = R('cond'), v = el.querySelector('.v');
    set('cond', tries[0]);
    for (const t of tries) { if (v.textContent !== t) v.textContent = t; if (!(v.scrollWidth > v.clientWidth + 1)) break; }
    el.setAttribute('aria-label', `Conditions: ${[clock?.label, sky, [kn, dir].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`);
    if (boat === 'tessie' && root.dataset.state === 'home') goBtn?.setAttribute('aria-label', 'Dive in');
    R('place').setAttribute('aria-label', `Where she starts: ${place}`);
    paintPlate();
  }
  // the art: the coast fills the free gap between the links and the foot (gone when it is short); the rose is always in its corner
  function fitArt() {
    const links = root.querySelector('.lk-links'), foot = root.querySelector('.lk-foot');
    const lastLink = [...(links?.querySelectorAll(':scope > .lk-link') ?? [])].pop();
    if (!lastLink || !foot) return;
    const cr = card.getBoundingClientRect(), gap = foot.getBoundingClientRect().top - lastLink.getBoundingClientRect().bottom - 8;
    const foot0 = cr.bottom - foot.getBoundingClientRect().top;
    root.toggleAttribute('data-art-low', gap < ART_MIN_GAP);
    // the coast is the art's lower third: its width sets its height (1180/880 × 0.34 of it is the coast); never taller than the gap
    const w = Math.max(cr.width * 0.72, Math.min(cr.width * 1.6, gap / (1180 / 880 * 0.34)));
    root.style.setProperty('--lk-art-w', `${Math.round(w)}px`); root.style.setProperty('--lk-art-b', `${Math.round(foot0 + 2)}px`);
    root.setAttribute('data-art', '');
    // the gap between the items of a spread row, so each divider sits in the middle of its gap (extras row and foot)
    const spread = (el, items) => {
      const live = items.filter((i) => i.getClientRects().length); if (!el || live.length < 2) return;
      const cs = win.getComputedStyle(el), inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const xg = Math.max(8, (inner - live.reduce((a, i) => a + i.getBoundingClientRect().width, 0)) / (live.length - 1));
      el.style.setProperty('--xg', `${xg.toFixed(1)}px`);
    };
    spread(links, [...(links?.querySelectorAll(':scope > .lk-link:not(.lk-go)') ?? [])]);
    spread(foot, [...foot.children]);
  }
  const mo = win.MutationObserver && sum ? new win.MutationObserver(paint) : null;
  mo?.observe(sum, { subtree: true, childList: true, characterData: true });
  const ro = win.ResizeObserver ? new win.ResizeObserver(() => { fitArt(); if (!pl.hidden) placePlate(); }) : null;
  ro?.observe(card); { const ln = root.querySelector('.lk-links'); if (ln) ro?.observe(ln); }
  const offPick = bp()?.on?.('pick', paint) ?? null, offMoved = bp()?.on?.('moved', paint) ?? null;
  // the clock reads live in the menu (once a second while the panel shows)
  const tick = win.setInterval?.(() => { const s = root.dataset.state; if (s === 'home' || s === 'menu') { paint(); fitArt(); } else closePlate(); }, 1000);   // fitArt too: the panel lays out after it mounts, and the card's own size never changes
  // the keyboard starts on Set sail at the entrance (the panel mounts after the card went live, so home.js's first focus missed it)
  const go = () => root.querySelector('.lk-links .lk-go');
  const focusGo = () => { const g = go(), a = doc.activeElement; if (root.dataset.state !== 'home' || root.dataset.pg || !g || !g.getClientRects().length || g.closest('[inert]')) return; if (!a || a === doc.body || a === doc.documentElement) g.focus({ preventScroll: true }); };
  const so = win.MutationObserver ? new win.MutationObserver(() => win.setTimeout(focusGo, 60)) : null;
  so?.observe(root, { attributes: true, attributeFilter: ['data-state'] });
  win.setTimeout(focusGo, 60);
  paint(); fitArt();
  return {
    el: led, plate: pl, paint, fitArt, get boat() { return boat; }, setBoat,
    escTaken: () => closePlate(true),
    contains: (t) => pl.contains(t),
    dispose() { mo?.disconnect(); so?.disconnect(); ro?.disconnect(); win.clearInterval?.(tick); doc.removeEventListener('pointerdown', onDown, true); doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('pointerdown', onPtr, true); offPick?.(); offMoved?.(); led.remove(); pl.remove(); root.removeAttribute('data-art'); root.removeAttribute('data-art-low'); },
  };
}
