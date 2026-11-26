// The Logbook's Tessie page (the Tessie RPG, phase 1; behind ?tessierpg=1): her mark and "Level N · x / y XP · k points to spend" as
// the lead line, then two views in the logbook's own hand (src/ui/logbook.js, the corners' rows): the bounty, one row per boat type
// on the water today (wrecked or splashed, the first day, the records), and her five skills with four rank pips each. Phase 6: the
// bounty is grouped by set (Emerald Bay, South Lake: a view each, its types as rows, then the set's own row: "3 of 5 · +25 XP when
// every one is in", or once complete "Set complete · +25 XP" with its legend line). A press on a
// skill row that can take a point spends it there; a locked skill's row says its free tries left ("4 free tries left") (v2/sim/tessieBounty.js: an unlock costs a point, Lure → Sonar → Surge → Breach, rank 4
// the cap). The text is built here, pure (no DOM): the logbook draws it.
//   const src = tessiePage({ bounty: createTessieBounty({ storage }) });   createLogbook({ …, tessie: src })
import { TYPES, SETS, SKILL_ORDER, SKILL_NAMES, BOUNTY, legendOf, canSpend, trialsLeft, setProgress } from '../sim/tessieBounty.js';
import { tessieMarkSvg } from './tessieMark.js';
export { createTessieBounty } from '../sim/tessieBounty.js';   // m4.js makes the page's store from this chunk

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "Level 4 · 40 / 45 XP · 1 point to spend" (cumulative XP over the next level's start); at 20 her title
export function levelLine(s) {
  const l = legendOf(s);
  const xp = l.next == null ? `${s.xp} XP · the Lake’s legend` : `${s.xp} / ${l.next} XP`;
  return `Level ${l.level} · ${xp}${s.points > 0 ? ` · ${plural(s.points, 'point')} to spend` : ''}`;
}
// one bounty row's text: { t, g, got }
export function bountyRow(type, r) {
  const n = type.splash ? r.splashed + r.wrecked : r.wrecked;
  if (!n) return { id: type.id, t: `◇ ${type.name}`, g: 'not yet', got: false };
  const parts = [type.splash ? `${n} splashed` : `${n} wrecked`];
  if (r.deepestM) parts.push(`deepest from ${r.deepestM.toFixed(1)} m`);
  if (r.unseen) parts.push(`${r.unseen} unseen`);
  if (r.fastestS != null) parts.push(`fastest ${r.fastestS.toFixed(1)} s`);
  if (r.first) parts.push(`first ${r.first}`);
  return { id: type.id, t: `◆ ${type.name}`, g: parts.join(' · '), got: true };
}
const pips = (rank) => `<span class="pips" aria-label="rank ${rank} of ${BOUNTY.rankCap}">${Array.from({ length: BOUNTY.rankCap }, (_, i) => `<i class="pip${i < rank ? ' on' : ''}"></i>`).join('')}</span>`;
// a set's own row (phase 6): { id: 'set', t, g, got }
export function setRow(s, set) {
  const p = setProgress(s, set);
  if (p.done) return { id: 'set', t: `◆ Set complete · +${BOUNTY.set} XP`, g: set.legend, got: true };
  return { id: 'set', t: `◇ The set · ${p.got} of ${p.of}`, g: `+${BOUNTY.set} XP when every one is in`, got: false };
}
const typeOf = (id) => TYPES.find((t) => t.id === id);
// one skill row: { id, t, g, got, press }
export function skillRow(s, id) {
  const rank = s.ranks[id], why = canSpend(s, id), i = SKILL_ORDER.indexOf(id);
  let g;
  if (!why) g = rank ? `rank ${rank} · press to grow` : 'press to unlock';
  else if (why === 'max') g = 'rank 4 · full';
  else if (why === 'order') g = `locked · after ${SKILL_NAMES[SKILL_ORDER[i - 1]]}`;
  else g = rank ? `rank ${rank} of ${BOUNTY.rankCap}` : 'locked · a point unlocks it';
  const tries = rank ? 0 : trialsLeft(s, id);   // a locked skill's free uses left
  if (tries) g += ` · ${plural(tries, 'free try', 'free tries')} left`;
  return { id, t: `${SKILL_NAMES[id]}${pips(rank)}`, g, got: rank > 0, press: !why };
}
// the logbook's tessie source: views read the store afresh each time; press(id) spends a point
export function tessiePage({ bounty, name = 'Tessie', mark = tessieMarkSvg() } = {}) {
  const lead = (s) => `${mark}<span>${levelLine(s)}</span>`;
  return {
    name,
    views() {
      const s = bounty.state();
      return [
        ...SETS.map((set) => { const p = setProgress(s, set);
          return { id: set.id, label: `${set.name}<i>${p.done ? 'set complete' : `${p.got} of ${p.of}`}</i>`, lead: lead(s),
            rows: [...set.types.map((id) => bountyRow(typeOf(id), s.byType[id])), setRow(s, set)] }; }),
        { id: 'skills', label: `skills<i>${plural(s.points, 'point')} to spend</i>`, lead: lead(s), rows: SKILL_ORDER.map((id) => skillRow(s, id)) },
      ];
    },
    press(id) { return !!bounty.spend(id)?.ok; },
  };
}
