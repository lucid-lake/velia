// The key legend (owner, 2026-11-07): on a desktop, in Sail, while the 3D cockpit is up, the sailor's few useful keys stand on the
// right edge in cream, like a watermark: a thin outlined cap and a short word, no panel. Each line dims after LEARN_AT uses
// and the whole legend fades out once every shown line is learned; "?" brings it back at full for RECALL_S s. Settings > Screen > key hints
// turns it off. Opacity only, 400 ms (section 6.8). The keys are the real map (src/sail/keys.js; the Keys sheet, keysContent.js).
// In Pro (owner, 2026-11-07) the pro trim keys join: traveller, twist, backstay and the jib lead, as keys.js binds them per mode.
// The legend shows what a sailor cannot guess or will not remember, when it is needed (owner ruling, 2026-11-07): always W S sheets,
// R F jib, Space tack, C view; Esc and A D are guessed and gone. Moments bring K reef (wind builds), G wing on wing (running),
// J anchor and I engine (near shore or in the harbour) and B binoculars (a landmark ahead), each with hysteresis and a 10 s minimum.
//
//   visible(facts)                    // pure: should the legend be on screen now
//   linesFor(keys)                    // pure: the always lines (plus Pro's trims) for a key mode of src/sail/keys.js MODES ('basic' | 'raw' | 'pro-basic' | 'pro-raw')
//   legendLines(facts, was)           // pure: { keys, windKn, reefed, twaDeg, shoreM, depthM, harbour, landmarkInView } -> the lines to show
//   momentFlags(facts, was)           // pure: which moments are on, with hysteresis from the moments on a moment ago
//   stepMoments(state, facts, now)    // pure: the moments with hysteresis and the minimum on-time
//   landmarkSignal(boat, places, was, los)   // pure: is a named landmark ahead at a useful distance
//   legendLevels(counts, recalling, keys, lines)   // pure: { show, lines: [{ id, level: 'full' | 'learned' }] }
//   countUse(counts, code, shift, keys)     // pure: the counts after one key press
//   createKeyLegend({ services, settings, getMode, doc, storage })   // shell.js; .update() each frame, .dispose()
import { profileFor } from '../core/profile.js';
import { ensureTokens } from './tokens.js';
import { ensureEdgeStyle, EDGE } from './edgeStyle.js';
import { FLAGS } from '../sim/core/flags.js';
import { placesFrom, terrainLos } from '../sail/discoveries.js';

export const LEARN_AT = 3;        // uses of an action before its line dims
export const RECALL_S = 8;        // "?" shows the legend at full this long
export const FADE_MS = EDGE.fadeMs;   // 400 ms, the edge pair's one fade
export const MIN_WIDTH = 1100;    // a desktop window; narrower: no legend
export const OPACITY = { full: 0.6, learned: 0.15, idle: 0.35 };   // full: .6 since 2026-11-12 (owner: the edge pair's labels at 60 %; was .45)
export const STORE_KEY = 'lakeshore.keylegend.v1';
const KN = 0.514444;              // m/s per knot

// The always lines (a sailor cannot guess them). W S is "sails in, out" as the Keys sheet says (keysContent.js) while the crew
// trims; with ?autotrim=0 it is the main sheet alone and R F the jib sheet.
const MAIN = { id: 'main', caps: ['W', 'S'], word: 'sails in, out' }, MAIN_RAW = { id: 'main', caps: ['W', 'S'], word: 'main sheet' };
const JIB = { id: 'jib', caps: ['R', 'F'], word: 'jib sheet' }, TACK = { id: 'tack', caps: ['Space'], word: 'tack' }, VIEW = { id: 'view', caps: ['C'], word: 'view' };
export const LINES = [MAIN, JIB, TACK, VIEW];
// Pro's trim lines (src/sail/keys.js PRO rows); ⇧ is Shift
const L = { traveller: { id: 'traveller', caps: ['Q', 'E'], word: 'traveller' }, twist: { id: 'twist', caps: ['Z', 'X'], word: 'twist' },
  backstay: { id: 'backstay', caps: ['⇧', 'Z', 'X'], word: 'backstay' }, lead: { id: 'lead', caps: ['R', 'F'], word: 'jib lead' },
  leadShift: { id: 'lead', caps: ['⇧', 'R', 'F'], word: 'jib lead' } };
// The moments' lines (keys.js words: reef, wing on wing, the anchor, the engine, the binoculars)
const C = { reef: { id: 'reef', caps: ['K'], word: 'reef', ctx: true }, shake: { id: 'shake', caps: ['K'], word: 'shake out', ctx: true },
  wing: { id: 'wing', caps: ['G'], word: 'wing on wing', ctx: true }, anchor: { id: 'anchor', caps: ['J'], word: 'anchor', ctx: true },
  engine: { id: 'engine', caps: ['I'], word: 'engine', ctx: true }, bino: { id: 'bino', caps: ['B'], word: 'binoculars', ctx: true } };
const MODE_LINES = {
  basic: [MAIN, JIB, TACK, VIEW], raw: [MAIN_RAW, JIB, TACK, VIEW],
  'pro-basic': [MAIN, L.lead, TACK, VIEW, L.traveller, L.twist, L.backstay],                 // R/F move the lead; the crew has the jib sheet
  'pro-raw': [MAIN_RAW, JIB, TACK, VIEW, L.leadShift, L.traveller, L.twist, L.backstay],     // R/F stay the jib sheet; the lead on Shift
  'pro-sheet': [MAIN, JIB, TACK, VIEW, L.traveller, L.twist, L.backstay],                    // v2's Pro: R/F the jib sheet, the lead on the PRO panel only
};
export const linesFor = (keys = 'basic') => MODE_LINES[keys] ?? LINES;
export const CONTEXT_LINES = Object.values(C);
export const ALL_LINES = [...new Map([...Object.values(MODE_LINES).flat(), ...CONTEXT_LINES].map((l) => [`${l.id}|${l.caps.join('')}`, l])).values()];
// KeyboardEvent.code -> the line it teaches
export const LINE_OF = {
  KeyW: 'main', KeyS: 'main', ArrowUp: 'main', ArrowDown: 'main',
  KeyR: 'jib', KeyF: 'jib', Space: 'tack', KeyC: 'view',
  KeyK: 'reef', KeyG: 'wing', KeyJ: 'anchor', KeyI: 'engine', KeyB: 'bino',
};
const COUNT_OF = { shake: 'reef' };   // "shake out" is the same K the sailor learned for the reef

// ---- the moments (owner ruling 2026-11-07) ----
// Thresholds, each from the code it follows. Wind: the crew reefs on its own from the heel and a boat that starts in 20 kn starts
// reefed (src/boat.js reefTarget, halcyon.json reefStartKt [20, 26]); the legend asks from 17 kn, so the key is known before the
// crew needs it, and lets go below 14. Wing on wing: the boat's own auto rule engages past 160 deg off the true wind and releases
// under 150 deg (src/boat.js, auto wing-on-wing); the legend shows from 150 and lets go under 140. Shore: the anchor drops in
// 3 to 20 m of water (src/boat/tackle.js dropDepth); the legend shows within 150 m of the shore, in under 10 m of water or
// within 150 m of a mooring ball or a pier, and lets go past 220 m and over 14 m. Binoculars: a named landmark (waterfall,
// house, ruin) 400 to 3000 m away, within 30 deg of the bow, with clear sight over the terrain (discoveries.js SIGHT).
export const MOMENT = {
  reefOnKn: 17, reefOffKn: 14, shakeKn: 12, wingOnDeg: 150, wingOffDeg: 140,
  shoreOnM: 150, shoreOffM: 220, depthOnM: 10, depthOffM: 14, harbourM: 150,
  binoMinM: 400, binoMaxM: 3000, binoOffMinM: 300, binoOffMaxM: 3500, binoOnDeg: 30, binoOffDeg: 40,
  minOnS: 10, maxContext: 2,
};
// the moments on now (facts: windKn, reefed, twaDeg, shoreM, depthM, harbour, landmarkInView); was: the moments on a moment ago (hysteresis)
export function momentFlags(f, was = {}) {
  const M = MOMENT, kn = f.windKn ?? 0, twa = Math.abs(f.twaDeg ?? 0), reefed = !!f.reefed;
  const reef = !reefed && kn >= (was.reef ? M.reefOffKn : M.reefOnKn);
  const shake = reefed && kn < (was.shake ? M.reefOffKn : M.shakeKn);
  const wing = twa >= (was.wing ? M.wingOffDeg : M.wingOnDeg);
  const shoreM = f.shoreM ?? Infinity, depthM = f.depthM ?? Infinity, harbour = !!f.harbour;
  const shore = was.shore ? (shoreM <= M.shoreOffM || depthM <= M.depthOffM || harbour) : (shoreM < M.shoreOnM || depthM < M.depthOnM || harbour);
  return { reef, shake, wing, shore, bino: !!f.landmarkInView };
}
// one step: the flags with the minimum on-time. state: { on, since } (since: the time each moment came on)
export function stepMoments(state, f, now) {
  const raw = momentFlags(f, state?.on), on = {}, since = { ...(state?.since ?? {}) };
  for (const k of Object.keys(raw)) {
    const held = state?.on?.[k] && now - (since[k] ?? now) < MOMENT.minOnS;
    on[k] = raw[k] || !!held;
    if (on[k] && !state?.on?.[k]) since[k] = now;
    if (!on[k]) delete since[k];
  }
  return { on, since };
}
// the lines to show: the always lines, then the moments (at most MOMENT.maxContext, the order a sailor needs them), then Pro's trims
export function assembleLines(keys, on = {}) {
  const base = linesFor(keys), nPro = keys.startsWith('pro') ? (keys.endsWith('raw') ? 4 : 3) : 0, cut = base.length - nPro;
  const ctx = [on.reef && C.reef, on.shake && C.shake, on.shore && C.anchor, on.shore && C.engine, on.wing && C.wing, on.bino && C.bino]
    .filter(Boolean).slice(0, MOMENT.maxContext);
  return [...base.slice(0, cut), ...ctx, ...base.slice(cut)];
}
// v2's six (owner, 2026-11-17: "show only 6 rows like the left Pro status, the same height and width"): the in-the-moment keys, the
// same rows in the same order, whatever the wind. The lean set (owner 2026-11-20): W S, Space, C, then B (binoculars), I
// (engine) and J (anchor); in Pro R F, the jib's own sheet, takes B's place after W S (six rows still: the column it mirrors has six
// in Pro; B works all the same, it is on the Keys page). K (reef) and G (wing) have no key on v2. Pro's other trims stay on the Keys
// page. Same 36 px row and 12 px gap as the nav column.
export const SIX_IDS = ['main', 'tack', 'view', 'bino', 'engine', 'anchor'];
// One short label a row, the column's own small-caps style (the H list and the Keys page keep the full words); the caps stand at the row's
// outer end where the column's number stands.
const SIX_WORD = { main: 'sails', jib: 'jib', tack: 'tack', view: 'view', bino: 'binoculars', engine: 'engine', anchor: 'anchor' };
export function sixLines(keys = 'basic', on = {}) {
  const raw = keys.endsWith('raw') && !keys.startsWith('pro-sheet'), pro = keys.startsWith('pro');
  return (pro ? [raw ? MAIN_RAW : MAIN, JIB, TACK, VIEW, C.engine, C.anchor] : [raw ? MAIN_RAW : MAIN, TACK, VIEW, C.bino, C.engine, C.anchor]).map((l) => ({ ...l, word: SIX_WORD[l.id] }));
}
// the six's levels: an always row is full (dimmed once learned); B, I and J are full while their moment is on (a landmark ahead, the
// shore near) and not yet learned, else idle (35 %)
export function sixLevels(counts, recalling = false, on = {}, lines = sixLines()) {
  const out = lines.map(({ id }) => {
    const moment = id === 'bino' ? on.bino : id === 'anchor' || id === 'engine' ? on.shore : true;
    return { id, level: recalling ? 'full' : learned(counts, id) ? 'learned' : moment ? 'full' : 'idle' };   // idle: a moment row waiting (35 %), readable but quiet
  });
  return { show: recalling || out.some((l) => l.level === 'full'), lines: out };
}
export const legendLines = (f = {}, was = {}) => assembleLines(f.keys ?? 'basic', momentFlags(f, was));

// The bino signal: a named landmark ahead. boat: { x, z, heading }; places: { id: { x, z, y } } (discoveries.js placesFrom);
// was: the signal a moment ago; los(eye, place): clear sight.
export function landmarkSignal(boat, places, was = false, los = () => true) {
  const M = MOMENT, fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
  for (const id of ['waterfall', 'house', 'ruin']) {
    const p = places?.[id]; if (!p) continue;
    const dx = p.x - boat.x, dz = p.z - boat.z, d = Math.hypot(dx, dz);
    if (d < (was ? M.binoOffMinM : M.binoMinM) || d > (was ? M.binoOffMaxM : M.binoMaxM)) continue;
    const off = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) * 180 / Math.PI;
    if (off > (was ? M.binoOffDeg : M.binoOnDeg)) continue;
    if (los({ x: boat.x, y: 3, z: boat.z }, p)) return true;
  }
  return false;
}
// the distance to the shore (m): the nearest land on rings round the boat; Infinity when none within the last ring
export function shoreDistance(heightAt, x, z, rings = [40, 80, 120, 160, 220, 300], dirs = 16) {
  for (const r of rings) for (let i = 0; i < dirs; i++) { const a = (i / dirs) * 2 * Math.PI; if (heightAt(x + Math.sin(a) * r, z - Math.cos(a) * r) > 0) return r; }
  return Infinity;
}

// facts: { setting, flag ('0' | '1' | null), fine, width, mode, cockpit, helm, blocked, loading }
// The flag 1 stands in for the device facts (a test or a capture at any size); every other rule still holds.
export function visible(f) {
  if (f.flag === '0') return false;
  if (f.mode !== 'sail') return false;
  if (!f.cockpit || f.helm || f.blocked || f.loading) return false;
  if (f.flag === '1') return true;
  return !!f.setting && !!f.fine && (f.width ?? 0) >= MIN_WIDTH;
}

export const learned = (counts, id) => (counts?.[COUNT_OF[id] ?? id] ?? 0) >= LEARN_AT;
// lines: the legend's lines now (assembleLines). A learned moment line is hidden (its moment passes without it: the sailor knows
// the key); a learned always line stands dimmed. Recalling ("?") shows every current line at full.
export function legendLevels(counts, recalling = false, keys = 'basic', lines = linesFor(keys)) {
  const out = lines.filter((l) => recalling || !l.ctx || !learned(counts, l.id))
    .map(({ id }) => ({ id, level: !recalling && learned(counts, id) ? 'learned' : 'full' }));
  return { show: recalling || out.some((l) => l.level === 'full'), lines: out };
}
// the line a press teaches in a key mode (src/sail/keys.js): Q E traveller, Z X twist, Shift+Z X backstay; R F the sheet or the lead
export function lineOf(code, shift = false, keys = 'basic') {
  const pro = keys.startsWith('pro'), raw = keys.endsWith('raw');
  if (keys === 'pro-sheet' && (code === 'KeyR' || code === 'KeyF')) return shift ? null : 'jib';
  if (pro && (code === 'KeyQ' || code === 'KeyE')) return 'traveller';
  if (pro && (code === 'KeyZ' || code === 'KeyX')) return shift ? 'backstay' : 'twist';
  if (code === 'KeyR' || code === 'KeyF') return pro && shift === raw ? 'lead' : shift ? null : 'jib';
  return LINE_OF[code] ?? null;
}
export function countUse(counts, code, shift = false, keys = 'basic') {
  const id = lineOf(code, shift, keys);
  if (!id) return counts;
  return { ...counts, [id]: Math.min(99, (counts?.[id] ?? 0) + 1) };
}
const IDS = [...new Set(ALL_LINES.map((l) => COUNT_OF[l.id] ?? l.id))];
const zero = () => Object.fromEntries(IDS.map((id) => [id, 0]));
export const loadCounts = (storage) => {
  try {
    const o = JSON.parse(storage?.getItem(STORE_KEY) ?? '{}') ?? {};
    return Object.fromEntries(IDS.map((id) => [id, Number.isFinite(o[id]) ? Math.max(0, Math.min(99, o[id] | 0)) : 0]));
  } catch { return zero(); }
};

// the one key cap (the UI audit, 2026-11-21: v2's other caps, Tessie's legend, use this rule, not their own)
export const CAP_RULE = 'display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:1.9em;height:1.9em;padding:0 .45em;border:var(--lk-line) solid currentColor;border-radius:var(--lk-radius)';
// a cap's face (v2's six rows: Space reads SPC)
export const capFace = (k, six = true) => (six && k === 'Space' ? 'SPC' : k);
// the block itself (anchor, foot, type, shadow, the 400 ms fade) is the edge pair's shared style (edgeStyle.js); here only the
// legend's own: the .5 em row gap (a 1.9 em cap + .5 em = the 36 px edge row), the lines, the caps and their levels
const CSS = `
.lk-keys{row-gap:.5em}
.lk-keys .kl{display:grid;grid-column:1 / -1;grid-template-columns:subgrid;align-items:center;justify-items:start;opacity:${OPACITY.full};transition:opacity ${FADE_MS}ms var(--lk-ease)}
.lk-keys .kl.learned{opacity:${OPACITY.learned}}
.lk-keys .kl.off{display:none}
.lk-keys .kl.fade{opacity:0}   /* a line eases in and out; it leaves the layout only once faded */
.lk-keys.six{row-gap:0}
.lk-keys.six .kl{height:var(--lk-edge-row)}
.lk-keys.six .kl.gap{margin-top:12px}   /* the nav column's gap between its groups */
/* the column's format, mirrored: label (the column's own style) on the left, the caps its value on the outer right, small and tight */
.lk-keys.six{column-gap:.4em}
.lk-keys.six .kl{grid-template-columns:subgrid;justify-items:start}
.lk-keys.six .kl .w{grid-column:1;grid-row:1}
.lk-keys.six .kl .caps{grid-column:2;grid-row:1;justify-self:end;gap:.2em}
.lk-keys.six .cap,.lk-keys.six .cap.wide{min-width:1.5em;padding:0 .3em}
.lk-keys .kl.idle{opacity:${OPACITY.idle}}
.lk-keys .caps{display:inline-flex;gap:.35em}   /* the block keeps the right margin; inside it two columns, both left-aligned (owner, 2026-11-07: align left, each line the same length) */
.lk-keys .cap{${CAP_RULE};font-size:15px}
.lk-keys .sep{align-self:center;padding:0 .1em}   /* "1 / ⇧": two keys for one thing (v2's Tessie legend) */
.lk-keys .cap.wide{padding:0 .6em}
@media (prefers-reduced-motion:reduce){.lk-keys,.lk-keys .kl{transition:none}}`;

// the legend's whole look (tokens, the edge pair, the legend's own CSS), for another block built as a legend (v2's Tessie legend)
export function ensureLegendStyle(doc = globalThis.document) {
  ensureTokens(); ensureEdgeStyle(doc);   // the tokens on the page document (as before)
  if (doc?.head && !doc.getElementById('lk-keys-css')) { const st = doc.createElement('style'); st.id = 'lk-keys-css'; st.textContent = CSS; doc.head.appendChild(st); }
}
// words: a page's own word for a line by id (v2: Space is the assist key, { tack: … }); absent, the lines' own
// six: v2's fixed six rows (sixLines), the nav column's 36 px rows, 12 px gap and foot
export function createKeyLegend({ services, settings, getMode, doc = globalThis.document, storage, win = globalThis, words = null, six = false, always = false } = {}) {   // always (v2; owner, 2026-11-20): learned rows dim, the legend never hides itself; only Setup's key hints turn it off
  const wordOf = (l) => (six ? l.word : words?.[l.id] ?? l.word);
  const capText = (k) => capFace(k, six);
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  ensureLegendStyle(doc);
  const el = doc.createElement('div'); el.className = `lk-keys lk-edgepair right${six ? ' six' : ''}`; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ALL_LINES.map((l) => `<div class="kl off fade" data-id="${l.id}" data-caps="${l.caps.join('')}"><span class="caps">${l.caps.map((k) => `<span class="cap${k.length > 2 ? ' wide' : ''}">${capText(k)}</span>`).join('')}</span><span class="w">${wordOf(l)}</span></div>`).join('');
  doc.body.appendChild(el);
  const rows = [...el.querySelectorAll('.kl')];
  const keyMode = () => { const c = services.get('controls'); if (c?.pro && c?.proKeys) return c.proKeys; return `${c?.pro ? 'pro-' : ''}${c?.ctl?.autoTrim === false ? 'raw' : 'basic'}`; };   // proKeys: a page's own Pro key mode (v2: 'pro-sheet')
  let counts = loadCounts(storage), recallUntil = 0, last = '', moments = { on: {}, since: {} }, factsAt = -1e9, mf = {}, bino = false, places, los;
  const now = () => (win.performance?.now?.() ?? Date.now());
  const loadingUp = () => { const l = doc.getElementById('lk-load'); return !!l && l.isConnected && l.dataset.state !== 'gone' && !doc.documentElement.classList.contains('lk-nol'); };
  const menuOpen = () => !!services.get('menu')?.isOpen;
  // (a logbook find is the subtitle line at the top now, never a panel over the legend: nothing to step aside for)
  const blocked = () => menuOpen() || !!services.get('logbook')?.logbook?.isOpen || !!services.get('chart')?.chart?.toggle?.big || !!services.get('chart')?.chart?.toggle?.pinned
    || services.get('controls')?.hint?.current === 'keys' || (services.get('controls')?.tools?.bino?.k ?? 0) > 0.02;
  const facts = () => {
    const st = services.get('station'), calm = services.get('calm');
    return {
      setting: settings?.get?.('keyHints') !== false, flag: FLAGS.keylegend ?? null,
      fine: profileFor(win).input !== 'touch', width: win.innerWidth,   // keys or mixed (src/core/profile.js): an iPad with a keyboard and trackpad too
      mode: getMode(), cockpit: !!st?.cockpit && st.el?.isConnected !== false && !calm?.folded, helm: !!st?.helmView, blocked: blocked(), loading: loadingUp(),
    };
  };
  // the sailing facts for the moments, read from the live boat and the lake, 4 times a second
  const sailFacts = (t) => {
    const s = services.get('player')?.phys?.state, terrain = services.get('terrain');
    if (!s || !terrain?.heightAt) return null;
    if (places === undefined) { try { places = placesFrom({ terrain, shoreline: null, harbour: null }); los = terrainLos(terrain.heightAt); } catch { places = null; } }
    const tk = services.get('seamanship')?.tackle;
    const ball = tk?.nearestBall?.(s)?.d ?? 1e9, pier = tk?.state?.pierGap ?? 1e9;
    bino = places ? landmarkSignal(s, places, bino, los) : false;
    return { windKn: (s.trueWind?.speed ?? 0) / KN, reefed: (s.reef ?? 0) > 0, twaDeg: (s.trueWind?.angle ?? 0) * 180 / Math.PI,
      shoreM: shoreDistance(terrain.heightAt, s.x, s.z), depthM: -terrain.heightAt(s.x, s.z), harbour: Math.min(ball, pier) < MOMENT.harbourM, landmarkInView: bino };
  };
  const onKey = (e) => {
    if (e.key === '?' && !e.repeat && !six) { if (settings?.get?.('keyHints') !== false) recallUntil = now() + RECALL_S * 1000; return; }   // v2's six has no recall: the legend is always on
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !lineOf(e.code, e.shiftKey, keyMode())) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(doc.activeElement?.tagName ?? '')) return;
    if (getMode() !== 'sail' || loadingUp() || (menuOpen() && e.code !== 'Escape')) return;
    counts = countUse(counts, e.code, e.shiftKey, keyMode());
    try { storage?.setItem(STORE_KEY, JSON.stringify(counts)); } catch { /* memory only */ }
  };
  win.addEventListener('keydown', onKey, true);
  const api = { el, update, get counts() { return { ...counts }; }, recall: () => { recallUntil = now() + RECALL_S * 1000; },
    // a test or a capture may stand in for the live sailing facts (windKn, reefed, twaDeg, shoreM, depthM, harbour, landmarkInView); null clears
    override: null,
    // the host's own veto on top of the rules (v2's cockpit-up rule: v2/ui/cockpitUp.js through v2/ui/sail.js); v1 never sets it
    hidden: false,
    dispose() { win.removeEventListener('keydown', onKey, true); el.remove(); doc.getElementById('lk-keys-css')?.remove(); } };
  function update() {
    const keys = keyMode(), recalling = now() < recallUntil, vis = !api.hidden && visible(facts());
    if (vis) {
      const t = now() / 1000;
      if (api.override) { mf = api.override; factsAt = t; moments = stepMoments(moments, mf, t); }
      else if (t - factsAt >= 0.25) { factsAt = t; const f = sailFacts(t); if (f) { mf = f; moments = stepMoments(moments, f, t); } }
    } else { moments = { on: {}, since: {} }; bino = false; }
    const lines = six ? sixLines(keys, moments.on) : assembleLines(keys, moments.on), lv = six ? sixLevels(counts, recalling, moments.on, lines) : legendLevels(counts, recalling, keys, lines);
    const on = vis && (always || lv.show);
    const key = `${keys}|${on}|${lv.lines.map((l) => l.id + l.level[0]).join('')}|${six ? lines.map(wordOf).join() : ''}`;
    if (key === last) return;
    last = key;
    el.classList.toggle('on', on);
    const gapId = six ? lines.find((l) => l.ctx)?.id : null;   // v2's six: the column's gap before the first moment row
    const pos = new Map(lv.lines.map((l, i) => [l.id, i])), level = Object.fromEntries(lv.lines.map((l) => [l.id, l.level])), word = new Map(lines.map((l) => [`${l.id}|${l.caps.join('')}`, wordOf(l)]));
    const shown = new Set(lines.filter((l) => pos.has(l.id)).map((l) => `${l.id}|${l.caps.join('')}`));
    for (const r of rows) {
      const id = r.dataset.id, k = `${id}|${r.dataset.caps}`;
      r.classList.toggle('learned', level[id] === 'learned'); r.classList.toggle('idle', level[id] === 'idle'); r.classList.toggle('gap', six && id === gapId);
      if (shown.has(k)) {
        r.style.order = String(pos.get(id)); const w = r.querySelector('.w'); if (w.textContent !== word.get(k)) w.textContent = word.get(k);
        win.clearTimeout?.(r._t);
        if (r.classList.contains('off')) { r.classList.remove('off'); void r.offsetWidth; }
        r.classList.remove('fade');
      } else if (!r.classList.contains('fade')) {
        r.classList.add('fade'); r._t = win.setTimeout?.(() => r.classList.add('off'), FADE_MS);
      }
    }
  }
  return api;
}
