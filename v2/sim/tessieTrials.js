// Play as Tessie, a skill slot's own press and the free trials (the Tessie RPG, phase 2; behind ?tessierpg=1). Pure: no DOM, no clock.
// Every locked skill but the Dash has 5 free uses (v2/sim/tessieBounty.js trials), tried in any order; a trial acts as rank 1. A trial
// is spent only by a real use: the skill's behaviour says it ran (run(id, rank) → true). A skill with no behaviour yet answers false,
// so its press is a quiet no-op and spends nothing.
//   const r = useSkill({ bounty, id, run });   r → { used, trial, rank, left, line: { kind, text } | null, why }
//   run(id, rank): the skill's behaviour at that rank; true when it really did something (phases 3–5 register theirs in the player's
//   SKILL_RUN table, living/tessiePlayer.js)
// The skipper's line, once per skill (the lean skipper's TIP kinds, once ever): the first trial "Free try: 5 Sonars. Like it? Spend a
// point to keep it."; after the last "That was your last free Sonar."
import { BOUNTY, SKILL_NAMES, SKILL_PLURALS, TRIAL_SKILLS } from './tessieBounty.js';

export const TRIALS = Object.freeze({
  firstKind: (id) => `tip.tessie.try.${id}`, lastKind: (id) => `tip.tessie.tried.${id}`,
  first: (id) => `Free try: ${BOUNTY.trials} ${SKILL_PLURALS[id]}. Like it? Spend a point to keep it.`,
  last: (id) => `That was your last free ${SKILL_NAMES[id]}.`,
});
// the lean kinds of every trial line (leanSkipper.js LEAN_CLASS)
export const TRIAL_KINDS = Object.freeze(TRIAL_SKILLS.flatMap((id) => [TRIALS.firstKind(id), TRIALS.lastKind(id)]));

export function useSkill({ bounty, id, run = () => false } = {}) {
  const s = bounty?.state?.(); if (!s || !(id in s.ranks)) return { used: false, trial: false, why: 'unknown', line: null };
  const rank = s.ranks[id];
  if (rank > 0) return { used: !!run(id, rank), trial: false, rank, line: null };
  const left = s.trials?.[id] ?? 0;
  if (!(left > 0)) return { used: false, trial: false, rank: 0, left: 0, why: 'locked', line: null };
  if (!run(id, 1)) return { used: false, trial: true, rank: 1, left, why: 'no-behaviour', line: null };   // nothing happened: nothing spent
  const t = bounty.trial(id);
  const line = t.first ? { kind: TRIALS.firstKind(id), text: TRIALS.first(id) } : t.last ? { kind: TRIALS.lastKind(id), text: TRIALS.last(id) } : null;
  return { used: true, trial: true, rank: 1, left: t.left, line };
}
