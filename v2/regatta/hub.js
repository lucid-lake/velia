// Regatta's hub (mocks 1 and 4; step A): the menu over the live lake (the box laid behind it, the fleet on their
// lanes), navy and cream frosted glass like the top bar's Conditions sheet, amber only for the one primary button and a chosen
// segment. Left: the eyebrow, the word Regatta, today's hand on one plate (the course outline, the hand in words, In the box ›,
// Another hand ↻), one quiet row to the level (Beginner / Club / Pro presets and the two dials, in the Adjust sheet). Right: the
// course board (the course laid to today's wind, drawn as a committee boat's board: the legs dashed, the marks, the start line, the
// wind arrow), the fleet's chips in their hull colours and the hand's facts. A phone (a short side under 500 px) keeps the two
// columns on one landscape screen with no scroll; an upright phone sees the page turned (ui/landscape.js turns every sheet).
//   const H = createHub({ onGo, onDeal, onAdjust(setup), onLeave });   H.show(model); H.paint(model); H.hide(); H.dispose()
// Research/82 phase 2: under the chosen cup's races its hunt's count ("Chart the Bay 3/8") and Sail the cup › (createHub({ …, onCupSail(cupId) }));
// the hub opens on the cup of the area the boat is in (model.cupNow); a race the device cannot run is still not drawn
//   model = { hand, desc (setup.js describeHand), course (laid), windDeg, setup, fleet: [{ name, sail, hull }], lake, boat }
//   courseSvg(course, { w, h, pad, labels }) → the course board's drawing as an SVG string (pure: v2/tests/regatta-hub.test.mjs)
// Step B (§ 4.3, mocks 2 and 3): the Custom race sheet, a row under the hand ("Custom race ›"). Every dial the
// deal uses, each with its value shown and its picker: the course as cards (the art baked from the course's outline:
// tools/v2-regatta-outlines.mjs → outlines.json), the length and laps, the wind and its shifts, the sky and the time, the rivals and
// their skill, your aids, the start and the pace; the preview (the course, its metres, about how long, the fleet) with Race › (the
// sheet's one amber button) and Deal for me (a quiet text button). The owner's review (2026-11-16, "messy, hard to read"): a solid
// navy sheet over a dim scrim; three sections (Course · Conditions · Fleet & aids), one "Label … Value ›" row per dial, the course as
// one large card; a row opens its picker over the rows; text ≥ 16 px on desktop. A phone: the same sections in one scrolling column.
//   createHub({ …, onCustom(patch), onRaceCustom(), onDealForMe() });   H.custom(open)   model.custom: the hand is the player's Custom race
//   customDials(model) → the sheet's rows (pure: v2/tests/regatta-custom.test.mjs)
// Step C (owner 2026-11-17): the hand's race type on its plate (Match race, Time trial, Pursuit: the plate's eyebrow, its lines and the
// board's facts; a pursuit's start order, "You start 3rd, 14 s after Osprey"); the Emerald Cup's card under the rows (its state, the next
// race, Continue the Cup; a phone: one row); Custom's Race type row (a match race sails one rival, a time trial none, a pursuit its own
// gate: those rows step aside)
//   createHub({ …, onCup() })   model.event, model.pursuit (events.js pursuitOrder), model.trialBest, model.cup (cup.js cupWords)
// Step D (owner 2026-11-17): the course cards baked (cardArt.js, tools/v2-regatta-cards.mjs: a chart on navy, 1× and 2× PNGs) on
// Custom's cards, its Course row, its preview and the hand plate; the board draws today's laid course on the baked chart ground. No
// pop: the hub fades in and out (HUB_OUT_MS), the Custom sheet and its scrim fade and rise in and fade out (CUS_OUT_MS), the race's
// plates fade in after the hub; the veil is a softer left wash with a vignette (the course in the middle, behind the columns' gap)
//   cardImg(courseId, kind) → the baked card's <img> (srcset 1x, 2x)
// The race card (owner 2026-11-20,'s hub: the race card): two parchment cards with navy ink over the lake, one edge and
// one spacing scale; left the cups and their races (a row: name, goal, length and minutes, best and medal), Level, Custom and the Cup in a
// quiet foot; right the selected race's preview (a desktop moves the plate onto the board's card; a phone keeps it left)
// Select, then go (owner 2026-11-20,'s hub: select, then go): a row click or tap SELECTS a place race (the engine lays it
// behind the hub: its start area, marks, gates and lines, the camera gliding to them); a double-click, a double-tap or Enter starts it; the
// right card (name, one line, its marks and gates, the boats) and To the line start the selected race. No dealt hand, no Another hand, no
// fact grid, no Emerald Cup block; Level and Custom race stay as quiet rows (Custom keeps its own sheet)
//   createHub({ …, onSelect(raceId), onRace(raceId) })   model.selected: the race selected (index.js hubModel)
import { markNumbers, ROUND_SYMBOL } from './marks.js';
import { LEVELS, LEVEL_IDS } from '../sim/raceLevels.js';
import { SKILL_IDS, SKILL_LABEL, PRESETS, presetOf, COURSES, LENGTHS, WINDS, SKIES, TIMES, STARTS, PACES, LAPS, RIVALS, WATERS, courseOf, clampCustom, customHand, minutesFor, describeHand, raceKm } from './setup.js';
import { SHIFTS, shiftOf } from './shifts.js';
import { EVENT_IDS, EVENTS, eventOf } from './events.js';
import OUTLINES from './outlines.json' with { type: 'json' };
import { CARDS, BOARD, CARD_SIZES } from './cards.js';   // step D4: the course cards baked at 1× and 2× (tools/v2-regatta-cards.mjs)

const CSS = `
html.v2-rg-hub .lk-hint,html.v2-rg-hub .lk-nav,html.v2-rg-hub .lk-chart,html.v2-rg-hub .lk-cv,html.v2-rg-hub .lk-flat,html.v2-rg-hub .lk-keys,html.v2-rg-hub .lk-edgepair,html.v2-rg-hub .lk-fold,html.v2-rg-hub #rg{visibility:hidden!important}
#rgh{--ink:rgb(var(--lk-cream) / .94);--soft:rgb(var(--lk-cream) / .84);--hair:rgb(var(--lk-cream) / .16);--edge:var(--lk-glass-edge,rgb(var(--lk-cream) / .25));--gap:clamp(10px,1.8vh,16px);
  position:fixed;inset:0;z-index:9;pointer-events:none;color:var(--ink);font:var(--lk-regular,400) 17px/1.3 var(--lk-ui);letter-spacing:var(--lk-track,.04em);
  display:grid;grid-template-columns:minmax(0,470px) minmax(0,1fr) minmax(0,444px);column-gap:24px;align-items:start;
  padding:calc(var(--lk-cap-top,58px) + 10px) var(--lk-mx,40px) var(--lk-my,28px);box-sizing:border-box}
#rgh[hidden]{display:none}
#rgh .veil{position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,rgb(var(--lk-brand-navy) / .86) 0%,rgb(var(--lk-brand-navy) / .66) 34%,rgb(var(--lk-brand-navy) / .18) 60%,rgb(var(--lk-brand-navy) / .1) 72%,rgb(var(--lk-brand-navy) / .42) 100%),radial-gradient(ellipse 70% 80% at 58% 46%,rgb(var(--lk-brand-navy) / 0) 55%,rgb(var(--lk-brand-navy) / .3) 100%),linear-gradient(180deg,rgb(var(--lk-brand-navy) / .3) 0%,rgb(var(--lk-brand-navy) / 0) 18%,rgb(var(--lk-brand-navy) / 0) 82%,rgb(var(--lk-brand-navy) / .28) 100%)}
/* step D1: no pop: the hub fades in over the live lake (the veil 400 ms, the columns rise 240 ms) and out (240 ms) into the race; the Custom
   sheet and its scrim fade and rise in, fade out; the race's own plates fade in after the hub (#rg) */
#rgh{transition:opacity 240ms cubic-bezier(.2,0,0,1)}
#rgh[data-out]{opacity:0;pointer-events:none}
#rgh[data-out] *{pointer-events:none!important}
#rgh:not([hidden]) .veil{animation:rgh-fade 400ms cubic-bezier(.2,0,0,1) both}
@keyframes rgh-fade{from{opacity:0}to{opacity:1}}
#rgh .cus:not([hidden]){animation:rgh-sheet 240ms cubic-bezier(.2,0,0,1) both}
#rgh .cscr:not([hidden]){animation:rgh-fade 240ms cubic-bezier(.2,0,0,1) both}
#rgh .cus[data-out],#rgh .cscr[data-out]{animation:rgh-out 160ms cubic-bezier(.4,0,1,1) both}
#rgh .adj:not([hidden]){animation:rgh-sheet 200ms cubic-bezier(.2,0,0,1) both}
@keyframes rgh-sheet{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes rgh-out{from{opacity:1}to{opacity:0}}
html:not(.v2-rg-hub) #rg{animation:rgh-fade 400ms cubic-bezier(.2,0,0,1) 120ms both}
@media (prefers-reduced-motion:reduce){#rgh .cus:not([hidden]),#rgh .adj:not([hidden]){animation-name:rgh-fade}html:not(.v2-rg-hub) #rg{animation-delay:0ms}}
#rgh .col{grid-column:1;display:flex;flex-direction:column;gap:var(--gap);min-width:0;pointer-events:auto}
#rgh .eb{font-size:15px;font-weight:500;letter-spacing:var(--lk-track-wide,.16em);text-transform:uppercase;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rgh h1{all:unset;display:block;font:var(--lk-brand,500) 44px/1 var(--lk-font);letter-spacing:.01em;margin-top:-4px}
#rgh .pl{background:rgb(var(--lk-brand-navy) / .8);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);border:1px solid var(--edge);border-radius:16px;box-shadow:0 8px 28px rgb(0 0 0 / .32)}
#rgh button{all:unset;box-sizing:border-box;cursor:pointer;-webkit-tap-highlight-color:transparent}
#rgh button:focus-visible{outline:2px solid rgb(var(--lk-cream));outline-offset:2px}
#rgh .go{display:inline-flex;align-items:center;justify-content:center;gap:.4em;height:44px;padding:0 20px;border-radius:22px;font-size:17px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;transition:background-color 120ms,color 120ms}
#rgh .go{background:rgb(var(--lk-amber));color:rgb(var(--lk-brand-navy))}
#rgh .go:hover{background:rgb(var(--lk-amber) / .88)}
#rgh .row:hover{background:rgb(var(--lk-cream) / .1)}
#rgh .row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:12px;padding:8px 10px;margin:0 -10px;border-radius:14px}
#rgh .row .t{font-size:18px;font-weight:500}
#rgh .row .s{grid-row:2;font-size:15px;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rgh .row .ch{grid-row:1 / span 2;grid-column:2;font-size:22px;color:var(--soft)}
#rgh .back{align-self:flex-start;font-size:15px;color:var(--soft);padding:6px 0}
#rgh .back:hover{color:var(--ink)}
#rgh .ci{display:block;width:100%;height:100%;object-fit:cover;border-radius:8px;box-shadow:inset 0 0 0 1px rgb(var(--lk-cream) / .14)}
#rgh .adj{position:absolute;z-index:2;left:var(--lk-mx,40px);top:calc(var(--lk-cap-top,58px) + 10px);width:min(470px,calc(100vw - 2 * var(--lk-mx,40px)));box-sizing:border-box;padding:16px;display:grid;gap:14px;pointer-events:auto;background:rgb(var(--lk-brand-navy) / .94)}
#rgh .adj[hidden]{display:none}
#rgh .adj h2{all:unset;display:flex;justify-content:space-between;align-items:baseline;font:var(--lk-brand,500) 24px/1.1 var(--lk-font)}
#rgh .adj section{display:grid;gap:8px}
#rgh .adj h3{all:unset;display:flex;justify-content:space-between;gap:1em;font-size:15px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--soft)}
#rgh .adj h3 b{font-weight:500;letter-spacing:var(--lk-track,.04em);text-transform:none;color:var(--ink)}
#rgh .seg{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);border-radius:10px;box-shadow:inset 0 0 0 1px rgb(var(--lk-cream) / .26);overflow:hidden}
#rgh .seg button{display:flex;align-items:center;justify-content:center;min-height:40px;padding:0 .4em;font-size:16px;font-weight:500;transition:background-color 120ms,color 120ms}
#rgh .seg button+button{box-shadow:inset 1px 0 0 var(--hair)}
#rgh .seg button:hover{background:rgb(var(--lk-cream) / .1)}
#rgh .seg button[aria-checked=true]{color:rgb(var(--lk-amber));background:rgb(var(--lk-amber) / .12);box-shadow:inset 0 0 0 1px rgb(var(--lk-amber) / .8)}
#rgh .seg button:first-child{border-radius:10px 0 0 10px}#rgh .seg button:last-child{border-radius:0 10px 10px 0}
#rgh .adj .ll[hidden]{display:none}
#rgh .adj .done{justify-self:end;height:40px;padding:0 18px;border-radius:20px;border:1px solid rgb(var(--lk-cream) / .55);font-size:16px;font-weight:500}
#rgh .adj .done:hover{background:rgb(var(--lk-cream) / .1)}
#rgh .col{animation:rgh-in 240ms cubic-bezier(.2,0,0,1) both}
@keyframes rgh-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#rgh .col{animation:none}}
@media (max-width:1100px){#rgh{grid-template-columns:minmax(0,1fr) minmax(0,.9fr);column-gap:20px}}
/* a phone held sideways (844 × 390) and an upright one turned: one landscape screen, two columns, 44 px controls, nothing under 15 px */
:where(:root[data-screen~=tight]) #rgh{--gap:6px;grid-template-columns:minmax(0,1.16fr) minmax(0,1fr);column-gap:16px;padding:calc(var(--lk-cap-top,58px) + 2px) max(16px,var(--lk-sar,0px)) 10px max(16px,var(--lk-sal,0px))}
  :where(:root[data-screen~=tight]) #rgh .eb{font-size:15px;letter-spacing:.12em}
  :where(:root[data-screen~=tight]) #rgh h1{font-size:30px;margin-top:-2px}
  :where(:root[data-screen~=tight]) #rgh .eb .e2{display:none}
  :where(:root[data-screen~=tight]) #rgh .row .s{display:none}
  :where(:root[data-screen~=tight]) #rgh .row .ch{grid-row:1}
  :where(:root[data-screen~=tight]) #rgh .go{height:44px;padding:0 16px;font-size:16px}
  :where(:root[data-screen~=tight]) #rgh .row{padding:4px 10px;min-height:44px}
  :where(:root[data-screen~=tight]) #rgh .row .t{font-size:17px}
  :where(:root[data-screen~=tight]) #rgh .back{display:none}
  :where(:root[data-screen~=tight]) #rgh .adj{left:max(16px,var(--lk-sal,0px));top:calc(var(--lk-cap-top,58px) + 2px);width:min(520px,calc(100vw - 32px));max-height:calc(100dvh - var(--lk-cap-top,58px) - 12px);padding:10px 14px;gap:8px}
  :where(:root[data-screen~=tight]) #rgh .adj h2{font-size:19px;min-height:44px;align-items:center}
  :where(:root[data-screen~=tight]) #rgh .adj section{grid-template-columns:132px minmax(0,1fr);align-items:center;gap:10px}
  :where(:root[data-screen~=tight]) #rgh .adj h3{letter-spacing:.08em}
  :where(:root[data-screen~=tight]) #rgh .adj h3 b{display:none}
  :where(:root[data-screen~=tight]) #rgh .adj .done{position:absolute;right:14px;top:10px;height:44px}
  :where(:root[data-screen~=tight]) #rgh .seg button{min-height:44px}
#rgh .row.cusr .t b{font-weight:500;color:var(--soft)}
  :where(:root[data-screen~=tight]) #rgh .ctab{min-height:44px;padding:4px 10px}
  :where(:root[data-screen~=tight]) #rgh .ctab .cn{font-size:17px}
  :where(:root[data-screen~=tight]) #rgh .cline,:where(:root[data-screen~=tight]) #rgh .rc .rs{display:none}
  :where(:root[data-screen~=tight]) #rgh .rc{min-height:44px;padding:2px 10px}
/*: with the cups on the plate, "Race now" is one compact plate (the hand in words and its two buttons); the Level and Custom rows
   share a line; the Emerald Cup's card is slim. All of it fits 1280 × 720 with no scroll */
:root:not([data-screen~=tight]) #rgh .rr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:12px}
:where(:root:not([data-screen~=tight])) #rgh .rr .row{margin:0;min-width:0}
:where(:root:not([data-screen~=tight])) #rgh .rr .row .t,:where(:root:not([data-screen~=tight])) #rgh .rr .row .s{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-height:760px){:where(:root:not([data-screen~=tight])) #rgh .cline{display:none}}
/* step C: the Emerald Cup's card (desktop) and its row (a phone) */
/* (owner go 2026-11-19): the cups: two plates (Emerald Bay, The Mouth) and the chosen cup's races, each with its best and
   medal; an unavailable race (Tessie's Deep on a phone) is not drawn. Navy glass, cream ink, brass for the numbers and the medals */
#rgh .cups{padding:12px 14px 6px;display:flex;flex-direction:column;gap:8px;--brass:201 162 75}
#rgh .ctabs{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:8px}
#rgh .ctab{display:flex;flex-direction:column;gap:1px;min-height:44px;padding:6px 12px;border-radius:12px;box-shadow:inset 0 0 0 1px rgb(var(--lk-cream) / .22);transition:background-color 120ms}
#rgh .ctab:hover{background:rgb(var(--lk-cream) / .08)}
#rgh .ctab .cn{font:var(--lk-brand,500) 19px/1.15 var(--lk-font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rgh .ctab .cc{font-size:15px;color:var(--soft);white-space:nowrap}
#rgh .ctab[aria-selected=true]{background:rgb(var(--lk-cream) / .1);box-shadow:inset 0 0 0 1px rgb(var(--lk-cream) / .55)}
#rgh .cline{font-size:15px;line-height:1.3;color:var(--soft);margin:0}
#rgh .rlist{display:flex;flex-direction:column}
#rgh .rlist[hidden]{display:none}
#rgh .rc{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;column-gap:12px;min-height:56px;padding:6px 10px;margin:0 -10px;border-radius:14px;border-top:1px solid var(--hair)}
#rgh .rc:first-child{border-top-color:transparent}
#rgh .rc:hover{background:rgb(var(--lk-cream) / .1)}
#rgh .rc .no{grid-row:1 / span 2;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgb(var(--brass) / .9);color:rgb(var(--brass));font-size:16px;font-weight:500}
#rgh .rc .rt{font-size:18px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rgh .rc .rs{grid-column:2;font-size:15px;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rgh .rc .rb{grid-column:3;grid-row:1 / span 2;display:flex;align-items:center;gap:8px;font-size:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
#rgh .rc .rb i{width:11px;height:11px;border-radius:50%;background:rgb(var(--lk-cream) / .25);box-shadow:inset 0 0 0 1px rgb(var(--lk-cream) / .5)}
#rgh .rc .rb i[data-medal=gold]{background:rgb(var(--brass));box-shadow:none}
#rgh .rc .rb i[data-medal=silver]{background:rgb(var(--lk-cream) / .85);box-shadow:none}
#rgh .rc .rb i[data-medal=bronze]{background:rgb(176 121 63);box-shadow:none}
#rgh .rc .rb i[hidden]{display:none}
#rgh .rr{display:contents}
/* Custom race (mock 2; owner review 2026-11-16: "messy, hard to read, crowded"): a solid navy sheet over a dim scrim, the dials in three
   sections (Course · Conditions · Fleet & aids), one "Label … Value ›" row each; a row opens its picker over the rows */
#rgh .cscr{position:absolute;inset:0;z-index:2;pointer-events:auto;background:rgb(var(--lk-brand-navy) / .62);-webkit-backdrop-filter:blur(8px) saturate(.8);backdrop-filter:blur(8px) saturate(.8)}
#rgh .cscr[hidden]{display:none}
#rgh .cus{--mut:rgb(var(--lk-cream) / .8);--val:rgb(var(--lk-cream) / .97);position:absolute;z-index:3;inset:calc(var(--lk-cap-top,58px) + 10px) var(--lk-mx,40px) var(--lk-my,28px);box-sizing:border-box;padding:20px 24px;display:grid;grid-template-columns:minmax(0,1fr) 320px;grid-template-rows:auto minmax(0,1fr);gap:16px 32px;pointer-events:auto;background:rgb(var(--lk-brand-navy) / .97);-webkit-backdrop-filter:blur(18px) saturate(.8);backdrop-filter:blur(18px) saturate(.8);animation:rgh-in 400ms cubic-bezier(.2,0,0,1) both}
#rgh .cus[hidden]{display:none}
#rgh .cus .chd{grid-column:1 / -1;display:flex;align-items:baseline;gap:18px;min-width:0}
#rgh .cus h2{all:unset;font:var(--lk-brand,500) 34px/1 var(--lk-font);letter-spacing:.01em;white-space:nowrap;color:var(--val)}
#rgh .cus .sub{font-size:16px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:0}
#rgh .cus .cback{font-size:16px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);min-height:44px;padding:0 6px;display:inline-flex;align-items:center;white-space:nowrap}
#rgh .cus .cback:hover{color:var(--val)}
#rgh .cus .rows{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 36px;align-content:start;min-width:0;min-height:0}
#rgh .cus .cc{display:flex;flex-direction:column;gap:22px;min-width:0}
#rgh .cus .sec{display:flex;flex-direction:column;min-width:0}
#rgh .cus .sec>h3{all:unset;font-size:16px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);padding-bottom:6px;border-bottom:1px solid rgb(var(--lk-cream) / .22)}
#rgh .cus .r{position:static}
#rgh .cus .r>.val{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;column-gap:14px;width:100%;min-height:46px;box-sizing:border-box;padding:0 4px;border-bottom:1px solid rgb(var(--lk-cream) / .1);transition:background-color 120ms}
#rgh .cus .r>.val:hover{background:rgb(var(--lk-cream) / .07)}
#rgh .cus .r>.val .vl{font-size:17px;color:var(--mut);white-space:nowrap}
#rgh .cus .r>.val .vv{font-size:17px;font-weight:500;color:var(--val);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
#rgh .cus .r>.val .ch{font-size:22px;line-height:1;color:var(--mut)}
#rgh .cus .r[data-row=course]>.val{grid-template-columns:120px minmax(0,1fr) auto;min-height:96px;margin-top:10px;padding:8px 12px 8px 8px;border:1px solid rgb(var(--lk-cream) / .3);border-radius:14px}
#rgh .cus .r[data-row=course]>.val .art{grid-row:1 / span 2;width:120px;height:80px;display:block}
#rgh .cus .r[data-row=course]>.val .art svg,#rgh .cus .r[data-row=course]>.val .art img{width:100%;height:100%;display:block}
#rgh .cus .r[data-row=course]>.val .vv{grid-column:2;text-align:left;font:var(--lk-brand,500) 22px/1.15 var(--lk-font);align-self:end}
#rgh .cus .r[data-row=course]>.val .vf{grid-column:2;font-size:16px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;align-self:start;font-variant-numeric:tabular-nums}
#rgh .cus .r[data-row=course]>.val .ch{grid-column:3;grid-row:1 / span 2}
#rgh .cus .r[data-row=course]>.val .vl{display:none}
/* the picker: over the rows, its title, the options as large segments (the course as cards), Done */
#rgh .cus .r>.pk{display:none}
#rgh .cus .r.open>.pk{display:flex;position:absolute;z-index:5;inset:0;box-sizing:border-box;padding:14px 18px;flex-direction:column;gap:14px;background:rgb(var(--lk-brand-navy));border-radius:14px;box-shadow:inset 0 0 0 1px var(--edge),0 10px 32px rgb(0 0 0 / .45);overflow-y:auto}
#rgh .cus .pt{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:44px;font:var(--lk-brand,500) 24px/1 var(--lk-font);color:var(--val)}
#rgh .cus .pick-x{display:inline-flex;align-items:center;height:44px;padding:0 20px;border-radius:22px;border:1px solid rgb(var(--lk-cream) / .55);font:500 17px/1 var(--lk-ui);letter-spacing:.06em;color:var(--val)}
#rgh .cus .pick-x:hover{background:rgb(var(--lk-cream) / .1)}
#rgh .cus .opts{display:flex;flex-wrap:wrap;gap:10px}
#rgh .cus .opts button{display:inline-flex;align-items:center;justify-content:center;min-height:52px;min-width:64px;padding:0 20px;border-radius:12px;box-shadow:inset 0 0 0 1px rgb(var(--lk-cream) / .3);font-size:18px;font-weight:500;color:var(--val);white-space:nowrap;transition:background-color 120ms}
#rgh .cus .opts button:hover{background:rgb(var(--lk-cream) / .1)}
#rgh .cus .opts button[aria-checked=true]{color:rgb(var(--lk-amber));background:rgb(var(--lk-amber) / .12);box-shadow:inset 0 0 0 1px rgb(var(--lk-amber) / .85)}
#rgh .cus .cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
#rgh .cus .card{display:grid;grid-template-columns:120px minmax(0,1fr);align-items:center;gap:2px 14px;min-height:96px;padding:8px 14px 8px 8px;border-radius:14px;box-shadow:inset 0 0 0 1px rgb(var(--lk-cream) / .3);text-align:left;transition:background-color 120ms}
#rgh .cus .card:hover{background:rgb(var(--lk-cream) / .08)}
#rgh .cus .card .art{grid-row:1 / span 2;width:120px;height:80px;display:block}
#rgh .cus .card .art svg,#rgh .cus .card .art img{width:100%;height:100%;display:block}
#rgh .cus .card .cn{font:var(--lk-brand,500) 20px/1.15 var(--lk-font);color:var(--val);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;align-self:end}
#rgh .cus .card .cf{font-size:16px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;align-self:start;font-variant-numeric:tabular-nums}
#rgh .cus .card .x{color:rgb(var(--lk-amber))}
#rgh .cus .card[aria-checked=true]{background:rgb(var(--lk-amber) / .1);box-shadow:inset 0 0 0 1px rgb(var(--lk-amber) / .85)}
#rgh .cus .card[aria-checked=true] .cn{color:rgb(var(--lk-amber))}
/* the preview */
#rgh .cus .pv{grid-column:2;grid-row:2;display:flex;flex-direction:column;gap:12px;min-height:0;min-width:0}
#rgh .cus .pvh{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
#rgh .cus .pvh .k{font-size:16px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--val);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rgh .cus .pvh .f{font-size:16px;color:var(--mut);white-space:nowrap}
#rgh .cus .pva{border-radius:14px;box-shadow:inset 0 0 0 1px rgb(var(--lk-cream) / .18);padding:6px;flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center}
#rgh .cus .pva svg{width:100%;height:100%;max-height:220px;display:block}
#rgh .cus .pva img{width:100%;height:auto;max-height:220px;aspect-ratio:240 / 150;object-fit:contain;box-shadow:none}
#rgh .cus .pvf{all:unset;display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}
#rgh .cus .pvf dt{font-size:16px;color:var(--mut)}
#rgh .cus .pvf dd{all:unset;display:block;font-size:18px;font-weight:500;color:var(--val);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
#rgh .cus .acts{display:flex;align-items:center;gap:14px}
#rgh .cus .acts .go{flex:1 1 auto;height:48px;font-size:18px}
#rgh .cus .dfm{display:inline-flex;align-items:center;min-height:44px;padding:0 6px;font-size:17px;font-weight:500;color:var(--mut);white-space:nowrap}
#rgh .cus .dfm:hover{color:var(--val);text-decoration:underline;text-underline-offset:4px}
/* a phone held sideways (844 × 390) and an upright one turned: the same sections in one scrolling column, the preview beside it */
:where(:root[data-screen~=tight]) #rgh .row.cusr .t b{display:none}
  :where(:root[data-screen~=tight]) #rgh .rr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:8px}
  :where(:root[data-screen~=tight]) #rgh .rr .row{margin:0;min-width:0}
  :where(:root[data-screen~=tight]) #rgh .rr .row .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  :where(:root[data-screen~=tight]) #rgh .cus{inset:calc(var(--lk-cap-top,58px) + 2px) max(10px,var(--lk-sar,0px)) 6px max(10px,var(--lk-sal,0px));padding:8px 14px;grid-template-columns:minmax(0,1fr) 230px;gap:6px 18px;animation-duration:240ms}
  :where(:root[data-screen~=tight]) #rgh .cus h2{font-size:22px}
  :where(:root[data-screen~=tight]) #rgh .cus .sub{display:none}
  :where(:root[data-screen~=tight]) #rgh .cus .chd{align-items:center;justify-content:space-between}
  :where(:root[data-screen~=tight]) #rgh .cus .rows{position:static;display:block;overflow-y:auto;overscroll-behavior:contain;padding-right:4px}
  :where(:root[data-screen~=tight]) #rgh .cus .cc{gap:14px}
  :where(:root[data-screen~=tight]) #rgh .cus .cc+.cc{margin-top:14px}
  :where(:root[data-screen~=tight]) #rgh .cus .sec>h3{font-size:15px;padding-bottom:4px}
  :where(:root[data-screen~=tight]) #rgh .cus .r>.val{min-height:44px}
  :where(:root[data-screen~=tight]) #rgh .cus .r>.val .vl,:where(:root[data-screen~=tight]) #rgh .cus .r>.val .vv{font-size:16px}
  :where(:root[data-screen~=tight]) #rgh .cus .r[data-row=course]>.val{grid-template-columns:84px minmax(0,1fr) auto;min-height:64px;margin-top:6px;padding:4px 10px 4px 4px}
  :where(:root[data-screen~=tight]) #rgh .cus .r[data-row=course]>.val .art{width:84px;height:56px}
  :where(:root[data-screen~=tight]) #rgh .cus .r[data-row=course]>.val .vv{font-size:19px}
  :where(:root[data-screen~=tight]) #rgh .cus .r[data-row=course]>.val .vf{font-size:15px}
  :where(:root[data-screen~=tight]) #rgh .cus .r.open>.pk{position:absolute;left:14px;top:8px;bottom:8px;right:auto;width:calc(100% - 230px - 46px);padding:8px 12px;gap:8px}
  :where(:root[data-screen~=tight]) #rgh .cus .pt{font-size:19px}
  :where(:root[data-screen~=tight]) #rgh .cus .opts{gap:8px}
  :where(:root[data-screen~=tight]) #rgh .cus .opts button{min-height:48px;padding:0 14px;font-size:16px}
  :where(:root[data-screen~=tight]) #rgh .cus .cards{gap:8px}
  :where(:root[data-screen~=tight]) #rgh .cus .card{grid-template-columns:72px minmax(0,1fr);min-height:62px;padding:4px 8px 4px 4px;gap:0 8px}
  :where(:root[data-screen~=tight]) #rgh .cus .card .art{width:72px;height:50px}
  :where(:root[data-screen~=tight]) #rgh .cus .card .cn{font-size:17px}
  :where(:root[data-screen~=tight]) #rgh .cus .card .cf{font-size:15px}
  :where(:root[data-screen~=tight]) #rgh .cus .pv{gap:6px}
  :where(:root[data-screen~=tight]) #rgh .cus .pvh{display:none}
  :where(:root[data-screen~=tight]) #rgh .cus .pva{padding:2px}
  :where(:root[data-screen~=tight]) #rgh .cus .pva svg text{display:none}
  :where(:root[data-screen~=tight]) #rgh .cus .pvf{gap:2px 8px}
  :where(:root[data-screen~=tight]) #rgh .cus .pvf dt{font-size:15px}
  :where(:root[data-screen~=tight]) #rgh .cus .pvf dd{font-size:16px}
  :where(:root[data-screen~=tight]) #rgh .cus .acts{flex-direction:column;align-items:stretch;gap:2px}
  :where(:root[data-screen~=tight]) #rgh .cus .acts .go{height:44px;font-size:16px;padding:0 12px}
  :where(:root[data-screen~=tight]) #rgh .cus .dfm{justify-content:center}
/* a browser tab's height on a phone (the compact tier, under 370 px): the eyebrow goes, the title and the hand tighten, so
   the Level and Custom rows stay on the screen; the Custom sheet's preview drops its map (the facts and Race stay) */
:where(:root[data-screen~=short]) #rgh .eb{display:none}
  :where(:root[data-screen~=short]) #rgh h1{font-size:26px;margin-top:0}
  :where(:root[data-screen~=short]) #rgh .cus .pva{display:none}
/* the race card (owner 2026-11-20: "a big navy card on top of a navy-coloured water background is not a good idea; the Regatta menu can
   have its own easy-to-read theme"): the committee's race card, parchment with navy ink, brass for the numbers and the medals, a signal
   flag per cup (no red: red means port); two cards, one edge (20 px), one spacing scale (4 / 8 / 12 / 16 / 20). Left: the races by place
   (the cups, their races, then Level, Custom and the Cup, quiet). Right: Race now, today's hand on its course board. The Level and Custom
   pop-ups share the card's look (the block after the cups' rules) */
#rgh{--pp:244 236 218;--nv:var(--lk-brand-navy);--bi:#7A5A1E;--br:#B58F4A}
#rgh .veil{background:linear-gradient(90deg,rgb(var(--lk-brand-navy) / .34) 0%,rgb(var(--lk-brand-navy) / .12) 40%,rgb(var(--lk-brand-navy) / 0) 60%,rgb(var(--lk-brand-navy) / .2) 100%)}
#rgh .col{--ink:rgb(var(--nv));--soft:rgb(var(--nv) / .74);--hair:rgb(var(--nv) / .16);color:var(--ink);background-color:rgb(var(--pp));border-radius:14px;border:0;box-shadow:0 0 0 1px rgb(var(--nv) / .22),0 14px 40px rgb(0 0 0 / .38);-webkit-backdrop-filter:none;backdrop-filter:none}
#rgh .col{position:relative;box-sizing:border-box;padding:20px;gap:0;align-self:start;max-height:100%;overflow:hidden;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='-50 -50 100 100'%3E%3Cg fill='none' stroke='%231C2340' stroke-opacity='.1' stroke-width='.5'%3E%3Ccircle r='46'/%3E%3Ccircle r='42'/%3E%3Ccircle r='20'/%3E%3Cpath d='M0-46V46M-46 0H46M-32-32L32 32M32-32L-32 32'/%3E%3C/g%3E%3Cg fill='%231C2340' fill-opacity='.07'%3E%3Cpath d='M0-44L6 0L0 44L-6 0Z'/%3E%3Cpath d='M-44 0L0-6L44 0L0 6Z'/%3E%3C/g%3E%3C/svg%3E");background-repeat:no-repeat;background-size:200px 200px;background-position:right -56px top -56px}
#rgh .col .pl{background:none;border:0;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;border-radius:0}
#rgh .col .eb{color:var(--soft);padding-right:96px;line-height:20px}
#rgh .col h1{color:var(--ink);font-size:40px;line-height:44px;margin:4px 0 0}
#rgh button:focus-visible{outline-color:rgb(var(--nv))}
:root:not([data-screen~=tight]) #rgh .col .back{position:absolute;top:12px;right:12px;min-height:36px;padding:0 8px;border-radius:8px;font-size:15px;color:var(--soft);display:inline-flex;align-items:center}
:root:not([data-screen~=tight]) #rgh .col .back:hover{color:var(--ink);background:rgb(var(--nv) / .06)}
/* the cups: a tab per cup with its signal flag; the chosen one ringed in navy */
#rgh .cups{padding:0;gap:0;margin-top:16px}
#rgh .ctabs{gap:8px}
#rgh .ctab{flex-direction:row;align-items:center;gap:12px;min-height:52px;padding:8px 12px;border-radius:10px;box-shadow:inset 0 0 0 1px rgb(var(--nv) / .2)}
#rgh .ctab::before{content:"";flex:none;width:24px;height:16px;border-radius:1px;box-shadow:0 0 0 1px rgb(var(--nv) / .5);background:var(--flag) center / 100% 100% no-repeat}
#rgh .ctab[data-cup=emerald-bay]{--flag:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 16'%3E%3Crect width='12' height='16' fill='%23C9A24B'/%3E%3Crect x='12' width='12' height='16' fill='%231C2340'/%3E%3C/svg%3E")}
#rgh .ctab[data-cup=the-mouth]{--flag:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 16'%3E%3Crect width='24' height='16' fill='%231C2340'/%3E%3Cpath d='M0 0L24 16M24 0L0 16' stroke='%23fff' stroke-width='3'/%3E%3C/svg%3E")}
#rgh .ctab .cx{display:flex;flex-direction:column;min-width:0}
#rgh .ctab .cn{color:var(--ink)}
#rgh .ctab .cc{color:var(--soft)}
#rgh .ctab:hover{background:rgb(var(--nv) / .05)}
#rgh .ctab[aria-selected=true]{background:rgb(var(--nv) / .07);box-shadow:inset 0 0 0 1.5px rgb(var(--nv) / .9)}
#rgh .cline{color:var(--soft);margin:12px 0 0;line-height:20px}
#rgh .rlists{margin-top:8px}
/* a race row: the brass number, the name and its goal, the length and minutes over the best and medal, a chevron: the row is the button */
#rgh .rc{grid-template-columns:30px minmax(0,1fr) auto 12px;column-gap:12px;min-height:60px;padding:8px 8px;margin:0 -8px;border-radius:10px;border-top:1px solid var(--hair)}
#rgh .rc:first-child{border-top-color:transparent}
#rgh .rc:hover,#rgh .rc:hover+.rc{border-top-color:transparent}
#rgh .rc:hover{background:rgb(var(--nv) / .06)}
#rgh .rc{touch-action:manipulation}
/* select, then go: the chosen race is a highlighted row (its preview is the right card and the lake behind) */
#rgh .rc[aria-selected=true]{background:rgb(var(--nv) / .1);box-shadow:inset 3px 0 0 var(--br);border-top-color:transparent}
#rgh .rc[aria-selected=true]+.rc{border-top-color:transparent}
#rgh .rc .no{box-shadow:inset 0 0 0 1.5px var(--br);color:var(--bi);font-size:16px}
#rgh .rc .rt{color:var(--ink)}
#rgh .rc .rs{color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:20px}
#rgh .rc .rb{flex-direction:column;align-items:flex-end;justify-content:center;gap:2px;font-size:15px}
#rgh .rc .rk{color:var(--ink);font-size:16px;font-weight:500}
#rgh .rc .bt{display:inline-flex;align-items:center;gap:6px;color:var(--soft)}
#rgh .rc .rb i{order:-1;width:10px;height:10px;box-shadow:inset 0 0 0 1px rgb(var(--nv) / .45)}
#rgh .rc .rb i[data-medal=gold]{background:var(--br)}
#rgh .rc .rb i[data-medal=silver]{background:#A9ADB8}
#rgh .rc .rch{grid-row:1 / span 2;grid-column:4;font-size:22px;color:var(--soft);line-height:1}
/*: under the chosen cup's races one quiet line: its hunt's count (a brass diamond, "Chart the Bay 3/8") and Sail the cup
   (an outline pill: the cup's races back to back) */
#rgh .selc{display:flex;flex-direction:column;align-items:stretch;gap:8px;margin:8px -8px 0;padding:10px 8px 8px;border-top:1px solid var(--hair)}
#rgh .selc .sl{min-width:0;font-size:16px;font-weight:500;font-variant-numeric:tabular-nums;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rgh .selc .go{flex:none;height:44px;width:100%}
/* the foot: Level and Custom race on one quiet line, the Cup slim; a hairline above, no plates */
/* an even foot: the two cards the same height (the taller one's), the left card's foot at its bottom */
:root:not([data-screen~=tight]) #rgh{align-content:start}
:root:not([data-screen~=tight]) #rgh .col{align-self:stretch}
:root:not([data-screen~=tight]) #rgh .col .cups{margin-bottom:12px}
:root:not([data-screen~=tight]) #rgh .col .rr{margin-top:auto;padding-top:12px;border-top:1px solid var(--hair);column-gap:8px}
#rgh .col .row{margin:0;padding:0 8px;min-height:44px;border-radius:10px;color:var(--ink)}
#rgh .col .row:hover{background:rgb(var(--nv) / .06)}
#rgh .col .row .t{font-size:17px;color:var(--ink)}
#rgh .col .row .t b{color:var(--soft)}
#rgh .col .row .s{color:var(--soft)}
#rgh .col .row .ch{color:var(--soft)}
:root:not([data-screen~=tight]) #rgh .col .row{margin:0 -8px 0 -8px}
:root:not([data-screen~=tight]) #rgh .col .rr .row+.row{margin:0 -8px 0 0}
:root:not([data-screen~=tight]) #rgh .col .row .s{display:none}
:root:not([data-screen~=tight]) #rgh .col .row .ch{grid-row:1}
/* Race now: today's hand on the course board's card (desktop); the board is its course, a dark slate on the parchment */
#rgh .col .go{background:rgb(var(--nv));color:rgb(var(--pp))}
#rgh .col .go:hover{background:rgb(var(--nv) / .88)}
/* a phone: the same two cards; the column holds the hand and the four rows, the cups card the races */
:where(:root[data-screen~=tight]) #rgh .col{padding:8px 12px;gap:6px}
:where(:root[data-screen~=tight]) #rgh .col .eb{padding-right:0}
:where(:root[data-screen~=tight]) #rgh .col h1{font-size:28px;line-height:32px;margin:0}
:where(:root[data-screen~=tight]) #rgh .rlists{margin-top:4px}
:where(:root[data-screen~=tight]) #rgh .rc .bt{display:none}
:where(:root[data-screen~=tight]) #rgh .rc{min-height:48px}
:where(:root[data-screen~=short]) #rgh .col{padding:4px 12px}
:root[data-screen~=tight] #rgh .rc .rs,:root[data-screen~=tight] #rgh .col .eb{display:none}
:where(:root[data-screen~=tight]) #rgh .ctab{gap:8px;padding:4px 10px}
:where(:root[data-screen~=tight]) #rgh .ctab::before{width:20px;height:13px}
@media (max-height:760px) and (min-height:601px){:root:not([data-screen~=tight]) #rgh .cline{display:block}}
/* the pop-ups (owner 2026-11-20: the Level and Custom race pop-ups take the race card's look): the same parchment, navy ink, 14 px edge, type
   scale and 4 / 8 / 12 / 16 / 20 spacing; a filled navy primary, quiet secondaries, the chosen pick ringed in navy 1.5 px on a 7 % tint
   (as the cup tab); the course cards as on the course board (a dark slate chart tile on the parchment). Behaviour is unchanged */
#rgh .adj,#rgh .cus{--ink:rgb(var(--nv));--soft:rgb(var(--nv) / .74);--hair:rgb(var(--nv) / .16);--mut:var(--soft);--val:var(--ink);color:var(--ink);background-color:rgb(var(--pp));border:0;border-radius:14px;box-shadow:0 0 0 1px rgb(var(--nv) / .22),0 14px 40px rgb(0 0 0 / .38);-webkit-backdrop-filter:none;backdrop-filter:none}
#rgh .cscr{background:rgb(var(--lk-brand-navy) / .5);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
#rgh .adj{padding:20px;gap:16px}
#rgh .adj h2{font-size:24px;line-height:28px}
#rgh .adj h3,#rgh .cus .sec>h3{font-size:16px;line-height:20px;letter-spacing:var(--lk-track-wide,.16em);color:var(--soft)}
#rgh .adj h3 b{color:var(--ink)}
#rgh .seg{box-shadow:inset 0 0 0 1px rgb(var(--nv) / .22)}
#rgh .seg button{color:var(--ink);outline-offset:-4px}
#rgh .seg button:hover{background:rgb(var(--nv) / .05)}
#rgh .seg button[aria-checked=true]{color:var(--ink);background:rgb(var(--nv) / .07);box-shadow:inset 0 0 0 1.5px rgb(var(--nv) / .9)}
#rgh .adj .done,#rgh .cus .go{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 20px;border-radius:22px;border:0;font-size:17px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;background:rgb(var(--nv));color:rgb(var(--pp))}
#rgh .adj .done:hover,#rgh .cus .go:hover{background:rgb(var(--nv) / .88)}
#rgh .cus{padding:20px;gap:16px 20px}
#rgh .cus h2{font-size:40px;line-height:44px}
#rgh .cus .chd{gap:20px}
#rgh .cus .cback{color:var(--soft);border-radius:8px;padding:0 8px}
#rgh .cus .cback:hover{color:var(--ink);background:rgb(var(--nv) / .06)}
#rgh .cus .rows{gap:0 20px}
#rgh .cus .cc{gap:20px}
#rgh .cus .sec>h3{border-bottom-color:var(--hair);padding-bottom:8px}
#rgh .cus .r>.val{border-bottom-color:var(--hair);border-radius:0}
#rgh .cus .r>.val:hover{background:rgb(var(--nv) / .06)}
#rgh .cus .r>.val:focus-visible{outline-offset:-2px}
#rgh .cus .r[data-row=course]>.val{border:0;border-radius:10px;box-shadow:inset 0 0 0 1px rgb(var(--nv) / .22);margin-top:8px}
#rgh .cus .r[data-row=course]>.val:hover{background:rgb(var(--nv) / .05)}
#rgh .cus .r>.val .art,#rgh .cus .card .art{border-radius:10px;overflow:hidden}
#rgh .cus .r>.val .ci,#rgh .cus .card .ci,#rgh .cus .pva .ci{border-radius:10px;box-shadow:none}
#rgh .cus .r.open>.pk{padding:16px 20px;gap:16px;background-color:rgb(var(--pp));border-radius:14px;box-shadow:0 0 0 1px rgb(var(--nv) / .22),0 8px 24px rgb(0 0 0 / .22)}
#rgh .cus .pick-x{border-color:rgb(var(--nv) / .7);color:var(--ink)}
#rgh .cus .pick-x:hover{background:rgb(var(--nv) / .07)}
#rgh .cus .opts{gap:8px}
#rgh .cus .opts button,#rgh .cus .card{color:var(--ink);box-shadow:inset 0 0 0 1px rgb(var(--nv) / .22)}
#rgh .cus .opts button{border-radius:10px}
#rgh .cus .card{border-radius:10px;gap:2px 12px}
#rgh .cus .cards{gap:12px}
#rgh .cus .opts button:hover,#rgh .cus .card:hover{background:rgb(var(--nv) / .05)}
#rgh .cus .opts button[aria-checked=true],#rgh .cus .card[aria-checked=true]{color:var(--ink);background:rgb(var(--nv) / .07);box-shadow:inset 0 0 0 1.5px rgb(var(--nv) / .9)}
#rgh .cus .card[aria-checked=true] .cn{color:var(--ink)}
#rgh .cus .card .x{color:var(--bi)}
#rgh .cus .pv{gap:12px}
#rgh .cus .pva{padding:0;box-shadow:none;border-radius:10px;overflow:hidden;background:var(--rg-board,none) center / cover no-repeat,rgb(var(--nv))}
#rgh .cus .pvh .k{letter-spacing:var(--lk-track-wide,.16em);font-size:16px;color:var(--soft)}
#rgh .cus .pvh .f{color:var(--ink)}
#rgh .cus .pvf{gap:8px 12px}
#rgh .cus .acts{gap:12px}
#rgh .cus .dfm{color:var(--soft);border-radius:8px}
#rgh .cus .dfm:hover{color:var(--ink);text-decoration:none;background:rgb(var(--nv) / .06)}
:where(:root[data-screen~=tight]) #rgh .adj{padding:8px 12px;gap:8px}
:where(:root[data-screen~=tight]) #rgh .adj h2{font-size:19px;line-height:24px}
:where(:root[data-screen~=tight]) #rgh .adj .done{right:12px;top:8px;height:44px;padding:0 16px;font-size:16px}
:where(:root[data-screen~=tight]) #rgh .cus{padding:8px 12px;gap:8px 16px}
:where(:root[data-screen~=tight]) #rgh .cus h2{font-size:24px;line-height:28px}
:where(:root[data-screen~=tight]) #rgh .cus .rows{padding-right:4px}
:where(:root[data-screen~=tight]) #rgh .cus .cc{gap:12px}
:where(:root[data-screen~=tight]) #rgh .cus .cc+.cc{margin-top:12px}
:where(:root[data-screen~=tight]) #rgh .cus .sec>h3{padding-bottom:4px}
:where(:root[data-screen~=tight]) #rgh .cus .r.open>.pk{left:12px;top:8px;bottom:8px;width:calc(100% - 230px - 40px);padding:8px 12px;gap:8px}
:where(:root[data-screen~=tight]) #rgh .cus .opts{gap:8px}
:where(:root[data-screen~=tight]) #rgh .cus .cards{gap:8px}
:where(:root[data-screen~=tight]) #rgh .cus .card{gap:0 8px}
:where(:root[data-screen~=tight]) #rgh .cus .acts .go{height:44px;font-size:16px;padding:0 12px}

/* one card on a phone too (owner 2026-11-20): no title, one-line cup tabs, 44 px rows; the selected line and To the line share a row; the hunt count steps aside */
:root[data-screen~=tight] #rgh .col{padding:6px 12px}
:root[data-screen~=tight] #rgh .cups{margin-top:0}
:root[data-screen~=tight] #rgh .ctab{min-height:44px}
:root[data-screen~=tight] #rgh .selc{flex-direction:row;align-items:center;justify-content:space-between;margin-top:2px;padding:4px 8px}
:root[data-screen~=tight] #rgh .selc .sl{font-size:15px;line-height:20px;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
:root[data-screen~=tight] #rgh .rc .rt{grid-row:1 / span 2;align-self:center}
:root[data-screen~=tight] #rgh .selc .go{width:auto;padding:0 16px}
:root[data-screen~=tight] #rgh .col .rr{margin-top:0;padding-top:0}
/* the cup's two extra rows (owner 2026-11-20): Explore (a diamond: a search) and Race all three (cup points); a hairline sets them apart; the list ends in a hairline */
#rgh .rc .no .dia{display:block;width:10px;height:10px;transform:rotate(45deg);box-shadow:inset 0 0 0 1.5px var(--br)}
#rgh .rc.rx[data-kind=cup] .no{font-size:15px;letter-spacing:-.02em}
#rgh .rc.rx[data-kind=hunt]{border-top:1px solid var(--hair)}
#rgh .rc[aria-selected=true].rx{border-top-color:transparent}
#rgh .rlist{border-bottom:1px solid var(--hair);padding-bottom:4px}
#rgh .rc.rx .rs{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-height:20px}
:root:not([data-screen~=tight]) #rgh .rc.rx{min-height:66px}
#rgh .rlist .rc:last-child{margin-bottom:0}
/* the header (the eyebrow and Regatta) stays at every height; below 760 px the spacing tightens so nothing clips (1280 × 720 and 1280 × 650) */
@media (max-height:760px){:root:not([data-screen~=tight]) #rgh .col{padding:14px 20px}:root:not([data-screen~=tight]) #rgh .col .eb{font-size:15px;line-height:16px}:root:not([data-screen~=tight]) #rgh .col h1{font-size:34px;line-height:38px;margin:0}:root:not([data-screen~=tight]) #rgh .cups{margin-top:8px}:root:not([data-screen~=tight]) #rgh .ctab{min-height:44px;padding:4px 12px}:root:not([data-screen~=tight]) #rgh .rc{min-height:46px;padding:3px 8px}:root:not([data-screen~=tight]) #rgh .rc:not(.rx) .rs{display:none}:root:not([data-screen~=tight]) #rgh .rc.rx{min-height:58px}:root:not([data-screen~=tight]) #rgh .selc{margin-top:4px;padding:6px 8px 4px;gap:6px}:root:not([data-screen~=tight]) #rgh .col .rr{padding-top:6px}:root:not([data-screen~=tight]) #rgh .col .back{top:8px}}
@media (max-height:680px){:root:not([data-screen~=tight]) #rgh .col .eb{display:block}:root:not([data-screen~=tight]) #rgh .col h1{font-size:30px;line-height:32px}:root:not([data-screen~=tight]) #rgh .rc{min-height:40px;padding:2px 8px}:root:not([data-screen~=tight]) #rgh .rc.rx{min-height:50px}:root:not([data-screen~=tight]) #rgh .rc.rx .rs{font-size:15px;line-height:18px}:root:not([data-screen~=tight]) #rgh .col{padding:8px 20px}:root:not([data-screen~=tight]) #rgh .cups{margin-top:6px}:root:not([data-screen~=tight]) #rgh .selc{padding:4px 8px 2px;gap:4px;margin-top:2px}:root:not([data-screen~=tight]) #rgh .col .rr{padding-top:4px}}
/* a phone: one card in two columns (the cups and Level and Custom left, the rows right, the selected line and its button under both) so 4 rows, the line and the rows of the foot fit 340 px */
:root[data-screen~=tight] #rgh .col{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.4fr);grid-template-rows:auto auto 1fr auto;column-gap:10px;row-gap:0;padding:4px 10px}
:root[data-screen~=tight] #rgh .cups{display:contents}
:root[data-screen~=tight] #rgh .col h1{grid-area:1 / 1 / 2 / 3;font-size:22px;line-height:22px;margin:0}
:root[data-screen~=tight] #rgh .ctabs{grid-area:2 / 1;grid-auto-flow:row;grid-auto-columns:auto;align-content:start;gap:2px}
:root[data-screen~=tight] #rgh .rlists{grid-area:2 / 2 / 4 / 3;margin-top:0}
:root[data-screen~=tight] #rgh .rr{grid-area:3 / 1;display:block;align-self:end;margin:0}
:root[data-screen~=tight] #rgh .rr .row{margin:0}
:root[data-screen~=tight] #rgh .selc{grid-area:4 / 1 / 5 / 3}
:root[data-screen~=tight] #rgh .rc{min-height:44px;padding:2px 6px;grid-template-columns:26px minmax(0,1fr) 10px;column-gap:8px}
:root[data-screen~=tight] #rgh .col .eb,:root[data-screen~=tight] #rgh .col .back,:root[data-screen~=tight] #rgh .ctab .cc,:root[data-screen~=tight] #rgh .ctab::before,:root[data-screen~=tight] #rgh .rc .rb{display:none}
:root[data-screen~=tight] #rgh .ctab{padding:4px 8px}
:root[data-screen~=tight] #rgh .rc .rch{grid-column:3}
:root[data-screen~=tight] #rgh .rc.rx .rs{display:none}
:root[data-screen~=tight] #rgh .rc .rt{font-size:16px}
:root[data-screen~=tight] #rgh .rc .no{width:26px;height:26px;font-size:15px}
:root[data-screen~=tight] #rgh .rlist{padding-bottom:0;border-bottom:0}
`;

const ORDS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const ordOf = (n) => ORDS[n - 1] ?? `${n}th`;
const mmss = (t) => { const a = Math.max(0, t), m = Math.floor(a / 60), r = a - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (v) => (Math.round(v * 10) / 10).toString();
// step D4: a course's baked card as an <img> (1× and 2×; the drawn SVG outline when the bake has no such course)
function cardImg(courseId, kind = 'tile', waters = WATERS) {
  const c = CARDS[waters]?.[courseId]?.[kind], sz = CARD_SIZES[kind] ?? [120, 80];
  if (!c) return OUTLINES[waters]?.[courseId]?.[kind === 'card' ? 'card' : 'mini'] ?? '';
  return `<img class="ci" src="${c[0]}" srcset="${c[0]} 1x, ${c[1]} 2x" width="${sz[0]}" height="${sz[1]}" alt="" decoding="async" draggable="false">`;
}

// the course board's drawing: the course turned so the wind blows from the top (a board on a committee boat shows the first beat up),
// fitted into w × h. Legs cream dashed with an arrow at their middle; W a sphere (a filled circle), I a can (a square); the start
// line from the pin (a dot) to the committee boat (a small hull); the wind arrow at the top. labels: the marks' numbers (15 px; owner
// 2026-11-16: on screen the marks are numbered by order, the JSON's ids stay internal) with the rounding's symbol (⟲ port, ⟳
// starboard), F at the finish line; size: the labels' px
export function courseSvg(course, { w = 412, h = 250, pad = 22, labels = true, stroke = 1.6, size = 15 } = {}) {
  if (!course?.line) return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const U = course.line.up, ux = U[0], uz = U[1], R = [-uz, ux];
  const to = (p) => [p[0] * R[0] + p[1] * R[1], -(p[0] * ux + p[1] * uz)];
  const L = course.line, FIN = course.finish ?? null;   // a place race: its own finish line, its gates' two buoys
  const pts = [L.pin, L.committee, ...course.marks.flatMap((m) => (m.kind === 'gate' ? [m.green, m.red] : [m.at])), ...(FIN ? [FIN.pin, FIN.committee] : [])].map(to);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const top = labels ? 26 : 16, sw = Math.max(1, x1 - x0), sh = Math.max(1, y1 - y0), k = Math.min((w - 2 * pad) / sw, (h - pad - top) / sh);
  const ox = (w - sw * k) / 2 - x0 * k, oy = top + (h - pad - top - sh * k) / 2 - y0 * k;
  const P = (p) => { const [x, y] = to(p); return [x * k + ox, y * k + oy]; };
  const ink = 'rgb(239 230 210)', out = [];
  out.push(`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(course.name ?? 'Course')}" fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">`);
  // the wind: an arrow down from the top edge
  const cx = w / 2;
  out.push(`<path d="M${f1(cx)} 4V${f1(top - 6)}M${f1(cx - 5)} ${f1(top - 11)}L${f1(cx)} ${f1(top - 5)}L${f1(cx + 5)} ${f1(top - 11)}" stroke-width="${stroke}" opacity=".8"/>`);
  // the legs (dashed), an arrowhead at each middle
  for (const leg of course.legs ?? []) {
    const [ax, ay] = P(leg.from), [bx, by] = P(leg.to), mx = (ax + bx) / 2, my = (ay + by) / 2, a = Math.atan2(by - ay, bx - ax), s = labels ? 6 : 4;
    out.push(`<path d="M${f1(ax)} ${f1(ay)}L${f1(bx)} ${f1(by)}" stroke-width="${stroke}" stroke-dasharray="${labels ? '6 5' : '4 4'}" opacity=".9"/>`);
    const p1 = [mx - s * Math.cos(a - 0.5), my - s * Math.sin(a - 0.5)], p2 = [mx - s * Math.cos(a + 0.5), my - s * Math.sin(a + 0.5)];
    out.push(`<path d="M${f1(p1[0])} ${f1(p1[1])}L${f1(mx)} ${f1(my)}L${f1(p2[0])} ${f1(p2[1])}" stroke-width="${stroke}"/>`);
  }
  // the start line: the pin, the committee boat's hull pointing up the course
  const [px, py] = P(L.pin), [qx, qy] = P(L.committee);
  out.push(`<path d="M${f1(px)} ${f1(py)}L${f1(qx)} ${f1(qy)}" stroke-width="${stroke + 0.4}"/>`);
  out.push(`<circle cx="${f1(px)}" cy="${f1(py)}" r="${labels ? 3.2 : 2.4}" fill="${ink}" stroke="none"/>`);
  const hs = labels ? 1 : 0.7;
  out.push(`<path d="M${f1(qx - 9 * hs)} ${f1(qy - 4 * hs)}h${f1(13 * hs)}l${f1(6 * hs)} ${f1(4 * hs)}l${f1(-6 * hs)} ${f1(4 * hs)}h${f1(-13 * hs)}z" fill="${ink}" stroke="none"/>`);
  // a place race's finish line (its own, away from the start): the pin's dot, the committee end's flag, an F between
  if (FIN) {
    const [fx, fy] = P(FIN.pin), [gx2, gy2] = P(FIN.committee);
    out.push(`<path d="M${f1(fx)} ${f1(fy)}L${f1(gx2)} ${f1(gy2)}" stroke-width="${stroke + 0.4}" stroke-dasharray="${labels ? '2 4' : '1.5 3'}"/>`);
    out.push(`<circle cx="${f1(fx)}" cy="${f1(fy)}" r="${labels ? 3.2 : 2.4}" fill="${ink}" stroke="none"/><circle cx="${f1(gx2)}" cy="${f1(gy2)}" r="${labels ? 3.2 : 2.4}" fill="${ink}" stroke="none"/>`);
  }
  // the marks, numbered by order (marks.js)
  const nums = markNumbers(course), font = `font-size="${size}" font-weight="500" font-family="'Atkinson Hyperlegible Next',sans-serif"`;
  if (labels) { const [e1, e2] = FIN ? [P(FIN.pin), P(FIN.committee)] : [[px, py], [qx, qy]], mx = (e1[0] + e2[0]) / 2, my = (e1[1] + e2[1]) / 2; out.push(`<text x="${f1(mx)}" y="${f1(Math.min(h - 3, my + size + 4))}" text-anchor="middle" fill="${ink}" stroke="none" ${font}>F</text>`); }
  // step D4: each mark's number on the side away from the course's middle (a mark left of it labels to its left), so a number never sits on
  // the legs between the marks; flipped back when it would leave the card
  let gx = 0; for (const m of course.marks) gx += P(m.at)[0]; gx /= Math.max(1, course.marks.length);
  for (const m of course.marks) {
    const [x, y] = P(m.at), r = labels ? 6 : 4.5;
    if (m.kind === 'gate') {   // a gate: its two buoys with a bar between (pass between them)
      const [ga, gb] = [P(m.green), P(m.red)], q = labels ? 4.2 : 3;
      out.push(`<path d="M${f1(ga[0])} ${f1(ga[1])}L${f1(gb[0])} ${f1(gb[1])}" stroke-width="${stroke}" opacity=".7"/><circle cx="${f1(ga[0])}" cy="${f1(ga[1])}" r="${f1(q)}" fill="${ink}" stroke="none"/><circle cx="${f1(gb[0])}" cy="${f1(gb[1])}" r="${f1(q)}" fill="${ink}" stroke="none"/>`);
      if (labels) { const right = x >= gx - 1 ? x < w - 40 : x < 40; out.push(`<text x="${f1(right ? Math.max(ga[0], gb[0]) + 10 : Math.min(ga[0], gb[0]) - 10)}" y="${f1(y + 5)}" text-anchor="${right ? 'start' : 'end'}" fill="${ink}" stroke="none" ${font}>${nums.get(m.id) ?? ''}</text>`); }
      continue;
    }
    out.push(m.kind === 'cylinder' ? `<rect x="${f1(x - r)}" y="${f1(y - r)}" width="${f1(2 * r)}" height="${f1(2 * r)}" rx="1.5" fill="${ink}" stroke="none"/>` : `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${ink}" stroke="none"/>`);
    if (labels) { const right = x >= gx - 1 ? x < w - 40 : x < 40, t = `${nums.get(m.id) ?? ''} ${ROUND_SYMBOL[m.rounding === 'starboard' ? 'starboard' : 'port']}`; out.push(`<text x="${f1(right ? x + 10 : x - 10)}" y="${f1(y + 5)}" text-anchor="${right ? 'start' : 'end'}" fill="${ink}" stroke="none" ${font}>${esc(t)}</text>`); }
  }
  out.push('</svg>');
  return out.join('');
}

// the Custom sheet's rows (owner review 2026-11-16: three sections, one "Label … Value ›" row per dial): each { id, section, label,
// value, pickers: [{ dial, options: [{ v, label, on }] }] }; the course's row is a card (its facts) and its picker cards. The values come
// from the stored picks (clamped) and the setup's two dials
export function customDials(m) {
  const S = m.setup ?? {}, c = clampCustom(S.custom), h = customHand(S, 1), d = describeHand(h);
  const opt = (dial, list, cur) => [{ dial, options: list.map(([v, label]) => ({ v: String(v), label, on: String(v) === String(cur) })) }];
  const minsAt = (patch) => minutesFor({ ...h, ...patch });
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return [
    { id: 'course', section: 'course', label: 'Course', value: d.short, facts: `${d.legs} legs · about ${d.mins} min`,
      cards: COURSES.map((x) => { const hx = { ...h, course: x.id, laps: x.laps, scale: x.scales[LENGTHS.findIndex((l) => l.id === c.length)] }; return { v: x.id, name: x.short, laps: x.laps, on: x.id === c.course, facts: `${x.marks * x.laps + 1} legs · about ${minutesFor(hx)} min` }; }) },
    { id: 'length', section: 'course', label: 'Length', value: `${d.length} · about ${d.mins} min`, pickers: opt('length', LENGTHS.map((l) => [l.id, `${l.label} · ${minsAt({ length: l.id, scale: courseOf(c.course).scales[l.i] })} min`]), c.length) },
    { id: 'laps', section: 'course', label: 'Laps', value: n(c.laps, 'lap', 'laps'), pickers: opt('laps', Array.from({ length: LAPS.max - LAPS.min + 1 }, (_, i) => [LAPS.min + i, n(LAPS.min + i, 'lap', 'laps')]), c.laps) },
    { id: 'wind', section: 'cond', label: 'Wind', value: d.wind, pickers: opt('wind', WINDS.map((w) => [w.level, `${w.name} · ${w.range}`]), c.wind) },
    { id: 'shifts', section: 'cond', label: 'Shifts', value: d.shifts, pickers: opt('shifts', SHIFTS.map((x) => [x.id, x.label]), c.shifts) },
    { id: 'sky', section: 'cond', label: 'Sky', value: d.sky, pickers: opt('sky', SKIES.map((x) => [x.id, x.label]), c.sky) },
    { id: 'time', section: 'cond', label: 'Time of day', value: d.time, pickers: opt('time', TIMES.map((t) => [t.id, t.label]), c.time) },
    { id: 'event', section: 'fleet', label: 'Race type', value: eventOf(c.event).short === 'Fleet' ? 'Fleet race' : eventOf(c.event).short, pickers: opt('event', EVENT_IDS.map((id) => [id, id === 'fleet' ? 'Fleet race' : EVENTS[id].short]), c.event) },
    // a match race sails one rival and a time trial none: the Rivals row steps aside for them (the Race type says it)
    ...(c.event === 'match' || c.event === 'trial' ? [] : [{ id: 'rivals', section: 'fleet', label: 'Rivals', value: h.rivals ? n(h.rivals, 'boat', 'boats') : 'None', pickers: opt('rivals', Array.from({ length: RIVALS.max - (c.event === 'pursuit' ? 2 : RIVALS.customMin) + 1 }, (_, i) => { const k = i + (c.event === 'pursuit' ? 2 : RIVALS.customMin); return [k, k ? String(k) : 'None']; }), h.rivals) }]),
    { id: 'skill', section: 'fleet', label: 'Their skill', value: SKILL_LABEL[S.skill] ?? 'Easy', pickers: opt('skill', SKILL_IDS.map((id) => [id, SKILL_LABEL[id]]), S.skill) },
    { id: 'aids', section: 'fleet', label: 'Your aids', value: LEVELS[S.aids]?.label ?? 'Beginner', pickers: opt('aids', LEVEL_IDS.map((id) => [id, LEVELS[id].label]), S.aids) },
    ...(S.aids === 'pro' ? [{ id: 'laylines', section: 'fleet', label: 'Laylines', value: S.laylines ? 'On' : 'Off', pickers: opt('laylines', [['off', 'Off'], ['on', 'On']], S.laylines ? 'on' : 'off') }] : []),
    ...(c.event === 'pursuit' ? [] : [{ id: 'start', section: 'fleet', label: 'Start', value: STARTS.find((x) => x.s === c.start)?.label ?? '', pickers: opt('start', STARTS.map((x) => [x.s, x.label]), c.start) }]),   // a pursuit starts on its own staggered gate
    { id: 'pace', section: 'fleet', label: 'Pace', value: `${c.pace} ×`, pickers: opt('pace', PACES.map((p) => [p, `${p} ×`]), c.pace) },
  ];
}
const HUB_OUT_MS = 240, CUS_OUT_MS = 160;   // step D1: the hub's and the Custom sheet's fade out (motion tokens: 240 ms, a short exit)
const DBL_MS = 450;
// the cup's hunt as a row (owner 2026-11-20: a first-time player must see it is a search): "Explore the Mouth" (the hunt's own name is Chart the Mouth, a
// chart term a first-timer does not know), its one line and "0 of 8 found"
const huntTitle = (h) => h.name.replace(/^Chart /, 'Explore ');
const huntLine = (c) => `Find ${c.hunt.of} hidden corners of the ${c.name.split(' ').pop().toLowerCase()}: sail close to discover them.`;   // two taps on one race row this close start it
const NUM_DIALS = new Set(['laps', 'wind', 'rivals', 'start', 'pace']);

export function createHub({ onGo = () => {}, onSelect = () => {}, onAdjust = () => {}, onLeave = () => {}, onCustom = () => {}, onRaceCustom = () => {}, onDealForMe = () => {}, onExplore = () => {}, onRace = () => {}, onCupSail = () => {}, doc = globalThis.document } = {}) {
  if (!doc.getElementById('v2-regatta-hub-css')) { const st = doc.createElement('style'); st.id = 'v2-regatta-hub-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const root = doc.createElement('div'); root.id = 'rgh'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Regatta');
  const seg = (name, ids, label) => `<div class="seg" role="radiogroup" data-seg="${name}">${ids.map((id) => `<button type="button" role="radio" aria-checked="false" data-v="${id}">${esc(label(id))}</button>`).join('')}</div>`;
  root.innerHTML = `<div class="veil"></div>
<div class="col">
  <div class="eb"><span class="e1"></span><span class="e2"></span><span class="e3"></span></div>
  <h1>Regatta</h1>
  <div class="cups pl" aria-label="Races by place"><div class="ctabs" role="tablist" aria-label="Cups"></div><div class="rlists"></div>
    <div class="selc"><span class="sl" aria-live="polite"></span><button type="button" class="go">To the line ›</button></div></div>
  <div class="rr"><button type="button" class="row lvl" aria-haspopup="dialog"><span class="t"></span><span class="s"></span><span class="ch">›</span></button>
  <button type="button" class="row cusr" aria-haspopup="dialog"><span class="t">Custom race <b></b></span><span class="s"></span><span class="ch">›</span></button></div>
  <button type="button" class="back">Back · Esc</button>
</div>
<div class="adj pl" role="dialog" aria-label="Level" hidden>
  <h2>Level</h2>
  <section><h3>Preset <b class="pv"></b></h3>${seg('preset', LEVEL_IDS, (id) => LEVELS[id].label)}</section>
  <section><h3>Rivals’ skill <b class="sv"></b></h3>${seg('skill', SKILL_IDS, (id) => SKILL_LABEL[id])}</section>
  <section><h3>Your aids <b class="av"></b></h3>${seg('aids', LEVEL_IDS, (id) => LEVELS[id].label)}</section>
  <section class="ll" hidden><h3>Laylines <b class="lv"></b></h3>${seg('laylines', ['off', 'on'], (v) => (v === 'on' ? 'On' : 'Off'))}</section>
  <button type="button" class="done">Done</button>
</div>
<div class="cscr" hidden></div>
<div class="cus pl" role="dialog" aria-label="Custom race" hidden>
  <div class="chd"><h2>Custom race</h2><span class="sub">Sailing instructions · every pick is remembered</span><button type="button" class="cback">‹ Regatta</button></div>
  <div class="rows"></div>
  <aside class="pv"><div class="pvh"><span class="k"></span><span class="f"></span></div><div class="pva"></div><dl class="pvf"></dl>
    <div class="acts"><button type="button" class="go race">Race ›</button><button type="button" class="dfm">Deal for me</button></div></aside>
</div>`;
  doc.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const set = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  const adj = $('.adj'), cus = $('.cus');
  let hideT = 0;
  let model = null, openRow = null;
  const stop = (e) => e.stopPropagation();
  root.addEventListener('pointerdown', stop); root.addEventListener('click', stop);
  $('.go').addEventListener('click', () => start(selId, true));   // To the line: the selected race starts (the hand in force is the selected race); Explore, Race all three: their own
  $('.back').addEventListener('click', () => onLeave());
  // the cups: a tab picks the cup shown (and selects its first race); a race row SELECTS that place race (select, then go:
  // the right card and the lake behind show it); a double-click, a double-tap (two taps within DBL_MS on one row) or Enter starts it
  let cupId = null, selId = null, lastTap = { id: null, t: 0 };
  const rows = () => [...root.querySelectorAll('.rlist:not([hidden]) .rc')];
  const pick = (id) => { if (!id) return; selId = id; onSelect(id); };
  const start = (id, button = false) => {   // a race starts that race; "Race all three" the cup's series; the exploring row leaves for free sailing with the hunt
    if (!id) return; const [k, v] = id.split(':');
    if (k === 'cup') onCupSail(v); else if (k === 'hunt') onExplore(v); else if (button) onGo(); else onRace(id);
  };
  $('.cups').addEventListener('click', (e) => {
    const t = e.target.closest('.ctab'); if (t) { cupId = t.dataset.cup; paintCups(); pick(root.querySelector(`.rlist[data-cup="${cupId}"] .rc`)?.dataset.race); return; }
    const r = e.target.closest('.rc'); if (!r) return;
    const id = r.dataset.race, now = Date.now();
    if (lastTap.id === id && now - lastTap.t < DBL_MS) { lastTap = { id: null, t: 0 }; start(id); return; }
    lastTap = { id, t: now }; pick(id);
  });
  // keys: Up and Down move the selection along the rows (the page's arrows are not the helm's while the hub is up), Enter starts it
  const typing = () => { const a = doc.activeElement; return !a || a === doc.body || root.contains(a) && (a.closest('.cups') || a === root); };
  const moveSel = (d) => { const r = rows(); if (!r.length) return; const i = Math.max(0, r.findIndex((b) => b.dataset.race === selId)), n = r[Math.min(r.length - 1, Math.max(0, i + d))]; pick(n.dataset.race); n.focus({ preventScroll: true }); };
  $('.lvl').addEventListener('click', () => adjust(adj.hidden));
  $('.done').addEventListener('click', () => adjust(false));
  $('.cusr').addEventListener('click', () => custom(true));
  $('.cback').addEventListener('click', () => custom(false));
  $('.cus .race').addEventListener('click', () => { pickRow(null); onRaceCustom(); });
  $('.cus .dfm').addEventListener('click', () => { pickRow(null); custom(false); onDealForMe(); });
  // a pick: the course's card, a segment of a dial, a phone row's value button (its picker), the picker's Done
  cus.addEventListener('click', (e) => {
    const val = e.target.closest('.r>.val'); if (val) { const id = val.parentElement.dataset.row; pickRow(openRow === id ? null : id); return; }
    if (e.target.closest('.pick-x')) { pickRow(null); return; }
    const b = e.target.closest('[data-dial] [data-v]'); if (!b || !model) return;
    const dial = b.closest('[data-dial]').dataset.dial, raw = b.dataset.v, v = NUM_DIALS.has(dial) ? Number(raw) : raw;
    if (dial === 'skill') onAdjust({ skill: v });
    else if (dial === 'aids') onAdjust({ aids: v });
    else if (dial === 'laylines') onAdjust({ laylines: v === 'on' });
    else onCustom({ [dial]: v });
  });
  function pickRow(id) {
    openRow = id;
    for (const r of cus.querySelectorAll('.r')) { const on = r.dataset.row === id; r.classList.toggle('open', on); r.querySelector('.val')?.setAttribute('aria-expanded', String(on)); }
  }
  // step D1: the sheet fades and rises in; it fades out (CUS_OUT_MS) before it hides, so closing it never pops
  let cusOut = 0;
  function custom(open, { instant = false } = {}) {
    const scr = $('.cscr');
    clearTimeout(cusOut); delete cus.dataset.out; delete scr.dataset.out;
    $('.cusr').setAttribute('aria-expanded', String(!!open)); pickRow(null);
    if (open) { cus.hidden = false; scr.hidden = false; adjust(false); paintCustom(); return; }
    if (cus.hidden || instant || root.hidden) { cus.hidden = true; scr.hidden = true; return; }
    cus.dataset.out = ''; scr.dataset.out = '';
    cusOut = setTimeout(() => { cus.hidden = true; scr.hidden = true; delete cus.dataset.out; delete scr.dataset.out; }, CUS_OUT_MS);
  }
  // the sheet from the model: built once per shape (the rows' pickers), the chosen states and values set in place
  let shape = '';
  function paintCustom() {
    if (!model || cus.hidden) return;
    const D = customDials(model), key = D.map((r) => `${r.id}:${(r.pickers ?? []).map((p) => `${p.dial}${p.options.length}`).join(',')}`).join('|');
    if (key !== shape) {
      shape = key;
      const row = (r) => {
        const pk = r.cards
          ? `<div class="cards" role="radiogroup" data-dial="course" aria-label="Course">${r.cards.map((c) => `<button type="button" class="card" role="radio" aria-checked="false" data-v="${esc(c.v)}"><span class="art">${cardImg(c.v, 'tile')}</span><span class="cn">${esc(c.name)}${c.laps > 1 ? ` <span class="x">× ${c.laps}</span>` : ''}</span><span class="cf"></span></button>`).join('')}</div>`
          : r.pickers.map((p) => `<div class="opts" role="radiogroup" data-dial="${p.dial}" aria-label="${esc(r.label)}">${p.options.map((o) => `<button type="button" role="radio" aria-checked="false" data-v="${esc(o.v)}"></button>`).join('')}</div>`).join('');
        const face = r.cards ? `<span class="art"></span><span class="vv"></span><span class="vf"></span><span class="ch">›</span>` : `<span class="vl">${esc(r.label)}</span><span class="vv"></span><span class="ch">›</span>`;
        return `<div class="r" data-row="${r.id}"><button type="button" class="val" aria-haspopup="true" aria-expanded="false" aria-label="${esc(r.label)}">${face}</button><div class="pk"><div class="pt"><span>${esc(r.label)}</span><button type="button" class="pick-x">Done</button></div>${pk}</div></div>`;
      };
      const sec = (id, label) => `<section class="sec" data-sec="${id}"><h3>${esc(label)}</h3>${D.filter((r) => r.section === id).map(row).join('')}</section>`;
      $('.rows').innerHTML = `<div class="cc">${sec('course', 'Course')}${sec('cond', 'Conditions')}</div><div class="cc">${sec('fleet', 'Fleet & aids')}</div>`;
      pickRow(openRow);
    }
    for (const r of D) {
      const el = cus.querySelector(`.r[data-row="${r.id}"]`); if (!el) continue;
      set(el.querySelector('.vv'), r.value);
      if (r.cards) {
        set(el.querySelector('.vf'), r.facts);
        const cur = r.cards.find((c) => c.on)?.v, art = el.querySelector('.val .art');
        if (art.dataset.c !== cur) { art.dataset.c = cur; art.innerHTML = cardImg(cur, 'tile'); }
        for (const c of r.cards) { const b = el.querySelector(`.card[data-v="${c.v}"]`); b.setAttribute('aria-checked', String(c.on)); set(b.querySelector('.cf'), c.facts); }
      } else for (const p of r.pickers) for (const o of p.options) { const b = el.querySelector(`[data-dial="${p.dial}"] [data-v="${o.v}"]`); if (!b) continue; set(b, o.label); b.setAttribute('aria-checked', String(o.on)); }
    }
    // the preview: the chosen course's card art, its metres, about how long, the fleet, the wind
    const S = model.setup ?? {}, h = customHand(S, 1), d = describeHand(h);
    set($('.pvh .k'), h.event && h.event !== 'fleet' ? `${d.event} · ${d.short}` : d.name); set($('.pvh .f'), `${d.length} · ${d.km.toFixed(1)} km`);
    if ($('.pva').dataset.c !== h.course) { $('.pva').dataset.c = h.course; $('.pva').innerHTML = cardImg(h.course, 'card'); }
    const pf = [['About', `${d.mins} min`], ['Fleet', h.event === 'match' ? '1 v 1' : h.rivals ? `${h.rivals + 1} boats` : 'you alone'], ['Wind', d.wind], ['Shifts', d.shifts]];
    $('.pvf').innerHTML = pf.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  }
  for (const g of root.querySelectorAll('.adj .seg')) g.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b || !model) return;
    const s = { ...model.setup }, v = b.dataset.v;
    if (g.dataset.seg === 'preset') Object.assign(s, PRESETS[v], { laylines: v === 'pro' ? !!s.laylines : false });
    else if (g.dataset.seg === 'skill') s.skill = v;
    else if (g.dataset.seg === 'aids') { s.aids = v; if (v !== 'pro') s.laylines = false; }
    else if (g.dataset.seg === 'laylines') s.laylines = v === 'on';
    onAdjust(s);
  });
  function adjust(open) {
    adj.hidden = !open; $('.lvl').setAttribute('aria-expanded', String(!!open));
    if (open) paintAdjust();
  }
  function paintAdjust() {
    if (!model) return;
    const s = model.setup, p = presetOf(s);
    const mark = (name, v) => { for (const b of root.querySelectorAll(`.adj .seg[data-seg=${name}] button`)) b.setAttribute('aria-checked', String(b.dataset.v === v)); };
    mark('preset', p); mark('skill', s.skill); mark('aids', s.aids); mark('laylines', s.laylines ? 'on' : 'off');
    set($('.pv'), p ? LEVELS[p].label : 'Custom'); set($('.sv'), SKILL_LABEL[s.skill]); set($('.av'), LEVELS[s.aids].label); set($('.lv'), s.laylines ? 'On' : 'Off');
    $('.adj .ll').hidden = s.aids !== 'pro';
  }
  // the cups from the model (places.js listCups: a race the device cannot run is left out); the cup shown is the player's pick, else the
  // first with a race; the rows are built once per shape and kept (all cups' rows exist, the others hidden)
  // a short side (a phone: data-screen tight) puts the cups in the right column where the course board is (the plate keeps the hand's art);
  // anywhere else they sit under the title. One node, moved: the page's tests and focus keep one set of rows
  // the race card (owner 2026-11-20): on a desktop the dealt hand ("Race now") sits on the course board's card, the board being its
  // course; a phone keeps it in the column (no board is drawn there)
  let cupsKey = '', selSeen = null;
  const mmss1 = (t) => { const m = Math.floor(t / 60), r = t - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; };
  function paintCups() {
    const cups = (model?.cups ?? []).map((c) => ({ ...c, races: c.races.filter((r) => r.available) })).filter((c) => c.races.length);
    const key = JSON.stringify(cups.map((c) => [c.id, c.races.map((r) => [r.id, r.best?.timeS ?? 0, r.best?.medal ?? '']), c.hunt?.found ?? 0]));
    selId = model?.selected ?? null;   // the engine's hand in force: the race selected (select, then go)
    if (selId !== selSeen) { selSeen = selId; const [k, v] = (selId ?? '').split(':'), sc = cups.find((c) => (k === 'cup' ? c.id === v : k === 'hunt' ? c.hunt?.id === v : c.races.some((r) => r.id === selId))); if (sc) cupId = sc.id; }   // a new selection brings its cup forward
    if (!cups.some((c) => c.id === cupId)) cupId = cups[0]?.id ?? null;
    if (key !== cupsKey) {
      cupsKey = key;
      $('.ctabs').innerHTML = cups.map((c) => `<button type="button" role="tab" class="ctab" data-cup="${esc(c.id)}" aria-selected="false"><span class="cx"><span class="cn">${esc(c.name)}</span><span class="cc">${c.races.length} ${c.races.length === 1 ? 'race' : 'races'}</span></span></button>`).join('');
      $('.rlists').innerHTML = cups.map((c) => `<div class="rlist" role="listbox" aria-label="${esc(c.name)} races" data-cup="${esc(c.id)}" hidden>${c.races.map((r, i) => `<button type="button" role="option" aria-selected="false" class="rc" data-race="${esc(r.id)}" aria-label="${esc(r.name)}: select it; double-click or Enter to sail"><span class="no">${i + 1}</span><span class="rt">${esc(r.name)}</span><span class="rs">${esc(r.line)}</span><span class="rb"><span class="rk">${r.km.toFixed(1)} km · ${r.mins} min</span><span class="bt">${r.best ? `best ${mmss1(r.best.timeS)}` : 'new'}<i data-medal="${esc(r.best?.medal ?? '')}"${r.best?.medal ? '' : ' hidden'}></i></span></span><span class="rch" aria-hidden="true">›</span></button>`).join('')}${c.hunt ? `<button type="button" role="option" aria-selected="false" class="rc rx" data-kind="hunt" data-race="hunt:${esc(c.hunt.id)}" aria-label="${esc(huntTitle(c.hunt))}: select it; double-click or Enter to explore"><span class="no"><i class="dia"></i></span><span class="rt">${esc(huntTitle(c.hunt))}</span><span class="rs">${esc(huntLine(c))}</span><span class="rb"><span class="rk">${c.hunt.found} of ${c.hunt.of} found</span></span><span class="rch" aria-hidden="true">›</span></button>` : ''}<button type="button" role="option" aria-selected="false" class="rc rx" data-kind="cup" data-race="cup:${esc(c.id)}" aria-label="Race all ${c.races.length}: select it; double-click or Enter to sail them"><span class="no">${c.races.length}×</span><span class="rt">Race all ${c.races.length === 3 ? 'three' : c.races.length}</span><span class="rs">The ${c.races.length === 3 ? 'three' : c.races.length} races back to back; lowest total points wins.</span><span class="rb"><span class="rk">cup points</span></span><span class="rch" aria-hidden="true">›</span></button></div>`).join('');
    }
    for (const b of root.querySelectorAll('.ctab')) b.setAttribute('aria-selected', String(b.dataset.cup === cupId));
    for (const b of root.querySelectorAll('.rc')) b.setAttribute('aria-selected', String(b.dataset.race === selId));
    for (const l of root.querySelectorAll('.rlist')) l.hidden = l.dataset.cup !== cupId;
    const cc = cups.find((c) => c.id === cupId);
    $('.cups').hidden = !cups.length;
  }
  function paint(m) {
    model = m;
    paintCups();
    const { hand, desc } = m;
    set($('.e1'), 'Lake Tahoe'); set($('.e2'), ''); set($('.e3'), ` · ${m.boat ?? 'Halcyon 28 ft'}`);   // the cup tab names the bay: the eyebrow does not repeat it
    // one card (owner 2026-11-20): under the races, the selected race's one line and To the line; the lake behind the hub is its preview
    const ri = m.cups?.flatMap((c) => c.races).find((r) => r.id === (m.selected ?? '').replace(/^(cup|hunt):.*$/, hand.place)) ?? null;
    const bestW = ri?.best ? `best ${mmss1(ri.best.timeS)}${ri.best.medal ? ` · ${ri.best.medal}` : ''}` : 'no best yet';
    const kind = (m.selected ?? '').split(':')[0], huntSel = kind === 'hunt' ? m.cups?.map((c) => c.hunt).find((h) => h && `hunt:${h.id}` === m.selected) : null;
    set($('.selc .go'), huntSel ? 'Explore ›' : 'To the line ›');
    set($('.sl'), huntSel ? `${huntSel.of} corners · ${huntSel.found} of ${huntSel.of} found · free sailing, no clock`
      : ri ? `${kind === 'cup' ? `${m.cups.find((c) => `cup:${c.id}` === m.selected)?.races.length ?? 3} races · starts here · ` : ''}${ri.km.toFixed(1)} km · ${ri.mins} min${kind === 'cup' ? '' : ` · ${hand.rivals} ${hand.rivals === 1 ? 'rival' : 'rivals'} · ${bestW}`}` : `${desc.name} · about ${desc.mins} min`);
    const p = presetOf(m.setup);
    set($('.lvl .t'), `Level · ${p ? LEVELS[p].label : 'Custom'}`);
    { const c = clampCustom(m.setup?.custom); set($('.cusr .t b'), m.custom ? '· yours' : ''); set($('.cusr .s'), `${courseOf(c.course).short} · ${WINDS.find((w) => w.level === c.wind)?.name} · ${shiftOf(c.shifts).label.toLowerCase()}`); }
    set($('.lvl .s'), `${desc.skill} rivals · ${desc.aids} aids · pace ${desc.pace}`);
    root.dataset.hand = String(hand.seed);
    if (!adj.hidden) paintAdjust();
    paintCustom();
  }
  // Esc: the Adjust sheet first, then back to the lake (before the page's own Esc opens the home menu)
  const onKey = (e) => {
    if (root.hidden || root.dataset.out != null) return;
    const sheet = (!cus.hidden && cus.dataset.out == null) || !adj.hidden;
    if (!sheet && !e.altKey && !e.ctrlKey && !e.metaKey && typing()) {   // select, then go (the arrows and Enter act on the races only while the focus is on the list or nowhere)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.stopImmediatePropagation(); e.preventDefault(); moveSel(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Enter' && selId && !e.target?.closest?.('.ctab')) { e.stopImmediatePropagation(); e.preventDefault(); start(selId); return; }
    }
    if (e.code !== 'Escape' && e.key !== 'Escape') return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!cus.hidden && cus.dataset.out == null) { if (openRow) pickRow(null); else custom(false); } else if (!adj.hidden) adjust(false); else onLeave();
  };
  globalThis.addEventListener?.('keydown', onKey, true);
  return {
    root,
    // phase 2: the hub opens on the cup of the area the boat is in (model.cupNow)
    show(m) { clearTimeout(hideT); delete root.dataset.out; if (m?.cupNow) cupId = m.cupNow; paint(m); adjust(false); custom(false, { instant: true }); root.hidden = false; doc.documentElement.classList.add('v2-rg-hub'); },
    paint,
    // step D1: the hub fades out (HUB_OUT_MS) while the race's plates fade in under it; hidden at the end
    hide() {
      if (root.hidden) return;
      adjust(false); doc.documentElement.classList.remove('v2-rg-hub'); root.dataset.out = '';
      clearTimeout(hideT); hideT = setTimeout(() => { root.hidden = true; delete root.dataset.out; custom(false, { instant: true }); }, HUB_OUT_MS);
    },
    adjust, custom, pickRow,
    get open() { return !root.hidden && root.dataset.out == null; }, get adjustOpen() { return !adj.hidden; }, get customOpen() { return !cus.hidden && cus.dataset.out == null; }, get pickerOpen() { return openRow; },
    dispose() { clearTimeout(hideT); clearTimeout(cusOut); globalThis.removeEventListener?.('keydown', onKey, true); root.remove(); doc.documentElement.classList.remove('v2-rg-hub'); },
  };
}
