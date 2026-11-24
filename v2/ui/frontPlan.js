// The front door's decisions (pure: no DOM, no storage of its own; v2/tests/front-door.test.mjs drives each). v2 opens as v1
// does: v1's loading screen (src/ui/loading.js; no reel), v1's home card and pages (src/ui/home.js, homePages.js), then Sail.
// No staged first minute (owner, 2026-11-13: "in v2 we do not need that"; v1 keeps src/ui/firstVisit.js and firstStage.js): a
// first visit gets the returning visit's door. No skill question either (owner, 2026-11-21: "remove the skill question"): a new
// player starts as DEFAULT_PROFILE and changes it in Setup › Aids › your sailing (seedProfile; home.js runs with welcome: false).
// What differs is said here:
//   frontGate({ flags, webdriver, resumeAt, now })  → bool: the home card waits for ENTER (v1's auto-install rule, as is)
//   BOOT_STAGES                                      v2's boot steps → v1's loading stages (the bar's marks, the captions)
//   pickStates(picks, have)                          the home card's mode picks: the ones v2 plays, and the rest marked soon
//   SOON                                             the word a mode v2 does not play yet carries ('s own "soon")
//   seedProfile(settings)                            a player never asked gets DEFAULT_PROFILE once (its bundle, welcomed set)
import { toFlags } from '../../src/sim/core/flags.js';
import { applyProfile } from '../../src/ui/profile.js';
import { playedIds } from '../engine/modes.js';

// the modes v2 plays today (Sail; Cruise since BACKLOG-v2 #11: v2/cruise; Regatta since #12: v2/regatta; School waits for its v2 port)
export const V2_MODES = playedIds();   // the mode table's rows (engine/modes.js): Sail, Cruise, Regatta since BACKLOG-v2 #12
//), and the card's other not-yet choices say
// "soon" (the lake and boat pages' "Soon" tiles, the language row's "中文 (soon)",'s "Regatta soon"): so a mode v2
// does not play stays in its cell, disabled, with a quiet "soon" under its name. School has no pick in v1 either: hidden.
export const SOON = 'soon';
export const pickStates = (picks, have = playedIds()) => picks.map(({ id, label }) => ({ id, label, ready: have.includes(id) }));

// v1's auto-install gate (src/ui/loading.js, its last block): the card waits for ENTER unless ?gate=0, an automated browser
// (unless ?gate=1), a GPU-recovery reload within the last minute, or ?menu=0 (no shell, so no card)
export const RESUME_KEY = 'lakeshore.resume.v1';
export function frontGate({ flags = '', webdriver = false, resumeAt = NaN, now = 0 } = {}) {
  const f = toFlags(flags);
  const resume = Number.isFinite(resumeAt) && now - resumeAt < 60e3;
  const gate = !resume && (f.gate === '1' || (f.gate !== '0' && !webdriver));
  return gate && !!f.menu;
}

// v2's boot, step by step, as v1's loading stages (src/ui/loading.js STAGES: the bar's marks, the caption, the status line).
// v2's order differs from v1's (the pipelines all build at once while the terrain's first grids stream): the device, the
// terrain's first stage, the pipelines (the water's FFT among them), the sky's bake, the boat; ready() at the first frame.
export const BOOT_STAGES = Object.freeze([
  ['device', 'gpu'],          // the WebGPU device is up
  ['terrain', 'terrain'],     // the terrain's first grids are asked for
  ['pipelines', 'water'],     // every pipeline built (the FFT water's compute among them)
  ['sky', 'sky'],             // the sky's LUTs baked (a phone's film starts here: attractReel.js)
  ['boat', 'boat'],           // the boat's sim is made, the first frame next
]);
export const stageOf = (step) => BOOT_STAGES.find(([s]) => s === step)?.[1] ?? null;

// the profile a new player starts with (src/ui/profile.js): New to it, the old welcome's Esc default and the store's own default
// (settingsStore.js profile 'new'): the crew trims, the safety net is on, plain words beside the terms. Setup changes it.
export const DEFAULT_PROFILE = 'new';
// once per store: a player the welcome never asked (no `welcomed`) gets the default's bundle, so Setup's row is lit and nothing asks
export function seedProfile(settings) {
  if (!settings || settings.get('welcomed')) return null;
  return applyProfile(settings, DEFAULT_PROFILE);
}
