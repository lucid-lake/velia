// Play as Tessie, the bounty and her level (the Tessie RPG, phase 1; behind ?tessierpg=1). Pure: no DOM, no clock of its own (the
// caller passes the day as a string), no Math.random. One localStorage key per device, like every Velia save.
//   the bounty   how many of each boat type she has wrecked (a knockdown) or splashed (a kayak pair), the first day, and three
//                records: the deepest strike start (m under when it began), the unseen wrecks (struck from HIDDEN, deeper than 8 m),
//                the fastest (s from a Sonar ping or a Lure to the hit; the skills come later, so null until then)
//   the XP       per wreck by type (BOUNTY.xp), × 1.5 from HIDDEN, × 1.5 on a boat that had seen her, × 3 the first of a type; a set
//                (every type of a region) + 25 once
//   the level    1 to 20; level L → L + 1 needs 5L + 5 XP (level 2 at 10, level 5 at 70, level 10 at 270, level 20 at 1,045)
//   the points   one a level (19 in all); a point unlocks a skill (rank 0 → 1) or grows one by a rank, to rank 4; Dash's rank 1 is
//                free; a skill unlocks only after the one before it (Lure → Sonar → Surge → Breach). Points are derived (earned − spent)
//                on every read, so a point is never lost, whatever the save holds
//   the save     BOUNTY.key { _v: 1, xp, level, points, byType: { sail: { wrecked, splashed, first, deepestM, unseen, fastestS } … },
//                ranks: { dash: 1, lure: 0 … }, sets: [] }; the old knock total (BOUNTY.knocksKey) moves into sail.wrecked on the
//                first read (no XP: a count only)
//   const T = createTessieBounty({ storage });   every call reads the store afresh and writes it back (two holders never fight)
//   T.score({ kind, depthM, seen, hidden, skill, sinceS, splash }, { day }) → { xp, base, mult, first, set, levels, state } or null
//   T.spend(id) → { ok, why, state };  T.can(id) → null | why;  T.state() → the save with its derived level, points, toNext
//   T.legend() → { level, k (share inside this level, 0…1), xp, at, next }
export const BOUNTY = Object.freeze({
  key: 'lakeshore.tessie.bounty.v1', knocksKey: 'lakeshore.tessie.knocks.v1', v: 1,
  // XP per wreck by type (the bounty's kinds: sail the busy lake's sailboats, halcyon your boat, rival a Regatta boat, glass the glass
  // boat, kayak a pair splashed or tipped, paddle the paddle-wheeler, still a boat at anchor; South Lake's traffic: runabout a runabout
  // knocked down, jetski the jet ski's rider splashed: he ducks, never in the water)
  xp: Object.freeze({ kayak: 1, still: 2, sail: 3, halcyon: 4, rival: 5, glass: 6, paddle: 10, runabout: 3, jetski: 2 }),
  hidden: 1.5, seen: 1.5, first: 3, set: 25,
  hiddenM: 8,                  // m: deeper than this at the strike's start is HIDDEN (v2/sim/tessiePlay.js PLAY.hiddenM)
  maxLevel: 20, rankCap: 4,
});
// the types in the tab's order; live: a target on the water today (the rest wait for their boats: the Regatta's, the anchorages',
// the paddle-wheeler's route)
export const TYPES = Object.freeze([
  Object.freeze({ id: 'sail', name: 'Lake sailboats', live: true }),
  Object.freeze({ id: 'halcyon', name: 'Your Halcyon', live: true }),
  Object.freeze({ id: 'glass', name: 'The glass boat', live: true }),
  Object.freeze({ id: 'kayak', name: 'Kayak pairs', live: true, splash: true }),
  Object.freeze({ id: 'rival', name: 'Regatta rivals', live: false }),
  Object.freeze({ id: 'still', name: 'Boats at anchor', live: false }),
  Object.freeze({ id: 'paddle', name: 'The paddle-wheeler', live: false }),
  Object.freeze({ id: 'runabout', name: 'South Lake runabouts', live: true }),
  Object.freeze({ id: 'jetski', name: 'Jet skis', live: true, splash: true }),
]);
// a hit's kind (v2/sim/tessieHits.js) → its bounty type: each live type under its own name, but the runabouts are 'power' on the water
export const BOUNTY_KIND = Object.freeze({ ...Object.fromEntries(TYPES.filter((t) => t.live && t.id !== 'runabout').map((t) => [t.id, t.id])), power: 'runabout' });
export const SETS = Object.freeze([
  Object.freeze({ id: 'emerald', name: 'Emerald Bay', types: Object.freeze(['halcyon', 'sail', 'rival', 'glass', 'kayak']) }),
  Object.freeze({ id: 'south', name: 'South Lake', types: Object.freeze(['paddle', 'still', 'kayak', 'runabout', 'jetski']) }),
]);
// the five skills in their slots' order: the unlock order too
export const SKILL_ORDER = Object.freeze(['dash', 'lure', 'sonar', 'surge', 'breach']);
export const SKILL_NAMES = Object.freeze({ dash: 'Dash', lure: 'Lure', sonar: 'Sonar', surge: 'Tail Surge', breach: 'Breach' });

// XP to go from level L to L + 1, and the total XP at which level L starts
export const xpToNext = (L) => 5 * L + 5;
export const xpAt = (L) => { const n = Math.max(0, Math.min(BOUNTY.maxLevel, L | 0) - 1); return 5 * n * (n + 1) / 2 + 5 * n; };
export function levelOf(xp) {
  let L = 1;
  while (L < BOUNTY.maxLevel && xp >= xpAt(L + 1)) L++;
  return L;
}
const blankType = () => ({ wrecked: 0, splashed: 0, first: null, deepestM: null, unseen: 0, fastestS: null });
export function blankSave() {
  return { _v: BOUNTY.v, xp: 0, level: 1, points: 0, byType: Object.fromEntries(TYPES.map((t) => [t.id, blankType()])), ranks: Object.fromEntries(SKILL_ORDER.map((id) => [id, id === 'dash' ? 1 : 0])), sets: [] };
}
const nat = (v) => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);
const numOrNull = (v) => (v == null || !Number.isFinite(+v) ? null : +v);
// the ranks spent beyond Dash's free one
export const spent = (ranks) => SKILL_ORDER.reduce((s, id) => s + (ranks[id] ?? 0), 0) - 1;
// a save made whole: unknown fields dropped, numbers sane, ranks within 0…4 (Dash at least 1) and in the unlock order, the level and
// the points derived from the XP and the ranks (a point is never lost: points = the levels gained − the ranks bought)
export function normalise(raw) {
  const s = blankSave();
  if (!raw || typeof raw !== 'object') return s;
  s.xp = nat(raw.xp);
  for (const t of TYPES) {
    const r = raw.byType?.[t.id]; if (!r || typeof r !== 'object') continue;
    s.byType[t.id] = { wrecked: nat(r.wrecked), splashed: nat(r.splashed), first: typeof r.first === 'string' ? r.first : null, deepestM: numOrNull(r.deepestM), unseen: nat(r.unseen), fastestS: numOrNull(r.fastestS) };
  }
  let open = true;
  for (const id of SKILL_ORDER) {
    const v = Math.min(BOUNTY.rankCap, nat(raw.ranks?.[id]));
    s.ranks[id] = id === 'dash' ? Math.max(1, v) : open ? v : 0;   // a rank past a locked slot was never reachable: refunded
    if (s.ranks[id] === 0) open = false;
  }
  s.sets = Array.isArray(raw.sets) ? SETS.map((x) => x.id).filter((id) => raw.sets.includes(id)) : [];
  s.level = levelOf(s.xp);
  // more ranks than levels (a hand-edited save): the newest unlocks are refunded from the top, never the player's earned points
  while (spent(s.ranks) > s.level - 1) { const id = [...SKILL_ORDER].reverse().find((k) => s.ranks[k] > (k === 'dash' ? 1 : 0)); s.ranks[id]--; }
  s.points = s.level - 1 - spent(s.ranks);
  return s;
}
// the first read: the save, or a new one carrying the old knock total into sail.wrecked
export function migrate(rawBounty, rawKnocks) {
  if (rawBounty != null) { try { const j = typeof rawBounty === 'string' ? JSON.parse(rawBounty) : rawBounty; if (j && j._v === BOUNTY.v) return { save: normalise(j), migrated: false }; } catch { /* a corrupt save: start again (below) */ } }
  const s = blankSave();
  const n = nat(rawKnocks);
  if (n) s.byType.sail.wrecked = n;
  return { save: s, migrated: true };
}
// one wreck scored into a save (mutates and returns it): hit { kind, depthM, seen, hidden, skill, sinceS, splash }; day: 'YYYY-MM-DD'
export function scoreInto(s, hit, { day = null } = {}) {
  const kind = hit?.kind, base = BOUNTY.xp[kind], row = s.byType[kind];
  if (!base || !row) return null;
  const depthM = Number.isFinite(hit.depthM) ? Math.max(0, hit.depthM) : 0;
  const hidden = hit.hidden != null ? !!hit.hidden : depthM > BOUNTY.hiddenM;
  const first = row.wrecked + row.splashed === 0;
  const mult = (hidden ? BOUNTY.hidden : 1) * (hit.seen ? BOUNTY.seen : 1) * (first ? BOUNTY.first : 1);
  if (hit.splash) row.splashed++; else row.wrecked++;
  if (first) row.first = day;
  row.deepestM = Math.max(row.deepestM ?? 0, +depthM.toFixed(1));
  if (hidden) row.unseen++;
  if (Number.isFinite(hit.sinceS)) row.fastestS = row.fastestS == null ? +hit.sinceS.toFixed(1) : Math.min(row.fastestS, +hit.sinceS.toFixed(1));
  let xp = Math.round(base * mult), set = null;
  for (const S of SETS) {
    if (s.sets.includes(S.id) || !S.types.includes(kind)) continue;
    if (S.types.every((t) => s.byType[t].wrecked + s.byType[t].splashed > 0)) { s.sets.push(S.id); xp += BOUNTY.set; set = S.id; }
  }
  const was = levelOf(s.xp);
  s.xp += xp; s.level = levelOf(s.xp); s.points = s.level - 1 - spent(s.ranks);
  const levels = []; for (let L = was + 1; L <= s.level; L++) levels.push(L);
  return { xp, base, mult, first, hidden, set, levels };
}
// why a point cannot go to this skill now (null: it can)
export function canSpend(s, id) {
  const i = SKILL_ORDER.indexOf(id); if (i < 0) return 'unknown';
  if (s.ranks[id] >= BOUNTY.rankCap) return 'max';
  if (s.ranks[id] === 0 && i > 0 && s.ranks[SKILL_ORDER[i - 1]] === 0) return 'order';
  if (s.points <= 0) return 'points';
  return null;
}
export function spendInto(s, id) {
  const why = canSpend(s, id); if (why) return { ok: false, why };
  s.ranks[id]++; s.points = s.level - 1 - spent(s.ranks);
  return { ok: true, why: null, rank: s.ranks[id] };
}
// the level's share for the legend's fill: { level, k, xp, at (this level's start), next (the next level's start; null at 20) }
export function legendOf(s) {
  const L = levelOf(s.xp), at = xpAt(L), next = L < BOUNTY.maxLevel ? xpAt(L + 1) : null;
  return { level: L, xp: s.xp, at, next, k: next == null ? 1 : Math.min(1, Math.max(0, (s.xp - at) / (next - at))) };
}

export function createTessieBounty({ storage = null } = {}) {
  let mem = null, broken = false;   // no store, or one that throws (a private window): the page's life
  const get = (k) => { try { return storage?.getItem(k) ?? null; } catch { return null; } };
  const read = () => {
    if (!storage || broken) return mem ?? (mem = blankSave());
    const { save, migrated } = migrate(get(BOUNTY.key), get(BOUNTY.knocksKey));
    if (migrated) write(save);
    return save;
  };
  const write = (s) => { if (!storage || broken) { mem = s; return; } try { storage.setItem(BOUNTY.key, JSON.stringify(s)); } catch { broken = true; mem = s; } };
  return {
    state: () => read(),
    legend: () => legendOf(read()),
    score(hit, opts = {}) { const s = read(), r = scoreInto(s, hit, opts); if (!r) return null; write(s); return { ...r, state: s }; },
    can: (id) => canSpend(read(), id),
    spend(id) { const s = read(), r = spendInto(s, id); if (r.ok) write(s); return { ...r, state: s }; },
  };
}
