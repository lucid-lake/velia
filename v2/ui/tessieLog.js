// The Logbook's Tessie page (the Tessie RPG, phase 1; behind ?tessierpg=1): her mark and "Level N · x / y XP · k points to spend" as
// the lead line, then two views in the logbook's own hand (src/ui/logbook.js, the corners' rows): the bounty, one row per boat type
// on the water today (wrecked or splashed, the first day, the records), and her five skills with four rank pips each. A press on a
// skill row that can take a point spends it there (v2/sim/tessieBounty.js: an unlock costs a point, Lure → Sonar → Surge → Breach, rank 4
// the cap). The text is built here, pure (no DOM): the logbook draws it.
//   const src = tessiePage({ bounty: createTessieBounty({ storage }) });   createLogbook({ …, tessie: src })
import { TYPES, SKILL_ORDER, SKILL_NAMES, BOUNTY, legendOf, canSpend } from '../sim/tessieBounty.js';
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
// one skill row: { id, t, g, got, press }
export function skillRow(s, id) {
  const rank = s.ranks[id], why = canSpend(s, id), i = SKILL_ORDER.indexOf(id);
  let g;
  if (!why) g = rank ? `rank ${rank} · press to grow` : 'press to unlock';
  else if (why === 'max') g = 'rank 4 · full';
  else if (why === 'order') g = `locked · after ${SKILL_NAMES[SKILL_ORDER[i - 1]]}`;
  else g = rank ? `rank ${rank} of ${BOUNTY.rankCap}` : 'locked · a point unlocks it';
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
        { id: 'bounty', label: `bounty<i>${plural(TYPES.filter((t) => t.live).reduce((n, t) => n + s.byType[t.id].wrecked + s.byType[t.id].splashed, 0), 'boat')}</i>`, lead: lead(s),
          rows: TYPES.filter((t) => t.live).map((t) => bountyRow(t, s.byType[t.id])) },
        { id: 'skills', label: `skills<i>${plural(s.points, 'point')} to spend</i>`, lead: lead(s), rows: SKILL_ORDER.map((id) => skillRow(s, id)) },
      ];
    },
    press(id) { return !!bounty.spend(id)?.ok; },
  };
}
