// The first-visit profile: "How do you sail?" sets a bundle of settings once, then the
// player may change any of them in Settings. Pure: no DOM, no storage of its own (the settings object holds it).
//   New       the crew trims the sails, the pilot and the shallow-water assist are on, plain words beside the terms
//   I sail    you trim (crew off), light assists, the sailor's terms
//   I race    Pro mode on (TRIM+), every assist off, the sailor's terms only
import { CURRENT_WATERS } from '../sim/waters/current.js';

export const PROFILES = ['new', 'sail', 'race'];
export const PROFILE_CHOICES = [
  { id: 'new', title: 'New to it', note: 'The crew handles the sails. You steer, and enjoy the water.' },
  { id: 'sail', title: 'I sail', note: 'Your hands on the sheets. A light safety net, the real terms.' },
  { id: 'race', title: 'I race', note: 'Pro mode, the full trim panel, no assists. Sailor’s words only.' },
];
export const PATCH = {
  new:  { crewTrim: true,  pilot: true,  shoalAssist: true,  autoReef: true,  hints: true, words: 'both',   proMode: false },
  sail: { crewTrim: false, pilot: true,  shoalAssist: true,  autoReef: true,  hints: true, words: 'sailor', proMode: false },
  race: { crewTrim: false, pilot: false, shoalAssist: false, autoReef: false, hints: true, words: 'sailor', proMode: true },
};
// the settings that are first-visit flags: "show the welcome again" clears them
export const FLAGS = { welcomed: false, introShown: false, goalDone: false, proOffered: false, cruiseOffered: false };

// Apply a profile to a settings object (createSettings): the bundle, the profile itself, the welcome done.
export function applyProfile(settings, id) {
  const p = PATCH[id] ? id : 'new';
  for (const [k, v] of Object.entries(PATCH[p])) settings.set(k, v);
  for (const k of ['introShown', 'goalDone', 'proOffered', 'cruiseOffered']) settings.set(k, false);
  settings.set('profile', p);
  settings.set('welcomed', true);
  return p;
}
// "show the welcome again": the next home card asks again
export function resetWelcome(settings) { for (const [k, v] of Object.entries(FLAGS)) settings.set(k, v); }

// Does the first-visit flow apply? Only after the welcome was answered, never on a returning visitor's reset flags.
export const isNew = (settings) => !!settings.get('welcomed') && settings.get('profile') === 'new';

// The step-2 choice for the New profile: Cruise (sit back) or Sail (take the helm). I sail / I race go to Sail. An explicit
// ?mode= in the URL is kept (the player already chose).
export function planFor(profile, step2, urlMode = null) {
  if (urlMode) return urlMode;
  if (profile === 'new' && step2 === 'cruise') return 'cruise';
  return 'sail';
}
// Which welcome step follows step 1 for this profile
export const needsStep2 = (profile, urlMode = null) => profile === 'new' && !urlMode;

// The in-Sail lines, once each (settings.introShown), by profile. R.'s words, short.
export const LINES = {
  new: 'Drag the wheel to steer — the crew handles the sails.',
  sail: 'Scroll or drag the winches to trim.',
  race: 'The Regatta is on the home card — try it on Hard.',
};
// the first sail's goal and the arrival line: the lake's own (its profile: chart.destination.name, goal.text, goal.arrival)
export const GOAL = { name: CURRENT_WATERS.chart.destination.name, text: CURRENT_WATERS.goal.text };
export const ARRIVAL = CURRENT_WATERS.goal.arrival;
export const NEXT = { trim: 'Try trimming the sails yourself — scroll on a winch', race: 'Try a race in Regatta' };
// the same lines on v2's phone flat controls (v2/ui/flat.js: no wheel, no winches; html.lk-flat)
export const FLAT_LINES = { new: 'Drag the steer ring to steer — the crew handles the sails.', sail: 'Drag the sheet ring to trim.', race: LINES.race };
export const FLAT_NEXT = { trim: 'Try trimming the sails yourself — drag the sheet ring', race: NEXT.race };
const flatOn = () => !!globalThis.document?.documentElement?.classList?.contains('lk-flat');
export const introLine = (profile) => (flatOn() ? FLAT_LINES : LINES)[profile] ?? (flatOn() ? FLAT_LINES : LINES).new;
export const PRO_OFFER = 'Sailing like a pro — switch to Pro mode?';
export const CRUISE_OFFER = 'Take the helm';
export const CRUISE_OFFER_S = 60;

// After the goal: the next suggestion. A player whose crew already left the sheets gets the race.
export const nextSuggestion = (settings) => { const N = flatOn() ? FLAT_NEXT : NEXT; return settings.get('crewTrim') ? N.trim : N.race; };

// Bearing of a goal off the boat's bow, in degrees (+ right), and the distance (m). Heading is clockwise from north,
// the world is x east, z south (src/terrain.js).
export function goalBearing(boat, goal) {
  const dx = goal.x - boat.x, dz = goal.z - boat.z;
  const abs = Math.atan2(dx, -dz);
  let rel = (abs - boat.heading) * 180 / Math.PI;
  rel = ((rel + 540) % 360) - 180;
  return { relDeg: rel, dist: Math.hypot(dx, dz) };
}
export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
