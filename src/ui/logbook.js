// Logbook: a pictorial record of the places and moments found on the bay, and your line on the water (design:
//). Plain DOM + CSS + canvas, no framework, no edits to main.js. Jost, the sail's cream on a navy
// wash over the live world: the same hand as the hints (controlsHint.js) and the opening card (loading.js).
//
//   import { createLogbook, ENTRIES } from './ui/logbook.js';
//   const log = createLogbook({ entries: ENTRIES, chart, storage: localStorage, position: () => ({ x, z, heading }) });
//   log.open(); log.close(); log.toggle();          // L or Escape do the same; the world keeps running behind it
//   await log.record('waterfall', image);           // image: a canvas, an <img>, a data URL or a URL; stored treated
//   await log.record('gust', jpegDataUrl, { treated: true })   // already treat()ed (and encoded) by the caller
//   log.setTrack(points);                           // [{ x, z, v }] today's line, v in m/s; redraws if open
//   log.pin('new', 'waterfall') / log.pin('affordance') / log.pin('sea')   // hold a state for a capture
//   log.page = 'sea'                                // the seamanship page (Tab or a click on its name, while open)
//   log.refreshSeamanship();                        // redraw the seamanship tiles from seamanship.state()
//   log.dispose();
//
// seamanship (optional): { skills: [{ id, name, sil }], challenges: [{ id, name, sil }],
//   state: () => ({ mastered: { id: true }, bests: { id: '6 min 40 s' } }) }: a second page with the same tiles, the
// skills drawn as silhouettes until mastered (no picture: the drawing brightens), the challenges unnamed until done,
// each with its best in the drawing's corner. The only place a time appears.
//
// words ('s words, optional): the words store (ui/words.js createWords); a third page, "sailor's words":
//   the terms the player has met, each with its plain gloss and why it matters; the unmet are not listed ("n of N met").
//
// corners (v2's cups' hunts, optional): { pages: () => [{ id, name, found, of, rows: [{ id, name, clue, foundAt }] }] }:
//   a fourth page, "corners": one view per hunt, its corners as rows (found: the name and the day; unfound: the name and a one-line clue),
//   read afresh each time the page is shown. Absent (v1): no page, nothing changes.
//
// chart: buildChart(terrain) from logbookChart.js ({ shore, island, bounds, places }). storage: null for none.
// The save is localStorage 'lakeshore.logbook.v1'; a full or absent store keeps the entries in memory and drops the
// images first, never the finds.

import { TOKENS, FONT, ensureTokens } from './tokens.js';
import { closeOnOutside } from './cardClose.js';
import { SIGN } from './skipper.js';   // the margin notes' signature
import { clamp } from '../sim/core/math.js';
import { uniqueFaces } from './fontFaces.js';   // one @font-face per family and style (no duplicate font fetches)
const CREAM = TOKENS.cream, NAVY = TOKENS.navy;   // the tokens (src/ui/tokens.css) for the canvas work
const KEY = 'lakeshore.logbook.v1';
const SPEED_FULL = 3.6;          // m/s (7 kn, the boat's hull speed): the brightest the line gets
const TILE_W = 300, TILE_H = 188; // px, the stored image (2× the 1280×720 tile)

// The entries. Places get a sound memory (the audio postcard, replayable from the page); moments do not.
// Trigger rules (what Sail must detect) are; here only what the page needs.
export const ENTRIES = [
  { id: 'island',    kind: 'place',  name: 'the island',        sound: 'wind in the ruin' },
  { id: 'waterfall', kind: 'place',  name: 'the waterfall',     sound: 'the fall' },
  { id: 'house',     kind: 'place',  name: 'the stone house',   sound: 'the creek, a screen door' },
  { id: 'narrows',   kind: 'place',  name: 'the narrows',       sound: 'swell on the rocks' },
  { id: 'harbour',   kind: 'place',  name: 'the harbour',       sound: 'halyards on masts' },
  { id: 'light',     kind: 'place',  name: 'the light',         sound: 'wind on the point' },
  { id: 'ruin',      kind: 'place',  name: 'the ruin',          sound: 'wind in the stones' },
  { id: 'gust',      kind: 'moment', name: 'first gust' },
  { id: 'tack',      kind: 'moment', name: 'first tack' },
  { id: 'round',     kind: 'moment', name: 'round the island' },
  { id: 'sunset',    kind: 'moment', name: 'past sunset' },
  { id: 'milkyway',  kind: 'moment', name: 'the Milky Way' },
  { id: 'anchor',    kind: 'moment', name: 'at anchor' },
  { id: 'aground',   kind: 'moment', name: 'aground' },
  { id: 'sail',      kind: 'moment', name: 'a far sail' },
];
// the July 4th show (S3): an entry only on the show's evening (?fireworks=1 on the highlight day; src/sail/logbook.js)
export const FIREWORKS_ENTRY = Object.freeze({ id: 'fireworks', kind: 'moment', name: 'the Fourth of July show' });
// a kayak bumped (feat/kayaks-lake step 3): a quiet entry, with the kayaks on (the default; src/sail/logbook.js)
export const KAYAK_ENTRY = Object.freeze({ id: 'kayak', kind: 'moment', name: 'a bump with a kayak' });

// The unfound silhouettes: one stroke drawing each, viewBox 0 0 160 100, the pen the cream at low opacity.
export const SIL = {
  island:    'M8 72 H152 M34 72 Q62 40 84 46 Q114 34 134 72 M86 46 V32 H98 V40',
  waterfall: 'M44 14 L36 86 M118 14 L126 86 M74 18 q4 16 0 32 t0 34 M86 18 q-4 16 0 32 t0 34 M56 86 q24 -8 48 0',
  house:     'M10 80 Q80 74 150 80 M46 72 V52 L74 34 L104 52 V72 Z M74 34 V26 M82 72 V60 H90 V72',
  narrows:   'M6 92 Q40 62 64 40 L56 18 M154 92 Q120 62 98 40 L106 18 M62 32 Q80 26 100 32',
  harbour:   'M14 66 Q60 56 116 66 M34 66 V38 M58 66 V30 M82 66 V36 M104 66 V42 M36 40 l10 12 M60 32 l10 14 M84 38 l8 10 M122 66 V52 H146 V66',
  light:     'M4 74 Q58 60 92 64 L156 82 M88 64 V44 H96 V64 M92 44 V40 M104 50 h14 M106 56 h10',
  gust:      'M22 46 q20 -12 40 0 t40 0 t36 0 M30 62 q20 -12 40 0 t40 0 M22 78 q20 -12 40 0 t40 0 t36 0',
  tack:      'M26 84 L62 38 L96 70 L134 18 M126 18 h8 v8',
  round:     'M80 50 m-30 0 a30 30 0 1 1 10 28 M80 50 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M60 80 l-4 -8 M60 80 l8 -2',
  sunset:    'M12 62 H148 M44 62 a36 36 0 0 1 72 0 M64 72 h32 M70 80 h20',
  milkyway:  'M6 84 Q34 70 58 76 Q86 82 110 72 Q132 64 154 74 M26 70 Q58 26 140 12 M42 72 Q76 38 146 28 M56 44 h2 M96 26 h2 M118 42 h2 M76 58 h2 M128 52 h2',
  aground:   'M6 74 Q40 66 80 72 Q120 78 154 70 M30 62 Q44 50 64 52 L104 52 Q120 52 128 62 Z M80 52 V20 M80 28 L106 50 M60 74 L56 88 M100 74 L108 86',
  anchor:    'M80 18 a6 6 0 1 0 0.1 0 M80 30 V82 M58 44 H102 M48 62 Q80 96 112 62 M48 62 l-2 10 M112 62 l2 10',
  ruin:      'M10 80 H150 M52 80 V44 H108 V80 M52 44 L62 34 L72 44 M108 80 V58 M70 62 h12 v10 h-12 Z M86 80 V68 h10 v12',
  sail:      'M8 74 H152 M84 66 V22 L112 62 Z M80 30 L60 62 H80 M68 66 H112 L106 72 H74 Z',
  kayak: 'M8 70 H152 M48 66 Q80 58 112 66 Q80 72 48 66 M78 62 v-14 M70 44 l26 -10 M66 46 l8 -4 M92 36 l8 -4',
  fireworks: 'M8 84 H152 M50 40 l-14 -10 M50 40 l14 -10 M50 40 l-16 6 M50 40 l16 6 M50 40 l-6 -16 M50 40 l6 16 M110 30 l-12 -8 M110 30 l12 -8 M110 30 l-12 8 M110 30 l12 8 M110 30 v-14 M110 30 v14 M50 40 L54 84 M110 30 L106 84',
};

const CSS = `
@font-face{font-family:'Jost';font-style:normal;font-weight:300 500;font-display:swap;src:url(/fonts/jost-latin.woff2) format('woff2')}
@font-face{font-family:'Jost';font-style:italic;font-weight:300 500;font-display:swap;src:url(/fonts/jost-italic-latin.woff2) format('woff2')}
@font-face{font-family:'Velia Sub A';font-style:normal;font-weight:400 700;font-display:swap;src:url(/fonts/sub/fraunces-soft.woff2) format('woff2')}
/* The logbook is a card over a corner of the live world (owner, 2026-10-30): about a third of the width at 1280 x 720, no
   veil, no scroll; the entries in pages of eight (Tab, or the arrows by the page number). A real log's page: navy board,
   cream ink, a double rule round the edge. */
.lk-log{--s:min(0.078125vw,0.138889vh);--c:var(--lk-cream);--ease:var(--lk-ease);
  position:fixed;inset:0;z-index:var(--lk-z-page);pointer-events:none;user-select:none;color:var(--lk-ink);
  font:var(--lk-regular) calc(14*var(--s))/1.35 var(--lk-ui);letter-spacing:var(--lk-track);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.lk-log .card{position:absolute;left:clamp(24px,5vw,84px);bottom:clamp(20px,5vh,64px);width:calc(430*var(--s));box-sizing:border-box;padding:calc(15*var(--s)) calc(18*var(--s)) calc(14*var(--s));
  background:rgb(var(--lk-brand-navy));border-radius:calc(5*var(--s));transform:translateY(var(--lk-rise));
  box-shadow:inset 0 0 0 calc(5*var(--s)) rgb(var(--lk-brand-navy)),inset 0 0 0 calc(6*var(--s)) rgb(var(--c)/.42),0 .1em .3em rgb(var(--lk-shade)/.45),0 1.2em 3em -.6em rgb(var(--lk-shade)/.55);
  opacity:0;transition:opacity var(--lk-out) var(--ease),transform var(--lk-out) var(--ease)}
.lk-log[data-state=open] .card,.lk-log[data-state=opening] .card{opacity:1;transform:none;pointer-events:auto;transition:opacity var(--lk-in) var(--ease),transform var(--lk-in) var(--ease)}
.lk-log .head{display:flex;align-items:baseline;justify-content:space-between;gap:1em;padding-bottom:calc(5*var(--s));border-bottom:1px solid rgb(var(--c)/.4)}
.lk-log .title{font:var(--lk-regular) calc(14*var(--s))/1.3 var(--lk-ui);letter-spacing:.04em;color:var(--lk-ink-soft);white-space:nowrap}
.lk-log .title b,.lk-log .title [data-tab].on{font:500 calc(19*var(--s))/1.3 'Velia Sub A',var(--lk-font);letter-spacing:.01em;color:var(--lk-ink)}
.lk-log .title [data-tab]{cursor:pointer;transition:color .3s}
.lk-log .title [data-tab]:not(.on):hover{color:var(--lk-ink)}
.lk-log .title .dot{margin:0 .45em;color:var(--lk-ink-faint)}
.lk-log .close{all:unset;font-size:calc(13*var(--s));color:var(--lk-ink-soft);display:inline-flex;align-items:center;gap:.45em;cursor:pointer;white-space:nowrap}
.lk-log .close:hover{color:var(--lk-ink)}
.lk-log .close .xx{display:none}
/* a finger (data-hand, src/ui/hand.js; owner 2026-11-15): a round × as the Menu card's, no L cap, no Tab cap */
:root[data-hand=touch] .lk-log .close > span:not(.xx),:root[data-hand=touch] .lk-log .pnav .cap{display:none}
:root[data-hand=touch] .lk-log .close{justify-content:center;width:44px;height:44px;margin:-6px 0 -6px 0;border:1px solid rgb(var(--lk-cream) / .38);border-radius:50%;box-sizing:border-box;color:var(--lk-ink)}
:root[data-hand=touch] .lk-log .close .xx{display:inline;font-size:20px;line-height:1}
.lk-log .cap{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:1.55em;height:1.55em;padding:0 .4em;
  border:var(--lk-line) solid var(--lk-hair);border-radius:var(--lk-radius);font-weight:var(--lk-medium);font-size:calc(12.5*var(--s));letter-spacing:.02em;color:var(--lk-ink)}
.lk-log .pager{display:flex;align-items:center;justify-content:space-between;height:calc(30*var(--s));margin-bottom:calc(4*var(--s))}
.lk-log .plabel{font-size:calc(12*var(--s));font-weight:var(--lk-medium);letter-spacing:.16em;text-transform:uppercase;color:var(--lk-ink-soft)}
.lk-log .plabel i{font-style:normal;letter-spacing:.04em;text-transform:none;font-weight:var(--lk-regular);color:var(--lk-ink-faint);margin-left:.4em}
.lk-log .pnav{display:inline-flex;align-items:center;gap:calc(4*var(--s));font-size:calc(13*var(--s));color:var(--lk-ink-soft)}
.lk-log .pnav[hidden]{display:none}
.lk-log .pv{all:unset;display:inline-flex;align-items:center;justify-content:center;width:calc(24*var(--s));height:calc(24*var(--s));border-radius:50%;border:1px solid rgb(var(--c)/.35);cursor:pointer;font-size:calc(15*var(--s));line-height:1;color:var(--lk-ink)}
.lk-log .pv:hover,.lk-log .pv:focus-visible{background:rgb(var(--c)/.12);border-color:rgb(var(--c)/.8)}
.lk-log .pn{min-width:2.6em;text-align:center}
.lk-log .pnav .cap{margin-right:calc(4*var(--s))}
/* the body: one view at a time, a fixed height so the card does not jump between pages */
.lk-log .body{position:relative;height:calc(256*var(--s))}
.lk-log .view{position:absolute;inset:0;display:none}
.lk-log .view.on{display:block}
.lk-log .grid{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:calc(58*var(--s));gap:calc(8*var(--s)) calc(12*var(--s))}
.lk-log .tile{position:relative;display:grid;grid-template-columns:calc(92*var(--s)) minmax(0,1fr);grid-template-rows:auto 1fr;column-gap:calc(9*var(--s));align-items:start;min-width:0;
  opacity:0;transform:translateY(var(--lk-rise));transition:opacity var(--lk-in) var(--ease) var(--d,0s),transform var(--lk-in) var(--ease) var(--d,0s)}
.lk-log[data-state=open] .tile,.lk-log[data-state=opening] .tile{opacity:1;transform:none}
.lk-log[data-now] .tile{transition:none}
.lk-log .pic{grid-row:1/3;position:relative;width:100%;aspect-ratio:1.6;overflow:hidden;border-radius:calc(2*var(--s));box-sizing:border-box;
  background:rgb(var(--c)/.04);box-shadow:inset 0 0 0 1px rgb(var(--c)/.16)}
.lk-log .pic canvas,.lk-log .pic img,.lk-log .pic svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.lk-log .pic svg{padding:9% 12%;box-sizing:border-box;fill:none;stroke:rgb(var(--c)/.74);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;
  vector-effect:non-scaling-stroke;transition:opacity 1.2s var(--ease)}
.lk-log .pic canvas{opacity:0;transition:opacity 1.2s var(--ease)}
.lk-log .tile[data-found] .pic canvas{opacity:1}
.lk-log .tile[data-found] .pic svg{opacity:0}
.lk-log .tile[data-found] .pic{box-shadow:inset 0 0 0 1px rgb(var(--c)/.34),0 1px 3px rgb(var(--lk-shade)/.4)}
.lk-log .tile[data-new] .pic{box-shadow:inset 0 0 0 2px var(--lk-lit),0 0 10px var(--lk-lit-fill),0 1px 3px rgb(var(--lk-shade)/.4)}
.lk-log .tile.arriving .pic canvas,.lk-log .tile.arriving .pic svg{opacity:.9;transition:none}
.lk-log .name{display:flex;flex-direction:column;align-items:flex-start;gap:calc(2*var(--s));min-width:0;padding-top:calc(1*var(--s));
  font-size:calc(14*var(--s));line-height:1.25;color:var(--lk-ink-faint);transition:color .9s var(--ease) .3s}
.lk-log .name > span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lk-log .tile[data-found] .name{color:var(--lk-ink)}
.lk-log .tile.arriving .name{color:var(--lk-ink);transition:none}
.lk-log .play{all:unset;display:inline-flex;align-items:center;gap:.4em;cursor:pointer;color:var(--lk-ink-soft);font-size:calc(12.5*var(--s));letter-spacing:.06em;
  opacity:0;transition:opacity .3s,color .3s;pointer-events:none}
.lk-log[data-state=open] .tile[data-found] .play,.lk-log[data-state=opening] .tile[data-found] .play{opacity:.85;pointer-events:auto}   /* a closed book's invisible buttons took the taps meant for the chart (found 2026-10-30) */
.lk-log .tile[data-found]:hover .play,.lk-log .tile[data-found].playing .play,.lk-log[data-pin=play] .tile[data-found] .play,.lk-log .play:focus-visible{opacity:1}
.lk-log .play:hover{color:var(--lk-lit-ink)}
.lk-log .play svg{width:calc(14*var(--s));height:calc(14*var(--s));fill:none;stroke:currentColor;stroke-width:1.7;overflow:visible}
.lk-log .play .arc{stroke-dasharray:32;stroke-dashoffset:32;transform:rotate(-90deg);transform-origin:50% 50%}
.lk-log .tile.playing .play .arc{animation:lk-log-arc var(--len,8s) linear forwards}
@keyframes lk-log-arc{from{stroke-dashoffset:32}to{stroke-dashoffset:0}}
/* the chart page: the bay with today's line (left), the key to it (right) */
.lk-log .chartv.on{display:flex;flex-direction:column;align-items:center;gap:calc(6*var(--s))}
.lk-log .chart{position:relative;flex:none}
.lk-log .chart canvas{display:block}
.lk-log .legend{display:flex;flex-wrap:wrap;justify-content:center;gap:calc(4*var(--s)) calc(14*var(--s));font-size:calc(12.5*var(--s));line-height:1.3;color:var(--lk-ink-soft)}
.lk-log .legend .foot{display:none}
.lk-log .legend .note{flex:1 0 100%;text-align:center;font-style:italic;color:var(--lk-ink)}   /* the session's plain lines (note(): "Moved to Tessie's water"), newest last */
.lk-log .legend .lg{display:flex;align-items:center;gap:.6em}
.lk-log .legend .lg i{flex:none;display:inline-block;width:1.6em;height:0;border-top:2px solid rgb(var(--c)/.9)}
.lk-log .legend .lg i.y{border-top:1px solid rgb(var(--c)/.3)}
.lk-log .legend .lg i.p{width:.6em;height:.6em;border:1px solid rgb(var(--c)/.7);border-radius:50%;box-sizing:border-box;background:radial-gradient(circle,rgb(var(--c)/.85) 30%,transparent 34%)}
/* the seamanship page: the skipper's pencilled note under a mastered skill */
.lk-log .tile.drawn[data-found] .pic svg{opacity:1;stroke:rgb(var(--c)/.85)}
.lk-log .tile.drawn .name{padding-top:0}
.lk-log .margin{grid-column:2;margin-top:calc(1*var(--s));font-family:var(--lk-font);font-style:italic;font-weight:var(--lk-book);font-size:calc(12.5*var(--s));line-height:1.2;
  color:rgb(var(--c)/.78);opacity:0;white-space:normal;transition:opacity 1.4s var(--ease) .9s;overflow:hidden;display:none;-webkit-line-clamp:1;-webkit-box-orient:vertical}   /* one line; the whole note on hover */
.lk-log .margin .sig{margin-left:.4em;color:rgb(var(--c)/.6)}
.lk-log .tile[data-found] .margin{opacity:1;display:-webkit-box}
.lk-log .pic .best{position:absolute;right:7%;bottom:6%;font-size:calc(12.5*var(--s));font-weight:var(--lk-medium);letter-spacing:.04em;color:var(--lk-ink);opacity:0;transition:opacity .9s var(--ease) .3s}
.lk-log .tile[data-found] .pic .best{opacity:1}
/* the words page: four terms a page */
.lk-log .wl{display:flex;flex-direction:column;gap:calc(10*var(--s))}
.lk-log .w{display:grid;grid-template-columns:calc(116*var(--s)) 1fr;column-gap:calc(12*var(--s));row-gap:calc(1*var(--s));align-items:baseline;
  opacity:0;transform:translateY(var(--lk-rise));transition:opacity var(--lk-in) var(--ease) var(--d,0s),transform var(--lk-in) var(--ease) var(--d,0s)}
.lk-log[data-state=open] .w,.lk-log[data-state=opening] .w{opacity:1;transform:none}
.lk-log[data-now] .w{transition:none}
.lk-log .w .t{font-weight:var(--lk-medium);color:var(--lk-ink);font-size:calc(14*var(--s))}
.lk-log .w .g{color:var(--lk-ink-soft);font-size:calc(14*var(--s))}
.lk-log .w .y{grid-column:2;color:var(--lk-ink-faint);font-size:calc(12.5*var(--s));overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lk-log .corners .w{grid-template-columns:calc(196*var(--s)) 1fr}.lk-log .corners .w:not(.got) .t{color:var(--lk-ink-soft)}
.lk-log .none{color:var(--lk-ink-soft);font-size:calc(14*var(--s));padding-top:calc(8*var(--s))}
  opacity:0;transform:translateY(var(--lk-rise));transition:opacity var(--lk-out) var(--lk-ease-out),transform var(--lk-out) var(--lk-ease-out)}
:where(:root[data-f-finger-targets=on]) .lk-log .pv{width:36px;height:36px}:where(:root[data-f-finger-targets=on]) .lk-log .play{opacity:.85}
/* the phone: a bottom card, at most the lower half of the screen */
:where(:root[data-screen~=narrow]) .lk-log{--s:1px}
  :where(:root[data-screen~=narrow]) .lk-log .card{left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));width:auto;max-width:440px;margin:0 auto;padding:13px 14px 12px}
  :where(:root[data-screen~=narrow]) .lk-log .title{font-size:12.5px}
  :where(:root[data-screen~=narrow]) .lk-log .title b,:where(:root[data-screen~=narrow]) .lk-log .title [data-tab].on{font-size:17px}
  :where(:root[data-screen~=narrow]) .lk-log .close span:last-child{display:none}
  :where(:root[data-screen~=narrow]) .lk-log .pnav .cap{display:none}
  :where(:root[data-screen~=narrow]) .lk-log .body{height:236px}
  :where(:root[data-screen~=narrow]) .lk-log .grid{grid-auto-rows:53px;gap:8px 10px}
  :where(:root[data-screen~=narrow]) .lk-log .tile{grid-template-columns:72px minmax(0,1fr);column-gap:7px}
  :where(:root[data-screen~=narrow]) .lk-log .name{font-size:13px}
  :where(:root[data-screen~=narrow]) .lk-log .w{grid-template-columns:96px 1fr}
@media (prefers-reduced-motion:reduce){.lk-log .tile,.lk-log .card{transform:none}}
`;

// The shore ring runs off the chart's frame where the open lake leaves it (the east): its closing chord (6.9 km on the
// real map) drew a hairline across the bay. Close the water along the frame instead, the short way round its corners,
// and never stroke a frame-edge run. Pure: tests/logbook.test.mjs.
export const FRAME_GAP_M = 400;
export function closeOnFrame(pts, B, eps = 30) {
  if (!pts?.length) return pts;
  const a = pts.at(-1), b = pts[0];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < FRAME_GAP_M) return pts;
  // the perimeter position (0 … P) of a point on the frame, clockwise from the top-left corner
  const W = B.x1 - B.x0, H = B.z1 - B.z0, P = 2 * (W + H);
  const pos = ([x, z]) => (Math.abs(z - B.z0) < eps ? x - B.x0 : Math.abs(x - B.x1) < eps ? W + z - B.z0 : Math.abs(z - B.z1) < eps ? W + H + B.x1 - x : Math.abs(x - B.x0) < eps ? 2 * W + H + B.z1 - z : null);
  const pa = pos(a), pb = pos(b);
  if (pa == null || pb == null) return pts;
  const corners = [[W, [B.x1, B.z0]], [W + H, [B.x1, B.z1]], [2 * W + H, [B.x0, B.z1]], [P, [B.x0, B.z0]]];
  const fwd = ((pb - pa) % P + P) % P, out = [];
  if (fwd <= P / 2) { for (let k = 0; k < 8; k++) { const [c, xy] = corners[k % 4], cc = c + (k >= 4 ? P : 0); if (cc > pa && cc < pa + fwd) out.push(xy); } }
  else { for (let k = 7; k >= 0; k--) { const [c, xy] = corners[k % 4], cc = c - (k < 4 ? P : 0); if (cc < pa && cc > pa - (P - fwd)) out.push(xy); } }
  return [...pts, ...out];
}
export const treatParams = { cream: CREAM, navy: NAVY, speedFull: SPEED_FULL, tile: [TILE_W, TILE_H] };
const PLAY_SVG = `<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" opacity=".55"/><circle class="arc" cx="7" cy="7" r="5"/><circle cx="7" cy="7" r="1.4" fill="currentColor" stroke="none"/></svg>`;

// --- the image treatment: a wash, not a screenshot ------------------------------------------------------------
// Downsample the frame to the tile, keep its light and its colour at 60 %, lift the blacks toward the navy, draw its
// edges in a soft ink, a quiet vignette, and a touch of grain. Deterministic (no Math.random()).
export function treat(src, opts) {
  const it = treatSteps(src, opts); let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
// The same treatment in slices (a generator: each next() is one slice of ≈ 1–4 ms on a 300 × 188 tile), so a caller
// can run it across tasks and never hold a frame. The result is the same canvas, pixel for pixel, as treat().
// rawMean: the source crop's mean luminance (0–255), set on the canvas (a black grab reads ≈ 0).
// In a worker (no document) it draws on an OffscreenCanvas.
export function* treatSteps(src, { w = TILE_W, h = TILE_H, bands = 4 } = {}) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(w, h); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  const sw = src.naturalWidth ?? src.videoWidth ?? src.width, sh = src.naturalHeight ?? src.videoHeight ?? src.height;
  const k = Math.max(w / sw, h / sh), cw = w / k, ch = h / k;   // a centre crop at the tile's aspect
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), d = im.data, N = w * h;
  { let m = 0, n = 0; for (let i = 0; i < d.length; i += 32) { m += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; } c.rawMean = m / n; }
  yield 'read';
  // a wet wash: soften the fine detail first (a 5-tap blur, twice), so the ink follows shapes, not glitter
  const blur = (src, dst) => {
    const tmp = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x, l = Math.max(0, x - 1), r = Math.min(w - 1, x + 1), l2 = Math.max(0, x - 2), r2 = Math.min(w - 1, x + 2); tmp[p] = (src[y * w + l2] + 4 * src[y * w + l] + 6 * src[p] + 4 * src[y * w + r] + src[y * w + r2]) / 16; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x, u = Math.max(0, y - 1), v = Math.min(h - 1, y + 1), u2 = Math.max(0, y - 2), v2 = Math.min(h - 1, y + 2); dst[p] = (tmp[u2 * w + x] + 4 * tmp[u * w + x] + 6 * tmp[p] + 4 * tmp[v * w + x] + tmp[v2 * w + x]) / 16; }
  };
  const rgb = [];
  for (let ch = 0; ch < 3; ch++) { const a = new Float32Array(N); for (let p = 0; p < N; p++) a[p] = d[p * 4 + ch] / 255; const b = new Float32Array(N); blur(a, b); blur(b, a); rgb.push(a); yield 'blur'; }
  const lum = new Float32Array(N);
  for (let p = 0; p < N; p++) lum[p] = 0.2126 * rgb[0][p] + 0.7152 * rgb[1][p] + 0.0722 * rgb[2][p];
  const edge = new Float32Array(N);   // Sobel on the softened luminance
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const gx = (lum[p - w + 1] + 2 * lum[p + 1] + lum[p + w + 1]) - (lum[p - w - 1] + 2 * lum[p - 1] + lum[p + w - 1]);
    const gy = (lum[p + w - 1] + 2 * lum[p + w] + lum[p + w + 1]) - (lum[p - w - 1] + 2 * lum[p - w] + lum[p - w + 1]);
    edge[p] = Math.hypot(gx, gy);
  }
  yield 'edge';
  const cream = CREAM.map((v) => v / 255), navy = NAVY.map((v) => v / 255);
  for (let band = 0; band < bands; band++) {
  const y0 = Math.floor(band * h / bands), y1 = Math.floor((band + 1) * h / bands);
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * 4, L = lum[p];
    // the wash: the softened colour at 70 %, the tones pooled into a few steps (a watercolour's flat passes),
    // then a pull toward paper and navy by the light: cream in the lights, navy in the shadows
    const Lq = Math.round(L * 7) / 7, Lw = L + (Lq - L) * 0.3;
    let r = rgb[0][p], gg = rgb[1][p], b = rgb[2][p];
    r = Lw + (r - L) * 0.7; gg = Lw + (gg - L) * 0.7; b = Lw + (b - L) * 0.7;
    const tone = Math.pow(clamp(Lw, 0, 1), 0.9), duo = 0.34;
    r = r * (1 - duo) + (navy[0] + (cream[0] - navy[0]) * tone) * duo;
    gg = gg * (1 - duo) + (navy[1] + (cream[1] - navy[1]) * tone) * duo;
    b = b * (1 - duo) + (navy[2] + (cream[2] - navy[2]) * tone) * duo;
    const lift = 0.08, gain = 0.93; r = lift + r * gain; gg = lift + gg * gain; b = lift + b * gain;
    // the ink: edges of the shapes darken toward the navy, soft
    const ek = clamp((edge[p] - 0.05) / 0.3, 0, 1), ink = ek * ek * (3 - 2 * ek) * 0.45;
    r = r * (1 - ink) + navy[0] * ink; gg = gg * (1 - ink) + navy[1] * ink; b = b * (1 - ink) + navy[2] * ink;
    // the vignette, into the page's navy
    const nx = (x / w - 0.5) * 2, ny = (y / h - 0.5) * 2, rr = Math.hypot(nx * 0.9, ny);
    const vt = clamp((rr - 0.62) / 0.6, 0, 1), vig = vt * vt * (3 - 2 * vt) * 0.6;
    r = r * (1 - vig) + navy[0] * vig; gg = gg * (1 - vig) + navy[1] * vig; b = b * (1 - vig) + navy[2] * vig;
    // grain: a hash, ±3 levels
    let hsh = (x * 374761393 + y * 668265263) | 0; hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177); const n = (((hsh ^ (hsh >>> 16)) >>> 0) / 4294967296 - 0.5) * (6 / 255);
    d[i] = clamp((r + n) * 255, 0, 255); d[i + 1] = clamp((gg + n) * 255, 0, 255); d[i + 2] = clamp((b + n) * 255, 0, 255);
  }
  yield 'wash';
  }
  g.putImageData(im, 0, 0);
  return c;
}

const loadImage = (src) => new Promise((res, rej) => {
  if (src instanceof HTMLCanvasElement || src instanceof HTMLImageElement && src.complete && src.naturalWidth) return res(src);
  const im = new Image(); im.decoding = 'async';
  if (!(typeof src === 'string') && !src.startsWith?.('data:')) im.crossOrigin = 'anonymous';
  im.onload = () => res(im); im.onerror = () => rej(new Error(`logbook: image failed ${String(src).slice(0, 48)}`));
  im.src = typeof src === 'string' ? src : src.src;
});

export function createLogbook({
  entries = ENTRIES, chart = null, storage = globalThis.localStorage, root = document.body, position = () => null,
  onPlay = null, onOpen = null, onClose = null, onFind = null, once = true, now = false, seamanship = null, words = null, corners = null,
  key = true,   // false (v2): no L key; Menu › Logbook and the wind dial open it
} = {}) {
  ensureTokens();
  if (!document.getElementById('lk-log-css')) { const st = document.createElement('style'); st.id = 'lk-log-css'; st.textContent = uniqueFaces(CSS); document.head.appendChild(st); }
  const rm = matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);

  // ---- the save ----
  let save = { v: 1, entries: {}, lastTrack: null, seen: false };
  try { const raw = storage?.getItem(KEY); if (raw) { const j = JSON.parse(raw); if (j && j.v === 1 && j.entries) save = { ...save, ...j }; } } catch { /* a corrupt or absent store: start clean */ }
  let memoryOnly = false;
  function persist() {
    if (!storage || memoryOnly) return;
    try { storage.setItem(KEY, JSON.stringify(save)); return; } catch { /* full, or private mode */ }
    try {   // drop the images, keep the finds
      const lean = { ...save, entries: Object.fromEntries(Object.entries(save.entries).map(([k, v]) => [k, { ...v, image: null }])) };
      storage.setItem(KEY, JSON.stringify(lean));
    } catch { memoryOnly = true; }
  }

  // ---- DOM: a card; the entries in views of eight, one view shown (no scroll, owner 2026-10-30) ----
  const PER = 8, WORDS_PER = 4;
  const el = document.createElement('div'); el.className = 'lk-log'; el.dataset.state = 'closed'; root.appendChild(el);
  el.innerHTML = `<div class="card" role="dialog" aria-label="Logbook">
    <div class="head"><span class="title">${seamanship || words || corners ? ['<span data-tab="log" class="on">Logbook</span>', seamanship && '<span data-tab="sea">seamanship</span>', words && '<span data-tab="words">sailor’s words</span>', corners && '<span data-tab="corners">corners</span>'].filter(Boolean).join('<span class="dot">·</span>') : '<b>Logbook</b>'}</span><button class="close" type="button" data-close aria-label="close the logbook"><span class="cap">L</span><span>close</span><span class="xx" aria-hidden="true">×</span></button></div>
    <div class="pager"><span class="plabel"></span><span class="pnav"><span class="cap wide">Tab</span><button class="pv" type="button" data-step="-1" aria-label="previous page">‹</button><span class="pn"></span><button class="pv" type="button" data-step="1" aria-label="next page">›</button></span></div>
    <div class="body"></div></div>`;
  const card = el.querySelector('.card'), body = el.querySelector('.body'), plabel = el.querySelector('.plabel'), pnav = el.querySelector('.pnav'), pn = el.querySelector('.pn');
  const views = [];   // { id, tab, el, label: () => html }
  const addView = (id, tab, cls, label) => { const v = document.createElement('div'); v.className = `view ${cls}`; v.dataset.view = id; body.appendChild(v); views.push({ id, tab, el: v, label }); return v; };
  const chunk = (list, n) => { const out = []; for (let k = 0; k < list.length; k += n) out.push(list.slice(k, k + n)); return out.length ? out : [[]]; };
  const tiles = new Map();
  let i = 0;
  const count = (kind) => { const l = entries.filter((x) => x.kind === kind); return `${l.filter((x) => found(x.id)).length} of ${l.length}`; };
  for (const kind of ['place', 'moment']) {
    const pages = chunk(entries.filter((x) => x.kind === kind), PER);
    pages.forEach((list, pi) => {
      const name = kind === 'place' ? 'places' : 'moments';
      const v = addView(pages.length > 1 ? `${name}-${pi + 1}` : name, 'log', 'entries log', () => `${name}<i>${count(kind)}</i>`);
      const grid = document.createElement('div'); grid.className = 'grid'; v.appendChild(grid);
      for (const e of list) {
        const t = document.createElement('div'); t.className = 'tile'; t.dataset.id = e.id; t.style.setProperty('--d', `${0.06 + (i++ % PER) * 0.03}s`);
        t.innerHTML = `<div class="pic"><svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid meet"><path d="${SIL[e.id] ?? SIL.island}"/></svg><canvas width="${TILE_W}" height="${TILE_H}"></canvas></div>
          <div class="name"><span>${e.name}</span>${e.sound ? `<button class="play" type="button" aria-label="listen: ${e.sound}">${PLAY_SVG}<span>listen</span></button>` : ''}</div>`;
        grid.appendChild(t); tiles.set(e.id, t);
        t.querySelector('.play')?.addEventListener('click', (ev) => { ev.stopPropagation(); play(e.id); });
      }
    });
  }
  // the chart page: the bay, today's line and the places; the key beside it
  const chartView = addView('chart', 'log', 'chartv', () => `the bay<i>${todayLine()}</i>`);
  chartView.innerHTML = `<div class="chart"><canvas></canvas></div><div class="legend"><span class="lg"><i></i>today, bright where fast</span><span class="lg"><i class="y"></i>last sail</span><span class="lg"><i class="p"></i>place, filled when found</span><span class="foot"></span><span class="note" hidden></span></div>`;
  const canvas = chartView.querySelector('canvas'), foot = chartView.querySelector('.foot'), noteEl = chartView.querySelector('.note'), legend = chartView.querySelector('.legend');
  // the seamanship page: the skills and the challenges, the same tiles, drawn (no pictures)
  const seaTiles = new Map();
  if (seamanship) {
    let j = 0;
    for (const [label, list] of [['skills', seamanship.skills ?? []], ['challenges', seamanship.challenges ?? []]]) {
      const pages = chunk(list, PER);
      pages.forEach((part, pi) => {
        const from = pi * PER + 1, to = pi * PER + part.length;
        const v = addView(pages.length > 1 ? `${label}-${pi + 1}` : label, 'sea', 'entries sea', () => `${label}<i>${pages.length > 1 ? `${from}–${to} of ${list.length}` : `${list.length}`}</i>`);
        const grid = document.createElement('div'); grid.className = 'grid'; v.appendChild(grid);
        for (const e of part) {
          const t = document.createElement('div'); t.className = 'tile drawn'; t.dataset.id = e.id; t.style.setProperty('--d', `${0.06 + (j++ % PER) * 0.03}s`);
          t.innerHTML = `<div class="pic"><svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid meet"><path d="${e.sil ?? SIL.island}"/></svg>${label === 'challenges' ? '<span class="best"></span>' : ''}</div>
            <div class="name"><span>${e.name}</span></div>${e.note ? `<div class="margin" title="${e.note}"><span class="pencil">${e.note}</span><span class="sig">${SIGN}</span></div>` : ''}`;
          grid.appendChild(t); seaTiles.set(e.id, t);
        }
      });
    }
  }
  // the words page: the terms met so far, in the order met, each with its plain gloss and its why-line; four a page
  function refreshWords() {
    if (!words) return;
    const keep = views.filter((v) => v.tab !== 'words'); for (const v of views.filter((x) => x.tab === 'words')) v.el.remove(); views.length = 0; views.push(...keep);
    const met = words.met().sort((a, b) => (words.metAt(a.id) ?? '').localeCompare(words.metAt(b.id) ?? ''));
    const pages = chunk(met, WORDS_PER), head = () => `sailor’s words<i>${met.length} of ${words.total} met</i>`;
    pages.forEach((list, pi) => {
      const v = addView(`words-${pi + 1}`, 'words', 'entries words', head);
      v.innerHTML = list.length ? `<div class="wl">${list.map((t, k) => { const w = words.gloss(t.id); return `<div class="w" style="--d:${0.06 + k * 0.03}s"><span class="t">${w.term}</span><span class="g">${w.gloss}</span><span class="y">${w.why}</span></div>`; }).join('')}</div>`
        : '<div class="none">words appear here as you meet them on the water</div>';
    });
    if (pageNow === 'words') showView(views.find((v) => v.tab === 'words' && v.id === viewNow) ?? views.find((v) => v.tab === 'words'));
  }
  // the corners page (v2's hunts): one view per hunt, its corners as rows; rebuilt each time it is shown (finds come in while sailing)
  function refreshCorners() {
    if (!corners) return;
    const keep = views.filter((v) => v.tab !== 'corners'); for (const v of views.filter((x) => x.tab === 'corners')) v.el.remove(); views.length = 0; views.push(...keep);
    let list = []; try { list = corners.pages?.() ?? []; } catch { list = []; }
    if (!list.length) list = [{ id: 'none', name: 'corners', found: 0, of: 0, rows: [] }];
    for (const h of list) {
      const v = addView(`corners-${h.id}`, 'corners', 'entries words corners', () => `${h.name}<i>${h.found} of ${h.of} found</i>`);
      v.innerHTML = h.rows.length ? `<div class="wl">${h.rows.map((r, k) => `<div class="w${r.foundAt != null ? ' got' : ''}" style="--d:${0.06 + k * 0.03}s"><span class="t">${r.foundAt != null ? '◆' : '◇'} ${r.name}</span><span class="g">${r.foundAt != null ? (r.foundAt ? `found ${r.foundAt}` : 'found') : r.clue}</span></div>`).join('')}</div>`
        : '<div class="none">corners appear here as you find them</div>';
    }
    if (pageNow === 'corners') showView(views.find((v) => v.tab === 'corners' && v.id === viewNow) ?? views.find((v) => v.tab === 'corners'));
  }
  const pages = ['log', seamanship && 'sea', words && 'words', corners && 'corners'].filter(Boolean);
  for (const tab of el.querySelectorAll('[data-tab]')) tab.addEventListener('click', (ev) => { ev.stopPropagation(); setPage(tab.dataset.tab); });
  for (const b of el.querySelectorAll('[data-step]')) b.addEventListener('click', (ev) => { ev.stopPropagation(); step(+b.dataset.step, true); });
  let pageNow = 'log', viewNow = views[0].id;
  refreshWords();   // the words' views exist from the start, so Tab reaches them
  refreshCorners();
  function showView(v) {
    if (!v) return;
    viewNow = v.id; pageNow = v.tab; el.dataset.page = pageNow; el.dataset.view = v.id;
    for (const o of views) o.el.classList.toggle('on', o === v);
    for (const tab of el.querySelectorAll('[data-tab]')) tab.classList.toggle('on', tab.dataset.tab === pageNow);
    const mine = views.filter((o) => o.tab === pageNow);
    plabel.innerHTML = v.label(); pnav.hidden = views.length < 2; pn.textContent = `${mine.indexOf(v) + 1} / ${mine.length}`;
    if (v === chartViewRec() && (state === 'open' || state === 'opening')) drawChart(1);
  }
  const chartViewRec = () => views.find((o) => o.id === 'chart');
  const viewOf = (t) => views.find((o) => o.el.contains(t));
  function setPage(p) {
    const tab = pages.includes(p) ? p : 'log';
    if (tab === 'sea') refreshSeamanship();
    if (tab === 'words') refreshWords();
    if (tab === 'corners') refreshCorners();
    showView(views.find((v) => v.tab === tab));
  }
  // Tab walks every view in turn (the log's, then seamanship, then the words); the arrows by the number stay in this page
  function step(d, inPage = false) {
    const list = inPage ? views.filter((v) => v.tab === pageNow) : views;
    const k = list.findIndex((v) => v.id === viewNow);
    const next = list[(k + d + list.length) % list.length];
    if (next.tab === 'sea' && pageNow !== 'sea') refreshSeamanship();
    if (next.tab === 'words' && pageNow !== 'words') { refreshWords(); showView(views.find((v) => v.tab === 'words')); return; }
    if (next.tab === 'corners' && pageNow !== 'corners') { refreshCorners(); showView(views.find((v) => v.tab === 'corners')); return; }
    showView(next);
  }
  words?.onChange?.((ev) => { if (ev.type === 'met' && pageNow === 'words' && (state === 'open' || state === 'opening')) refreshWords(); });
  function refreshSeamanship() {
    if (!seamanship) return;
    const st = seamanship.state?.() ?? {}, m = st.mastered ?? {}, b = st.bests ?? {};
    for (const [id, t] of seaTiles) {
      const done = !!m[id] || b[id] != null;
      if (done) t.dataset.found = '1'; else delete t.dataset.found;
      const best = t.querySelector('.best'); if (best) best.textContent = b[id] ?? '';
    }
  }
  el.querySelector('[data-close]').addEventListener('click', () => close());
  card.addEventListener('pointerdown', (ev) => ev.stopPropagation());   // a press on the card is not a press on the water

  // ---- state ----
  let state = 'closed', track = [], openT = 0, raf = 0, pinned = null;
  const found = (id) => !!save.entries[id]?.foundAt;

  // the tiles from the save
  async function paintTile(id, image) {
    const t = tiles.get(id); if (!t) return;
    const c = t.querySelector('canvas');
    if (image) {
      try { const src = await loadImage(image); const tr = treat(src); c.getContext('2d').drawImage(tr, 0, 0); return true; }
      catch { /* the picture is gone: a found tile without one */ }
    }
    // found, no picture: the silhouette in the found ink on the navy
    const g = c.getContext('2d'); g.fillStyle = `rgb(${NAVY.join(' ')} / .55)`; g.fillRect(0, 0, TILE_W, TILE_H);
    return false;
  }
  for (const [id, rec] of Object.entries(save.entries)) if (rec.foundAt && tiles.has(id)) { tiles.get(id).dataset.found = '1'; paintTile(id, rec.image); }

  // ---- the chart ----
  const B = chart?.bounds ?? { x0: -1150, x1: 1150, z0: -2000, z1: 2050 };
  function layoutChart() {
    const aspect = (B.x1 - B.x0) / (B.z1 - B.z0);
    const H = (body.clientHeight || 256) - (legend.offsetHeight || 22) - 6, W = body.clientWidth || 394;   // the bay fits the page above its key
    const cssW = Math.round(Math.min(W, H * aspect)), cssH = Math.round(cssW / aspect);
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    return { cssW, cssH };
  }
  function drawChart(progress = 1) {
    const { cssW, cssH } = layoutChart();
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cssW, cssH);
    const k = cssW / (B.x1 - B.x0), X = (x) => (x - B.x0) * k, Y = (z) => (z - B.z0) * k;
    const cream = (a) => `rgb(${CREAM.join(' ')} / ${a})`;
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (chart) {
      // the water as a breath lighter than the land, the shore a hairline that draws itself on open
      const path = (pts) => { g.beginPath(); pts.forEach((p, j) => (j ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); };
      path(closeOnFrame(chart.shore, B)); g.closePath(); g.fillStyle = `rgb(${NAVY.join(' ')} / .46)`; g.fill();   // the water, a navy pool; the land is the wash
      if (chart.island) { path(chart.island); g.closePath(); g.fillStyle = cream(0.05); g.fill(); }
      const n = Math.max(2, Math.floor(chart.shore.length * clamp(progress * 1.25, 0, 1)));
      // the shore's hairline, broken where the ring runs along or off the frame (no chord across the bay)
      g.beginPath(); chart.shore.slice(0, n).forEach((p, j, a) => (j && Math.hypot(p[0] - a[j - 1][0], p[1] - a[j - 1][1]) < FRAME_GAP_M ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
      g.strokeStyle = cream(0.5); g.lineWidth = 1; g.stroke();
      if (chart.island && progress > 0.5) { path(chart.island); g.closePath(); g.strokeStyle = cream(0.5); g.lineWidth = 1; g.stroke(); }
      // the places: a ring; found, a dot in it
      if (progress > 0.7) for (const [id, p] of Object.entries(chart.places ?? {})) {
        if (!p) continue;
        g.beginPath(); g.arc(X(p.x), Y(p.z), 3.2, 0, Math.PI * 2); g.strokeStyle = cream(found(id) ? 0.7 : 0.3); g.lineWidth = 1; g.stroke();
        if (found(id)) { g.beginPath(); g.arc(X(p.x), Y(p.z), 1.3, 0, Math.PI * 2); g.fillStyle = cream(0.85); g.fill(); }
      }
    }
    // north and the scale: a hairline N at the top right, 500 m bottom left
    g.font = `300 ${10}px ${FONT}`; g.fillStyle = cream(0.38); g.textAlign = 'left'; g.fillText('N', 14, 12);
    g.beginPath(); g.moveTo(8, 30); g.lineTo(8, 10); g.strokeStyle = cream(0.3); g.lineWidth = 1; g.stroke();
    g.beginPath(); g.moveTo(8, 8); g.lineTo(5, 15); g.lineTo(11, 15); g.closePath(); g.fillStyle = cream(0.38); g.fill();
    const bar = 500 * k; g.beginPath(); g.moveTo(cssW - 6 - bar, cssH - 8); g.lineTo(cssW - 6, cssH - 8); g.strokeStyle = cream(0.32); g.lineWidth = 1; g.stroke();
    g.textAlign = 'right'; g.fillStyle = cream(0.32); g.fillText('500 m', cssW - 6, cssH - 12);
    // yesterday's line, faint
    const drawTrack = (pts, bright, frac) => {
      if (!pts || pts.length < 2) return;
      const m = Math.max(2, Math.floor(pts.length * frac));
      if (bright) {   // the glow under the fast stretches
        for (let j = 1; j < m; j++) {
          const f = clamp(((pts[j - 1].v + pts[j].v) / 2) / SPEED_FULL, 0, 1), s = f * f;
          if (s < 0.2) continue;
          g.beginPath(); g.moveTo(X(pts[j - 1].x), Y(pts[j - 1].z)); g.lineTo(X(pts[j].x), Y(pts[j].z));
          g.strokeStyle = cream(0.16 * s); g.lineWidth = 2.2 + 5 * s; g.stroke();
        }
      }
      for (let j = 1; j < m; j++) {
        const f = clamp(((pts[j - 1].v + pts[j].v) / 2) / SPEED_FULL, 0, 1);
        g.beginPath(); g.moveTo(X(pts[j - 1].x), Y(pts[j - 1].z)); g.lineTo(X(pts[j].x), Y(pts[j].z));
        g.strokeStyle = bright ? cream(0.34 + 0.62 * f) : cream(0.14); g.lineWidth = bright ? 0.9 + 1.7 * f : 0.8; g.stroke();
      }
    };
    drawTrack(save.lastTrack?.map(([x, z, v]) => ({ x, z, v })), false, 1);
    drawTrack(track, true, clamp((progress - 0.25) / 0.75, 0, 1));
    // the boat now: the small sloop, bow along its heading
    const pos = position?.() ?? (track.length ? { x: track.at(-1).x, z: track.at(-1).z, heading: null } : null);
    if (pos && progress >= 1) {
      g.save(); g.translate(X(pos.x), Y(pos.z));
      if (pos.heading != null) g.rotate(pos.heading);
      g.fillStyle = cream(0.92); g.strokeStyle = cream(0.92); g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, -5.5); g.lineTo(0, 1.5); g.lineTo(3.8, 1.5); g.closePath(); g.fill();   // the sail
      g.beginPath(); g.moveTo(-3.2, 2.6); g.lineTo(3.8, 2.6); g.lineTo(3.0, 4.2); g.lineTo(-2.4, 4.2); g.closePath(); g.fill();   // the hull
      g.restore();
    }
    // the foot: today's distance, one number
    foot.textContent = todayLine();
  }

  function todayLine() {
    let nm = 0; for (let j = 1; j < track.length; j++) nm += Math.hypot(track[j].x - track[j - 1].x, track[j].z - track[j - 1].z);
    return track.length > 1 ? `today · ${(nm / 1852).toFixed(1)} nm` : 'today';
  }
  // the open motion: the shore draws itself over 0.9 s, the line over the next 1.2 s
  function animateOpen() {
    cancelAnimationFrame(raf);
    if (rm || now) { drawChart(1); return; }
    const t0 = performance.now();
    const step = (t) => { const p = clamp((t - t0) / 2100, 0, 1); drawChart(p); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }

  function open({ now: instant = false } = {}) {
    if (state === 'open' || state === 'opening') return;
    state = 'opening'; el.dataset.state = 'opening'; if (instant) el.dataset.now = '1';
    onOpen?.();
    refreshSeamanship(); if (pageNow === 'words') refreshWords();
    const fresh = [...tiles.values()].find((t) => t.dataset.new);   // a find since the last look: open on its page
    showView((fresh && viewOf(fresh)) ?? views.find((v) => v.id === viewNow) ?? views[0]);
    requestAnimationFrame(() => { if (instant) { drawChart(1); state = 'open'; el.dataset.state = 'open'; return; } animateOpen(); setTimeout(() => { if (state === 'opening') { state = 'open'; el.dataset.state = 'open'; } }, 500); });
  }
  function close() {
    if (state === 'closed' || state === 'closing') return;
    state = 'closing'; el.dataset.state = 'closing'; delete el.dataset.now; cancelAnimationFrame(raf);
    for (const t of tiles.values()) { delete t.dataset.new; t.classList.remove('arriving', 'playing'); }   // seen
    onClose?.();
    setTimeout(() => { if (state === 'closing') { state = 'closed'; el.dataset.state = 'closed'; } }, 500);
  }
  const toggle = () => (state === 'open' || state === 'opening' ? close() : open());

  // ---- a find ----
  // a find is announced to the page's owner (announce), which says it in the subtitle line (src/sail/findLine.js): the logbook draws no notice of its own
  const announce = (id, extra = {}) => { const e = entries.find((x) => x.id === id) ?? entries[0]; onFind?.({ id: e.id, name: e.name, ...extra }); };
  // treated: the image is already treat()'s JPEG data URL (Sail treats it in its own task, off the frame)
  async function record(id, image = null, { hour = null, at = null, quiet = false, treated = false } = {}) {
    const e = entries.find((x) => x.id === id); if (!e) throw new Error(`logbook: no entry "${id}"`);
    if (found(id)) return false;
    let data = null;
    if (treated) data = typeof image === 'string' ? image : null;
    else if (image) {
      try { const src = await loadImage(image); data = treat(src).toDataURL('image/jpeg', 0.8); } catch { data = null; }
    }
    save.entries[id] = { foundAt: new Date().toISOString(), hour, at, image: data };
    const firstFind = !save.seen; save.seen = true;
    persist();
    const t = tiles.get(id);
    if (t) {
      const c = t.querySelector('canvas');
      if (data) { const src = await loadImage(data); c.getContext('2d').drawImage(src, 0, 0); } else await paintTile(id, null);
      t.dataset.found = '1'; t.dataset.new = '1';
    }
    if (state === 'open' || state === 'opening') { drawChart(1); showView(viewOf(t) ?? views.find((v) => v.id === viewNow)); }
    else if (!quiet) announce(id, { first: firstFind && once });
    return true;
  }
  // a plain line in the log (v2: "Moved to Tessie's water"): the session's last three on the chart page's key, newest last
  const lines = [];
  function note(text) {
    const t = String(text ?? '').trim(); if (!t) return false;
    lines.push(t); if (lines.length > 3) lines.shift();
    noteEl.textContent = lines.join(' · '); noteEl.hidden = false;
    if (state === 'open' && viewNow === 'chart') drawChart(1);   // the key grew a row: the bay refits above it
    return true;
  }
  function setTrack(points) {
    track = points ?? [];
    if (state === 'open' && viewNow === 'chart') drawChart(1);
  }
  function endSession() {   // keep today's line as yesterday's, faint, for the next visit
    if (track.length > 1) { const step = Math.max(1, Math.floor(track.length / 400)); save.lastTrack = track.filter((_, j) => j % step === 0).map((p) => [Math.round(p.x), Math.round(p.z), +p.v.toFixed(2)]); persist(); }
  }
  function play(id) {
    const t = tiles.get(id); if (!t || !t.dataset.found) return;
    const on = t.classList.toggle('playing');
    for (const o of tiles.values()) if (o !== t) o.classList.remove('playing');
    if (on) { t.style.setProperty('--len', '8s'); onPlay?.(id); t.addEventListener('animationend', () => t.classList.remove('playing'), { once: true }); }
  }
  function pin(what, id = null) {
    pinned = what;
    if (what === 'new') { open({ now: true }); const t = tiles.get(id); if (t) { t.dataset.found = '1'; t.dataset.new = '1'; t.classList.add('arriving'); showView(viewOf(t)); } drawChart(1); }
    else if (what === 'affordance') announce(id, { hold: true });
    else if (what === 'play') { open({ now: true }); el.dataset.pin = 'play'; const t = tiles.get(id ?? 'waterfall'); t?.classList.add('playing'); }
    else if (what === 'open') open({ now: true });
    else if (what === 'sea') { open({ now: true }); setPage('sea'); }
    else if (what === 'words') { open({ now: true }); setPage('words'); }
  }

  // ---- input: L toggles; Escape and a press outside close (cardClose.js); never consumed ----
  const onKey = (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (key && e.code === 'KeyL') toggle();
    else if (e.code === 'Tab' && views.length > 1 && (state === 'open' || state === 'opening')) { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  };
  addEventListener('keydown', onKey);
  const offOutside = closeOnOutside({ isOpen: () => state === 'open' || state === 'opening', inside: (t) => el.contains(t) && t !== el, close, esc: true });   // cardClose.js: a press outside the card, or Esc, as the home card's pages do
  const onResize = () => { if ((state === 'open' || state === 'opening') && viewNow === 'chart') drawChart(1); };
  addEventListener('resize', onResize);
  addEventListener('pagehide', endSession);

  function dispose() { removeEventListener('keydown', onKey); offOutside(); removeEventListener('resize', onResize); removeEventListener('pagehide', endSession); cancelAnimationFrame(raf); el.remove(); }

  return { open, close, toggle, record, note, get lines() { return [...lines]; }, setTrack, endSession, play, pin, dispose, el, refreshSeamanship, refreshWords,
    get page() { return pageNow; }, set page(p) { setPage(p); },
    get isOpen() { return state === 'open' || state === 'opening'; }, get state() { return state; },
    found: (id) => found(id), get entries() { return entries.map((e) => ({ ...e, ...(save.entries[e.id] ?? { foundAt: null, image: null }) })); }, get memoryOnly() { return memoryOnly; } };
}
