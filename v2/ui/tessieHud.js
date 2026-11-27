// Play as Tessie, her HUD as a family of instruments (owner, 2026-11-20: "keep the depth dial; a sonar dial for nearby
// boats; a skill dial for the dash as the first slot of a skills row; her keys on the right edge in Sail's legend style"). Cockpit
// instruments, calm: navy glass at 72 %, a cream 2 px bezel, cream ink, amber only while something is lit (the dash, the lock); no flash,
// no pulse, no sweep. The pure parts (the layout, the sonar's blips, the legend's levels, the ring) are exported for the tests; the DOM
// is built by mountHud into the play's own layer (#lk-tplay, living/tessiePlayer.js) and painted each frame.
//   DEPTH  (kept: living/tessiePlayer.js .tp-dial) bottom left; a tablet top left
//   SONAR  bottom right (a tablet top right): boats round her, her heading up, 160 m at the rim, faint rings at 50 and 100 m, the ±35°
//          lock cone a faint wedge; a sailboat a small hull triangle along its heading, the glass boat a rounded bar, a kayak a hollow dot,
//          your Halcyon an outlined triangle; the corners' boat at full ink (the others at 60 %), a boat that has seen her a tick at its
//          tail; HIDDEN under her mark deeper than 8 m (no boat can see her), SONAR otherwise. Updated at 10 Hz, at most 12 blips
//   SKILLS bottom centre: one slot per skill (v2/sim/tessieSkills.js SKILLS order), then quiet empty slots to four; the DASH slot's ring
//          full cream when ready, emptying in amber while it runs, refilling in dim cream as it cools, brightening once when ready again;
//          "Lv 1" at its lower right, "DASH ⇧" under it; a tablet taps it to dash
//   KEYS   the right edge above the sonar: Sail's key legend itself (the UI audit, owner 2026-11-21: src/ui/keyLegend.js's classes and CSS,
//          lk-keys lk-edgepair six: its ink 60 % / 15 % learned, the --lk-mx margin, the edge foot (raised clear of the sonar), its one cap,
//          SPC); each line dims after 3 uses and never hides; Setup › key hints off hides it, as Sail's; a desktop 1100 px wide or more only;
//          the Tessie RPG (rpg, ?tessierpg=1): a first line "Tessie · Lv N" with a 2 px cream fill under it, the share of XP toward the
//          next level (hud.level({ level, k }))
//   THE RPG, phase 2 (rpg): five slots (Dash, Lure, Sonar, Tail Surge, Breach: v2/sim/tessieBounty.js SKILL_ORDER), each with four 4 px
//          rank pips at its foot (filled cream 90 % to its rank, empty outlined 28 %) in place of the "Lv 1" tag; a locked skill keeps the
//          empty slot's look (its glyph at 25 %, no pips, its number key); the slots a point can go to carry a soft steady amber halo
//          (hud.halo(ids)); her legend gains a line per unlocked skill (hud.ranks(ranks, trials)). The free trials: a locked skill
//          with uses left shows its glyph at 60 % and the uses left in the pips' place (its legend line shows too); at 0 the locked look
//   THE RPG, phase 3 (rpg): a Sonar ping marks the boats within its range: while the marks last, a short cream tick on the SONAR
//          dial's rim at each marked boat's bearing and the dial's word reads the ping's range ("480 M"; HIDDEN still wins); a free trial's
//          slot shows its ring while the skill runs and cools (the trial count stays in the pips' place)
import { SLOT_COUNT, slotLabel } from '../sim/tessieSkills.js';
import { CAP_RULE, capFace, ensureLegendStyle } from '../../src/ui/keyLegend.js';
export { CAP_RULE };
export const HUD = Object.freeze({
  margin: 22, dial: 132, slot: 64, gap: 12, slots: 4, legendGap: 22,   // legendGap: the legend's foot this far over the sonar's top
  narrow: Object.freeze({ width: 1100, dial: 112, slot: 56 }),
  tablet: Object.freeze({ dial: 104, inset: 16, slot: 72, stickShare: 0.4, buttonsW: 236 }),   // the stick owns the left 40 %, the buttons (Bite and ▲ ▼) about 236 px on the right
  sonar: Object.freeze({ rangeM: 160, rings: Object.freeze([50, 100]), max: 12, hz: 10, coneDeg: 35 }),
  learnAt: 3,   // uses before a line dims (Sail's LEARN_AT); the ink is Sail's (keyLegend.js OPACITY)
  storeKey: 'lakeshore.tessie.keys.v1',
});
// her keys, in the legend's order (the owner's words): the dash line comes from the skills table
export const LEGEND = Object.freeze([
  Object.freeze({ id: 'swim', word: 'Swim', caps: Object.freeze(['W', 'A', 'S', 'D']), codes: Object.freeze(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) }),
  Object.freeze({ id: 'dash', word: 'Dash', caps: Object.freeze(['1', '⇧']), sep: '/', codes: Object.freeze(['Digit1', 'ShiftLeft', 'ShiftRight']) }),   // the slot's number, or Shift (owner, 2026-11-21; ⇧ as Sail's Pro rows)
  Object.freeze({ id: 'bite', word: 'Bite', caps: Object.freeze(['Space', 'click']), sep: '/', codes: Object.freeze(['Space']) }),   // or a left click on the water (living/tessiePlayer.js createClickBite)
  Object.freeze({ id: 'updown', word: 'Up / Down', caps: Object.freeze(['E', 'Q']), codes: Object.freeze(['KeyE', 'KeyQ']) }),
  Object.freeze({ id: 'view', word: 'View', caps: Object.freeze(['C']), codes: Object.freeze(['KeyC']) }),
  Object.freeze({ id: 'boat', word: 'Halcyon', caps: Object.freeze(['T']), codes: Object.freeze(['KeyT']) }),   // back to your boat: its name, as the top bar's switch
]);
// the RPG's skills after the dash, in their slots' order: one legend line each, shown once the skill is unlocked
export const RPG_SKILLS = Object.freeze([
  Object.freeze({ id: 'lure', name: 'Lure', short: 'LURE', word: 'Lure', caps: Object.freeze(['2']), codes: Object.freeze(['Digit2']), slot: 2 }),
  Object.freeze({ id: 'sonar', name: 'Sonar', short: 'SONAR', word: 'Sonar', caps: Object.freeze(['3']), codes: Object.freeze(['Digit3']), slot: 3 }),
  Object.freeze({ id: 'surge', name: 'Tail Surge', short: 'SURGE', word: 'Tail Surge', caps: Object.freeze(['4']), codes: Object.freeze(['Digit4']), slot: 4 }),
  Object.freeze({ id: 'breach', name: 'Breach', short: 'BREACH', word: 'Breach', caps: Object.freeze(['5']), codes: Object.freeze(['Digit5']), slot: 5 }),
]);
// the RPG's legend: Swim, Dash, then the four skills, then the rest
export const RPG_LEGEND = Object.freeze([...LEGEND.slice(0, 2), ...RPG_SKILLS.map(({ id, word, caps, codes }) => Object.freeze({ id, word, caps, codes, skill: true })), ...LEGEND.slice(2)]);
// a slot pip row's state (pure): rank → four pips, true = filled; a locked skill (rank 0) shows none
export const pipsOf = (rank) => (rank > 0 ? [0, 1, 2, 3].map((i) => i < rank) : []);
// a slot's state (pure): 'unlocked' (pips), 'trial' (locked, free uses left: glyph 60 %, the count), 'locked' (glyph 25 %)
export const slotState = (rank = 0, trials = 0) => (rank > 0 ? 'unlocked' : trials > 0 ? 'trial' : 'locked');
export const slotGlyph = (state) => (state === 'locked' ? 0.25 : state === 'trial' ? 0.6 : 1);
const DEG = Math.PI / 180;
import { wrap } from '../../src/sim/core/math.js';

// a line with [K] key marks as the skipper's line draws it (src/ui/controlsHint.js CAP: class "cap", "wide" past two characters)
export const capLine = (text) => String(text ?? '').replace(/\[([^\]]{1,5})\]/g, (_, k) => { const f = capFace(k); return `<span class="cap${f.length > 2 ? ' wide' : ''}" data-k="${f}">${f}</span>`; });

// where each instrument stands (px, CSS from the frame's edges): w, h the viewport; tablet: a touch layout; barB: the top bar's foot
export function hudLayout({ w = 1280, h = 720, tablet = false, barB = 58, slots = HUD.slots } = {}) {
  const H = HUD;
  if (tablet) {
    const T = H.tablet, n = slots, row = n * T.slot + (n - 1) * H.gap;
    const free0 = w * T.stickShare, free1 = w - T.buttonsW, cx = (free0 + free1) / 2;   // the free band between the stick's zone and the buttons
    return { tablet: true, depth: { left: T.inset, top: barB + T.inset, size: T.dial }, sonar: { right: T.inset, top: barB + T.inset, size: T.dial },
      skills: { left: Math.round(cx - row / 2), bottom: H.margin, slot: T.slot, gap: H.gap, width: row }, legend: { show: false } };
  }
  const narrow = w < H.narrow.width, dial = narrow ? H.narrow.dial : H.dial, slot = narrow ? H.narrow.slot : H.slot, row = slots * slot + (slots - 1) * H.gap;
  return { tablet: false, depth: { left: H.margin, bottom: H.margin, size: dial }, sonar: { right: H.margin, bottom: H.margin, size: dial },
    skills: { left: Math.round((w - row) / 2), bottom: H.margin, slot, gap: H.gap, width: row }, legend: { show: !narrow, minBottom: H.margin + dial + H.legendGap } };   // the edge foot (--lk-edge-foot), raised clear of the sonar
}

// the sonar's blips (pure): her { x, z, psi }, the boats ({ id, kind, x, z, heading }), her heading up; each blip { id, kind, u, v (−1…1,
// v up = ahead), rot (rad: its heading about hers), target (the corners' boat), lock (the locked one), seen (it has seen her) } within
// rangeM, the nearest `max`
export function sonarBlips(her, list = [], { rangeM = HUD.sonar.rangeM, max = HUD.sonar.max, targetId = null, lockId = null, seen = () => false } = {}) {
  if (!her) return [];
  const c = Math.cos(her.psi), s = Math.sin(her.psi), out = [];
  for (const b of list) {
    const dx = b.x - her.x, dz = b.z - her.z, d = Math.hypot(dx, dz);
    if (!(d <= rangeM)) continue;
    // into her frame: ahead = (sin ψ, −cos ψ), right = (cos ψ, sin ψ)
    const ahead = dx * s - dz * c, right = dx * c + dz * s;
    out.push({ id: b.id, kind: b.kind, d, u: right / rangeM, v: ahead / rangeM, rot: wrap((b.heading ?? 0) - her.psi), target: b.id === targetId, lock: b.id === lockId, seen: !!seen(b, d) });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, max);
}

// the legend's levels (pure): counts { id: uses } → [{ id, word, caps, level ('full' | 'learned') }]; a learned line stays (never hidden)
export function legendLevels(counts = {}, lines = LEGEND) {
  return lines.map((l) => ({ ...l, level: (counts[l.id] ?? 0) >= HUD.learnAt ? 'learned' : 'full' }));
}
// is her legend on screen (pure): she is played, the layout has room (a desktop 1100 px or wider), Setup › key hints is on (Sail's rule)
export const legendVisible = ({ shown = false, layout = null, keyHints = true } = {}) => !!shown && !!layout?.legend?.show && keyHints !== false;
export const legendLineOf = (code, lines = LEGEND) => lines.find((l) => l.codes.includes(code))?.id ?? null;

// a skill slot's look (pure) for its state ({ phase, k }): the ring's share and its ink
export function slotLook(state) {
  if (!state) return { ring: 0, ink: 'empty', glyph: 0.28 };
  if (state.phase === 'active') return { ring: state.k, ink: 'amber', glyph: 1 };
  if (state.phase === 'cool') return { ring: state.k, ink: 'cool', glyph: 0.5 };
  return { ring: 1, ink: 'ready', glyph: 1 };
}

const LOCKED_LOOK = Object.freeze({ ring: 0, ink: 'empty', glyph: slotGlyph('locked') }), TRIAL_LOOK = Object.freeze({ ring: 0, ink: 'empty', glyph: slotGlyph('trial') }), READY = Object.freeze({ phase: 'ready' });
const HUD_CSS = `#lk-tplay .tp-sonar{position:absolute;right:22px;bottom:22px;width:132px;height:132px}
#lk-tplay .tp-sonar svg{width:100%;height:100%;overflow:visible}
#lk-tplay .tp-sonar .sw{position:absolute;left:0;right:0;top:84px;text-align:center;font:600 11px/1 var(--lk-ui,system-ui);letter-spacing:.16em;opacity:.8}
#lk-tplay .tp-sonar[data-hidden] .me{opacity:.45}
#lk-tplay .tp-sonar .bl{fill:rgb(var(--lk-cream) / .6);stroke:none}
#lk-tplay .tp-sonar .bl.o{fill:none;stroke:rgb(var(--lk-cream) / .7);stroke-width:1.2}
#lk-tplay .tp-sonar .bl[data-t]{fill:rgb(var(--lk-cream) / .95)}
#lk-tplay .tp-sonar .bl.o[data-t]{fill:none;stroke:rgb(var(--lk-cream) / .95)}
#lk-tplay .tp-sonar .lk{fill:none;stroke:rgb(var(--lk-amber,240 172 64));stroke-width:1.5}
#lk-tplay .tp-sonar .rm{stroke:rgb(var(--lk-cream) / .9);stroke-width:2.2;stroke-linecap:round}
#lk-tplay .tp-skills{position:absolute;bottom:22px;display:flex;gap:12px;align-items:flex-start}
#lk-tplay .tp-slot{all:unset;box-sizing:border-box;position:relative;width:64px;height:64px;flex:none;border-radius:50%;color:var(--lk-ink,#f3ecdc)}
#lk-tplay .tp-slot svg{width:100%;height:100%;overflow:visible}
#lk-tplay .tp-slot.empty{border:1.5px solid rgb(var(--lk-cream) / .28);background:rgb(var(--lk-brand-navy) / .35)}
#lk-tplay .tp-slot .rg{fill:none;stroke-width:3;stroke-linecap:round;transition:stroke .3s ease,stroke-opacity .3s ease}
#lk-tplay .tp-slot[data-ink=ready] .rg{stroke:rgb(var(--lk-cream));stroke-opacity:.9}
#lk-tplay .tp-slot[data-ink=amber] .rg{stroke:rgb(var(--lk-amber,240 172 64));stroke-opacity:1;transition:none}
#lk-tplay .tp-slot[data-ink=cool] .rg{stroke:rgb(var(--lk-cream));stroke-opacity:.55;transition:none}
#lk-tplay .tp-slot .gl{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:opacity .3s ease}
#lk-tplay .tp-slot[data-ink=amber] .gl{stroke:rgb(var(--lk-amber,240 172 64))}
#lk-tplay .tp-slot .lv{position:absolute;right:-4px;bottom:-2px;padding:1px 4px;border-radius:6px;background:rgb(var(--lk-brand-navy) / .85);border:1px solid rgb(var(--lk-cream) / .45);font:600 10px/1.2 var(--lk-ui,system-ui);letter-spacing:.04em}
#lk-tplay .tp-slot .nm{position:absolute;left:50%;top:calc(100% + 6px);transform:translateX(-50%);white-space:nowrap;font:600 11px/1 var(--lk-ui,system-ui);letter-spacing:.14em;text-shadow:0 1px 2px rgb(var(--lk-brand-navy) / .9)}
#lk-tplay .tp-slot.sk{pointer-events:auto;cursor:pointer;touch-action:none}
#lk-tplay .tp-slot.sk:hover .rg{stroke-opacity:1}
#lk-tplay .tp-slot.empty{pointer-events:auto;cursor:default}
#lk-tplay .tp-slot.empty:hover{border-color:rgb(var(--lk-cream) / .4)}
#lk-tplay .tp-slot .kn{position:absolute;left:-3px;top:-3px;padding:0 4px;border-radius:6px;background:rgb(var(--lk-brand-navy) / .85);border:1px solid rgb(var(--lk-cream) / .4);font:600 10px/1.3 var(--lk-ui,system-ui);letter-spacing:.04em;pointer-events:none}
#lk-tplay .tp-slot.empty .kn{background:none;border-color:transparent;opacity:.4}
#lk-tplay .tp-keys .kl.tp-lv{position:relative}
#lk-tplay .tp-keys .kl.tp-lv .w{grid-column:1 / -1}
#lk-tplay .tp-keys .kl.tp-lv .xp{position:absolute;left:0;right:0;bottom:5px;height:2px;background:rgb(var(--lk-cream) / .22);box-shadow:0 0 3px rgb(var(--lk-brand-navy) / .6)}
#lk-tplay .tp-keys .kl.tp-lv .xp b{display:block;height:100%;width:0;background:rgb(var(--lk-cream) / .92)}
#lk-tplay .tp-slot .pp{position:absolute;left:50%;bottom:9px;transform:translateX(-50%);display:flex;gap:3px;pointer-events:none}
#lk-tplay .tp-slot .pp b{width:4px;height:4px;box-sizing:border-box;border-radius:50%;border:1px solid rgb(var(--lk-cream) / .28)}
#lk-tplay .tp-slot .pp b.on{background:rgb(var(--lk-cream) / .9);border-color:transparent}
#lk-tplay .tp-slot.locked{border:1.5px solid rgb(var(--lk-cream) / .28);background:rgb(var(--lk-brand-navy) / .35)}
#lk-tplay .tp-slot.locked .base,#lk-tplay .tp-slot.locked .rg,#lk-tplay .tp-slot.locked .nm,#lk-tplay .tp-slot.locked .pp{display:none}
#lk-tplay .tp-slot .tr{display:none;position:absolute;left:50%;bottom:6px;transform:translateX(-50%);font:600 10px/1 var(--lk-ui,system-ui);letter-spacing:.04em;color:rgb(var(--lk-cream) / .9);pointer-events:none}
#lk-tplay .tp-slot.locked.trial .tr{display:block}
#lk-tplay .tp-slot.locked.trial[data-busy] .rg{display:inline}
#lk-tplay .tp-slot.locked .kn{background:none;border-color:transparent;opacity:.4}
#lk-tplay .tp-slot[data-halo]{box-shadow:0 0 0 2px rgb(var(--lk-brand-navy) / .55),0 0 0 4px rgb(var(--lk-amber,240 172 64) / .55),0 0 14px 5px rgb(var(--lk-amber,240 172 64) / .28)}   /* a navy hairline keeps the amber apart from the cream ring */
#lk-tplay .tp-slot{transition:box-shadow .4s ease}
@media (prefers-reduced-motion:reduce){#lk-tplay .tp-slot .rg{transition:none}}`;

const GLYPH = '<path class="gl" d="M18 26h10M15 32h13M18 38h10M34 24l8 8-8 8"/>';   // the dash: three speed lines and a chevron
// the RPG's glyphs (the same 2 px cream line): the dash's, a tail flicking up three drops (Lure), a ping and two arcs (Sonar), two
// waves running out (Tail Surge), an arc with an up chevron (Breach)
const GLYPHS = Object.freeze({
  dash: GLYPH,
  lure: '<path class="gl" d="M20 40c6-1 10-6 12-13 2 7 6 12 12 13M25 23v-3M32 19v-4M39 23v-3"/>',
  sonar: '<path class="gl" d="M32 37.5h.01M26 32a8.5 8.5 0 0 1 12 0M21 27a15.5 15.5 0 0 1 22 0"/>',
  surge: '<path class="gl" d="M17 37q7.5-8 15 0t15 0M21 29q5.5-6 11 0t11 0"/>',
  breach: '<path class="gl" d="M18 42q14-24 28 0M28 25l4-4 4 4"/>',
});
const SONAR_SVG = (cone) => `<svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="58" stroke-width="2" style="fill:rgb(var(--lk-brand-navy) / .72);stroke:rgb(var(--lk-cream) / .7)"/>
<circle cx="66" cy="66" r="${(54 * 50 / 160).toFixed(1)}" fill="none" stroke-width="1" style="stroke:rgb(var(--lk-cream) / .14)"/><circle cx="66" cy="66" r="${(54 * 100 / 160).toFixed(1)}" fill="none" stroke-width="1" style="stroke:rgb(var(--lk-cream) / .14)"/>
<path d="M66 66L${(66 + 54 * Math.sin(cone)).toFixed(1)} ${(66 - 54 * Math.cos(cone)).toFixed(1)}A54 54 0 0 0 ${(66 - 54 * Math.sin(cone)).toFixed(1)} ${(66 - 54 * Math.cos(cone)).toFixed(1)}Z" style="fill:rgb(var(--lk-cream) / .06)"/>
<g class="rim"></g><g class="bls"></g><path class="me" d="M66 59l4 10h-8z" style="fill:rgb(var(--lk-cream) / .95)"/></svg><b class="sw">SONAR</b>`;

// the DOM: the sonar, the skills row, the legend, made in the play's layer; returns { paint(frame), place(layout), count(code), el }
export function mountHud({ root, doc = globalThis.document, skills = [], storage = null, onSlot = null, onSlotUp = null, keyHints = () => true, rpg = false } = {}) {
  if (!root || !doc) return null;
  if (!doc.getElementById('lk-thud-css')) { const st = doc.createElement('style'); st.id = 'lk-thud-css'; st.textContent = HUD_CSS; doc.head.appendChild(st); }
  const sonar = doc.createElement('div'); sonar.className = 'tp-sonar tp-hud'; sonar.setAttribute('aria-hidden', 'true'); sonar.innerHTML = SONAR_SVG(HUD.sonar.coneDeg * DEG);
  const row = doc.createElement('div'); row.className = 'tp-skills tp-hud';
  const circ = 2 * Math.PI * 29;
  const ring = (glyph) => `<svg viewBox="0 0 64 64"><circle class="base" cx="32" cy="32" r="29" stroke-width="3" style="fill:rgb(var(--lk-brand-navy) / .72);stroke:rgb(var(--lk-cream) / .25)"/><circle class="rg" cx="32" cy="32" r="29" transform="rotate(-90 32 32)" stroke-dasharray="${circ.toFixed(1)} ${circ.toFixed(1)}"/>${glyph}</svg>`;
  const slot = (sk, n) => sk
    ? `<button type="button" class="tp-slot sk" data-skill="${sk.id}" aria-label="${sk.name}, key ${slotLabel(sk.slot ?? 1)}" tabindex="-1">${ring(GLYPH)}<i class="lv">Lv ${sk.level}</i><i class="kn">${slotLabel(sk.slot ?? 1)}</i><b class="nm">${sk.name.toUpperCase()}</b></button>`
    : `<i class="tp-slot empty" data-slot="${n}" aria-hidden="true"><i class="kn">${n}</i></i>`;
  // the RPG: every slot is a skill, locked until a point opens it (hud.ranks); the pips in place of the level tag
  const rpgSlot = (sk) => `<button type="button" class="tp-slot sk${sk.id === 'dash' ? '' : ' locked'}" data-skill="${sk.id}" data-rank="${sk.id === 'dash' ? 1 : 0}" aria-label="${sk.name}, key ${slotLabel(sk.slot)}" tabindex="-1">${ring(GLYPHS[sk.id])}<i class="pp">${pipsOf(4).map(() => '<b></b>').join('')}</i><i class="tr"></i><i class="kn">${slotLabel(sk.slot)}</i><b class="nm">${sk.short}</b></button>`;
  // a skill sits in its own slot (its `slot`, else the next free one); the rest are reserved
  const bySlot = {}; skills.forEach((sk, i) => { bySlot[sk.slot ?? i + 1] = sk; });
  const dashRow = bySlot[1] ?? { id: 'dash', name: 'Dash', slot: 1 };
  row.innerHTML = rpg ? [{ ...dashRow, short: 'DASH' }, ...RPG_SKILLS].map(rpgSlot).join('')
    : Array.from({ length: SLOT_COUNT }, (_, i) => slot(bySlot[i + 1], i + 1)).join('');
  const lines = rpg ? RPG_LEGEND : LEGEND;
  ensureLegendStyle(doc);   // Sail's legend: the edge pair, the rows, the cap
  const legend = doc.createElement('div'); legend.className = 'lk-keys lk-edgepair right six tp-keys tp-hud'; legend.setAttribute('aria-hidden', 'true');
  const cap = (k) => { const f = capFace(k); return `<span class="cap${f.length > 2 ? ' wide' : ''}">${f}</span>`; };
  legend.innerHTML = (rpg ? '<div class="kl tp-lv" data-id="level"><span class="w">Tessie · Lv 1</span><i class="xp"><b></b></i></div>' : '') + lines.map((l) => `<div class="kl${l.skill ? ' off' : ''}" data-id="${l.id}"><span class="caps">${l.caps.map(cap).join(l.sep ? `<span class="sep">${l.sep}</span>` : '')}</span><span class="w">${l.word}</span></div>`).join('');
  root.append(sonar, row, legend);
  for (const b of row.querySelectorAll('.tp-slot.sk')) {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.setPointerCapture?.(e.pointerId); onSlot?.(b.dataset.skill); });
    // the press lifted (onSlotUp: the RPG's Breach is held on its slot and launches on the release)
    for (const t of ['pointerup', 'pointercancel']) b.addEventListener(t, (e) => { e.stopPropagation(); onSlotUp?.(b.dataset.skill); });
  }
  let counts = {}; try { counts = JSON.parse(storage?.getItem(HUD.storeKey) ?? '{}') ?? {}; } catch { counts = {}; }
  let lastBlips = 0, lay = null, shown = false;
  const px = (v) => (v == null ? '' : `${Math.round(v)}px`);
  const api = {
    el: { sonar, row, legend },
    get counts() { return { ...counts }; },
    // a key used while she is played (one count per press): its line learns
    count(code) { const id = legendLineOf(code, lines); if (!id) return; counts[id] = Math.min(99, (counts[id] ?? 0) + 1); try { storage?.setItem(HUD.storeKey, JSON.stringify(counts)); } catch { /* memory only */ } },
    place(L, depthEl = null) {
      lay = L;
      const put = (el, p) => { el.style.left = px(p.left); el.style.right = px(p.right); el.style.top = px(p.top); el.style.bottom = px(p.bottom); if (p.size) { el.style.width = px(p.size); el.style.height = px(p.size); } };
      if (depthEl) put(depthEl, L.depth);
      put(sonar, L.sonar);
      row.style.left = px(L.skills.left); row.style.bottom = px(L.skills.bottom); row.style.gap = px(L.skills.gap);
      row.toggleAttribute('data-tablet', !!L.tablet);
      for (const s of row.querySelectorAll('.tp-slot')) { s.style.width = px(L.skills.slot); s.style.height = px(L.skills.slot); }
      if (L.legend.show) legend.style.bottom = `max(var(--lk-edge-foot), ${px(L.legend.minBottom)})`;
      api.legendOn();
    },
    // each frame: t (s), skill states by id, the sonar's input (her, the boats, the corners' and the locked ids, seen(b, d)), hidden
    // ping (the RPG's Sonar, while its marks last): { rangeM, marks: [{ a }] } (a: rad clockwise from her heading)
    paint({ t = 0, states = {}, her = null, boats = [], targetId = null, lockId = null, seen = () => false, hidden = false, ping = null } = {}) {
      for (const s of row.querySelectorAll('.tp-slot.sk')) {
        // the RPG: a locked slot keeps the empty slot's look (its glyph at 25 %); an unlocked skill with no state yet reads ready;
        // a free trial running or cooling shows its ring as an unlocked one would
        const st = states[s.dataset.skill], trial = s.classList.contains('trial'), busy = trial && !!st && st.phase !== 'ready';
        if (s.hasAttribute('data-busy') !== busy) s.toggleAttribute('data-busy', busy);
        const look = s.classList.contains('locked') ? (busy ? slotLook(st) : trial ? TRIAL_LOOK : LOCKED_LOOK) : slotLook(st ?? (rpg ? READY : null));
        if (s.dataset.ink !== look.ink) s.dataset.ink = look.ink;
        s.querySelector('.rg').setAttribute('stroke-dasharray', `${(circ * look.ring).toFixed(1)} ${circ.toFixed(1)}`);
        s.querySelector('.gl').style.opacity = String(look.glyph);
      }
      const lv = legendLevels(counts, lines);
      for (const k of legend.querySelectorAll('.kl')) k.classList.toggle('learned', lv.find((l) => l.id === k.dataset.id)?.level === 'learned');
      api.legendOn();
      sonar.toggleAttribute('data-hidden', !!hidden); const sw = sonar.querySelector('.sw'); const word = hidden ? 'HIDDEN' : ping ? `${Math.round(ping.rangeM)} M` : 'SONAR'; if (sw.textContent !== word) sw.textContent = word;
      if (t - lastBlips < 1 / HUD.sonar.hz && t >= lastBlips) return;
      lastBlips = t;
      const R = 54, g = sonar.querySelector('.bls');
      g.innerHTML = sonarBlips(her, boats, { targetId, lockId, seen }).map((b) => {
        const x = 66 + b.u * R, y = 66 - b.v * R, r = (b.rot / DEG).toFixed(0), tg = b.target ? ' data-t=""' : '';
        const shape = b.kind === 'kayak' || b.kind === 'sup' ? `<circle class="bl o"${tg} cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`
          : b.kind === 'glass' ? `<rect class="bl"${tg} x="-2" y="-5" width="4" height="10" rx="2" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r})"/>`
          : `<path class="bl${b.kind === 'halcyon' ? ' o' : ''}"${tg} d="M0 -6L4 5H-4Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r})"/>`;
        const tick = b.seen ? `<path d="M0 7v3" stroke-width="1.2" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r})" style="stroke:rgb(var(--lk-cream) / .8)"/>` : '';
        const ring = b.lock ? `<circle class="lk" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"/>` : '';
        return `<g data-id="${b.id}">${shape}${tick}${ring}</g>`;
      }).join('');
      sonar.dataset.blips = String(g.childElementCount);
      // the ping's rim: a tick at each marked boat's bearing (in range or beyond the dial's 160 m)
      const rim = sonar.querySelector('.rim'), marks = ping?.marks ?? [];
      rim.innerHTML = marks.map((m) => { const sx = Math.sin(m.a), cy = Math.cos(m.a); return `<line class="rm" x1="${(66 + 55 * sx).toFixed(1)}" y1="${(66 - 55 * cy).toFixed(1)}" x2="${(66 + 62 * sx).toFixed(1)}" y2="${(66 - 62 * cy).toFixed(1)}"/>`; }).join('');
      sonar.dataset.rim = String(marks.length);
    },
    show(on) { shown = !!on; for (const e of [sonar, row, legend]) e.toggleAttribute('data-off', !on); for (const e of [sonar, row]) e.hidden = !on; api.legendOn(); },
    // the legend shows while she is played, on a wide desktop, with Setup › key hints on (Sail's legend's own setting)
    legendOn() { let hints = true; try { hints = keyHints() !== false; } catch { /* */ } const on = legendVisible({ shown, layout: lay, keyHints: hints }); legend.hidden = !on; legend.classList.toggle('on', on); return on; },
    get layout() { return lay; },
    // the RPG's level line (rpg only): "Tessie · Lv N" and the fill's share k (0…1) of this level's XP
    level({ level = 1, k = 0 } = {}) {
      const row = legend.querySelector('.tp-lv'); if (!row) return false;
      const w = row.querySelector('.w'), txt = `Tessie · Lv ${level}`; if (w.textContent !== txt) w.textContent = txt;
      row.querySelector('.xp b').style.width = `${(Math.min(1, Math.max(0, k)) * 100).toFixed(1)}%`;
      row.dataset.level = String(level);
      return true;
    },
    // the RPG: each skill's rank ({ dash: 1, lure: 0 … }): the pips filled to it, a locked slot's look at 0, a legend line per unlocked skill
    // trials: the free uses left of each locked skill ({ lure: 5 … })
    ranks(ranks = {}, trials = {}) {
      if (!rpg) return false;
      for (const s of row.querySelectorAll('.tp-slot.sk')) {
        const id = s.dataset.skill, r = Math.max(0, Math.min(4, ranks[id] ?? (id === 'dash' ? 1 : 0))), n = r === 0 ? Math.max(0, trials[id] ?? 0) : 0;
        const key = `${r}:${n}`; if (s.dataset.look === key) continue;
        s.dataset.look = key; s.dataset.rank = String(r); s.dataset.trials = String(n);
        const st = slotState(r, n); s.classList.toggle('locked', st !== 'unlocked'); s.classList.toggle('trial', st === 'trial');
        s.querySelector('.tr').textContent = n > 0 ? String(n) : '';
        const on = pipsOf(r); s.querySelectorAll('.pp b').forEach((b, i) => b.classList.toggle('on', !!on[i]));
      }
      for (const k of legend.querySelectorAll('.kl')) { const l = RPG_SKILLS.find((x) => x.id === k.dataset.id); if (l) k.classList.toggle('off', !((ranks[l.id] ?? 0) > 0 || (trials[l.id] ?? 0) > 0)); }
      return true;
    },
    // the RPG: the slots a point can go to now carry the soft amber halo (steady: no pulse)
    halo(ids = []) {
      if (!rpg) return false;
      for (const s of row.querySelectorAll('.tp-slot.sk')) s.toggleAttribute('data-halo', ids.includes(s.dataset.skill));
      return true;
    },
  };
  return api;
}
