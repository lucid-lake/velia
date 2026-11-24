// Regatta's plates on v2's page (§ 10.2; mockups 1–6): the coach's one line under the top bar (with the race
// officer's call under it), the watch (the clock, the line's metres and seconds, the time to burn or the next mark, the wind),
// the fleet, the tags over the ends, the ghost, the rival and the mark, an edge tag for a mark off the screen. Brand theme:
// navy plates, cream ink, amber only for a lit/next state. Phones: the watch top-left and small, the fleet folded
// to one line top-right, the coach line one line (§ 10.2). Text is written only when it changes.
// R3: the card shows ONE line (the coach's step, the officer's hail or a note: v2/regatta/coach.js arbitrates), the level picker (on
// the first race, and from the watch's level chip), the results card at the finish (place, time, the gap to the winner, the medal,
// one tip, Race again and Home). Leave race (owner, 2026-11-20): the watch's Leave beside Restart (asks "Leave race?" while the race is in
// progress: inProgress()), the results card's Leave (at once); both call onLeave().
//   const U = createRaceUi({ canvas, onHelper, onRestart, onLevel, onHome, onHub, onShowCourse, onLeave, inProgress });   onHub: the results card's New hand (the hub)  U.line(o | null), U.watch(o), U.fleet(rows, clock),
//   U.tag(id, x | null, y, text, sub, amber), U.edge(o | null), U.helperButton(show), U.level(aids), U.picker(show),
//   U.results(model | null), U.plate(id, x | null, y, text) (a mark's number plate on the buoy), U.card(svg | null, { open, show }) (the
//   course card, desktop: open for the pre-start's first seconds, then folded to a tap on the watch's first line), U.dispose()
// Step C (owner 2026-11-17): U.fleet(rows, clock, head) — head: the race chip's own words (a match race "Ahead 12 m" / "Behind 8 m", a
// time trial's split, a pursuit's "Start in 14 s"); the results card's model may carry title (a match race's "You win the match"),
// mark (the disc's figure), cup ({ rows, raceN, of, done }: the series' standings, the podium at the end) and the Cup's buttons
// (createRaceUi({ …, onCupNext, onCupNew }): Next race ›, Start a new Cup)
import { profile, LIMITS } from '../../src/core/profile.js';
import { LEVELS, LEVEL_IDS } from '../sim/raceLevels.js';

const CSS = `
html.v2-regatta .lk-hint{display:none!important}
/* R4: the race's HUD as a broadcast graphics package (the owner, 2026-11-14: "large navy colour blocks"): one row
   height, one radius, one edge margin, thin translucent strips (a dark gradient scrim, the text shadowed), solid colour only for the
   small accents (the place number, the boats' chips, the warning bar); fixed places: the clock pill top-left, the timing tower top-right,
   the coach and the officer as a lower third, the tags on the water as labels on a leader line */
#rg{--rh:26px;--rr:6px;--rm:var(--lk-edge-gap,14px);--rf:13px;--rs:11px;--rtop:calc(var(--lk-cap-top,58px) + 12px);--rbg:rgb(var(--lk-brand-navy) / .62);--rbg2:rgb(var(--lk-brand-navy) / .30);--rsh:0 1px 2px rgb(0 0 0 / .75),0 0 6px rgb(0 0 0 / .35);
  position:fixed;inset:0;pointer-events:none;z-index:6;font-family:var(--lk-font);color:rgb(var(--lk-cream));font-size:var(--rf);line-height:1.2}
#rg .pl{border-radius:var(--rr);text-shadow:var(--rsh)}
#rg .strip{background:linear-gradient(90deg,var(--rbg),var(--rbg2));backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
/* the clock pill: the countdown and one readout on one row, the cue (amber) on a second only when there is one */
#rg .watch{position:absolute;left:var(--rm);top:var(--rtop);padding:0 10px 0 0;pointer-events:auto;display:grid;grid-template-columns:auto 1fr;column-gap:10px;align-items:center;max-width:min(360px,62vw)}
#rg .watch .clk{grid-row:1 / span 2;height:calc(var(--rh) * 1.5);min-width:58px;padding:0 10px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.02em;background:rgb(var(--lk-brand-navy) / .88);border-radius:var(--rr) 0 0 var(--rr);border-left:3px solid rgb(var(--lk-cream) / .85)}
#rg .watch.warn .clk{border-left-color:rgb(var(--lk-amber));color:rgb(var(--lk-amber))}
#rg .watch .l{font-size:var(--rf);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rg .watch .l2:empty{display:none}
#rg .watch .a{color:rgb(var(--lk-amber))}
#rg .watch .l1.fl{font-weight:600;animation:rgfl .45s ease-in-out 4}
@keyframes rgfl{50%{opacity:.3}}
@media (prefers-reduced-motion:reduce){#rg .watch .l1.fl{animation:none}}
#rg .watch .l3,#rg .watch .lv{display:none}
#rg .watch button.help{grid-column:2;justify-self:start;margin:4px 0;font:inherit;font-size:var(--rs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgb(var(--lk-brand-navy));background:rgb(var(--lk-amber));border:0;border-radius:var(--rr);padding:0 10px;height:var(--rh);min-width:44px;cursor:pointer;text-shadow:none}
#rg .watch button[hidden]{display:none}
#rg .watch .acts{position:absolute;right:4px;top:4px;display:flex;gap:4px}
#rg .watch .acts button{height:var(--rh);padding:0;font:inherit;line-height:1;color:rgb(var(--lk-cream));background:rgb(var(--lk-cream) / .1);border:1px solid rgb(var(--lk-cream) / .35);border-radius:var(--rr);cursor:pointer;text-shadow:none}
#rg .watch button.rst{width:var(--rh);font-size:15px}
#rg .watch button.lvr{padding:0 8px;font-size:var(--rs);font-weight:600;letter-spacing:.08em;text-transform:uppercase}
#rg .watch .acts button:focus-visible,#rg .lq button:focus-visible{outline:2px solid rgb(var(--lk-cream));outline-offset:1px}
#rg .watch{padding-right:calc(var(--rh) + 74px)}
/* Leave race? (owner, 2026-11-20): one question under the watch while the race is in progress; Yes leaves, No (or Esc) stays */
#rg .lq{position:absolute;left:var(--rm);top:calc(var(--rtop) + var(--rh) * 1.5 + 8px);display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;pointer-events:auto;background:rgb(var(--lk-brand-navy) / .9);border-left:3px solid rgb(var(--lk-amber))}
#rg .lq[hidden]{display:none}
#rg .lq span{font-size:var(--rf);font-weight:600;margin-right:4px}
#rg .lq button{font:inherit;font-size:var(--rf);height:32px;min-width:56px;padding:0 12px;border-radius:var(--rr);cursor:pointer;text-shadow:none}
#rg .lq .y{color:rgb(var(--lk-brand-navy));background:rgb(var(--lk-amber));border:0;font-weight:600}
#rg .lq .n{color:rgb(var(--lk-cream));background:transparent;border:1px solid rgb(var(--lk-cream) / .45)}
:root[data-hand=touch] #rg .lq button{height:44px}
/* the race hides Sail's own HUD where the race's takes its place (the owner, 2026-11-14: the clock sat on the nav column's MARK WP
   readout): the nav column (COG, TWS, TWA, VMG, heel, the passage's WP, DTW, BTW, TTG, XTE); the passage plan's route steps aside too
   (index.js sailHud) */
html.v2-regatta .lk-nav{display:none!important}
/* the timing tower: narrow rows, the place in a solid block, the chip, the name, the gap */
#rg .fleet{position:absolute;right:var(--rm);top:var(--rtop);width:196px;pointer-events:auto;cursor:default;text-shadow:var(--rsh)}
#rg .fleet .h{height:20px;display:flex;align-items:center;padding:0 8px;font-size:var(--rs);letter-spacing:.12em;text-transform:uppercase;opacity:.85;background:linear-gradient(90deg,var(--rbg2),transparent);border-radius:var(--rr) var(--rr) 0 0}
#rg .fleet .r{display:flex;align-items:center;gap:7px;height:22px;margin-top:2px;padding-right:8px;background:linear-gradient(90deg,var(--rbg),var(--rbg2));border-radius:0 var(--rr) var(--rr) 0}
#rg .fleet .r span:first-child{width:22px;height:22px;flex:none;display:flex;align-items:center;justify-content:center;font-weight:600;font-variant-numeric:tabular-nums;background:rgb(var(--lk-brand-navy) / .9);text-shadow:none}
#rg .fleet .r.me span:first-child{background:rgb(var(--lk-amber));color:rgb(var(--lk-brand-navy))}
#rg .fleet .r.me .nm{color:rgb(var(--lk-amber))}
#rg .fleet .r .cd{display:none;font-weight:600;letter-spacing:.04em}
#rg .fleet .r .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rg .fleet .r .sn{opacity:.7;font-size:var(--rs);font-variant-numeric:tabular-nums}
#rg .fleet .r .gp{min-width:3.6em;text-align:right;font-variant-numeric:tabular-nums}
#rg .ch{display:inline-block;width:8px;height:8px;border-radius:2px;margin:0 6px 1px 0;vertical-align:middle;box-shadow:0 0 0 1px rgb(var(--lk-cream) / .6)}
/* the coach and the officer: a lower third, one strip, the speaker as a small label in it; amber bar for the coach, cream for the officer */
#rg .coach{position:absolute;left:50%;bottom:calc(var(--lk-foot,72px) + 64px);transform:translateX(-50%);max-width:min(620px,calc(100vw - 2 * var(--rm)));min-height:var(--rh);padding:4px 14px 4px 12px;display:flex;align-items:baseline;gap:10px;border-left:3px solid rgb(var(--lk-amber));background:linear-gradient(90deg,var(--rbg),var(--rbg2) 85%,transparent);border-radius:0 var(--rr) var(--rr) 0;transition:opacity .35s;z-index:2}
#rg .coach .o{order:-1;flex:none;font-size:var(--rs);letter-spacing:.1em;text-transform:uppercase;opacity:.8;white-space:nowrap}
#rg .coach .t{font-size:14px;font-weight:500;line-height:1.3}
#rg .coach.off{opacity:0}
#rg .coach.of{border-left-color:rgb(var(--lk-cream) / .8)}
#rg .pick,#rg .res{z-index:3}
#rg.rs .watch,#rg.rs .fleet,#rg.rs .coach,#rg.rs .tag,#rg.rs .edge,#rg.rs .pick{display:none!important}
/* the first race's level picker: one strip under the clock (afterwards: Setup's race level row) */
#rg .pick{position:absolute;left:var(--rm);top:calc(var(--rtop) + var(--rh) * 2 + 10px);padding:6px 10px;pointer-events:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:calc(100vw - 2 * var(--rm) - 210px)}
#rg .pick[hidden]{display:none}
#rg .pick .h{font-size:var(--rs);letter-spacing:.1em;text-transform:uppercase;opacity:.85}
#rg .pick .row{display:flex;gap:4px}
#rg .pick button{font:inherit;font-size:var(--rf);color:rgb(var(--lk-cream));background:rgb(var(--lk-cream) / .08);border:1px solid rgb(var(--lk-cream) / .35);border-radius:var(--rr);padding:0 10px;height:var(--rh);min-width:44px;cursor:pointer;text-shadow:none}
#rg .pick button[aria-checked=true]{background:rgb(var(--lk-amber));color:rgb(var(--lk-brand-navy));border-color:rgb(var(--lk-amber))}
#rg .pick .d{display:none}
#rg .pick .ll[hidden]{display:none}
/* the results card: the end of the race (the one panel the HUD shows alone), in the same tokens */
#rg .res{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(400px,calc(100vw - 2 * var(--rm)));max-height:86vh;overflow:auto;padding:16px 18px 14px;pointer-events:auto;text-align:center;background:linear-gradient(180deg,rgb(var(--lk-brand-navy) / .82),rgb(var(--lk-brand-navy) / .66));backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-top:3px solid rgb(var(--lk-amber))}
#rg .res[hidden]{display:none}
#rg .res .md{width:48px;height:48px;margin:0 auto 6px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;color:rgb(var(--lk-brand-navy));text-shadow:none;box-shadow:inset 0 -3px 0 rgb(0 0 0 / .18)}
#rg .res .md.gold{background:radial-gradient(circle at 35% 30%,#fbe7a6,#d8a93c 60%,#a57a1e)}
#rg .res .md.silver{background:radial-gradient(circle at 35% 30%,#ffffff,#c4cad4 60%,#8d95a3)}
#rg .res .md.bronze{background:radial-gradient(circle at 35% 30%,#f4c9a0,#b97b47 60%,#80512a)}
#rg .res .md.none{background:rgb(var(--lk-cream) / .12);color:rgb(var(--lk-cream));box-shadow:none}
#rg .res .mn{font-size:var(--rs);letter-spacing:.12em;text-transform:uppercase;opacity:.8}
#rg .res .pn{font-size:28px;font-weight:500;line-height:1.1;margin-top:2px}
#rg .res .tm{font-size:var(--rf);margin-top:4px;font-variant-numeric:tabular-nums}
#rg .res .gp{font-size:var(--rf);opacity:.85;margin-top:2px;font-variant-numeric:tabular-nums}
#rg .res .tip{margin:10px 0 2px;padding:6px 10px;background:rgb(var(--lk-cream) / .07);border-left:3px solid rgb(var(--lk-amber));border-radius:0 var(--rr) var(--rr) 0;text-align:left;font-size:var(--rf);line-height:1.35}
#rg .res .tip b{display:block;font-size:var(--rs);letter-spacing:.12em;text-transform:uppercase;opacity:.75;font-weight:500;margin-bottom:2px}
#rg .res .bt{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px}
#rg .res .bt button{font:inherit;font-size:14px;border-radius:var(--rr);padding:0 12px;height:44px;cursor:pointer;flex:1;max-width:180px;text-shadow:none;white-space:nowrap}
#rg .res .bt .again{color:rgb(var(--lk-brand-navy));background:rgb(var(--lk-amber));border:0;font-weight:600}
#rg .res .bt .home,#rg .res .bt .hand,#rg .res .bt .leave{color:rgb(var(--lk-cream));background:transparent;border:1px solid rgb(var(--lk-cream) / .45)}
#rg .res .bt kbd{font:inherit;font-size:var(--rs);opacity:.7;margin-left:6px}
#rg .res .bt .next{color:rgb(var(--lk-brand-navy));background:rgb(var(--lk-amber));border:0;font-weight:600}
#rg .res .bt button[hidden]{display:none}
/* step C: the Emerald Cup's standings after a race, the podium at the end (your row amber) */
#rg .res .cup{margin:10px 0 0;text-align:left}
#rg .res .cup[hidden]{display:none}
#rg .res .cup .ch2{font-size:var(--rs);letter-spacing:.12em;text-transform:uppercase;opacity:.8;margin-bottom:4px}
#rg .res .cup table{width:100%;border-collapse:collapse;font-size:var(--rf);font-variant-numeric:tabular-nums}
#rg .res .cup td{padding:2px 4px;white-space:nowrap}
#rg .res .cup td.n{width:1.6em;text-align:right;opacity:.8}
#rg .res .cup td.p{text-align:right;font-weight:600}
#rg .res .cup td.r{text-align:right;opacity:.7;font-size:var(--rs)}
#rg .res .cup tr.me td{color:rgb(var(--lk-amber))}
#rg .res .pod{display:flex;align-items:flex-end;justify-content:center;gap:6px;margin:6px 0 2px}
#rg .res .pod[hidden]{display:none}
#rg .res .pod div{flex:1;max-width:110px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;border-radius:var(--rr) var(--rr) 0 0;background:rgb(var(--lk-cream) / .1);padding:4px 4px 6px;font-size:var(--rs);line-height:1.25;text-align:center}
#rg .res .pod div b{font-size:18px;font-weight:600}
#rg .res .pod div.me{background:rgb(var(--lk-amber) / .22);box-shadow:inset 0 0 0 1px rgb(var(--lk-amber));color:rgb(var(--lk-amber))}
#rg .res .pod .p1{height:84px}#rg .res .pod .p2{height:66px}#rg .res .pod .p3{height:52px}
#rg .res .pod .nm2{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
/* the tags on the water: no box, a label on a thin leader line to the boat or the mark */
#rg .tag{position:absolute;left:0;top:0;transform:translate(-50%,-100%);will-change:transform;padding:0 2px 14px;font-size:12px;line-height:1.15;white-space:nowrap;text-align:center;text-shadow:var(--rsh)}
#rg .tag::after{content:'';position:absolute;left:50%;bottom:0;width:1px;height:11px;background:rgb(var(--lk-cream) / .8);box-shadow:0 0 2px rgb(0 0 0 / .6)}
#rg .tag .m{font-weight:600}
#rg .tag .s{font-size:var(--rs);opacity:.9}
#rg .tag.am{color:rgb(var(--lk-amber))}
#rg .tag.am::after{background:rgb(var(--lk-amber))}
#rg .tag .m .ch{margin-right:5px}
#rg .tag[hidden],#rg .edge[hidden]{display:none}
#rg .edge{position:absolute;left:0;top:0;transform:translate(-50%,-50%);height:var(--rh);padding:0 10px;display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;background:linear-gradient(90deg,var(--rbg),var(--rbg2))}
#rg .edge .ar{display:inline-block;color:rgb(var(--lk-amber))}
#rg .edge .s{font-size:var(--rs);opacity:.85}
#rg .edge .s:empty{display:none}
/* a mark's number plate on its buoy (owner 2026-11-16): a small cream plate, navy figure, no leader */
#rg .plt{position:absolute;left:0;top:0;transform:translate(-50%,-100%);will-change:transform;min-width:18px;height:18px;padding:0 4px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;line-height:1;color:rgb(var(--lk-brand-navy));background:rgb(var(--lk-cream) / .92);box-shadow:0 1px 3px rgb(0 0 0 / .45)}
#rg .plt[hidden]{display:none}
/* the course card (owner 2026-11-16): bottom-left, the hub's board art with the marks numbered; a desktop piece (a phone has none) */
#rg .ccard{position:absolute;left:var(--rm);bottom:calc(var(--lk-foot,72px) + 64px);width:200px;padding:6px 10px 8px;pointer-events:auto;z-index:2;background:linear-gradient(180deg,rgb(var(--lk-brand-navy) / .78),rgb(var(--lk-brand-navy) / .62));backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
#rg .ccard[hidden]{display:none}
#rg .ccard .h{display:flex;align-items:center;justify-content:space-between;font-size:var(--rs);letter-spacing:.12em;text-transform:uppercase;opacity:.9}
#rg .ccard .h button{font:inherit;font-size:15px;line-height:1;letter-spacing:0;color:rgb(var(--lk-cream));background:none;border:0;padding:2px 4px;cursor:pointer;opacity:.8;text-shadow:none}
#rg .ccard .art svg{width:100%;height:auto;display:block}
#rg .ccard .fly{margin-top:4px;width:100%;font:inherit;font-size:var(--rf);color:rgb(var(--lk-cream));background:rgb(var(--lk-cream) / .08);border:1px solid rgb(var(--lk-cream) / .35);border-radius:var(--rr);height:var(--rh);cursor:pointer;text-shadow:none}
#rg .ccard .fly[hidden]{display:none}
#rg .watch .l1.tap{cursor:pointer}
#rg.rs .ccard,#rg.rs .plt{display:none!important}
/* a phone upright: the clock and the tower under the dials, the tower top 3 and her own row, 3-letter codes; the lower third over
   the controls */
:where(:root[data-screen~=portrait][data-screen~=slim]) #rg{--rh:22px;--rm:10px;--rf:12px;--rs:11px;--rtop:calc(var(--lk-cap-top,58px) + 118px)}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .watch{max-width:calc(100vw - 2 * var(--rm) - 128px);column-gap:8px}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .watch .clk{font-size:17px;min-width:48px;padding:0 7px}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet{width:126px}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet .h{white-space:nowrap;overflow:hidden}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet .r .cd{white-space:nowrap}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .coach .o,:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .edge .s{display:none}   /* the bar's colour says who speaks (amber the coach, cream the officer) */
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .ccard{display:none!important}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet .r{height:20px;gap:5px}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet .r span:first-child{width:20px;height:20px}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet .r .nm,:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet .r .sn{display:none}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet .r .cd{display:block;flex:1}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet .r:nth-child(n+4):not(.me){display:none}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet.open .r{display:flex!important}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet{cursor:pointer}
  /* folded to one chip, "5th of 6 · +36 m" (owner 2026-11-15: the board took the top third of the water ahead); a tap opens the tower */
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet{width:auto;min-width:96px;max-width:150px}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet:not(.open) .r{display:none!important}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet:not(.open) .h{height:var(--rh);padding:0 10px;justify-content:center;letter-spacing:.06em;opacity:1;background:linear-gradient(90deg,var(--rbg),var(--rbg2));border-radius:var(--rr)}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .fleet.open{width:126px}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .coach{bottom:186px;padding:3px 10px;gap:6px;flex-wrap:wrap}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .coach .t{font-size:13px}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .pick{left:var(--rm);right:var(--rm);max-width:none;top:calc(var(--rtop) + var(--rh) * 2 + 8px)}
  :where(:root[data-screen~=portrait][data-screen~=slim]) #rg .res{top:calc(var(--lk-cap-top,58px) + 110px);transform:translateX(-50%);padding:12px 14px}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .res .bt kbd{display:none}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .res .md{width:40px;height:40px;font-size:18px}:where(:root[data-screen~=portrait][data-screen~=slim]) #rg .res .pn{font-size:22px}
/* a phone sideways: the clock and the tower in the top corners, the strip under the top bar (the controls own the bottom) */
:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg{--rh:22px;--rm:10px;--rf:12px;--rs:11px;--rtop:calc(var(--lk-cap-top,50px) + 6px)}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .watch{max-width:27vw}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .watch .clk{font-size:17px;min-width:48px}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .fleet{width:150px}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .fleet .r{height:20px}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .fleet .r span:first-child{width:20px;height:20px}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .fleet .r .sn{display:none}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .fleet .h{display:none}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .coach{top:calc(var(--lk-cap-top,50px) + 6px);bottom:auto;max-width:36vw;padding:3px 10px}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .coach .o{display:none}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .coach .t{font-size:12.5px}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .pick{top:calc(var(--rtop) + var(--rh) * 2 + 8px);max-width:50vw}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .ccard{display:none!important}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res{width:min(560px,70vw);padding:10px 14px;display:grid;grid-template-columns:72px 1fr;column-gap:12px;text-align:left;align-items:center}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res .md{grid-row:1 / span 4;margin:0 auto}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res .pn{font-size:22px}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res .tip{grid-column:1 / span 2;margin:6px 0 0}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res .bt{grid-column:1 / span 2;margin-top:6px}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res .bt kbd{display:none}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res.cupon{width:min(640px,80vw);max-height:calc(100dvh - var(--lk-cap-top,50px) - 12px);top:calc(var(--lk-cap-top,50px) + 6px);transform:translateX(-50%);grid-template-columns:56px minmax(0,1fr) minmax(0,1.15fr);align-items:start}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res.cupon .md{width:40px;height:40px;font-size:18px}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res.cupon .cup{grid-column:3;grid-row:1 / span 5;margin:0}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res.cupon .tip{display:none}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res.cupon .bt{grid-column:1 / span 3}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res .cup td{padding:1px 3px}
  :where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res .pod .p1{height:66px}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res .pod .p2{height:58px}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res .pod .p3{height:52px}:where(:root[data-screen~=tight]:not([data-screen~=portrait])) #rg .res .pod div b{font-size:15px}`;

export const mmss = (s) => { const a = Math.max(0, Math.round(Math.abs(s))); return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`; };
// the watch's lines (pure: v2/tests/regatta.test.mjs): the clock (a countdown before the gun), the line or the leg, the cue
export function watchLines(o) {
  const out = { clk: o.clock < 0 ? mmss(o.clock) : `${mmss(o.clock)}`, l1: '', l2: '', l1amber: false, l1flash: false, l2amber: false, l3: o.wind ? `Wind from ${o.wind.from}, ${o.wind.kn} kn` : '' };
  if (o.finish != null) { out.l1 = `Finished in ${mmss(o.finish)}`; out.l2 = ''; return out; }
  if (o.ocs) { out.l1 = `Over the line by ${Math.max(0, Math.round(-o.line.distM))} m`; out.l2 = 'Over early: dip back below the line'; out.l2amber = true; return out; }
  if (o.clock < 0 || o.status === 'behind') {
    const t = o.line.timeS != null && o.line.timeS < 600 ? ` · ${Math.round(o.line.timeS)} s away` : '';
    out.l1 = `Line ${Math.max(0, Math.round(o.line.distM))} m${t}`;
    // a pursuit (step C): her own start, so many seconds after the gun (slotIn: the seconds left to it)
    if (o.slotIn != null && o.slotIn > 0.5) { out.l2 = `Your start in ${Math.ceil(o.slotIn)} s`; out.l2amber = true; return out; }
    if (o.clock < 0 && o.line.burnS != null) { const b = Math.round(o.line.burnS); out.l2 = b >= 1 ? `Time to burn ${b} s` : b <= -1 ? `Late by ${-b} s: go now` : 'On time: go'; out.l2amber = true; }
    else if (o.clock >= 0) { out.l2 = 'Cross the line now'; out.l2amber = true; }
    return out;
  }
  // racing (owner 2026-11-16, one voice per fact): line 1 the leg, the mark and the side (marks.js legLine: "Leg 1 of 3 · Mark 1 · round to
  // port"); the metres live on the mark's tag; line 2 only the amber cue
  if (o.next) { out.l1 = o.next.text ?? ''; out.l2 = ''; }
  if (o.layline) { out.l2 = `Tack line in ${Math.round(o.layline.m)} m`; out.l2amber = true; }
  // the rounding (owner 2026-11-17): a mark just counted flashes "Mark 1 ✓" (amber) over the leg line; near a mark not counted yet,
  // "Round mark 1 →" says what is missing
  if (o.flash) { out.l1 = o.flash; out.l1amber = true; out.l1flash = true; }
  else if (o.cue) { out.l1 = o.cue; out.l1amber = true; }
  return out;
}

// R4: the ladder's gap for a boat behind the leader (pure): metres on a beat (the TV ladder), seconds after a mark (rules.js liveGap)
export function ladderGap(g, beat) {
  if (!g || (g.s <= 0 && g.m <= 0)) return '';
  return beat ? `+${Math.max(0, Math.round(g.m))} m` : `+${Math.max(0, Math.round(g.s))} s`;
}
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
export const placeWord = (i, n) => `${ORD[i] ?? `${i + 1}th`} of ${n}`;

export function createRaceUi({ canvas, onHelper = () => {}, onRestart = () => {}, onLevel = () => {}, onHome = () => {}, onHub = null, onShowCourse = () => {}, onCupNext = () => {}, onCupNew = () => {}, onLeave = () => {}, inProgress = () => true, doc = globalThis.document }) {
  if (!doc.getElementById('v2-regatta-css')) { const st = doc.createElement('style'); st.id = 'v2-regatta-css'; st.textContent = CSS; doc.head.appendChild(st); }
  doc.documentElement.classList.add('v2-regatta');
  const root = doc.createElement('div'); root.id = 'rg';
  root.innerHTML = `<div class="coach pl off" role="status" aria-live="polite"><div class="t"></div><div class="o"></div></div>
<div class="watch pl strip" aria-label="Race watch"><div class="clk">0:45</div><div class="l l1"></div><div class="l l2 a"></div><div class="l l3 w"></div><button type="button" class="lv" aria-haspopup="true">Beginner</button><button type="button" class="help" hidden>Helper</button><div class="acts"><button type="button" class="rst" aria-label="Restart the race" title="Restart the race">\u21BA</button><button type="button" class="lvr" aria-label="Leave race" title="Leave race: sail on freely">Leave</button></div></div>
<div class="lq pl" role="alertdialog" aria-label="Leave race?" hidden><span>Leave race?</span><button type="button" class="y">Yes</button><button type="button" class="n">No</button></div>
<div class="pick pl strip" role="dialog" aria-label="Race level" hidden><div class="h">Your level</div><div class="row" role="radiogroup">${LEVEL_IDS.map((id) => `<button type="button" role="radio" data-lv="${id}" aria-checked="false">${LEVELS[id].label}</button>`).join('')}</div><div class="d"></div><div class="ll" hidden><button type="button" role="switch" class="llb" aria-checked="false">Laylines: off</button></div></div>
<div class="res pl" role="dialog" aria-label="Results" hidden><div class="md"></div><div class="mn"></div><div class="pn"></div><div class="tm"></div><div class="gp"></div><div class="tip"><b>Tip</b><span></span></div><div class="cup" hidden><div class="ch2"></div><div class="pod" hidden></div><table></table></div><div class="bt"><button type="button" class="next" hidden>Next race ›</button><button type="button" class="again">Race again</button>${onHub ? '<button type="button" class="hand">New hand</button>' : ''}<button type="button" class="leave" title="Leave race: sail on freely">Leave</button><button type="button" class="home">Home</button></div></div>
<div class="fleet pl" aria-label="Fleet"><div class="h">Fleet</div><div class="rows"></div></div>
<div class="edge pl strip" hidden><span class="ar">▲</span><span class="et"></span> <span class="s"></span></div>
<div class="ccard pl" role="dialog" aria-label="Course" hidden><div class="h"><span>Course</span><button type="button" class="x" aria-label="Fold the course card">\u00d7</button></div><div class="art"></div><button type="button" class="fly">Show course</button></div>`;
  doc.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const coach = $('.coach'), ct = $('.coach .t'), co = $('.coach .o'), clk = $('.watch .clk'), l1 = $('.watch .l1'), l2 = $('.watch .l2'), l3 = $('.watch .l3'), help = $('.watch .help');
  const fleetEl = $('.fleet'), watchEl = $('.watch');
  const rows = $('.fleet .rows'), fh = $('.fleet .h'), edge = $('.edge'), ear = $('.edge .ar'), et = $('.edge .et'), es = $('.edge .s');
  help.addEventListener('click', () => onHelper());
  // R4 (the owner: "R is also the jib"): no key restarts the race; R stays v1's jib sheet in every mode. Restart is the clock pill's
  // button and the results card's Race again (Enter on the focused button)
  $('.watch .rst').addEventListener('click', (e) => { e.stopPropagation(); onRestart(); });
  // Leave race (owner, 2026-11-20): beside Restart; while the race is in progress one question first ("Leave race?" Yes / No; Esc is
  // No, Enter on the focused Yes leaves); after the finish it leaves at once
  const lq = $('.lq'), lqYes = $('.lq .y'), lqNo = $('.lq .n');
  const win = doc.defaultView ?? globalThis;
  const onLqKey = (e) => { if (e.key === 'Escape' && !lq.hidden) { e.preventDefault(); e.stopImmediatePropagation(); ask(false); } };
  function ask(show) {
    if (show === !lq.hidden) return;
    lq.hidden = !show; doc.documentElement.classList.toggle('v2-rg-ask', !!show);   // the page's Esc waits (front.js escFirst): it is No here
    if (show) { win.addEventListener?.('keydown', onLqKey, true); try { lqYes.focus({ preventScroll: true }); } catch { /* */ } }
    else win.removeEventListener?.('keydown', onLqKey, true);
  }
  function leave() { ask(false); onLeave(); }
  $('.watch .lvr').addEventListener('click', (e) => { e.stopPropagation(); if (inProgress()) ask(lq.hidden); else leave(); });
  lqYes.addEventListener('click', (e) => { e.stopPropagation(); leave(); });
  lqNo.addEventListener('click', (e) => { e.stopPropagation(); ask(false); });
  const set = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  const tags = new Map();
  // the card: one line (the coach decides which, v2/regatta/coach.js); hidden when there is none
  let lineKey = '';
  function line(o) {
    const k = o ? `${o.kind}|${o.text}|${o.sub}` : '';
    if (k === lineKey) return; lineKey = k;
    if (!o) { coach.classList.add('off'); return; }
    set(ct, o.text); set(co, o.sub ?? ''); coach.classList.toggle('of', o.kind === 'officer'); coach.classList.remove('off');
  }
  // the level: the watch's chip, the picker (three levels; Pro's laylines are an option)
  const lvBtn = $('.watch .lv'), pick = $('.pick'), pd = $('.pick .d'), ll = $('.pick .ll'), llb = $('.pick .llb');
  let aidsNow = { level: 'beginner', laylines: true, laylinesOption: false };
  const paintPick = () => {
    for (const b of pick.querySelectorAll('[data-lv]')) b.setAttribute('aria-checked', String(b.dataset.lv === aidsNow.level));
    set(pd, LEVELS[aidsNow.level]?.line ?? ''); ll.hidden = !aidsNow.laylinesOption;
    llb.setAttribute('aria-checked', String(!!aidsNow.laylines)); set(llb, `Laylines: ${aidsNow.laylines ? 'on' : 'off'}`);
  };
  function level(a) { aidsNow = a; set(lvBtn, `${LEVELS[a.level]?.label ?? 'Beginner'} \u25BE`); paintPick(); }
  function picker(show) { pick.hidden = !show; root.classList.toggle('pk', !!show); if (show) paintPick(); }
  lvBtn.addEventListener('click', (e) => { e.stopPropagation(); picker(pick.hidden); });
  for (const b of pick.querySelectorAll('[data-lv]')) b.addEventListener('click', (e) => { e.stopPropagation(); onLevel(b.dataset.lv, b.dataset.lv === 'pro' && aidsNow.level === 'pro' && aidsNow.laylines); picker(false); });
  llb.addEventListener('click', (e) => { e.stopPropagation(); onLevel(aidsNow.level, !aidsNow.laylines); });
  // the results card
  const res = $('.res'), q = (c) => res.querySelector(c);
  q('.again').addEventListener('click', (e) => { e.stopPropagation(); onRestart(); });
  q('.home').addEventListener('click', (e) => { e.stopPropagation(); onHome(); });
  q('.leave').addEventListener('click', (e) => { e.stopPropagation(); leave(); });   // the race is over: no question
  q('.hand')?.addEventListener('click', (e) => { e.stopPropagation(); onHub?.(); });   // the front door: the hub with the next hand
  q('.next').addEventListener('click', (e) => { e.stopPropagation(); if (q('.next').dataset.k === 'new') onCupNew(); else onCupNext(); });   // the Cup: the next race, or a new Cup
  const MEDAL_WORD = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
  const escH = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let cupKey = '';
  function cupPanel(c) {
    const box = q('.cup'), nb = q('.next');
    res.classList.toggle('cupon', !!c);
    if (!c) { box.hidden = true; nb.hidden = true; q('.again').hidden = false; cupKey = ''; return; }
    box.hidden = false; nb.hidden = false; q('.again').hidden = true;   // a Cup race is sailed once: no Race again
    nb.dataset.k = c.done ? 'new' : 'next'; set(nb, c.done ? 'Start a new Cup' : `Next race \u203a`);
    set(q('.cup .ch2'), c.done ? `${c.name} \u00b7 final standings` : `${c.name} \u00b7 after race ${c.sailed} of ${c.of}`);
    const k = JSON.stringify(c.rows.map((r) => [r.id, r.pts, r.places])) + c.done;
    if (k === cupKey) return; cupKey = k;
    const pod = q('.pod');
    pod.hidden = !c.done;
    if (c.done) { const top = c.rows.slice(0, 3), at = [1, 0, 2].filter((i) => top[i]); pod.innerHTML = at.map((i) => `<div class="p${i + 1}${top[i].id === 'me' ? ' me' : ''}"><span class="nm2">${escH(top[i].name)}</span><b>${i + 1}</b><span>${top[i].pts} pts</span></div>`).join(''); }
    const rows = c.done ? c.rows.filter((r) => r.id === 'me' && r.rank > 3) : c.rows;   // the podium shows the top 3; under it only your own row if you are not on it
    q('.cup table').innerHTML = rows.map((r) => `<tr class="${r.id === 'me' ? 'me' : ''}"><td class="n">${r.rank}</td><td>${r.chip ? `<i class="ch" style="background:${escH(r.chip)}"></i>` : ''}${escH(r.name)}</td><td class="r">${r.places.map((p) => (p ?? 'DNF')).join(' \u00b7 ')}</td><td class="p">${r.pts}</td></tr>`).join('');
  }
  function results(m) {
    if (!m) { if (!res.hidden) { res.hidden = true; root.classList.remove('rs'); } return; }
    ask(false); root.classList.add('rs');   // the card alone: the watch, the fleet, the coach and the tags step aside
    const md = q('.md'); md.className = `md ${m.medal ?? 'none'}`; set(md, m.mark ?? (m.finished ? String(m.place) : '\u2013'));
    set(q('.mn'), m.kicker ?? (m.medal ? `${MEDAL_WORD[m.medal]} medal \u00b7 ${LEVELS[m.level]?.label ?? ''}` : `${LEVELS[m.level]?.label ?? ''}`));
    set(q('.pn'), m.title ?? (m.finished ? `${m.ord} of ${m.boats}` : 'Did not finish'));
    cupPanel(m.cup ?? null);
    set(q('.tm'), m.tmLine ?? (m.finished ? `Time ${m.time}${m.best ? ` \u00b7 ${m.best}` : ''}` : ''));
    set(q('.gp'), m.gap ?? '');
    set(q('.tip span'), m.tip?.text ?? '');
    if (res.hidden) { res.hidden = false; try { q('.again').focus({ preventScroll: true }); } catch { /* */ } }
  }
  function tick() { /* the card's line is set by line() at each paint */ }
  function watch(o) {
    const w = watchLines(o);
    set(clk, w.clk); set(l1, w.l1); set(l2, w.l2); set(l3, w.l3);
    l2.classList.toggle('a', w.l2amber); l1.classList.toggle('a', w.l1amber); l1.classList.toggle('fl', w.l1flash);
    watchEl.classList.toggle('warn', !!o.ocs);   // R4 HUD: the warning is an accent on the clock pill, not a new box
  }
  // R4: the ladder: place, colour chip, name, sail number, the gap to the leader; the player's row amber. Rows are built
  // when the order changes; the gaps' text when it changes. Phone upright: folded to "2nd of 6 · +38 m" (a tap opens it)
  let fleetKey = '', rowEls = [], meGap = '';
  fleetEl.addEventListener('click', (e) => { e.stopPropagation(); fleetEl.classList.toggle('open'); });
  function fleet(list, clock, head = null) {
    const k = list.map((r) => r.id).join(',') + (clock < 0 ? 'p' : 'r');
    const pf = profile.get(), portrait = (pf.h > pf.w && pf.tokens.includes('slim')) || doc.documentElement.classList.contains('lk-flat'), me = list.findIndex((r) => r.id === 'me');   // a phone's flat controls fold it too
    if (k !== fleetKey) {
      fleetKey = k; fleetEl.dataset.ids = list.map((r) => r.id).join(',');   // the order painted (the page test reads it)
      rows.innerHTML = list.map((r, i) => `<div class="r${r.id === 'me' ? ' me' : ''}${i === 0 ? ' first' : ''}"><span>${i + 1}</span><span class="cd">${r.hull ? `<i class="ch" style="background:${r.hull}"></i>` : ''}${String(r.name).slice(0, 3).toUpperCase()}</span><span class="nm">${r.hull ? `<i class="ch" style="background:${r.hull}"></i>` : ''}${r.name}</span>${r.sail != null ? `<span class="sn">${r.sail}</span>` : ''}<span class="gp"></span></div>`).join('');
      rowEls = [...rows.querySelectorAll('.gp')];
    }
    list.forEach((r, i) => { if (rowEls[i]) set(rowEls[i], r.gap ?? ''); });
    meGap = list[me]?.gap ?? '';
    if (head) { set(fh, head); return; }   // the race type's own chip (a match race's gap, a time trial's split, a pursuit's start)
    set(fh, portrait ? `${placeWord(me, list.length)}${meGap && !fleetEl.classList.contains('open') ? ` \u00b7 ${meGap}` : ''}` : clock < 0 ? `Fleet \u00b7 ${list.length}` : `Race \u00b7 ${placeWord(me, list.length)}`);
  }
  // the tags: text now, positions resolved once a frame in place() (R4: no tag over a plate, the watch's level chip among them, nor over
  // another tag: a clash moves the lower-priority tag up, then beside the plate, else hides it). Sizes estimated from the text (no
  // layout read per tag); the plates' boxes read once a frame
  const pendTags = [];
  function tag(id, x, y, text, sub, amber = false, chip = null, prio = 1) {
    let t = tags.get(id);
    if (x == null) { if (t && !t.el.hidden) t.el.hidden = true; if (t) t.want = false; return; }
    if (!t) { const el = doc.createElement('div'); el.className = 'tag pl'; el.innerHTML = '<div class="m"><i class="ch" hidden></i><span></span></div><div class="s"></div>'; root.appendChild(el); t = { el, chip: el.querySelector('.ch'), m: el.querySelector('.m span'), s: el.lastChild, want: false, x: 0, y: 0, w: 0, h: 0, prio: 1 }; tags.set(id, t); }
    set(t.m, text); set(t.s, sub ?? ''); t.s.hidden = !sub; t.el.classList.toggle('am', !!amber);
    if (chip) { t.chip.hidden = false; if (t.chip.dataset.c !== chip) { t.chip.dataset.c = chip; t.chip.style.background = chip; } } else t.chip.hidden = true;
    const pf = profile.get(), small = pf.tokens.includes('slim') || pf.h <= LIMITS.phoneShort, cw = small ? 6.6 : 7.3;   // the device profile's layout (src/core/profile.js)
    t.w = Math.max(text.length + (chip ? 2 : 0), (sub ?? '').length * 0.85) * cw + (small ? 16 : 20); t.h = sub ? (small ? 40 : 42) : (small ? 28 : 30);   // the label and its leader line
    t.x = Math.max(t.w / 2 + 4, Math.min(innerWidth - t.w / 2 - 4, x)); t.y = y; t.prio = prio; t.want = true;
    pendTags.push(t);
  }
  const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const boxes = [];
  function place() {
    const plates = [];
    // the top bar's band (the game bar sits above --lk-cap-top): a tag never goes under it
    const cap = parseFloat(getComputedStyle(doc.documentElement).getPropertyValue('--lk-cap-top')) || 58;
    // an upright phone: the band above the clock row holds the two dials too (a tag pushed up went over them)
    const pu = profile.get(), band = pu.h > pu.w && pu.tokens.includes('slim') ? Math.max(cap, watchEl.getBoundingClientRect().top - 4) : cap;
    plates.push({ l: -1e4, r: 1e5, t: -1e4, b: band });
    // Sail's own pieces the race keeps (the key legend, the chart and wind dials; a phone's flat controls, ui/flat.js): a tag keeps off them too
    for (const e of doc.querySelectorAll('.lk-keys, .lk-chart .pane, .lk-inst, div.lk-flat:not([hidden]) .fl-plate:not([hidden])')) { const r = e.getBoundingClientRect(); if (r.width && r.height && getComputedStyle(e).display !== 'none' && +getComputedStyle(e).opacity > 0.05) plates.push({ l: r.left - 4, r: r.right + 4, t: r.top - 4, b: r.bottom + 4 }); }
    for (const p of [fleetEl, watchEl, coach, pick, ccard]) { if (p.classList.contains('off') || p.hidden || root.classList.contains('rs')) continue; const r = p.getBoundingClientRect(); if (r.width) plates.push({ l: r.left - 4, r: r.right + 4, t: r.top - 4, b: r.bottom + 4 }); }
    pendTags.sort((a, b) => b.prio - a.prio);
    boxes.length = 0;
    for (const t of pendTags) {
      let x = t.x, y = t.y, ok = false;
      for (let k = 0; k < 5 && !ok; k++) {
        const bx = { l: x - t.w / 2, r: x + t.w / 2, t: y - t.h, b: y };
        const p = plates.find((q) => hit(bx, q)), o = boxes.find((q) => hit(bx, q));
        if (!p && !o) { ok = true; boxes.push(bx); break; }
        if (p && k === 1) { const nx = p.r + t.w / 2 + 2; if (nx + t.w / 2 < innerWidth) { x = nx; continue; } }
        if (p && k === 2 && p !== plates[0]) { x = t.x; y = p.b + t.h + 2; continue; }   // under the plate (an upright phone's watch and ladder)
        if (!o && p === plates[0]) { y = p.b + t.h + 2; continue; }   // under the top bar: drop below it
        y = (o ?? p).t - 2;
      }
      if (!ok || y - t.h < 0) { if (!t.el.hidden) t.el.hidden = true; continue; }
      t.el.hidden = false;
      t.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
    }
    pendTags.length = 0;
  }
  function edgeTag(o) {
    if (!o) { if (!edge.hidden) edge.hidden = true; return; }
    edge.hidden = false; set(et, o.text); set(es, o.sub ?? '');
    ear.style.transform = `rotate(${o.angleDeg.toFixed(0)}deg)`;
    // never over a plate (the fleet top-right, the watch): pushed below it
    let y = o.y; const er = edge.getBoundingClientRect();
    o.x = Math.max(er.width / 2 + 4, Math.min(innerWidth - er.width / 2 - 4, o.x));   // R4: never cut by the screen's edge
    const avoid = [fleetEl, watchEl, coach, ccard, ...doc.querySelectorAll('div.lk-flat:not([hidden]) .fl-plate:not([hidden])')].filter((p) => !p.classList.contains('off')).map((p) => p.getBoundingClientRect()).filter((r) => r.width);
    for (let pass = 0, moved = true; moved && pass < 6; pass++) { moved = false; for (const r of avoid) if (o.x + er.width / 2 > r.left && o.x - er.width / 2 < r.right && y + er.height / 2 > r.top && y - er.height / 2 < r.bottom) { y = r.bottom + er.height / 2 + 8; moved = true; } }   // until clear of every plate (one pushed below may land on the next)
    edge.style.transform = `translate(${o.x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
  }
  // the marks' number plates on their buoys: placed straight at the projected point (no leader, no clash pass: small, under the tags)
  const plates = new Map();
  function plate(id, x, y, text) {
    let el = plates.get(id);
    if (x == null) { if (el && !el.hidden) el.hidden = true; return; }
    if (!el) { el = doc.createElement('div'); el.className = 'plt'; root.insertBefore(el, root.firstChild); plates.set(id, el); }
    set(el, text); el.hidden = false;
    el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
  }
  // the course card (desktop): the board art, × folds it, a tap on the watch's first line opens it again; Show course (the fly-over)
  const ccard = $('.ccard'), cart = $('.ccard .art'), cfly = $('.ccard .fly');
  let cardSvg = '', cardOn = false;
  // the race's compact screen (was 'phone'): a layout 600 px wide or less (slim), 500 px tall or less, or the flat controls up
  const compactNow = () => { const pf = profile.get(); return pf.tokens.includes('slim') || pf.h <= LIMITS.phoneShort || doc.documentElement.classList.contains('lk-flat'); };
  function card(svg, { open = null, show = null } = {}) {
    if (svg != null && svg !== cardSvg) { cardSvg = svg; cart.innerHTML = svg; }
    if (svg === null) { cardSvg = ''; cart.innerHTML = ''; }
    if (open != null) cardOn = !!open && !!cardSvg && !compactNow();
    if (show != null) cfly.hidden = !show;
    ccard.hidden = !cardOn;
    l1.classList.toggle('tap', !!cardSvg && !compactNow());
  }
  $('.ccard .x').addEventListener('click', (e) => { e.stopPropagation(); card(undefined, { open: false }); });
  cfly.addEventListener('click', (e) => { e.stopPropagation(); card(undefined, { open: false }); onShowCourse(); });
  l1.addEventListener('click', (e) => { if (!cardSvg || compactNow()) return; e.stopPropagation(); card(undefined, { open: !cardOn }); });
  return {
    root, line, tick, watch, fleet, tag, place, edge: edgeTag, level, picker, results, plate, card,
    get cardOpen() { return cardOn; }, get compactScreen() { return compactNow(); },
    get pickerOpen() { return !pick.hidden; }, get resultsOpen() { return !res.hidden; },
    helperButton(show) { help.hidden = !show; },
    dispose() { ask(false); root.remove(); doc.documentElement.classList.remove('v2-regatta'); },
    ask, get asking() { return !lq.hidden; },   // Leave race? shown (the watch's Leave while the race is in progress)
  };
}
