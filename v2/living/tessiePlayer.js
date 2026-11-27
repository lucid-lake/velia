// Play as Tessie on the page (owner, 2026-11-20, every default approved). Her chunk only
// (living/tessie.js re-exports it), made by main.js where feature('playTessie') is on: a phone never loads a line of it.
//   the swap      one state (as 'boat' | 'tessie', entered from the menu's Boat plate, T (or a tap on the skipper's line
//                 "Tessie's up." on a tablet) while she shows herself, or "Be Tessie" on her chart mark); the skipper sails the Halcyon away from her while you are her (sim/tessieFlee.js); T swaps back
//   her hands     W S A D / arrows, Space or a left click on the water (the bite), T (back), C (first ↔ third person); the boat's keys do nothing
//                 while you are her (one key map per vessel). The owner's final scheme (2026-11-20): drag to look (the camera's pitch steers
//                 her depth), W A S D swim about the camera, Shift dashes (a press, 1.8 s, then a 4.5 s cooldown), Space (or a
//                 left click: createClickBite) bites, C first ↔ third person, T back; a tablet: a floating thumbstick, a drag outside it looks, one big Bite button (feature('tessieTouch'))
//   the camera    behind her neck (ui/tessieCam.js), the swap's glide under 120 m, the veil over it or under reduced motion
//   the hits      the corners on the boat ahead, the fall's hit, the knockdowns (the lake's sailboats, the glass boat, your Halcyon),
//                 the kayakers splashed and spooked only (sim/tessieHits.js)
//   the HUD       the cockpit folded (calmHud's shot rule reads services 'tessiePlay'), her depth dial bottom left, the four corners, the
//                 top bar's Halcyon | Tessie (Tessie lit amber), her teaching lines on Sail's skipper line (tip(): 'tip.tessie.*' kinds, the
//                 lean skipper's once-ever, 20 s gap and busy rules, key caps inline; no status lines), her key legend (Sail's own component)
//   the sound     the rush with her speed, the low-pass under the surface, her breath on each surfacing (living/tessie-sound.js swim)
//   phase 2a      (owner, 2026-11-20, every default approved): the eye goes under with her (ui/tessieCam.js under,
//                 waterAt and floorAt from the page); E rises and Q sinks (held; Shift + E at the surface breaches), the look's climb rate
//                 (desktop; settings "Dive by looking" is on there), the tablet's ▲ Up and ▼ Down (72 px beside Bite; the look drag only
//                 looks), the dial 0–20 m with a ▲/▼ while she climbs or sinks faster than 0.2 m/s, the outline aid gone while the eye is
//                 under, the first dive's line once ("Hold Q to dive. E comes up."), the first time past 6 m "Look up to see the boats.",
//                 the key line with UP E · DOWN Q; settings (ui/tessieSettings.js): Invert up/down (off), Camera follows her (on)
//   const P = createTessiePlayer({ plugin, B, depthAt, busy, tour, kayaks, birthplaces, veil, project, focal, canvas, mode, race,
//                                  knocked, reduced, services, touch, headless, waterAt, floorAt, underOn, settings })
//   P.step(dt) after her plug-in's step; c = P.camera(dt, c, orbit) last in placeCamera; P.threat() for the busy lake's escape;
//   P.become(entry) / P.back(); P.active; P.stats()
//   the RPG       (rpg: ?tessierpg=1; v2/sim/tessieBounty.js) each knockdown she makes is scored into her bounty by its kind, the depth and
//                 HIDDEN at the strike's start and whether the boat had seen her (within RPG.seenS before it); a breach, a fall or a
//                 surfacing that splashes a kayak pair scores one splash a pair (RPG.splashS apart); her legend's first line shows her
//                 level and its XP fill; a click or tap on her depth dial or her sonar opens the Logbook on its Tessie page; a South
//                 Lake runabout knocked down and the jet ski's rider splashed count too. Phase 2: five slots (Digit1 … Digit5, a click
//                 or tap) with rank pips; a level reached says "Level N: pick one skill to grow: [1] or [2]." on the skipper's line and the slots
//                 a point can go to glow; a press on a glowing slot while the line is up spends the point (v2/sim/tessieLevelUp.js),
//                 any other press is the skill's own (phases 3–5); the Dash's
//                 rank sets its burst, cooldown and bite (v2/sim/tessieSkills.js DASH_RANKS)
// Phase 3 (the RPG): Lure (slot 2) and Sonar (slot 3) by rank (v2/sim/tessieSkills.js LURE_RANKS, SONAR_RANKS; their rings on
// the slots, keys 2 and 3, a click or tap). Lure: her tail flicks the surface (creature-map rings, a fish-splash sound, a faint cream ring
// on the water expanding to LURE.ringM), the boats within range that have not seen her turn curious toward it (v2/sim/tessieLure.js:
// the busy lake's sailboats, the kayakers, the glass boat and her paddlers; rank 4 the Halcyon's skipper too); a boat that sees her
// forgets it. Sonar: one ping marks every boat within range for the mark time: a faint cream ring on the water under each hull
// (rank 3: a heading tail), ticks on the SONAR dial's rim, its word the range (v2/sim/tessieSonar.js); the boats within SONAR.hearM
// hear it unless she is HIDDEN. A free trial is spent only when the skill really fires (ready, not cooling)
// Phase 4 (the RPG): Tail Surge (slot 4, key 4, a click or tap; v2/sim/tessieSurge.js, SURGE_RANKS). A 1.2 s wind-up (her tail lifts:
// a flick, rings on her water), then the slap (her 'slap' splash, the creature map's ring at full amplitude, a cream ring on the water
// running out to the rank's ring radius over 2 s). The boats inside heel away from her as it reaches them (the busy lake's sailboats and
// the Halcyon by sim/waveRoll.js, the glass boat by her scripted roll); one boat within the knock radius already heeled past 20° goes
// over (her knockdown, scored as wrecked; never in Light wind); the kayakers within 20 m are splashed (scored, as a breach's); the slap
// reveals her to the boats inside. Every 30 s
// Phase 6a (the RPG): the lake grows wary by her level (v2/sim/tessieWary.js): the boats' sight at the surface 60 m (levels 1–5) → 90 m
// (6+: the threat's seeM, read by the busy lake's evade and her HUD's seen marks); the kayak pairs keep 100 m off her water (6+: the
// fleet's berth); two chatter lines once each on the skipper's line when a boat first sees her (6+, not under ?chatter=0: chatter());
// 13+: the Halcyon's skipper is never lured (he flees at the first ring). The boats at anchor are targets (anchored(): knocked down
// at anchor, 'anchored' → the bounty's 'still'), a Regatta rival is one whenever a race's source lists it (rivals(): entries with knock(side); none yet),
// the paddle-wheeler's splash scores; a set completed says its legend line once on the skipper's line
// Phase 5 (the RPG): Breach (slot 5: hold key 5 or a press on the slot, let go; v2/sim/tessieBreach.js, BREACH_RANKS). The hold picks the
// target (the locked boat, else the nearest within 60 m in ±35° of her heading; from HIDDEN never one over water under 20 m) and starts
// her run at 6 m (sim/tessiePlay.js skillBreach); the release (or 60 m of run, or the boat close enough) launches the 1.6 s arc with her
// roll in the air. Her fall within the rank's landing window of the hull knocks it down (scored, skill 'breach'); beside it (within
// BREACH.besideM) it is a wave heeling the boat to 35° (rank 4: one already heeled past SURGE.overDeg goes over); a kayak: she lands 4 m
// off it, a splash only; rank 3+ spooks the kayakers within 30 m of the splash. The run-up shows (BREACH.seeM, the threat's warn): a crew
// that sees it bears away and she is no longer told where it went (she lands behind). The third-person eye pulls back and up from the
// launch (the knockdown ease) and her play clock runs at 0.5x for 0.8 s about the apex (plugin.playK: a dt scale on her step only;
// never in a race; ?slowbreach=0 off). Cooldown 60 / 52 / 45 / 40 s
import { createTessiePlay, LINES as PLAY_LINES, PLAY } from '../sim/tessiePlay.js';
import { hitRule, createTessieHits } from '../sim/tessieHits.js';
import { createSwap } from '../sim/tessieSwap.js';
import { isRace } from '../engine/modes.js';   // a race: the mode table's race rows
import { createFlee } from '../sim/tessieFlee.js';
import { createTessieCam, createGlide, needsVeil } from '../ui/tessieCam.js';
import { heightAt as tessieHeightAt, reachAt } from '../sim/tessie.js';
import { tessieSettings } from '../ui/tessieSettings.js';   // phase 2a: Invert up/down, Camera follows her
import { mountHud, hudLayout, capLine, HUD } from '../ui/tessieHud.js';   //: the sonar, the skills row, her keys on the right edge
import { skillOfCode, RPG_SLOT_COUNT, createSkills, RPG_SKILLS_TABLE, LURE_RANKS, SONAR_RANKS, LURE_CAST_S, growthOf } from '../sim/tessieSkills.js';
import { LURE, lureTargets, lureSplashes } from '../sim/tessieLure.js';
import { SONAR, sonarPing, rimMarks, markRing } from '../sim/tessieSonar.js';   // the dash's keys: the slot's 1 and Shift
import { SURGE, SURGE_RANKS, surgeResolve, awaySide as surgeAway } from '../sim/tessieSurge.js';
import { BREACH, BREACH_RANKS, breachTarget, breachSlowK, breachLanding, breachBeside } from '../sim/tessieBreach.js';   // phase 5: the Breach
import { Press } from '../../src/ui/pointer.js';
import { createTessieBounty, BOUNTY, BOUNTY_KIND, SKILL_ORDER, SKILL_NAMES, SETS, splashType } from '../sim/tessieBounty.js';
import { waryOf, WARY, chatterLine } from '../sim/tessieWary.js';   // phase 6: the lake grows wary by her level
import { createLevelUp, LEVEL_UP } from '../sim/tessieLevelUp.js';
import { useSkill, SKILL_EMPTY } from '../sim/tessieTrials.js';   // the RPG: a slot's own press, the free trials of a locked skill   // the RPG, phase 2: the level-up line, the halo, the pick   // the Tessie RPG (rpg, ?tessierpg=1): each wreck scored into her bounty and level   // the click rule the look drag uses (v2/ui/touch.js): under 5 px and 250 ms is a click

const DEG = Math.PI / 180;
export const TESSIE_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyT', 'KeyC', 'KeyE', 'KeyQ', 'Digit1']);   // phase 2a: E rises, Q sinks
// the boat's keys: nothing while you are her (F: the bite's old second key, owner 2026-11-24: Space and the click are enough; R, Q, E, Z, X, Y, K, G, I, J, U, + and −; B, ` and 0 too)
const INERT = new Set(['KeyF', 'KeyR', 'KeyZ', 'KeyX', 'KeyY', 'KeyK', 'KeyG', 'KeyI', 'KeyJ', 'KeyU', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'Digit0', 'KeyB', 'Backquote', 'Digit2', 'Digit3', 'Digit4']);   // Digit2 … 4: the skills row's reserved slots do nothing yet (owner, 2026-11-21)
const COUNT_KEY = 'lakeshore.tessie.knocks.v1';   // her lines' once-ever marks are the lean skipper's store now (v2/ui/leanSkipper.js 'tip.tessie.*')
export const RPG = Object.freeze({ seenS: 45, splashS: 45, kinds: BOUNTY_KIND,   // a hit's kind → its bounty type (the rest come with their boats)
  slotCodes: Object.freeze({ Digit1: 'dash', Digit2: 'lure', Digit3: 'sonar', Digit4: 'surge', Digit5: 'breach' }),   // phase 2: the five slots' number keys
  stillV: 0.3, readS: 0.25 });   // m/s over her drift: still (the waiting line's 2 s); s between two reads of the save (the halo, the ranks)
// the Tail Surge's reasons when its slap tipped nothing (the RPG; once ever each on the skipper's line, v2/ui/leanSkipper.js)
export const SURGE_LINES = Object.freeze({
  upright: Object.freeze({ kind: 'tip.tessie.surge.upright', text: 'It only heeled. Slap closer, or a boat leaning in the wind.' }),
  light: Object.freeze({ kind: 'tip.tessie.surge.light', text: 'Light wind: the wave only heels them.' }),
});
// a slot press that did nothing, and why (the RPG; once ever each): Breach with no boat to run at, a Breach that missed a crew that saw
// it coming, a locked skill with no free try left
export const SKILL_LINES = Object.freeze({
  breachNone: Object.freeze({ kind: 'tip.tessie.breach.none', text: 'Breach needs a boat ahead, within 60 m.' }),
  breachSeen: Object.freeze({ kind: 'tip.tessie.breach.seen', text: 'They saw you coming. Start the Breach deeper.' }),   // a miss on a crew that saw the run
  locked: Object.freeze({ kind: 'tip.tessie.locked', text: (name) => `${name} is locked. Level up to pick it.` }),
});
// the first wreck of a boat wrecked within BOUNTY.repeatS before (the RPG; once ever): why the bounty paid less
export const REPEAT_LINE = Object.freeze({ kind: 'tip.tessie.repeat', text: 'Same boat again: half the bounty. Find a fresh one.' });
// the first wreck of a boat Sonar marked or Lure called (BOUNTY.marked, within BOUNTY.markedS; once ever): why it paid more
export const MARKED_LINE = Object.freeze({ kind: 'tip.tessie.marked', text: 'Sonar or Lure first: that boat pays half again.' });
const HALCYON = { L: 8.5, B: 3.0 }, BUSY_HULL = { L: 8.5, B: 3.0 }, GLASS = { L: 12.2, B: 3.8 };
export const PLAYER = Object.freeze({ offM: 150, veilOut: 0.22, veilIn: 0.4, reachDelayS: 2, reachM: [100, 90, 115, 80, 125], reachConeDeg: 20, nextDelayS: 6, nextNearM: 220, nextM: Object.freeze([170, 150, 190, 130, 210]), holdNearM: 30, dialM: 20, arrowV: 0.2, lookUpM: 6, fastS: 3, chevV: Object.freeze([1.5, 6.5, 15]), dashLineS: 2 });   // nextDelayS, nextNearM, nextM: the RPG's next boat after a wreck (6 s on, none upright and fresh within 220 m: one laid 130–210 m ahead)   // dashLineS: a boat in her corners out of reach this long, once ever: the dash's line   //: the fast line after 3 s swimming at the surface; the speed chevrons lit past 1.5, 6.5 and 15 m/s   // phase 2a: the dial's 0–20 m, its ▲/▼ past 0.2 m/s, the first dive's line, the first time past 6 m

const MARK = '<svg viewBox="0 0 32 20" aria-hidden="true"><path d="M2 15c3-1 4-6 7-6s3 5 6 5 3-6 6-6c2 0 3 2 3 4M24 12c1-4 1-8 4-9 1.5-.5 2.5.6 2 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 17.5h30" stroke="currentColor" stroke-width="1" opacity=".55"/></svg>';
const BOAT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v13M12 4l6 11h-6M11 6L6 15h5"/><path d="M3 18h18l-2 3H6z"/></svg>';
// the boat's own HUD, gone while you are her and back when you give her back (owner, 2026-11-21: the instrument plate's COG, TWS, TWA,
// VMG, HEEL, RUD showed while playing as Tessie): the nav column's instruments, the cockpit's DOM (its 3D station folds by sail.js
// dashHidden), the chart, the trim readouts and the Pro recess, the throttle's word, the dock, the first sail's coaching chips, the
// Calm HUD's "show the helm" mark and fold tab, the hands, Sail's key legend, the bar's mode pills
const BOAT_HUD = Object.freeze(['#hands', '.lk-nav', '.lk-chart', '.lk-cv', '.lk-puck', '.lk-tackb', '.lk-cp', '.lk-cpx', '.lk-thr', '.lk-dock', '.lk-tp',
  '.lk-pro', '.lk-inst', '.lk-guide', '.lk-calm-mark', '.lk-fold', '.lk-view .pill:not(.lk-tsw)', '.lk-view .xt[data-x=mode]', '.lk-keys.lk-edgepair:not(.tp-keys)']);   // Sail's legend, not hers (tp-keys: the same component)
const PLAYER_CSS = `#lk-tplay{position:fixed;inset:0;z-index:4;pointer-events:none;font:400 15px/1.2 var(--lk-ui,system-ui);color:var(--lk-ink,#f3ecdc)}
#lk-tplay [hidden]{display:none!important}
#lk-tplay .tp-dial{position:absolute;left:22px;bottom:22px;width:132px;height:132px}
#lk-tplay .tp-dial svg{width:100%;height:100%;overflow:visible}
#lk-tplay .tp-dial .w{position:absolute;left:0;right:0;top:56px;text-align:center;font:600 12px/1 var(--lk-ui,system-ui);letter-spacing:.16em}
#lk-tplay .tp-dial .m{position:absolute;left:0;right:0;top:74px;text-align:center;font:400 13px/1 var(--lk-ui,system-ui);font-variant-numeric:tabular-nums;opacity:.8;font-style:normal}
#lk-tplay .tp-aim{position:absolute;left:0;top:0;width:0;height:0}
#lk-tplay .tp-aim i{position:absolute;width:16px;height:16px;border:0 solid rgb(var(--lk-cream) / .85)}
#lk-tplay .tp-aim i:nth-child(1){left:0;top:0;border-left-width:2px;border-top-width:2px}
#lk-tplay .tp-aim i:nth-child(2){right:0;top:0;border-right-width:2px;border-top-width:2px}
#lk-tplay .tp-aim i:nth-child(3){left:0;bottom:0;border-left-width:2px;border-bottom-width:2px}
#lk-tplay .tp-aim i:nth-child(4){right:0;bottom:0;border-right-width:2px;border-bottom-width:2px}
#lk-tplay .tp-aim b{position:absolute;left:50%;bottom:-22px;transform:translateX(-50%);font:500 13px/1 var(--lk-ui,system-ui);font-variant-numeric:tabular-nums;text-shadow:0 0 4px rgb(var(--lk-brand-navy) / .8)}
#lk-tplay .tp-aim[data-reach] i{border-color:rgb(var(--lk-amber,240 172 64))}
#lk-tplay .tp-aim[data-reach] b{color:rgb(var(--lk-amber,240 172 64))}
#lk-tplay .tp-ghost{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
#lk-tplay .tp-ghost path{fill:none;stroke-linecap:round;stroke-linejoin:round}
#lk-tplay .tp-zone{position:absolute;left:0;top:70px;bottom:0;width:40%;pointer-events:auto;touch-action:none}
#lk-tplay .tp-stick{position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;border:1.5px solid rgb(var(--lk-cream) / .55);background:rgb(var(--lk-brand-navy) / .25);pointer-events:none}
#lk-tplay .tp-stick .knob{position:absolute;left:32px;top:32px;width:56px;height:56px;border-radius:50%;background:rgb(var(--lk-cream) / .85)}
#lk-tplay .tp-look{position:absolute;left:40%;right:0;top:70px;bottom:0;pointer-events:auto;touch-action:none}
#lk-tplay .tp-lunge{all:unset;box-sizing:border-box;position:absolute;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;
  background:var(--lk-glass-dense,rgb(var(--lk-brand-navy) / .8));border:1.5px solid rgb(var(--lk-cream) / .6);color:var(--lk-ink,#f3ecdc);font:600 14px/1 var(--lk-ui,system-ui);letter-spacing:.12em;text-transform:uppercase}
#lk-tplay .tp-lunge{right:28px;bottom:28px;width:104px;height:104px}
#lk-tplay .tp-lunge[data-rest]{opacity:.5}
#lk-tplay .tp-ud{all:unset;box-sizing:border-box;position:absolute;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:50%;cursor:pointer;
  background:var(--lk-glass-dense,rgb(var(--lk-brand-navy) / .8));border:1.5px solid rgb(var(--lk-cream) / .6);color:var(--lk-ink,#f3ecdc);font:600 13px/1 var(--lk-ui,system-ui);letter-spacing:.08em}
#lk-tplay .tp-up{right:148px;bottom:110px}
#lk-tplay .tp-dn{right:148px;bottom:24px}
#lk-tplay .tp-ud[data-dim]{opacity:.45}
#lk-tplay .tp-ud:active,#lk-tplay .tp-ud[aria-pressed=true]{background:rgb(var(--lk-amber,240 172 64) / .25)}
#lk-tplay .tp-dial .chev path{stroke:rgb(var(--lk-cream) / .92);opacity:.18;transition:opacity .4s ease,stroke .4s ease}
#lk-tplay .tp-dial .chev path[data-on]{opacity:1}
#lk-tplay .tp-dial .chev[data-dash] path[data-on]{stroke:rgb(var(--lk-amber,240 172 64))}
#lk-tplay .tp-dial .ar{position:absolute;left:0;right:0;top:92px;text-align:center;font:600 12px/1 var(--lk-ui,system-ui);opacity:.85}
#lk-tplay [data-door]{pointer-events:auto;cursor:pointer}
#lk-tplay .tp-world{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}
#lk-tplay .tp-world ellipse{fill:none;stroke:rgb(var(--lk-cream) / .62);stroke-width:1.5}
#lk-tplay .tp-world line{stroke:rgb(var(--lk-cream) / .62);stroke-width:1.5;stroke-linecap:round}
#lk-tplay .tp-world[hidden]{display:none}
#lk-tplay .tp-world .lr{fill:none;stroke:rgb(var(--lk-cream) / .8);stroke-width:1.8;stroke-dasharray:2 7;stroke-linecap:round}
#lk-tplay .tp-world .sr{fill:none;stroke:rgb(var(--lk-cream) / .78);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
#lk-tplay .tp-lunge:active,#lk-tplay .tp-lunge[aria-pressed=true]{background:rgb(var(--lk-amber,240 172 64) / .25)}
html[data-tessie-play].lk-calm-bar .lk-view{opacity:1!important;visibility:visible!important;pointer-events:auto!important}
html[data-tessie-play] .lk-view.off{opacity:1!important;transform:none!important;pointer-events:auto!important}
html[data-tessie-play] .lk-view.off .isl,html[data-tessie-play] .lk-view.off .isl *{pointer-events:auto!important}   /* the bar stays while you are her (her keys never wake the Calm HUD) */
${BOAT_HUD.map((q) => `html[data-tessie-play] ${q}`).join(',')}{display:none!important}
.lk-view .pill.lk-tsw{display:none}
html[data-tessie-play] .lk-view .pill.lk-tsw{display:flex}
.lk-view .pill.lk-tsw .seg svg{fill:none;stroke:currentColor;stroke-width:1.7}
.lk-view .pill.lk-tsw .seg.on,.lk-view .pill.lk-tsw .seg.on:hover{background:var(--lk-lit-fill);color:var(--lk-lit-ink);box-shadow:inset 0 0 0 var(--lk-line) var(--lk-lit);opacity:1}   /* who you are is a choice: lit amber (the Boat | Helm view keeps cream) */`;

// the top bar's who-you-are switch (decision A: Halcyon | Tessie, the panel's order; decision D: the one you are lit, .on, amber)
export const SWITCH_ORDER = Object.freeze(['halcyon', 'tessie']);
export function topSwitchHtml(as = 'tessie') {
  const icon = { halcyon: BOAT_ICON, tessie: MARK.replace('viewBox="0 0 32 20"', 'viewBox="0 0 32 20" style="width:26px"') }, name = { halcyon: 'Halcyon', tessie: 'Tessie' };
  return SWITCH_ORDER.map((id) => `<button type="button" class="seg${id === as ? ' on' : ''}" data-tw="${id}" aria-pressed="${id === as}" aria-label="${name[id]} (T)">${icon[id]}<span class="w">${name[id]}</span></button>`).join('');
}

// Her lines on Sail's skipper line (the UI audit, owner 2026-11-21: "we used the skipper lines format for hint always"): each goes
// through hint.note with its 'tip.tessie.*' kind, so the lean skipper decides (v2/ui/leanSkipper.js: once ever, the 20 s gap, nothing
// mid-manoeuvre, the phone's quiet rule on top); [K] marks become the line's own key caps (tessieHud.js capLine). A line refused now
// waits and asks again every askS while she is played, until the lean store marks it shown.
//   const T = createTipQueue({ hint: () => controlsHint, active: () => playing, onShown(kind) });  T.want(kind, text); T.step(dt)
export function createTipQueue({ hint = () => null, active = () => true, onShown = null, askS = 1 } = {}) {
  const want = new Map(); let wait = 0;
  const seen = (kind) => { const s = hint()?.phoneQuiet?.state?.seen; return Array.isArray(s) ? s.includes(kind) : null; };   // null: no lean store to ask
  return {
    want(kind, text) { if (seen(kind) !== true) want.set(kind, text); },
    step(dt) {
      wait -= dt;
      if (!want.size || !active() || wait > 0) return;
      wait = askS;
      const h = hint(); if (!h?.note) return;
      for (const [kind, text] of want) {
        if (seen(kind) === true) { want.delete(kind); continue; }
        h.note(capLine(text), '', null, { kind });
        const s = seen(kind);
        if (s !== false) { want.delete(kind); if (s) onShown?.(kind); }   // shown (the lean store has it), or no store: asked once
        break;
      }
    },
    get waiting() { return [...want.keys()]; },
  };
}

// "Tessie's up." (owner, 2026-11-24: one skipper line in place of the Be Tessie pill): when she shows herself near the boat (the swap's
// window, W.pill), the skipper's line says so with the way in: "[T] to be her", or on a tablet "Tap here to be her." with the line itself
// as the tap target. The lean skipper decides when (v2/ui/leanSkipper.js 'tip.tessie.be', LEAN_REPEAT): the first sighting of a session,
// then later sightings at most every 4 min, at most 3 a session; it jumps the 20 s gap (the only door in: a sighting lasts seconds) and
// waits out a busy moment at most 3 s (leanSkipper.js LEAN_JUMP). The first swap by T or the tap
// retires it for good (the lean store). Asked once per sighting: a sighting that ends before a quiet moment drops it.
// onShown: the line is up (the player keeps the swap's window open while it can be read: W.hold).
//   const L = createBeLine({ hint: () => controlsHint, touch: () => tablet, onTap, onShown });  L.step(dt, up); L.retire()
export const BE_LINE = Object.freeze({ kind: 'tip.tessie.be', keys: "Tessie's up. [T] to be her.", touch: "Tessie's up. Tap here to be her." });
export function createBeLine({ hint = () => null, touch = () => false, onTap = null, onShown = null, askS = 1 } = {}) {
  let was = false, want = false, wait = 0, shown = 0;
  const lean = () => hint()?.phoneQuiet ?? null;
  const retired = () => { const s = lean()?.state?.seen; return Array.isArray(s) && s.includes(BE_LINE.kind); };
  const count = () => { const c = lean()?.state?.counts; return c ? c[BE_LINE.kind] ?? 0 : null; };   // null: no lean store to ask
  return {
    step(dt, up) {
      up = !!up;
      if (up && !was) { want = !retired(); wait = 0; }   // a new sighting
      if (!up && was) { want = false; hint()?.drop?.(BE_LINE.kind); }   // she is gone: so is the line
      was = up; wait -= dt;
      if (!want || !up || wait > 0) return;
      wait = askS;
      const h = hint(); if (!h?.note) return;
      if (retired()) { want = false; return; }
      const tablet = !!touch(), c0 = count();
      h.note(capLine(tablet ? BE_LINE.touch : BE_LINE.keys), '', null, { kind: BE_LINE.kind, ...(tablet && onTap ? { onTap } : {}) });
      const c1 = count();
      if (c0 == null || c1 > c0) { want = false; shown++; onShown?.(); }   // shown (the lean counted it), or no lean to ask: asked once
    },
    retire() { want = false; lean()?.retire?.(BE_LINE.kind); hint()?.drop?.(BE_LINE.kind); },
    get waiting() { return want; }, get shown() { return shown; },
  };
}

// The click to bite (owner, 2026-11-24): a left-mouse press on the canvas, released within 250 ms and under 5 px of travel, bites
// on its release. The rule is the look drag's own (src/ui/pointer.js Press, read by v2/ui/touch.js): a press is a click until it
// travels 5 px, then a drag that looks, so one press is never both. On the release, not the press: every look drag starts with a
// press, and a bite fired then could not be taken back (the lunge, the snap's sound); the release costs only the click's own
// down-up time (about 0.1 s). Only the canvas's own presses count (the bar, the menus, the chart, the skipper's line and the HUD's
// buttons are DOM over it and take their own); the right button, a Ctrl-, Cmd- or Alt-click, a finger and a pen never bite.
//   const K = createClickBite({ on, bite, now }); K.down(e) / K.move(e) / K.up(e) → true when it bit / K.cancel(e); K.attach(canvas) → off()
export function createClickBite({ on = () => true, bite = () => {}, now = () => globalThis.performance?.now?.() ?? 0 } = {}) {
  let press = null, canvas = null;
  const at = (e) => (Number.isFinite(e.timeStamp) && e.timeStamp > 0 ? e.timeStamp : now());
  const api = {
    down(e) {
      press = null;
      if (!on() || (e.button ?? 0) !== 0 || (e.pointerType ?? 'mouse') !== 'mouse' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (canvas && e.target && e.target !== canvas) return;   // a press on something over the water
      press = new Press(e.clientX, e.clientY, at(e), 0); press.id = e.pointerId;
    },
    move(e) { if (press && e.pointerId === press.id) press.move(e.clientX, e.clientY); },
    up(e) {
      const p = press; if (!p || e.pointerId !== p.id) return false;
      press = null;
      if (!on() || p.end(e.clientX, e.clientY, at(e)) !== 'click') return false;
      bite(); return true;
    },
    cancel(e) { if (press && e.pointerId === press.id) press = null; },
    attach(c) {
      canvas = c;
      const fns = { pointerdown: api.down, pointermove: api.move, pointerup: api.up, pointercancel: api.cancel };
      for (const [t, f] of Object.entries(fns)) c.addEventListener(t, f);
      return () => { for (const [t, f] of Object.entries(fns)) c.removeEventListener?.(t, f); canvas = null; };
    },
  };
  return api;
}

export function createTessiePlayer({ plugin, B, depthAt = () => 30, busy = () => null, tour = () => null, kayaks = () => null, sups = () => null, traffic = () => [], anchored = () => null, rivals = () => null, chatter = () => true, birthplaces = null, veil = null,
  project = null, focal = () => 600, canvas = null, mode = () => 'sail', race = () => false, knocked = () => false, reduced = () => false,
  services = () => null, touch = () => false, headless = false, storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })(),
  waterAt = null, floorAt = null, underOn = true, settings = null, keyHints = () => true, rpg = false, slowBreach = () => true, day = () => { try { return new Date().toLocaleDateString('en-CA'); } catch { return null; } } } = {}) {
  const sim = plugin.sim;
  const C = createTessiePlay({ sim, depthAt }), H = createTessieHits(), W = createSwap(), cam = createTessieCam(), glide = createGlide();
  let flee = null, fleeOn = false, view = 'third', clock = 0, entryT = 0, reachDone = true, holdCamUntil = -1, veilT = null, lastPose = null, lastBoatPose = null;
  const boatPose = { pos: [0, 0, 0], target: [0, 0, 0], fov: 55 };   // lastBoatPose's storage
  let prevCard = null, provided = false, pulse = false, dragYaw = 0;
  const touchLook = [0, 0];   // the tablet's look drag this frame (rad)
  const held = new Set(), touchIn = { x: 0, y: 0, dive: false, lunge: false, up: false, down: false, dash: false, id: null, ox: 0, oy: 0 };
  const prefs = settings ?? tessieSettings(storage);   // phase 2a: Invert up/down, Camera follows her
  let surfaceT = 0, tapDive = 0, dashPulse = false;
  const log = { knocks: [], spooks: 0, falls: 0, hits: 0, lastFall: null, swaps: [], tips: [], bounty: [] };
  const bounty = rpg ? createTessieBounty({ storage }) : null;
  const levelUp = bounty ? createLevelUp({ bounty, touch }) : null;   // phase 2: the level-up moment on the skipper's line and the slots
  let rpgReadT = 0, rpgRanks = null, rpgHalo = '';
  let rpgLevel = bounty ? bounty.state().level : 1;   // phase 6: her level as last read (the wary band)
  const wary = () => (bounty ? waryOf(rpgLevel) : WARY[0]);   // flag off: today's rules
  // each skill's behaviour, (rank) → true when it really ran (a press that did something: a locked skill's trial is spent only then);
  // SKILL_EMPTY when it fired with no boat or kayak in range (it cools as any use, but a trial is not spent).
  // Lure, Sonar, Tail Surge and Breach register theirs here (phases 3–5); a skill with none answers false (a quiet no-op)
  const SKILL_RUN = {};
  // phase 3: Lure's and Sonar's rings (their own skills table; the Dash keeps C.skills), the lure under way, the ping's marks
  const R = bounty ? createSkills(RPG_SKILLS_TABLE) : null;
  const marks = new Map();   // id → until (s, her clock): the boats the last ping marked
  const skillAt = new Map();   // id → { t, until } (s, her clock): the last Sonar ping that marked the boat or Lure that lured it (the fastest record)
  const sinceSkill = (id) => { const k = skillAt.get(id); return k && clock <= k.until ? clock - k.t : undefined; };
  const markedNow = (id) => { const k = skillAt.get(id); return !!k && clock - k.t <= Math.max(BOUNTY.markedS, k.until - k.t); };   // the bonus: a ping or a lure within 30 s (or while it lasts)
  let ping = null, lureFx = null, halcyonLure = null, rimT = -1;   // ping { rangeM, until, tail }; lureFx { x, z, t0, n }; halcyonLure { x, z, until }
  const casts = [], splashPts = [], rimOut = [], pingArg = { rangeM: 0, marks: rimOut }, hudStates = { dash: null };
  const seenRecently = (id) => clock - (sawAt.get(id) ?? -Infinity) <= LURE.seenS;
  SKILL_RUN.lure = (rank) => runLure(rank);
  SKILL_RUN.sonar = (rank) => runSonar(rank);
  SKILL_RUN.surge = (rank) => runSurge(rank);
  SKILL_RUN.breach = (rank) => runBreach(rank);
  // phase 5: the Breach under way { rank, row, t0, targetId, kind, seen (the target saw the run: no longer tracked), launch, fall }
  let breachFx = null, slowK = 1;
  // phase 4: the Tail Surge under way { rank, row, t0, slapAt (null: the wind-up), x, z (the ring's centre), due: [the boats the wave has yet
  // to reach], ctx (the strike's record for the bounty), stir (the wind-up's rings laid) }
  let surgeFx = null;
  const wreckAt = new Map();   // the RPG: each boat's wrecks within BOUNTY.repeatS (s, her clock): the same boat again pays less
  const sawAt = new Map(), splashAt = new Map();   // the RPG: when each boat last saw her; when each kayak was last splashed (s, her clock)
  let strike = null, biteWas = null, lungeWas = null;   // the RPG: the strike under way ({ at, depthM, hidden, seen: Set, skill })
  let knockTotal = 0; try { knockTotal = +(storage?.getItem(COUNT_KEY) ?? 0) || 0; } catch { /* */ }
  const doc = headless ? null : globalThis.document ?? null;
  const loadEl = () => doc?.getElementById('lk-load') ?? null;
  const cardUp = () => { const el = loadEl(); if (!el) return false; const s = el.dataset.state; return (s === 'home' || s === 'menu' || s === 'attract' || s === 'company') && !el.hasAttribute('data-off') || !!el.dataset.pg; };
  const typing = () => /^(INPUT|SELECT|TEXTAREA)$/.test(doc?.activeElement?.tagName ?? '');
  const nose = () => sim.state.nose ?? null;
  const svc = () => services?.() ?? null;

  // ---- the DOM (made on the first frame that needs it) ----
  let el = null, sw = null;
  const q = (s) => el?.querySelector(s);
  function dom() {
    if (el || !doc?.body) return el;
    if (!doc.getElementById('lk-tplay-css')) { const st = doc.createElement('style'); st.id = 'lk-tplay-css'; st.textContent = PLAYER_CSS; doc.head.appendChild(st); }
    el = doc.createElement('div'); el.id = 'lk-tplay';
    el.innerHTML = `<div class="tp-dial" hidden aria-hidden="true"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="58" stroke-width="2" style="fill:rgb(var(--lk-brand-navy) / .72);stroke:rgb(var(--lk-cream) / .7)"/>
<path class="tk" d="" fill="none" stroke-width="7" stroke-linecap="round" style="stroke:rgb(var(--lk-cream) / .3)"/><path class="fl" d="" fill="none" stroke-width="7" stroke-linecap="round" style="stroke:rgb(var(--lk-cream) / .92)"/><g class="chev" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M53 104l5 5-5 5"/><path d="M63 104l5 5-5 5"/><path d="M73 104l5 5-5 5"/></g></svg><b class="w">SURFACE</b><i class="m">0 m</i><i class="ar"></i></div>
<svg class="tp-ghost" hidden aria-hidden="true"><defs><mask id="tp-gm" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%"><path class="o" d="" stroke="#fff"/><path class="i" d="" stroke="#000"/></mask></defs><rect width="100%" height="100%" mask="url(#tp-gm)" style="fill:rgb(var(--lk-cream) / .5)"/></svg>
<div class="tp-aim" hidden aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
<div class="tp-touch" hidden><div class="tp-look"></div><div class="tp-zone"></div><div class="tp-stick" hidden><i class="knob"></i></div><button class="tp-lunge" type="button" aria-pressed="false">Bite</button><button class="tp-ud tp-up" type="button" aria-pressed="false" aria-label="Up">▲ Up</button><button class="tp-ud tp-dn" type="button" aria-pressed="false" aria-label="Down">▼ Down</button></div>`;
    if (bounty) {   // phase 3: the world's marks (the ping's rings under the hulls, their tails, the lure's ring), projected onto the water
      // the marks are world: they sit beneath every HUD piece (the legend, the slots, the dials, the top bar, the skipper's line), whose
      // boxes are cut out of the layer's mask (the legend has no plate, so a ring would show between its letters)
      el.insertAdjacentHTML('afterbegin', `<svg class="tp-world" hidden aria-hidden="true"><defs><mask id="tp-wm" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%"><rect width="100%" height="100%" fill="#fff"/><g class="cut"></g></mask></defs><g mask="url(#tp-wm)">${'<ellipse class="mk" visibility="hidden"/>'.repeat(SONAR.max)}${'<line class="tl" visibility="hidden"/>'.repeat(SONAR.max)}<path class="lr" fill="none" visibility="hidden"/><path class="sr" fill="none" visibility="hidden"/></g></svg>`);
      const w = el.querySelector('.tp-world');
      world = { el: w, mk: [...w.querySelectorAll('.mk')], tl: [...w.querySelectorAll('.tl')], lr: w.querySelector('.lr'), sr: w.querySelector('.sr'), cut: w.querySelector('.cut'), cutT: -1, on: new Uint8Array(SONAR.max * 2 + 2) };
    }
    doc.body.appendChild(el);
    //: the sonar, the skills row (a tablet taps DASH to dash), her keys on the right edge
    hud = mountHud({ root: el, skills: C.skills.list(), storage, keyHints, rpg: !!bounty, onSlot: (id) => { if (bounty) pressSlot(id); else if (id === 'dash') touchIn.dash = true; }, onSlotUp: (id) => { if (bounty) releaseSlot(id); } });
    hud?.show(false);
    if (bounty) {
      hud?.level(bounty.legend());
      rpgSync(true);
      // the door: a click or tap on her depth dial or her sonar opens the Logbook on its Tessie page
      for (const d of [q('.tp-dial'), hud?.el.sonar]) {
        if (!d) continue;
        d.dataset.door = 'logbook'; d.removeAttribute('aria-hidden'); d.setAttribute('role', 'button'); d.setAttribute('aria-label', 'Tessie in the Logbook');
        d.addEventListener('pointerdown', (e) => e.stopPropagation());
        d.addEventListener('click', (e) => { e.stopPropagation(); self.openLog(); });
      }
    }
    // the dial's track: 0 to 20 m over a 270° sweep from lower left
    q('.tk').setAttribute('d', arc(0, 1));
    // the tablet: the floating stick in the left 40 %, a drag elsewhere looks, the Bite button
    const zone = q('.tp-zone'), stick = q('.tp-stick'), knob = q('.knob');
    zone.addEventListener('pointerdown', (e) => { if (touchIn.id != null) return; touchIn.id = e.pointerId; touchIn.ox = e.clientX; touchIn.oy = e.clientY; stick.hidden = false; stick.style.left = `${e.clientX}px`; stick.style.top = `${e.clientY}px`; zone.setPointerCapture?.(e.pointerId); e.preventDefault(); });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId !== touchIn.id) return; let dx = e.clientX - touchIn.ox, dy = e.clientY - touchIn.oy; const l = Math.hypot(dx, dy), m = 46; if (l > m) { dx *= m / l; dy *= m / l; } touchIn.x = dx / m; touchIn.y = -dy / m; knob.style.transform = `translate(${dx}px,${dy}px)`; });
    const up = (e) => { if (e.pointerId !== touchIn.id) return; touchIn.id = null; touchIn.x = 0; touchIn.y = 0; stick.hidden = true; knob.style.transform = ''; };
    zone.addEventListener('pointerup', up); zone.addEventListener('pointercancel', up);
    const hold = (b, k) => { b.addEventListener('pointerdown', (e) => { touchIn[k] = true; b.setAttribute('aria-pressed', 'true'); e.preventDefault(); e.stopPropagation(); }); for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, () => { touchIn[k] = false; b.setAttribute('aria-pressed', 'false'); }); };
    hold(q('.tp-lunge'), 'lunge'); hold(q('.tp-up'), 'up'); hold(q('.tp-dn'), 'down');   // phase 2a: ▲ / ▼ (as E / Q)
    // a tap on ▼ at the surface (under 0.25 s) starts a dive to 6 m; any other depth input ends it
    { const dn = q('.tp-dn'); let t0 = 0; dn.addEventListener('pointerdown', () => { t0 = clock; tapDive = 0; }); dn.addEventListener('pointerup', () => { if (clock - t0 < 0.25 && C.state.nose < 1.2) tapDive = PLAY.diveNose; }); }
    const look = q('.tp-look'); let lk = null;
    look.addEventListener('pointerdown', (e) => { lk = { id: e.pointerId, x: e.clientX, y: e.clientY }; look.setPointerCapture?.(e.pointerId); e.preventDefault(); });
    look.addEventListener('pointermove', (e) => { if (!lk || e.pointerId !== lk.id) return; touchLook[0] += (e.clientX - lk.x) * 0.005; touchLook[1] += (e.clientY - lk.y) * 0.004; lk.x = e.clientX; lk.y = e.clientY; });
    for (const t of ['pointerup', 'pointercancel']) look.addEventListener(t, (e) => { if (lk && e.pointerId === lk.id) lk = null; });
    return el;
  }
  // the top bar's Halcyon | Tessie (decision A: the panel's order), in the Boat | Helm pill's place while you are her; Tessie lit (.on, amber)
  function topSwitch() {
    if (sw || !doc) return sw;
    const pill = doc.querySelector('.lk-view .pill'); if (!pill) return null;
    sw = doc.createElement('div'); sw.className = 'pill lk-tsw'; sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Who you are');
    sw.innerHTML = topSwitchHtml('tessie');
    pill.parentNode.insertBefore(sw, pill);
    sw.addEventListener('click', (e) => { const b = e.target.closest?.('[data-tw]'); e.stopPropagation(); if (b?.dataset.tw === 'halcyon') self.back(); });
    return sw;
  }
  // the dial's arc: 0 … 20 m as a share of a 270° sweep (from 135° to 405°, clockwise)
  function arc(a, b) {
    const r = 48, cx = 66, cy = 66, p = (u) => { const t = (135 + 270 * u) * DEG; return [cx + Math.cos(t) * r, cy + Math.sin(t) * r]; };
    const [x0, y0] = p(a), [x1, y1] = p(Math.max(a + 1e-3, b)), large = (b - a) * 270 > 180 ? 1 : 0;
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  // her lines are the skipper's line (createTipQueue below; the UI audit, owner 2026-11-21)
  const hintSvc = () => svc()?.get?.('hint') ?? svc()?.get?.('controls')?.hint ?? null;
  const tips = createTipQueue({ hint: hintSvc, active: () => W.as === 'tessie', onShown: (kind) => log.tips.push(kind) });
  const tip = (kind, text) => tips.want(kind, text), stepTips = (dt) => tips.step(dt);
  const tipSeen = (kind) => tips.waiting.includes(kind) || !!hintSvc()?.phoneQuiet?.state?.seen?.includes?.(kind);   // phase 6: asked already, or shown (the lean store)
  // she shows herself: the skipper's line says so, with the way in (a tablet: the line is the tap target)
  const beLine = createBeLine({ hint: hintSvc, touch, onTap: () => self.become('swap'), onShown: () => W.hold() });   // the line may come late in a sighting: T read off it still swaps

  // ---- the keys (capture: before every other listener; the boat's keys stop here while you are her) ----
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing()) return;
    if (W.as !== 'tessie') {
      if (e.code === 'KeyT' && !e.repeat && W.pill && !cardUp()) { e.preventDefault(); e.stopImmediatePropagation(); self.become('swap'); }
      return;
    }
    if (cardUp()) return;
    if (bounty && RPG.slotCodes[e.code]) {   // the RPG: the five slots' number keys (a pick during the level-up line, else the skill)
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      hud?.count(e.code); pressSlot(RPG.slotCodes[e.code]);
      return;
    }
    if (TESSIE_KEYS.has(e.code)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      held.add(e.code); hud?.count(e.code);   // the legend learns
      if (e.code === 'Space') pulse = true;   // the bite: a tap shorter than a frame still bites
      if (skillOfCode(e.code) === 'dash') dashPulse = true;   // the dash: Shift or the slot's 1 (owner, 2026-11-21: the skills row is an RPG bar)   // the dash: a press, even one shorter than a frame
      if (e.code === 'KeyT') self.back();
      else if (e.code === 'KeyC') view = view === 'first' ? 'third' : 'first';   //: C toggles her eyes and the view behind her; kept for the visit
    } else if (INERT.has(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  const onKeyUp = (e) => { held.delete(e.code); if (bounty && W.as === 'tessie' && RPG.slotCodes[e.code] === 'breach') releaseSlot('breach'); };   // phase 5: the Breach launches on the release
  // the left click on the water bites, as Space (owner, 2026-11-24; desktop only: a tablet has its Bite button); the same pulse, so
  // the same buffer, cooldown, lunge, events and sound
  const clickBite = createClickBite({ on: () => W.as === 'tessie' && !touch() && !cardUp(), bite: () => { pulse = true; hud?.count('Space'); } });   // the legend's Bite line learns
  if (doc && canvas?.addEventListener) clickBite.attach(canvas);
  if (doc) {
    globalThis.addEventListener('keydown', onKey, true); globalThis.addEventListener('keyup', onKeyUp, true);
    globalThis.addEventListener('blur', () => held.clear());
  }
  const has = (...c) => c.some((k) => held.has(k));
  let pinned = null;   // P.pin({ nose, look, swim }): a fixed depth and look (swim: on at her walk, straight ahead) (tools/v2-perf.mjs's underwater poses, the evidence stills); null: the player's hands
  let pinTg = null;   // the corners' boat this step (a chase pin swims at it and bites in reach)
  const pinHands = () => {
    const d = C.state.nose - pinned.nose;
    let drag = 0, camYaw = nose()?.psi ?? cam.yaw, bite = false;   // straight on along her heading (the pose's), unless she chases
    if (pinned.chase) {   // the evidence's chase: W toward the nearest of the lake's sailboats (the corners' boat once aimed), Space in reach
      const n = nose(), L = busy();
      if (pinned.chaseId == null && n && L?.active) { let bd = Infinity; for (const b of L.liveBoats) { if (b.knock?.capsized) continue; const q2 = b.phys.state, dd = Math.hypot(q2.x - n.x, q2.z - n.z); if (dd < bd) { bd = dd; pinned.chaseId = b.id; } } }   // the nearest one, kept
      const boat = L?.liveBoats.find((b) => b.id === pinned.chaseId), tg = boat ? boat.phys.state : pinned.chaseId != null ? targets().find((e) => e.id === pinned.chaseId) ?? null : null;   // chase: '<id>' any target by its id (a boat at anchor, the paddle-wheeler)
      if (tg && n) { camYaw = Math.atan2(tg.x - n.x, -(tg.z - n.z)); drag = C.state.way == null ? 0 : Math.atan2(Math.sin(camYaw - C.state.way), Math.cos(camYaw - C.state.way)); }
      bite = !pinned.nobite && !!pinTg?.locked && pinTg.id === pinned.chaseId;   // nobite: the evidence's approach under a hull (Space once locked)
    }
    return { move: [0, pinned.swim || pinned.chase ? 1 : 0], camYaw, pitch: cam.pitch, look: cam.look, drag, rise: d > 0.15, sink: d < -0.15, lookSteers: false, diveTo: 0, dash: !!pinned.sprint && (d <= 0.15 || pinned.breach), bite };   // sprint: the dash pressed again whenever it is ready (no dash while she climbs to the pose unless it asks for the breach: the dash + E breaches)
  };
  const hands = () => {
    if (pinned) return pinHands();
    // the way she should swim, about the camera: W A S D or the arrows, or the stick (pushed to its edge: run)
    const sk = Math.hypot(touchIn.x, touchIn.y) > 0.25 ? [touchIn.x, touchIn.y] : [0, 0];
    const mv = [(has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0) + sk[0], (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0) + sk[1]];
    const tablet = touch();
    const h = { move: mv, camYaw: cam.yaw, pitch: cam.pitch, look: cam.look, drag: dragYaw,   // the look: its yaw (W's way, turned by the drag); phase 2a: the player's look steers her climb
      rise: has('KeyE') || touchIn.up, sink: has('KeyQ') || touchIn.down, lookSteers: !tablet, diveTo: tapDive,   // E / Q, ▲ / ▼ (3.6); a tablet: the look only looks; ▼ tapped: a dive to 6 m
      sprint: has('ShiftLeft', 'ShiftRight'), dash: dashPulse || touchIn.dash,   // the dash: Shift's press (the controller reads its edge), or the tablet's DASH slot
      bite: has('Space') || touchIn.lunge || pulse };
    pulse = false; dashPulse = false; touchIn.dash = false; dragYaw = 0;
    if (tapDive && (h.rise || h.sink || C.state.nose >= tapDive - 0.15)) tapDive = 0;
    h.move = h.move.map((v) => Math.max(-1, Math.min(1, v)));
    return h;
  };

  // a splash spooks the kayakers and the paddleboarders within r (the kayaks back away; a board's paddler wobbles and kneels)
  const spookAt = (x, z, r) => { kayaks()?.spook?.(x, z, r); sups()?.spook?.(x, z, r); };
  // ---- the world as she sees it: the boats, the glass boat, the kayakers ----
  function targets() {
    const out = [];
    const s = B.state;
    if (fleeOn || B.driven) out.push({ id: 'halcyon', kind: 'halcyon', x: s.x, z: s.z, heading: s.heading ?? 0, u: s.u ?? 0, motoring: !!s.engineOn, rpm: s.engineRpm, ...HALCYON });
    // a capsized boat is no target (it lies on its side)
    const L = busy(); if (L?.active) for (const b of L.liveBoats) { if (b.knock?.capsized) continue; const q2 = b.phys.state; out.push({ id: b.id, kind: 'sail', x: q2.x, z: q2.z, heading: q2.heading, u: q2.u ?? 0, motoring: !!b.motoring, ...BUSY_HULL, ref: b }); }
    const T = tour(); if (T?.active) { const g = T.boat; out.push({ id: 'glass', kind: 'glass', x: g.x, z: g.z, heading: g.heading, u: g.v ?? 0, ...GLASS }); for (const k of T.kayaks) out.push({ id: `gk${k.i}`, kind: 'kayak', x: k.x, z: k.z, heading: k.heading, L: 3.4, B: 0.85 }); }
    // the lake's kayakers (round B): each a bite target while upright (a pair: two targets); the glass boat's are only spooked
    const F = kayaks(); if (F) F.marks().forEach((m, i) => out.push({ id: `k:${m.id ?? i}`, kind: 'kayak', x: m.x, z: m.z, heading: m.heading ?? 0, L: 3.4, B: 0.85, bite: !m.busy && !!F.bite }));
    // the stand-up paddleboards (South Lake): splashed and spooked only, never a target (v2/sim/tessieHits.js 'sup')
    const Sp = sups(); if (Sp) for (const m of Sp.marks()) out.push({ id: `s:${m.id}`, kind: 'sup', x: m.x, z: m.z, heading: m.heading ?? 0, L: 3.35, B: 0.76 });
    // South Lake's traffic (the paddle-wheeler, the runabouts, the jet ski): each sim's own entries, the sim kept for the hit
    for (const T2 of traffic() ?? []) if (T2) for (const e of T2.targets()) { e.sim = T2; out.push(e); }
    // the RPG, phase 6: the boats at anchor (knocked down at anchor) and a race's Regatta rivals (whenever a source lists them)
    if (bounty) {
      const A = anchored(); if (A?.active !== false && A?.targets) for (const e of A.targets()) out.push(e);
      for (const e of rivals?.() ?? []) if (e) out.push({ ...e, kind: 'rival', L: e.L ?? BUSY_HULL.L, B: e.B ?? BUSY_HULL.B });
    }
    return out;
  }
  // the hull the sim holds her outside this frame: the nearest of the Halcyon and the lake's sailboats (posed as drawn)
  plugin.boatFor = (b0) => {
    const n = nose(); if (!n) return b0;
    let best = b0, bd = b0 ? Math.hypot(b0.x - n.x, b0.z - n.z) : Infinity;
    const L = busy();
    if (L?.active) for (const b of L.liveBoats) {
      const s = b.phys.state, d = Math.hypot(s.x - n.x, s.z - n.z);
      if (d < bd && d < PLAYER.holdNearM) { const f = b.float ?? {}; bd = d; best = { x: s.x, z: s.z, heading: s.heading, speed: s.u ?? 0, heel: (s.heel ?? 0) + (f.roll ?? 0), pitch: f.pitch ?? 0, heave: f.heave ?? 0, boomAngle: s.boomAngle ?? 0, jibAngle: s.jibAngle ?? 0 }; }
    }
    return best;
  };
  // she has shown herself (any part above the water), and the boat's distance to her nearest part
  function sighting() {
    const st = sim.state, s = B.state;
    if (!st.visible || !st.spine) return { shown: false, distM: Infinity };
    const sp = st.spine, N = sp.length / 8, ds = sim.L / (N - 1);
    let top = -Infinity, d = Infinity;
    for (let i = 0; i < N; i += 2) { top = Math.max(top, sp[i * 8 + 1] + tessieHeightAt(i * ds, sim.L)); d = Math.min(d, Math.hypot(sp[i * 8] - s.x, sp[i * 8 + 2] - s.z)); }
    return { shown: top > 0.05, distM: d };
  }
  // where she rises for the menu's and the chart's entries: 150 m abeam of the boat in deep water, swimming the boat's way
  function spotBy(s) {
    for (const R of [PLAYER.offM, 120, 180, 100, 220]) for (const sg of [1, -1]) {
      const a = s.heading + sg * Math.PI / 2, x = s.x + Math.sin(a) * R, z = s.z - Math.cos(a) * R;
      if (depthAt(x, z) < 12) continue;
      let ok = true; for (let k = 10; k <= 50 && ok; k += 10) ok = depthAt(x + Math.sin(s.heading) * k, z - Math.cos(s.heading) * k) >= 8;
      if (ok) return { x, z, heading: s.heading };
    }
    return { x: s.x + Math.sin(s.heading + Math.PI / 2) * 60, z: s.z - Math.cos(s.heading + Math.PI / 2) * 60, heading: s.heading };
  }
  // the reach: within 10 s of a menu or chart entry, one of the lake's sailboats 80–125 m ahead of her in a 40° cone. After a wreck
  // (near: m), the next boat: when no upright boat out of its grace is within near m of her, one laid R0 m ahead (cheat on where:
  // the swim between two wrecks was about 80 % of the time between them)
  function stageReach(R0 = PLAYER.reachM, near = null) {
    const n = nose(), L = busy(); if (!n || !L?.active) return true;
    let list = L.liveBoats.filter((b) => !b.knock?.capsized); if (!list.length) return false;   // never a capsized one (it would pop upright)
    if (near == null) { for (const b of list) { const s = b.phys.state, d = Math.hypot(s.x - n.x, s.z - n.z), off = Math.abs(Math.atan2(Math.sin(Math.atan2(s.x - n.x, -(s.z - n.z)) - n.psi), Math.cos(Math.atan2(s.x - n.x, -(s.z - n.z)) - n.psi))); if (d < 140 && off < PLAYER.reachConeDeg * DEG) return true; } }
    else {
      list = list.filter((b) => !b.knock && !graced(b.id) && !(clock - (wreckAt.get(b.id)?.at(-1) ?? -Infinity) < BOUNTY.repeatS));   // a fresh boat: not righting, not in its grace, not one just wrecked
      if (list.some((b) => Math.hypot(b.phys.state.x - n.x, b.phys.state.z - n.z) < near)) return true;
      if (!list.length) return false;
    }
    const eye = lastPose?.pos ?? [n.x, 0, n.z];
    const pick = [...list].sort((a, b) => Math.hypot(b.phys.state.x - eye[0], b.phys.state.z - eye[2]) - Math.hypot(a.phys.state.x - eye[0], a.phys.state.z - eye[2]))[0];
    const s = B.state, windFrom = (s.heading ?? 0) + (s.trueWind?.angle ?? 0);
    for (const R of R0) for (const off of [0, 8, -8, 15, -15]) {
      const a = n.psi + off * DEG, x = n.x + Math.sin(a) * R, z = n.z - Math.cos(a) * R;
      if (depthAt(x, z) < 6) continue;
      const hs = [n.psi + Math.PI / 2, n.psi - Math.PI / 2].sort((h1, h2) => Math.abs(Math.cos(h1 - windFrom)) - Math.abs(Math.cos(h2 - windFrom)));
      for (const h of hs) {
        if (Math.abs(Math.atan2(Math.sin(h - windFrom), Math.cos(h - windFrom))) < 60 * DEG) continue;
        let ok = true; for (let k = 15; k <= 90 && ok; k += 15) ok = depthAt(x + Math.sin(h) * k, z - Math.cos(h) * k) >= 4;
        if (ok && L.lay(pick.id, { x, z, heading: h, speed: 2.6 })) { log.reach = { id: pick.id, R, at: +clock.toFixed(1), ...(near != null ? { next: true } : {}) }; return true; }
      }
    }
    return false;
  }
  // a knockdown. mult: the dash bite's × 1.15; e: the contact (her jaw on the rail, the transom or the topsides, or her
  // back under the bottom; the owner's son, 2026-11-21: "attacking the water at the side of the sailboat, not really the boat"): the boat is
  // jolted at that point, shoved and heeled away from her (lifted from below), its crew letting the sheets fly (the sails shake)
  function knock(r, mult = 1, e = null, ctx = null) {   // ctx: the strike's record for the bounty (the Tail Surge's own; null: the bite's)
    const b = r.hit; let ok = false;
    const away = e ? -r.side : r.side;   // a bite pushes it over away from her; a fall's weight on the rail (a breach) rolls it toward her
    let bump = null;
    if (e) {
      const dx = b.x - e.x, dz = b.z - e.z, dl = Math.hypot(dx, dz) || 1, fx = Math.sin(b.heading ?? 0), fz = -Math.cos(b.heading ?? 0);
      const along = (e.x - b.x) * fx + (e.z - b.z) * fz, under = e.where === 'bottom';
      bump = { px: dx / dl * (under ? 0.2 : 0.45) * mult, pz: dz / dl * (under ? 0.2 : 0.45) * mult, roll: away * (under ? 0.22 : 0.14) * mult, pitch: Math.max(-1, Math.min(1, along / 4)) * (e.where === 'stern' ? 0.12 : 0.05), heave: under ? 0.55 : 0 };
    }
    if (b.kind === 'sail') ok = !!busy()?.knock(b.id, { K: H.rollK(b.ref.phys.P, away) * mult, holdS: H.K.holdS, bump });
    else if (b.kind === 'glass') ok = !!tour()?.knock(away);
    else if (b.kind === 'halcyon') { const P = B.phys?.P; if (P) { B.shove({ K: H.rollK(P, away) * mult }); ok = true; } }
    else if (b.kind === 'kayak' && b.bite) ok = !!kayaks()?.bite?.(b.id.slice(2), e ? { x: e.x, z: e.z } : {});   // round B: over, a swim, righted, away
    else if (b.kind === 'anchored') ok = !!anchored()?.knock?.(b.id, away);   // the RPG, phase 6: knocked down at anchor
    else if (b.kind === 'rival') ok = !!b.knock?.(away);   // a Regatta rival (its race's own knockdown)
    else if (b.sim) ok = !!b.sim.hit(b.id, hitRule(b.kind), away);   // South Lake: a runabout knocked down; the jet ski's rider and the paddle-wheeler splashed only
    if (ok) H.mark(b.id, clock);   // every knockdown starts its 45 s grace (a bite's and a fall's already have: the slap's and the beside-wave's here)
    if (ok) scoreWreck(b, ctx);
    if (ok && bounty) nextAt = clock + PLAYER.nextDelayS;   // the RPG: the next boat, if none is near (stageReach)
    if (ok) { pullUntil = clock + 5; knockTotal++; try { storage?.setItem(COUNT_KEY, String(knockTotal)); } catch { /* */ } log.knocks.push({ id: b.id, kind: b.kind, side: r.side, at: +clock.toFixed(1), d: r.d }); }
    return ok;
  }

  const graced = (id) => H.grace(id, clock);   // knocked down within the last 45 s: no target, never over again
  // ---- the RPG: a wreck and a splash into her bounty ----
  function scoreWreck(b, ctx = null) {
    const kind = bounty ? RPG.kinds[b.kind] ?? null : null; if (!kind) return null;
    const st = ctx ?? strike ?? { depthM: C.state.nose, hidden: !!C.state.hidden, seen: null, skill: null };
    const splash = splashType(kind);   // the jet ski's rider and the paddle-wheeler's decks are splashed, never wrecked
    const times = (wreckAt.get(b.id) ?? []).filter((t) => clock - t < BOUNTY.repeatS); times.push(clock); wreckAt.set(b.id, times);   // the same boat again
    const r = bounty.score({ kind, depthM: st.depthM, hidden: st.hidden, seen: !!st.seen?.has(b.id), skill: st.skill, splash, sinceS: sinceSkill(b.id), repeat: times.length - 1, marked: markedNow(b.id) }, { day: day() });
    if (r?.repeat) tip(REPEAT_LINE.kind, REPEAT_LINE.text);   // the first time the same boat pays less: why (once ever)
    if (r?.marked) tip(MARKED_LINE.kind, MARKED_LINE.text);   // the first time a marked or lured boat pays more: why (once ever)
    if (r) { log.bounty.push({ kind, ...(splash ? { splash } : {}), xp: r.xp, first: r.first, levels: r.levels, ...(r.repeat ? { repeat: r.repeat } : {}), ...(r.marked ? { marked: true } : {}), at: +clock.toFixed(1) }); if (log.bounty.length > 8) log.bounty.shift(); hud?.level(bounty.legend()); leveled(r); }
    return r;
  }
  // ---- the RPG, phase 2: the level-up moment, the five slots, the Dash's rank ----
  // a score that reached a level: the line asks at once; the halo and the ranks follow
  function leveled(r) {
    if (r?.levels?.length) levelUp?.levelUp();
    if (r?.set) { const S = SETS.find((x) => x.id === r.set); if (S) { tip(S.kind, S.legend); log.sets = [...(log.sets ?? []), { id: S.id, at: +clock.toFixed(1) }]; } }   // phase 6: its legend line, once
    rpgSync(true);
  }
  // the save read at most every RPG.readS (now: force): the Dash's numbers by its rank, the pips, the legend's lines, the halo
  function rpgSync(force = false) {
    if (!bounty || (!force && clock - rpgReadT < RPG.readS)) return;
    rpgReadT = clock;
    const s = bounty.state(); rpgLevel = s.level; C.grow(growthOf(s.level));   // her body grows with her level
    const key = SKILL_ORDER.map((id) => `${s.ranks[id]}.${s.trials?.[id] ?? ''}`).join();
    if (key !== rpgRanks) { rpgRanks = key; C.skills.rank('dash', s.ranks.dash); hud?.ranks(s.ranks, s.trials); }
    const halo = levelUp.halo().join();
    if (halo !== rpgHalo) { rpgHalo = halo; hud?.halo(levelUp.halo()); }
  }
  // a slot pressed (its number key, a click, a tap): a pick while the level-up line is up and the slot glows; else the skill itself
  function pressSlot(id) {
    const p = levelUp?.press(id);
    if (p?.pick) {
      log.picks = [...(log.picks ?? []), { id, rank: p.rank, at: +clock.toFixed(1) }].slice(-8);
      if (!p.points) hintSvc()?.drop?.(LEVEL_UP.kind);   // the last point spent: the line's work is done
      rpgSync(true);
      return 'pick';
    }
    if (id === 'dash') { dashPulse = true; return 'fire'; }
    // the other skills: their behaviour at the rank (a locked one with free trials left: rank 1); a trial is spent only by a real use
    const u = useSkill({ bounty, id, run: (sid, rank) => SKILL_RUN[sid]?.(rank) ?? false });
    if (u.line) tip(u.line.kind, u.line.text);   // the first trial's line, the last one's (once ever each: the lean skipper)
    if (u.trial && u.spent) { log.trials = [...(log.trials ?? []), { id, left: u.left, at: +clock.toFixed(1) }].slice(-8); rpgSync(true); }
    if (!u.used) log.idle = (log.idle ?? 0) + 1;   // nothing happened: a quiet no-op
    if (u.why === 'locked') tip(SKILL_LINES.locked.kind, SKILL_LINES.locked.text(SKILL_NAMES[id]));   // no free try left: why (once ever)
    return u.used ? 'fire' : 'idle';
  }
  // a slot let go (its key up, the press on it lifted): the Breach launches (its run ends; a quick tap breaches where she is)
  function releaseSlot(id) {
    if (id !== 'breach' || !breachFx) return false;
    const ok = C.releaseBreach(); if (ok) breachFx.released = +clock.toFixed(2);
    return ok;
  }
  // each step while she is played: the level-up line (asked through the lean skipper), the halo, the ranks
  function rpgStep(dt) {
    if (!levelUp) return;
    const moving = has('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') || Math.hypot(touchIn.x, touchIn.y) > 0.25;
    const still = !moving && !C.state.dash && !C.state.bite && !C.state.lunge && C.state.speed <= PLAY.drift + RPG.stillV;
    const h = hintSvc(), st = levelUp.state;
    const lineUp = !st.open || clock - st.lineAt < 1.5 || !h || h.current === 'note';   // the note shows 0.6 s after it is taken
    levelUp.step(dt, { still, lineUp, say: (text) => {
      if (!h?.note) return false;
      const count = () => { const c = h.phoneQuiet?.state?.counts; return c ? c[LEVEL_UP.kind] ?? 0 : null; };   // null: no lean to ask
      const c0 = count();
      h.note(capLine(text), '', null, { kind: LEVEL_UP.kind });   // the glowing slots' keys as the line's key caps
      const c1 = count();
      const ok = c0 == null || c1 > c0;   // the lean counted it (no lean: taken)
      if (ok) log.lines = (log.lines ?? 0) + 1;
      return ok;
    } });
    rpgSync();
  }
  // a breach, a fall or a surfacing at (x, z): one splash for the kayaks it spooks (a pair: one), none twice within RPG.splashS
  function scoreSplash(x, z, list, reach = null) {   // reach: the splash's own reach (the Breach's rank 3+: 30 m), else sim/tessieHits.js spookM
    if (!bounty) return null;
    const ids = (reach == null ? H.splash(x, z, list) : list.filter((o) => o.kind === 'kayak' && Math.hypot(o.x - x, o.z - z) <= reach).map((o) => o.id)).filter((id) => list.find((o) => o.id === id)?.kind === 'kayak');
    const fresh = ids.filter((id) => !(clock - (splashAt.get(id) ?? -Infinity) < RPG.splashS));
    if (!fresh.length) return null;
    for (const id of ids) splashAt.set(id, clock);
    const since = fresh.map(sinceSkill).filter(Number.isFinite);   // a lured kayak splashed: the fastest record too
    const r = bounty.score({ kind: 'kayak', splash: true, depthM: 0, hidden: false, seen: false, marked: fresh.some(markedNow), ...(since.length ? { sinceS: Math.min(...since) } : {}) }, { day: day() });
    if (r?.marked) tip(MARKED_LINE.kind, MARKED_LINE.text);
    if (r) { log.bounty.push({ kind: 'kayak', splash: true, xp: r.xp, first: r.first, levels: r.levels, ...(r.marked ? { marked: true } : {}), at: +clock.toFixed(1) }); if (log.bounty.length > 8) log.bounty.shift(); hud?.level(bounty.legend()); leveled(r); }
    return r;
  }
  // the strike's start (a bite or a rise begun this step): her depth, HIDDEN and the boats that had seen her, kept for its hit
  function watchStrike(nose0, hidden0) {
    const bt = C.state.bite, ln = C.state.lunge;
    const fresh = (bt && bt !== biteWas) || (ln && ln !== lungeWas);
    if (fresh) {
      const seen = new Set(); for (const [id, t] of sawAt) if (clock - t <= RPG.seenS) seen.add(id);
      strike = { at: clock, depthM: nose0, hidden: hidden0, seen, skill: bt && bt !== biteWas ? (bt.kind === 'dash' ? 'dash' : null) : ln?.kind === 'skill' ? 'breach' : 'rise' };
    }
    biteWas = bt; lungeWas = ln;
  }
  function watchSeen(list, n) {
    const th = self.threat(); if (!th || !n) return;
    for (const b of list) if (b.kind !== 'kayak' && b.kind !== 'sup' && Math.hypot(b.x - n.x, b.z - n.z) <= th.seeM) {
      const fresh = !(clock - (sawAt.get(b.id) ?? -Infinity) <= RPG.seenS);
      sawAt.set(b.id, clock);
      if (fresh && b.kind !== 'anchored' && wary().chatter && chatter()) { const c = chatterLine(n, tipSeen); if (c) { tip(c.kind, c.text); log.chatter = { kind: c.kind, at: +clock.toFixed(1), by: b.id }; } }   // phase 6: the lookout's radio
      if (b.ref?.curious) busy()?.lure?.(b.id, null);   // a curious boat that sees her forgets the lure (her evade wins)
      if (b.kind === 'halcyon') halcyonLure = null;
    }
  }
  // ---- the RPG, phase 3: Lure and Sonar (each true when it really fired: a free trial is spent only then) ----
  function runLure(rank) {
    const row = LURE_RANKS[rank], n = nose(); if (!R || !row || !n || W.as !== 'tessie') return false;
    R.rank('lure', rank); if (!R.press('lure')) return false;
    const her = { x: n.x, z: n.z }, s = row.curiousS, ids = [];
    for (const t of lureTargets(her, targets(), { rangeM: row.rangeM, seen: seenRecently, halcyon: row.halcyon && !wary().halcyonFlees })) {   // 13+: he flees at the first ring
      if (t.kind === 'kayak') continue;   // (the fleet below)
      if (t.kind === 'glass') { if (tour()?.lure?.(her.x, her.z, s, row.rangeM)) ids.push(t.id); }
      else if (t.kind === 'halcyon') { halcyonLure = { x: her.x, z: her.z, until: clock + s }; ids.push(t.id); }
      else if (busy()?.lure?.(t.id, { x: her.x, z: her.z, s })) ids.push(t.id);   // the busy lake's sailboats
    }
    for (const id of kayaks()?.lure?.(her.x, her.z, row.rangeM, s) ?? []) ids.push(`k:${id}`);   // the kayakers judge their own sighting (the watch, the wariness)
    for (const id of ids) skillAt.set(id, { t: clock, until: clock + s });
    lureFx = { x: her.x, z: her.z, t0: clock, n: 0 };
    sim.emit?.('flick', 'tail');
    casts.push({ type: 'lure', x: her.x, z: her.z });
    log.lure = { at: +clock.toFixed(1), rank, rangeM: row.rangeM, curiousS: s, ids };
    return ids.length ? true : SKILL_EMPTY;   // nothing turned toward it: no free trial spent
  }
  function runSonar(rank) {
    const row = SONAR_RANKS[rank], n = nose(); if (!R || !row || !n || W.as !== 'tessie') return false;
    R.rank('sonar', rank); if (!R.press('sonar')) return false;
    const found = sonarPing({ x: n.x, z: n.z }, targets(), { rangeM: row.rangeM });
    marks.clear(); for (const m of found) { marks.set(m.id, clock + row.markS); skillAt.set(m.id, { t: clock, until: clock + row.markS }); }
    ping = { rangeM: row.rangeM, until: clock + row.markS, tail: row.tail };
    rimT = -1;
    const heard = C.state.hidden ? [] : found.filter((m) => m.d <= SONAR.hearM && m.kind !== 'kayak').map((m) => m.id);   // a ping from HIDDEN keeps her hidden
    for (const id of heard) sawAt.set(id, clock);
    casts.push({ type: 'ping', echoes: found.slice(0, 6).map((m) => m.d) });
    log.sonar = { at: +clock.toFixed(1), rank, rangeM: row.rangeM, markS: row.markS, ids: found.map((m) => m.id), heard };
    return found.length ? true : SKILL_EMPTY;   // nothing marked: no free trial spent
  }
  function runSurge(rank) {
    const row = SURGE_RANKS[rank], n = nose(); if (!R || !row || !n || W.as !== 'tessie' || !sim.state.spine) return false;
    R.rank('surge', rank); if (!R.press('surge')) return false;
    const tl = tailAt();
    surgeFx = { rank, row, t0: clock, slapAt: null, x: tl.x, z: tl.z, due: [], ctx: null, stir: 0 };
    sim.emit?.('flick', 'tail');   // her tail lifts: its drops and its sound
    sim.ring?.(tl.x, tl.z, 0.6);
    log.surge = { at: +clock.toFixed(1), rank, ringM: row.ringM, knockM: row.knockM, heelDeg: row.heelDeg, slap: null };
    const c = sim.state.centre ?? [tl.x, tl.z], reach = surgeResolve({ x: c[0], z: c[1] }, surgeList(), row, { bodyD });
    return reach.seen.length || reach.kayaks.length ? true : SKILL_EMPTY;   // no boat in its ring, no kayak in reach: no free trial spent
  }
  // m from a boat's middle to the nearest frame of her spine (the Tail Surge's knock radius counts from her whole body)
  function bodyD(b) { const sp = sim.state.spine; if (!sp) return Infinity; let d = Infinity; for (let i = 0; i < sp.length; i += 16) d = Math.min(d, Math.hypot(sp[i] - b.x, sp[i + 2] - b.z)); return d; }
  // her tail's tip and her body's middle on the water
  function tailAt() { const sp = sim.state.spine, o = (sp.length / 8 - 1) * 8; return { x: sp[o], z: sp[o + 2] }; }
  // the boats as the wave sees them: the sailboats' and the Halcyon's heel now and the wind at them
  function surgeList() {
    return targets().map((b) => {
      if (b.kind === 'sail') { const q = b.ref.phys.state; return { ...b, heelDeg: (q.heel ?? 0) / DEG, twsMs: q.trueWind?.speed }; }
      if (b.kind === 'halcyon') return { ...b, heelDeg: (B.state.heel ?? 0) / DEG, twsMs: B.state.trueWind?.speed };
      return b;
    });
  }
  // the slap: the splash, the ring at full amplitude, the plan of who heels, who goes over, which kayaks are splashed
  function surgeSlap(fx) {
    const c = sim.state.centre ?? [fx.x, fx.z], tl = tailAt();
    fx.slapAt = clock; fx.x = c[0]; fx.z = c[1];
    sim.emit?.('slap', 'tail', 1.6);
    sim.ring?.(tl.x, tl.z, 1); sim.ring?.(c[0], c[1], 1);
    const list = surgeList(), plan = surgeResolve({ x: c[0], z: c[1] }, list, fx.row, { grace: graced, bodyD }), by = new Map(list.map((b) => [b.id, b]));
    const seen = new Set(); for (const [id, t] of sawAt) if (clock - t <= RPG.seenS) seen.add(id);
    fx.ctx = { depthM: Math.max(0, C.state.nose ?? 0), hidden: false, seen, skill: 'surge' };   // the slap shows her: never an unseen wreck
    fx.due = [...plan.heels.map((h) => ({ ...h, b: by.get(h.id) })), ...(plan.knock ? [{ ...plan.knock, knock: true, b: by.get(plan.knock.id) }] : [])].sort((a, b) => a.atS - b.atS);
    // the kayakers within SURGE.kayakM: splashed (scored once, as a breach's) and spooked
    const near = list.filter((b) => b.kind === 'kayak' || b.kind === 'sup');
    const kay = plan.kayaks.length ? scoreSplash(c[0], c[1], near) : null;
    spookAt(c[0], c[1], SURGE.kayakM);
    casts.push({ type: 'surge', x: c[0], z: c[1] });
    if (!plan.knock && plan.light) tip(SURGE_LINES.light.kind, SURGE_LINES.light.text);   // why nothing went over (once ever each)
    else if (!plan.knock && plan.upright) tip(SURGE_LINES.upright.kind, SURGE_LINES.upright.text);
    log.surge.slap = { at: +clock.toFixed(1), x: +c[0].toFixed(1), z: +c[1].toFixed(1), heels: plan.heels.map((h) => ({ id: h.id, d: +h.d.toFixed(1), lean: +h.lean.toFixed(1), heelDeg: +h.heelDeg.toFixed(1), side: h.side })),
      knock: plan.knock ? { id: plan.knock.id, d: +plan.knock.d.toFixed(1), lean: +plan.knock.lean.toFixed(1), side: plan.knock.side } : null, light: plan.light, upright: plan.upright, kayaks: plan.kayaks, splashXp: kay?.xp ?? 0, seen: plan.seen, over: [] };
  }
  // the wave reaching a boat: its heel (or the one boat's knockdown), and she is seen
  function surgeReach(fx, h) {
    const b = h.b; if (!b) return;
    if (h.knock && graced(b.id)) h = { ...h, knock: false, heelDeg: fx.row.heelDeg, side: surgeAway(b, fx) };   // knocked down since the slap (a bite): it only heels
    if (h.knock) {
      const ok = knock({ hit: b, side: h.side, d: h.d }, 1, null, fx.ctx);
      if (ok) { soundKnocks.push({ hit: true, boat: b.kind, x: b.x, z: b.z, where: 'rail', mult: 1 }); log.surge.slap.over.push(b.id); }
    } else {
      const heel = h.side * h.heelDeg * DEG;
      if (b.kind === 'sail') busy()?.wave?.(b.id, { heel });
      else if (b.kind === 'halcyon') B.wave?.({ heel });
      else if (b.kind === 'glass') tour()?.knock?.(h.side, h.heelDeg);
    }
    if (b.kind !== 'kayak' && b.kind !== 'sup') sawAt.set(b.id, clock);   // the slap reveals her
  }
  function surgeStep() {
    const fx = surgeFx; if (!fx) return;
    const u = clock - fx.t0;
    if (fx.slapAt == null) {
      if (fx.stir === 0 && u >= SURGE.windupS * 0.5) { fx.stir = 1; const c = sim.state.centre; if (c) sim.ring?.(c[0], c[1], 0.5); }   // the water stirs as she coils
      if (u >= SURGE.windupS) surgeSlap(fx);
      return;
    }
    const v = clock - fx.slapAt;
    while (fx.due.length && v >= fx.due[0].atS) surgeReach(fx, fx.due.shift());
    if (v > SURGE.waveS + SURGE.fadeS && !fx.due.length) surgeFx = null;
  }
  // ---- the RPG, phase 5: the Breach ----
  function runBreach(rank) {
    const row = BREACH_RANKS[rank], n = nose(); if (!R || !row || !n || W.as !== 'tessie' || !sim.state.spine) return false;
    R.rank('breach', rank); if (R.state('breach')?.phase !== 'ready') return false;
    const hidden = !!C.state.hidden, tg = breachTarget(n, targets(), { lockId: lastLock?.id ?? null, hidden, depthAt, grace: graced });
    if (!tg) { log.breach = { at: +clock.toFixed(1), rank, none: true, hidden }; tip(SKILL_LINES.breachNone.kind, SKILL_LINES.breachNone.text); return false; }   // nothing to run at: nothing spent; the line says why (once ever)
    const offM = tg.kind === 'kayak' ? (tg.B ?? 0.85) / 2 + BREACH.kayakOffM + 2.3 : PLAY.strikeOffM;   // a kayak: the spot off it, her front's reach past her nose kept clear
    if (!C.skillBreach(tg, { offM }) || !R.press('breach')) return false;
    breachFx = { rank, row, t0: clock, targetId: tg.id, kind: tg.kind, seen: null, launch: null, fall: null, released: null };
    log.breach = { at: +clock.toFixed(1), rank, windowM: row.windowM, target: tg.id, kind: tg.kind, d: +Math.hypot(tg.x - n.x, tg.z - n.z).toFixed(1), hidden, launch: null, fall: null };
    return true;
  }
  // the target as she is told of it this step: its entry; once its crew has seen the run (before the launch: the V) she is told no more,
  // and runs at where it was then (it bears away: she lands behind it)
  function breachTrack(list) {
    const fx = breachFx; if (!fx) return null;
    const b = list.find((o) => o.id === fx.targetId) ?? null;
    if (!fx.seen && C.state.lunge?.phase === 'run' && (sawAt.get(fx.targetId) ?? -Infinity) > fx.t0) fx.sawT ??= clock;   // the crew sees the V ...
    if (!fx.seen && fx.sawT != null && C.state.lunge?.phase === 'run' && clock - fx.sawT >= BREACH.reactS) {   // ... and bears away BREACH.reactS later
      fx.seen = b ? { ...b, u: 0 } : true; if (log.breach) { log.breach.seen = +clock.toFixed(1); if (b) log.breach.seenAt = { x: +b.x.toFixed(1), z: +b.z.toFixed(1) }; }
    }
    return fx.seen ? (fx.seen === true ? null : fx.seen) : b;
  }
  // her front lands: on the rail within the window (a knockdown), beside it (the wave), by a kayak (4 m off it, a splash only)
  function breachFall(e, list) {
    const fx = breachFx, row = fx?.row ?? BREACH_RANKS[1];
    const land = breachLanding(e, list);
    const r = H.fall(land, list.filter((b) => b.kind !== 'kayak' && b.kind !== 'sup'), clock, { hitM: row.windowM });
    let ok = r.hit ? knock(r) : false, beside = null;
    if (!r.hit) {
      beside = breachBeside(land, surgeList(), row, { grace: graced });
      const b = beside ? list.find((o) => o.id === beside.id) : null;
      if (b && beside.knock) ok = knock({ hit: b, side: beside.side, d: beside.d });   // rank 4: a boat already leaning goes over
      else if (b) {
        const heel = beside.side * beside.heelDeg * DEG;
        if (b.kind === 'sail') busy()?.wave?.(b.id, { heel });
        else if (b.kind === 'halcyon') B.wave?.({ heel });
        else if (b.kind === 'glass') tour()?.knock?.(beside.side, beside.heelDeg);
      }
      if (b) sawAt.set(b.id, clock);
    }
    if (ok) { log.hits++; soundKnocks.push({ hit: true, boat: (r.hit ?? list.find((o) => o.id === beside?.id))?.kind, x: land.x, z: land.z, where: 'rail', mult: 1 }); }
    spookAt(land.x, land.z, row.spookM); scoreSplash(land.x, land.z, list, row.spookM);
    const fl = { x: +land.x.toFixed(1), z: +land.z.toFixed(1), moved: +land.moved.toFixed(2), hit: r.hit?.id ?? null, d: r.d ?? null, beside: beside ? { id: beside.id, d: +beside.d.toFixed(1), heelDeg: beside.heelDeg, side: beside.side, knock: beside.knock, lean: +beside.lean.toFixed(1) } : null, ok, at: +clock.toFixed(1) };
    if (fx) { fx.fall = fl; fx.launch = 'done'; }
    if (!ok && fx?.seen) tip(SKILL_LINES.breachSeen.kind, SKILL_LINES.breachSeen.text);   // why it missed: the crew saw the V and bore away (from 9 m down every run of 9 landed; from the surface 5 of 9)
    if (log.breach) log.breach.fall = fl;
    log.lastFall = { x: fl.x, z: fl.z, hit: fl.hit, d: fl.d, at: fl.at };
    C.result(ok);
  }
  // each step while she is played: the two rings' clocks, the lure's splashes, the marks running out
  function skillsStep(dt) {
    if (!R) return;
    R.step(dt);
    surgeStep();
    if (lureFx) {
      const k = (clock - lureFx.t0) / LURE_CAST_S;
      while (lureFx.n < LURE.splashes && k >= lureFx.n / LURE.splashes) {   // the small splashes over the cast: rings on her water (the creature map)
        if (lureFx.n === 0) lureSplashes(lureFx.x, lureFx.z, LURE.splashes, splashPts);
        const p = splashPts[lureFx.n]; sim.ring?.(p[0], p[1], 0.45);
        if (lureFx.n === Math.floor(LURE.splashes / 2)) sim.emit?.('flick', 'tail');
        lureFx.n++;
      }
      if (clock - lureFx.t0 > LURE.ringS) lureFx = null;
    }
    if (halcyonLure && clock > halcyonLure.until) halcyonLure = null;
    if (ping && clock > ping.until) { ping = null; marks.clear(); rimT = -1; }
  }

  // ---- the swap ----
  function apply(on) {
    plugin.playing = on;
    const H2 = doc?.documentElement;
    if (H2) H2.toggleAttribute('data-tessie-play', on);
    if (!on) { plugin.playDip = 1; plugin.sound?.played?.({ on: false }); surgeFx = null; breachFx = null; slowK = 1; plugin.playK = 1; }   // a surge or a breach under way ends with her play
    if (dom()) {
      q('.tp-dial').hidden = !on; q('.tp-touch').hidden = !on || !touch(); q('.tp-aim').hidden = true;
      layoutKey = ''; hud?.show(on); if (on) placeHud();
      if (world) world.el.toggleAttribute('hidden', !on);   // (an svg element has no hidden property: the attribute)
      if (!on) q('.tp-ghost').toggleAttribute('hidden', true);
    }
    if (on) topSwitch();
    (svc()?.get?.('hint') ?? svc()?.get?.('controls')?.hint)?.hush?.(on);   // the skipper's sail lines say nothing while you are her (notes pass: her own lines, tip())
    svc()?.get?.('vesselPick')?.set?.(on ? 'tessie' : 'halcyon', { quiet: true });
    if (!on) svc()?.get?.('calm')?.wake?.('all');   // given back: the boat's HUD returns awake (BOAT_HUD), not faded by the Calm HUD's idle clock
  }
  function veilSwap(fn) { if (veil) { veil(1, PLAYER.veilOut); veilT = { t: PLAYER.veilOut + 0.05, fn }; } else fn(); }
  const self = {
    get active() { return W.as === 'tessie'; }, get as() { return W.as; }, get pill() { return W.pill; }, beLine, ctl: C, hits: H, swap: W, cam,
    get knocks() { return knockTotal; },
    get bounty() { return bounty; },   // the RPG's (null without ?tessierpg=1)
    get levelUp() { return levelUp; },   // the RPG's level-up moment (null without ?tessierpg=1)
    pressSlot: (id) => (bounty ? pressSlot(id) : null),   // the RPG: a slot pressed as its key or a tap would
    releaseSlot: (id) => (bounty ? releaseSlot(id) : null),   // the RPG: a slot let go (the Breach launches)
    skillRun: SKILL_RUN,   // the RPG: the skills' behaviours by id (phases 3–5; the page test registers a stub)
    // the door: the Logbook on its Tessie page (the dials' click; the RPG only)
    openLog() { const L = svc()?.get?.('logbook')?.logbook; if (!bounty || !L?.show) return false; L.show('tessie'); return true; },
    girthAt: (i, N) => reachAt(i * sim.L / Math.max(1, N - 1), sim.L),   // phase 2b: her body's reach at spine frame i of N (m: her bubbles leave her skin)
    // a fixed pose (tools/v2-perf.mjs, the evidence): her nose held at `nose` m (E / Q as the keys would), the look held at `look` rad (+ down),
    // swim: W held (her body follows her nose's path; at a drift it lags it by tens of seconds); sprint: Shift held; chase: W toward the
    // nearest of the lake's sailboats (chase: '<id>': that target) and Space once it is in reach; breach: the run kept while she climbs (a running climb breaches); yaw: the camera held that many rad round her (+ to her left);
    // null hands her back to the player
    pin(p = null) { pinned = p && Number.isFinite(p.nose) ? { nose: Math.max(0, p.nose), look: Number.isFinite(p.look) ? p.look : null, swim: !!p.swim, sprint: !!p.sprint, chase: !!p.chase, chaseId: typeof p.chase === 'string' ? p.chase : null, nobite: !!p.nobite, breach: !!p.breach, yaw: Number.isFinite(p.yaw) ? p.yaw : null } : null; return pinned; },
    get pinned() { return pinned; },
    get view() { return view; }, setView(v) { view = v === 'first' ? 'first' : 'third'; return view; },   //'s own state; tests and captures)
    ctx() { return { on: true, mode: mode(), race: !!race(), knocked: !!knocked(), card: cardUp(), revenge: !!plugin.revenge?.active }; },
    become(entry = 'swap', at = null) {
      if (W.as === 'tessie') return { ok: false, why: 'already' };
      const why = W.can(entry, self.ctx()); if (why) return { ok: false, why };
      if (!plugin.render?.ready) { if (entry !== 'swap') pendingEntry = entry; return { ok: false, why: 'loading' }; }   // the menu's or the chart's entry waits for her model
      const s = B.state, place = entry === 'swap' ? null : at ?? spotBy(s);
      const go = () => {
        W.become(entry);
        if (entry === 'swap') beLine.retire();   // T or the line's tap, once: the line has done its job (never again, stored)
        if (place) { sim.ambush(place.x, place.z, place.heading, PLAY.drift); }
        C.begin(place);
        // the skipper takes the Halcyon and sails away from her (unless an autopilot already has her: Cruise, AUTO)
        if (!B.driven) { flee ??= createFlee({ B, depthAt, her: () => { const n = nose(); return n ? { x: n.x, z: n.z } : null; }, lure: () => halcyonLure }); B.drive(flee.drive); fleeOn = true; }
        cam.reset(); entryT = clock; reachDone = entry === 'swap';
        apply(true);
        holdTip = 0.8;   // her first tip asks the skipper's line after 0.8 s (once ever: the lean store)
        log.swaps.push({ in: entry, at: +clock.toFixed(1) });
      };
      if (entry === 'swap') {
        // the glide under 120 m (the rig's first pose against the camera now); else, or under reduced motion, the veil
        const n = nose(); if (!n) return { ok: false, why: 'unseen' };
        const probe = createTessieCam().step(1 / 60, { spine: sim.state.spine, L: sim.L, psi: n.psi, nose: 0, reduced: reduced() });
        if (lastBoatPose && !needsVeil(lastBoatPose, probe, { reduced: reduced() })) { go(); glide.start(lastBoatPose); }
        else { veilSwap(() => {}); holdCamUntil = clock + PLAYER.veilOut + 0.05; go(); }   // she is yours at once; the camera cuts under the veil
      } else go();
      return { ok: true, entry };
    },
    back({ cut = false } = {}) {
      if (W.as !== 'tessie') return false;
      W.back(); C.end();
      if (fleeOn) { if (B.drivenBy?.(flee.drive)) B.drive(null); fleeOn = false; }   // only if her flee still owns the hook (Cruise's autopilot survives)
      apply(false); held.clear(); touchIn.x = touchIn.y = 0; touchIn.id = null; touchIn.dive = touchIn.lunge = touchIn.up = touchIn.down = touchIn.dash = false;   // the view C chose stays for the rest of the visit (open question 2)
      if (!cut && lastPose && lastBoatPose && !needsVeil(lastPose, lastBoatPose, { reduced: reduced() })) glide.start(lastPose);
      else if (!cut) { glide.stop(); veilSwap(() => {}); }
      log.swaps.push({ out: true, at: +clock.toFixed(1) });
      return true;
    },
    // the chart's "Be Tessie": the boat moved to her water under the veil (the birthplace's move), she rises 150 m off it.
    // id: the flagged pin's row (the card's ref); else the row that carries her mark (her own row folded into Off Fannette)
    async fromChart(id = null) {
      const why = W.can('chart', self.ctx()); if (why && why !== 'card') return { ok: false, why };
      if (W.as === 'tessie') self.back({ cut: true });
      const rows = birthplaces?.list?.() ?? [];
      const to = (id && rows.some((r) => r.id === id) ? id : null) ?? rows.find((r) => r.mark)?.id ?? id;
      const r = birthplaces ? await birthplaces.moveTo(to) : { ok: true };
      if (!r?.ok) return r ?? { ok: false, why: 'unknown' };
      pendingChart = true;
      svc()?.get?.('menu')?.close?.();
      return { ok: true };
    },
    // the busy lake's escape: her as a threat the boats keep clear of, only once they see her
    threat() {
      if (W.as !== 'tessie' || !sim.state.visible) return null;
      const n = nose(); if (!n) return null;
      const nz = C.state.nose, L = C.state.lunge, warned = !!L?.deep && L.phase === 'rise';   // 2c: the warning rings: the boats near them see her coming, at any depth
      const runUp = L?.kind === 'skill' && (L.phase === 'run' || L.phase === 'climb');   // phase 5: the Breach's run-up, a dark shape and a V
      const seeM = warned ? PLAY.warn.seeM : runUp ? Math.max(BREACH.seeM, nz < 2.5 ? wary().seeM : 0) : nz < 2.5 ? wary().seeM : nz <= PLAY.hiddenM ? 15 : 0;   // phase 6: 60 m, 90 m from level 6   //: 1–8 m 15 m, deeper never (HIDDEN on the dial)
      return seeM ? { x: n.x, z: n.z, heading: n.psi, u: n.speed, m: 120, seeM, warn: warned || runUp } : null;
    },
    step(dt) {
      if (!(dt > 0)) return;
      clock += dt;
      if (!provided) { const S = svc(); if (S?.provide) { S.provide('tessiePlay', self); provided = true; } }
      if (veilT) { veilT.t -= dt; if (veilT.t <= 0) { const f = veilT.fn; veilT = null; f?.(); veil?.(0, PLAYER.veilIn); } }
      // the menu's Boat plate: closing the card applies the pick (Dive in, Resume)
      const card = cardUp();
      if (prevCard && !card) {
        const pick = svc()?.get?.('vesselPick');
        const want = pick?.get?.();
        if (pendingChart) { pendingChart = false; self.become('chart'); }
        else if (want === 'tessie' && W.as === 'boat') self.become('menu');
        else if (want === 'halcyon' && W.as === 'tessie') self.back({ cut: true });
      }
      prevCard = card;
      if (W.as === 'tessie' && (race() || isRace(mode()))) self.back({ cut: true });
      if (pendingEntry && W.as === 'boat' && !card && plugin.render?.ready) { const e = pendingEntry; pendingEntry = null; self.become(e); }
      const sg = sighting();
      W.step(dt, { ...self.ctx(), shown: sg.shown, distM: sg.distM });
      beLine.step(dt, W.pill && W.as === 'boat');   // "Tessie's up. [T] to be her." on the skipper's line (createBeLine)
      if (holdTip > 0) { holdTip -= dt; if (holdTip <= 0) tip('tip.tessie.swim', touch() ? PLAY_LINES.tipTouch : PLAY_LINES.tip); }
      stepTips(dt);
      // phase 2a's two lines, each once: the first dive's (at the surface in water deep enough, after the tip), the first time past 6 m
      if (W.as === 'tessie' && underOn && sim.state.visible) {
        const nz = C.state.nose;
        surfaceT = nz < 1.2 && C.state.way != null && holdTip <= 0 && C.state.lim > 0 ? surfaceT + dt : 0;   //: swimming at the surface (a way held) in water deep enough to dive
        if (surfaceT > PLAYER.fastS) tip('tip.tessie.dive', touch() ? PLAY_LINES.fastTouch : PLAY_LINES.fast);
        if (nz > PLAYER.lookUpM) tip('tip.tessie.look', PLAY_LINES.look);
      }
      if (bounty) { const F = kayaks(), m = W.as === 'tessie' ? wary().kayakBerthM : 0; if (F?.berth && F.berthM !== m) F.berth(m); }   // phase 6: the kayaks' berth, only while she is played
      if (W.as !== 'tessie' || !sim.state.visible) return;
      const list = targets(), n = nose();
      // the corners (kept with hysteresis) and the lock-on: amber means locked, at the surface and under the water
      const tg = H.aim(n, list, clock);
      const lk = H.lock(n, list, clock, { nose: C.state.nose, way: C.state.way, tablet: !!touch(), dt });
      lastLock = lk ? { id: lk.id, k: lk.k, x: lk.x, z: lk.z } : null;
      if (tg) tg.locked = !!lk?.id && lk.id === tg.id;
      if (lk?.id && lk.id !== lockWas) lockAt = clock;   // the corners close in once on a new lock
      lockWas = lk?.id ?? null;
      pinTg = tg; lastTg = tg;
      const nose0 = C.state.nose, hidden0 = !!C.state.hidden;
      if (bounty) watchSeen(list, n);
      // phase 5: her play clock 0.5x about the Breach's apex (her own step only: the controller here, her body through plugin.playK)
      const slowOff = !slowBreach() || !!race() || isRace(mode());
      slowK = breachSlowK(C.state.lunge, { off: slowOff });
      C.step(dt * slowK, cardUp() ? {} : hands(), { target: tg, lock: lk, track: breachFx ? breachTrack(list) : undefined });
      plugin.playK = slowK = breachSlowK(C.state.lunge, { off: slowOff });
      if (bounty) watchStrike(nose0, hidden0);
      for (const e of C.events) {
        if (e.type === 'contact') {
          // a bite's hit test: her head within 3.0 m of the locked hull (2.0 m otherwise)
          log.bites = (log.bites ?? 0) + 1;
          const r = H.contact(e.kind === 'rising' ? { ...e, y: 0 } : e, list, clock);   // the rising strike: her head under the hull's bottom
          log.lastContact = { x: +e.x.toFixed(1), z: +e.z.toFixed(1), kind: e.kind, locked: !!e.locked, hit: r.hit?.id ?? null, d: r.d ?? null, at: +clock.toFixed(1) };
          const km = (e.kind === 'dash' ? C.skills.state('dash')?.bite : null) ?? e.knock ?? 1;   // the RPG: the Dash's rank 4 bites × 1.25 (no rank set: the bite's own)
          const ok = r.hit ? knock(r, km, e) : false; if (ok) log.hits++;
          if (ok) soundKnocks.push({ hit: true, boat: r.hit.kind, x: e.x, z: e.z, where: e.where, mult: km });   // the knock's sound (v2/audio/tessieMix.js): the hull's material, the creak, the sails
          C.result(ok);
        } else if (e.type === 'launch') {   // phase 5: the Breach launches: the eye eases back and up (the knockdown's)
          pullUntil = clock + 5; if (breachFx) breachFx.launch = e.why; if (log.breach) log.breach.launch = { why: e.why, at: +clock.toFixed(1) };
        } else if (e.type === 'fall' && e.skill) {
          log.falls++; breachFall(e, list);
        } else if (e.type === 'fall') {
          log.falls++;
          const r = H.fall(e, list, clock, { hitM: e.locked ? H.K.lock.footM : H.K.hitM });   // the rising strike's fall: 3.5 m while locked
          log.lastFall = { x: +e.x.toFixed(1), z: +e.z.toFixed(1), hit: r.hit?.id ?? null, d: r.d ?? null, at: +clock.toFixed(1) };
          const ok = r.hit ? knock(r) : false; if (ok) log.hits++;
          spookAt(e.x, e.z, H.K.spookM); log.spooks += r.spooked.length; scoreSplash(e.x, e.z, list);
          C.result(ok);
        } else if (e.type === 'surfaced') { spookAt(e.x, e.z, H.K.spookM); scoreSplash(e.x, e.z, list); }
      }
      for (const e of sim.state.events) if (e.type === 'breach' || e.type === 'break') { spookAt(e.x, e.z, H.K.spookM); scoreSplash(e.x, e.z, list); }
      if (bounty && !C.state.bite && !C.state.lunge) strike = null;
      rpgStep(dt);
      skillsStep(dt);
      // the kayaks and the glass boat are solid to her (the sailboats: the sim's own hold)
      // (round B: not the kayak she is biting: her jaw meets its hull, not the water beside it)
      const biting = C.state.bite?.target?.id ?? C.state.lunge?.target?.id ?? null;
      H.holdOff(sim.state.spine, sim.L, biting ? list.filter((b) => b.id !== biting || b.kind !== 'kayak') : list, (s) => reachAt(s, sim.L));
      if (!reachDone && clock - entryT > PLAYER.reachDelayS) reachDone = stageReach() || clock - entryT > 10;
      if (nextAt != null && clock >= nextAt) { nextAt = null; stageReach(PLAYER.nextM, PLAYER.nextNearM); }   // the RPG: a fresh boat after a wreck
      // the sound and the beds under the surface
      // her sound (v2/living/tessie-sound.js played): the rush by speed and gait (the top 19 m/s), the world's low-pass by the eye's depth,
      // the water's ambience, the engines, the one-shots from this frame's events
      const eyeUnder = underOn && lastUnder ? lastUnder.depth : null, pp = lastPose?.pos, pt = lastPose?.target;
      if (n) plugin.sound?.played?.({ on: true, speedK: C.state.speed / PLAY.top, speed: C.state.speed, nose: C.state.nose, dash: !!C.state.dash, eyeDepth: eyeUnder, boats: list, her: n, dt,
        cam: pp && pt ? { x: pp[0], z: pp[2], yaw: Math.atan2(pt[0] - pp[0], -(pt[2] - pp[2])) } : { x: n.x, z: n.z, yaw: n.psi }, events: C.events, knocks: soundKnocks, skill: C.skills.state('dash'), phase: C.state.phase, bite: C.state.bite, lunge: C.state.lunge, lockId: lastLock?.id ?? null, casts });
      soundKnocks.length = 0; casts.length = 0;
      plugin.playDip = (eyeUnder != null ? eyeUnder > 0.3 : C.state.nose >= 2) ? 0.55 : 1;
      // phase 5: through the Breach's run the corners sit on its target, amber once a release now lands the arc on it
      const L5 = C.state.lunge, bt = breachFx && L5?.kind === 'skill' && L5.phase === 'run' ? list.find((b) => b.id === breachFx.targetId) : null;
      paint(bt ? { id: bt.id, x: bt.x, z: bt.z, d: Math.max(0, Math.hypot(bt.x - n.x, bt.z - n.z) - (bt.L ?? 8.5) / 2), locked: !!L5.near } : tg, list, dt);
    },
    camera(dt, c, orbit = null) {
      // the boat's own camera, tracked in place (no per-frame allocation) in both modes: the swap-back judges the veil against where the boat is NOW
      if (c) { const b = boatPose; b.pos[0] = c.pos[0]; b.pos[1] = c.pos[1]; b.pos[2] = c.pos[2]; b.target[0] = c.target[0]; b.target[1] = c.target[1]; b.target[2] = c.target[2]; b.fov = c.fov; lastBoatPose = b; }
      if (W.as !== 'tessie') return glide.active && c ? (lastPose = glide.apply(dt, c)) : c;
      const n = nose(); if (!n) return c;
      // the look: the mouse's drag (the page's orbit) or the tablet's look drag; it follows in behind her while she swims and nobody drags
      const inv = prefs.get('invert') ? -1 : 1;   // phase 2a: Invert up/down (Settings; off)
      const lo = pinned ? [pinned.yaw != null ? Math.atan2(Math.sin(cam.yaw - (n.psi + pinned.yaw)), Math.cos(cam.yaw - (n.psi + pinned.yaw))) : 0, 0] : [(orbit?.[0] ?? 0) + touchLook[0], ((orbit?.[1] ?? 0) + touchLook[1]) * inv]; touchLook[0] = 0; touchLook[1] = 0;   // a pose's yaw: the camera held that far round her
      if (pinned?.look != null) cam.setLook(pinned.look);   // the pose's look, held (no assist)
      const dragging = !!(lo[0] || lo[1]); if (lo[0]) dragYaw -= lo[0];
      const moving = has('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') || Math.hypot(touchIn.x, touchIn.y) > 0.25 || !!(pinned?.swim || pinned?.chase);
      const keysHeld = moving || has('KeyE', 'KeyQ') || touchIn.up || touchIn.down || !!pinned;
      //: one continuous camera: the controller's strike state shapes its goal, the lock pulls its aim (never a mode switch)
      const live = cam.step(dt, { spine: sim.state.spine, L: sim.L, psi: n.psi, nose: C.state.nose, speed: C.state.speed, strike: C.state.strike, lock: lastLock, view, reduced: reduced(), orbit: dragging ? lo : null, follow: moving, pull: clock < pullUntil,
        followOn: prefs.get('follow') !== false, limit: !!C.state.limit, resting: !keysHeld, waterAt, floorAt, underOn });
      lastUnder = live.under;
      if (clock < holdCamUntil && lastBoatPose) return c;
      const out = glide.apply(dt, { ...live, pos: [...live.pos], target: [...live.target], near: live.under?.medium === 'water' || live.under?.crossing || live.viewK > 0.01 ? 0.1 : 0.5 });   // first person: the 0.1 m near plane (her crown is about 0.25 m under the eye)   // phase 2a: a near plane inside the lens's band while under or crossing
      lastPose = out;
      return out;
    },
    stats() {
      return { as: W.as, entry: W.entry, pill: W.pill, view, viewK: cam.state.viewK, fleeOn, knocks: knockTotal, under: lastUnder ? { ...lastUnder } : null, look: +cam.look.toFixed(4), eye: lastPose?.pos ? lastPose.pos.map((v) => +v.toFixed(2)) : null, ctl: { ...C.state, lunge: C.state.lunge ? { phase: C.state.lunge.phase, kind: C.state.lunge.kind, t: +C.state.lunge.t.toFixed(2), target: C.state.lunge.target?.id ?? null } : null, bite: C.state.bite ? { kind: C.state.bite.kind, t: +C.state.bite.t.toFixed(2), target: C.state.bite.target?.id ?? null, locked: C.state.bite.locked, hit: C.state.bite.hit } : null, strike: C.state.strike }, lock: lastLock ? { ...lastLock, k: +lastLock.k.toFixed(2) } : null, bite: sim.biteState ? { kind: sim.biteState.kind, phase: sim.biteState.phase, t: +sim.biteState.t.toFixed(2), gape: +(sim.state.gape ?? 0).toFixed(3) } : null,
        log: { ...log, knocks: log.knocks.slice(-8), swaps: log.swaps.slice(-8) }, tipsWant: tips.waiting, beLine: { waiting: beLine.waiting, shown: beLine.shown }, glide: glide.active, aim: lastAim,
        rpg: levelUp ? { ...levelUp.state, halo: levelUp.halo(), level: rpgLevel, wary: { ...wary() }, waiting: tips.waiting, dash: C.skills.state('dash'), lure: R.state('lure'), sonar: R.state('sonar'), surge: R.state('surge'), breach: R.state('breach'), slowK,
          breachFx: breachFx ? { rank: breachFx.rank, phase: C.state.lunge?.kind === 'skill' ? C.state.lunge.phase : 'done', t: +(clock - breachFx.t0).toFixed(2), target: breachFx.targetId, seen: !!breachFx.seen, near: !!C.state.lunge?.near, launch: breachFx.launch, windowM: breachFx.row.windowM } : null,
          surgeFx: surgeFx ? { phase: surgeFx.slapAt == null ? 'windup' : 'wave', t: +(clock - surgeFx.t0).toFixed(2), ringM: surgeFx.row.ringM, due: surgeFx.due.length } : null,
          marks: [...marks.keys()], ping: ping ? { rangeM: ping.rangeM, left: +(ping.until - clock).toFixed(2), tail: ping.tail } : null, lureRing: !!lureFx, halcyonLure: !!halcyonLure } : null };
    },
  };
  let lastLock = null, lastTg = null, lockWas = null, lockAt = -Infinity;   //: the lock this step, the corners' close-in clock
  const soundKnocks = [];   // this frame's contacts that hit, for her sound
  let nextAt = null;   // the RPG: when to look for the next boat after a wreck (stageReach's near rule)
  let pendingChart = false, holdTip = 0, lastAim = null, pendingEntry = null, pullUntil = -1, lastUnder = null, hud = null, layoutKey = '', outT = 0, world = null;
  // the HUD's places for this window: a desktop's bottom corners and row, a tablet's top corners
  function placeHud() {
    const w = globalThis.innerWidth ?? 1280, h = globalThis.innerHeight ?? 720, tab = !!touch(), k = `${w}x${h}${tab}`;
    if (!hud || k === layoutKey) return;
    layoutKey = k;
    const bar = parseFloat(globalThis.getComputedStyle?.(doc.documentElement)?.getPropertyValue('--lk-bar-b')) || 58;
    hud.place(hudLayout({ w, h, tablet: tab, barB: bar, slots: bounty ? RPG_SLOT_COUNT : HUD.slots }), q('.tp-dial'));   // the RPG: five slots
  }
  // phase 3: the world's marks, projected onto the water each frame (pooled elements; no allocation but the projection's own)
  const pA = [0, 0, 0], pB = [0, 0, 0], RING_FLAT = 0.3, LURE_SEGS = 40;
  // the lure's ring as the true circle on the water, projected point by point (she is near the eye: an ellipse would not hold); only
  // while it shows (LURE.ringS after a cast)
  // (segs, near: the Tail Surge's wider ring passes under the eye: finer, and cut nearer than near m so no chord dives off the frame)
  function circleAt(e, x, z, r, segs = LURE_SEGS, near = 0.5) {
    let d = '', pen = false;
    for (let k = 0; k <= segs; k++) {
      const a = k / segs * 2 * Math.PI, p = project(x + Math.sin(a) * r, 0, z - Math.cos(a) * r, pA);
      if (!p || !(p[2] > near)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`; pen = true;
    }
    if (!d) return false;
    e.setAttribute('d', d);
    return true;
  }
  const vis = (i, e, on) => { if (world.on[i] !== (on ? 1 : 0)) { world.on[i] = on ? 1 : 0; e.setAttribute('visibility', on ? 'visible' : 'hidden'); } };
  // a circle of radius r on the water at (x, z) as an ellipse: its centre projected, rx from the focal length, ry squashed by the eye's height
  // over the distance, never flatter than RING_FLAT of rx (a grazing ring would read as a line: cheat on the look, the place is true)
  function ringAt(e, x, z, r) {
    const p = project(x, 0, z, pA); if (!p || !(p[2] > 0.5)) return false;
    const eye = lastPose?.pos, h = eye ? Math.max(0.5, eye[1]) : 3, d = eye ? Math.hypot(x - eye[0], z - eye[2]) : 50;
    const rx = r * focal() / p[2], ry = rx * Math.max(RING_FLAT, Math.min(1, h / Math.hypot(h, d)));
    if (!(rx > 1.2)) return false;
    e.setAttribute('cx', p[0].toFixed(1)); e.setAttribute('cy', p[1].toFixed(1)); e.setAttribute('rx', rx.toFixed(1)); e.setAttribute('ry', ry.toFixed(1));
    return true;
  }
  // the HUD's boxes cut out of the marks' mask, read twice a second while a mark shows (a few rects; the HUD moves only on a resize)
  const HUD_BOXES = '#lk-tplay .tp-keys:not([hidden]) .kl, #lk-tplay .tp-sonar, #lk-tplay .tp-dial, #lk-tplay .tp-skills .tp-slot, #lk-tplay .tp-skills .nm, .lk-view, .lk-hint .row.in';
  function cutHud() {
    if (clock - world.cutT < 0.5 && world.cutT >= 0) return;
    world.cutT = clock;
    let h = '';
    for (const e of doc.querySelectorAll(HUD_BOXES)) { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) h += `<rect x="${(r.left - 4).toFixed(0)}" y="${(r.top - 4).toFixed(0)}" width="${(r.width + 8).toFixed(0)}" height="${(r.height + 8).toFixed(0)}" rx="6" fill="#000"/>`; }
    if (world.cut.innerHTML !== h) world.cut.innerHTML = h;
    world.el.dataset.cuts = String(world.cut.childElementCount);
  }
  function paintWorld(list) {
    if (!world || !project) return;
    if (ping || lureFx || surgeFx?.slapAt != null) cutHud(); else world.cutT = -1;
    let i = 0;
    if (ping) for (const b of list) {
      if (i >= SONAR.max) break;
      if (!marks.has(b.id)) continue;
      const r = markRing(b.L), on = ringAt(world.mk[i], b.x, b.z, r);
      let tail = false;
      if (on && ping.tail) {   // rank 3+: a short tail along its heading, from the ring's edge
        const fx = Math.sin(b.heading ?? 0), fz = -Math.cos(b.heading ?? 0), a = project(b.x + fx * r, 0, b.z + fz * r, pA), c = a && project(b.x + fx * r * (1 + SONAR.tailK), 0, b.z + fz * r * (1 + SONAR.tailK), pB);
        if (a && c && a[2] > 0.5 && c[2] > 0.5) { const t = world.tl[i]; t.setAttribute('x1', a[0].toFixed(1)); t.setAttribute('y1', a[1].toFixed(1)); t.setAttribute('x2', c[0].toFixed(1)); t.setAttribute('y2', c[1].toFixed(1)); tail = true; }
      }
      vis(i, world.mk[i], on); vis(SONAR.max + i, world.tl[i], tail);
      if (on) i++;
    }
    for (let j = i; j < SONAR.max; j++) { vis(j, world.mk[j], false); vis(SONAR.max + j, world.tl[j], false); }
    world.el.dataset.marks = String(i);
    // the lure's ring: out to LURE.ringM over ringGrowS, fading by ringS
    const L = lureFx, u = L ? clock - L.t0 : 0, on = !!L && circleAt(world.lr, L.x, L.z, LURE.ringM * Math.min(1, 0.15 + 0.85 * u / LURE.ringGrowS));
    if (on) world.lr.setAttribute('stroke-opacity', Math.max(0, Math.min(1, (LURE.ringS - u) / (LURE.ringS - LURE.ringGrowS))).toFixed(2));
    vis(SONAR.max * 2, world.lr, on);
    // the Tail Surge's wave: out from her middle to the ring radius over SURGE.waveS, fading over SURGE.fadeS
    const F = surgeFx, v = F?.slapAt != null ? clock - F.slapAt : -1, son = v >= 0 && circleAt(world.sr, F.x, F.z, F.row.ringM * Math.min(1, Math.max(0.08, v / SURGE.waveS)), 120, 6);
    if (son) world.sr.setAttribute('stroke-opacity', Math.max(0, Math.min(1, 1 - (v - SURGE.waveS) / SURGE.fadeS)).toFixed(2));
    vis(SONAR.max * 2 + 1, world.sr, son);
    world.el.dataset.surge = son ? String(Math.round(F.row.ringM * Math.min(1, v / SURGE.waveS))) : '';
  }
  function paint(tg, list = [], dt = 0) {
    if (!el) return;
    const st = C.state;
    //: the sonar (her heading up, the corners' boat at full ink, the locked one ringed amber, a tick on those that have
    // seen her), the DASH slot's ring, the legend's levels; the dash's line once ever, after a boat sits in her corners out of reach for 2 s
    placeHud();
    const th = self.threat(), n0 = nose();
    hudStates.dash = C.skills.state('dash');
    if (R) { hudStates.lure = R.state('lure'); hudStates.sonar = R.state('sonar'); hudStates.surge = R.state('surge'); hudStates.breach = R.state('breach'); }
    // the ping's rim (10 Hz: the dial's own rate): a tick at each marked boat's bearing
    if (ping && n0 && (rimT < 0 || clock - rimT >= 0.1)) { rimT = clock; rimMarks(n0, list, (id) => marks.has(id), rimOut); pingArg.rangeM = ping.rangeM; }
    hud?.paint({ t: clock, states: hudStates, her: n0, boats: list, targetId: tg?.id ?? null, lockId: lastLock?.id ?? null, seen: (b, d) => !!th && b.kind !== 'kayak' && d <= th.seeM, hidden: st.hidden, ping: ping ? pingArg : null });
    paintWorld(list);
    outT = tg && !tg.locked ? outT + dt : 0;
    if (outT > PLAYER.dashLineS && holdTip <= 0) tip('tip.tessie.dash', touch() ? PLAY_LINES.dashTouch : PLAY_LINES.dash);
    // the dial (HIDDEN deeper than 8 m: the boats cannot see her; owner, 2026-11-20: "hide herself"): her nose's depth on the 0–20 m arc, her word, the speed chevrons (the breath ring went with the stamina run); a ▲ or ▼ while she climbs or
    // sinks faster than 0.2 m/s (the player sees a look is steering her)
    const k = Math.min(1, st.nose / PLAYER.dialM);
    const ar = q('.ar'); if (ar) ar.textContent = st.climb < -PLAYER.arrowV ? '▲' : st.climb > PLAYER.arrowV ? '▼' : '';
    q('.tp-up')?.toggleAttribute('data-dim', st.nose < 1.0);
    q('.tp-dn')?.toggleAttribute('data-dim', st.lim <= 0 || st.nose >= st.lim - 0.3);
    q('.fl').setAttribute('d', arc(0, Math.max(0.004, k)));
    q('.w').textContent = st.hidden ? 'HIDDEN' : st.word; q('.m').textContent = `${st.nose.toFixed(st.nose < 10 ? 1 : 0)} m`;
    // the speed chevrons in the dial's foot: one lit swimming, two past 6.5 m/s (under the water), three past 15 m/s, amber on the dash
    const ch = q('.chev'); if (ch) { ch.toggleAttribute('data-dash', !!st.dash); ch.querySelectorAll('path').forEach((p, i) => p.toggleAttribute('data-on', st.speed > PLAYER.chevV[i])); }
    q('.tp-lunge')?.toggleAttribute('data-rest', st.rest > 0 || !!st.lunge || (!!st.bite && st.phase !== 'recover'));
    // the outline aid: while the water hides her (a dive), a faint cream line of her own body, 25 % (no other mark)
    const gh = q('.tp-ghost');
    if (project && st.nose > 2.5 && !(underOn && (lastUnder?.medium === 'water' || lastUnder?.crossing))) {   // phase 2a: gone while the eye is under (she is in plain view)
      const sp = sim.state.spine, N = sp.length / 8; let d = '', wsum = 0, nw = 0;
      for (let i = 0; i < N; i += 3) { const p = project(sp[i * 8], sp[i * 8 + 1], sp[i * 8 + 2]); if (!p) continue; d += `${d ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`; if (i > 6 && i < N - 12) { wsum += 1.4 * focal() / p[2]; nw++; } }
      gh.toggleAttribute('hidden', !d); if (d) { const w = Math.max(4, Math.min(60, wsum / Math.max(1, nw))), o = gh.querySelector('.o'), i = gh.querySelector('.i'); o.setAttribute('d', d); i.setAttribute('d', d); o.setAttribute('stroke-width', w.toFixed(1)); i.setAttribute('stroke-width', Math.max(1, w - 3).toFixed(1)); }   // her outline only: a 1.5 px cream edge
    } else gh.toggleAttribute('hidden', true);
    // the corners: four quiet cream corners round the boat ahead, amber inside the lunge's reach, its distance
    const aim = q('.tp-aim');
    lastAim = tg ? { id: tg.id, d: +tg.d.toFixed(1), reach: !!tg.locked, locked: !!tg.locked } : null;
    if (!tg || !project) { aim.hidden = true; return; }
    const p = project(tg.x, underOn && lastUnder?.medium === 'water' ? -0.5 : 1.4, tg.z);   // phase 2a: under the water the corners sit on her hull's underbody
    if (!p || !(p[2] > 0)) { aim.hidden = true; return; }
    // the lock: the corners turn amber and close in once (1.15 → 1.0 over 0.25 s)
    const close = tg.locked ? 1 + 0.15 * (1 - Math.min(1, Math.max(0, (clock - lockAt) / 0.25))) : 1;
    const size = Math.max(44, Math.min(280, 11 * focal() / p[2])) * close;
    aim.hidden = false; aim.toggleAttribute('data-reach', !!tg.locked);
    aim.style.left = `${(p[0] - size / 2).toFixed(1)}px`; aim.style.top = `${(p[1] - size * 0.55).toFixed(1)}px`; aim.style.width = `${size.toFixed(0)}px`; aim.style.height = `${(size * 0.8).toFixed(0)}px`;
    aim.querySelector('b').textContent = `${Math.round(tg.d)} m`;
  }
  return self;
}
