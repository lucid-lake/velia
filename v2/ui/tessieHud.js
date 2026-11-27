// Play as Tessie, her HUD as a family of instruments (owner, 2026-11-20: "keep the depth dial; a sonar dial for nearby
// boats; a skill dial for the dash as the first slot of a skills row; her keys on the right edge in Sail's legend style"). Cockpit
// instruments, calm: navy glass at 72 %, a cream 2 px bezel, cream ink, amber only while something is lit (the dash, the lock); no flash,
// no pulse; the only motion a ping's one wave on the SONAR dial and a cooling slot's wipe (THE ICONS, THE PING below). The pure parts (the layout, the sonar's blips, the legend's levels, the ring) are exported for the tests; the DOM
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
//   THE ICONS (the RTS pass): each slot is a rounded-square tile of one family (a navy ground lit from the upper left, a bevel, a
//          3 px frame that carries the state) with one bold cream silhouette, outlined in navy, that says what the skill does: the
//          Dash a dart with three speed streaks (horizontal), the Lure a hook with a glint (a vertical curl), the Sonar a fan of three
//          radial, never a broadcast fan), the Tail Surge a breaking wave (a low heavy curl), the Breach her neck rising out of a splash
//          (vertical). The frame tells the state: ready a full cream frame; running an amber frame emptying (the figure amber);
//          cooling a dim frame refilling and a navy wipe over the tile shrinking clockwise from twelve; locked the tile and figure
//          dimmed, no frame; pickable the steady amber halo. The skill's name under every tile, a locked one's dimmed
//   THE PING ON THE DIAL: while a ping's marks last the SONAR dial rescales to the ping's range: each marked boat a blip at its true
//          bearing and range, its shape by type (a sail a triangle, a runabout an arrowhead, a kayak a slim lens, the glass boat a
//          bar, the paddle-wheeler a block, a jet ski a diamond, your Halcyon an outlined triangle), a ring at half the range and the
//          rim labelled in metres, one ping wave out from her (0.9 s; none under reduced motion) that lights each blip as it passes,
//          the blips fading as the marks run out; a marked boat that has run past the range sits on the rim as a tick
import { SLOT_COUNT, slotLabel } from '../sim/tessieSkills.js';
import { CAP_RULE, capFace, ensureLegendStyle } from '../../src/ui/keyLegend.js';
export { CAP_RULE };
export const HUD = Object.freeze({
  margin: 22, dial: 132, slot: 64, gap: 12, slots: 4, legendGap: 22,   // legendGap: the legend's foot this far over the sonar's top
  narrow: Object.freeze({ width: 1100, dial: 112, slot: 56 }),
  tablet: Object.freeze({ dial: 104, inset: 16, slot: 72, stickShare: 0.4, buttonsW: 236 }),   // the stick owns the left 40 %, the buttons (Bite and ▲ ▼) about 236 px on the right
  sonar: Object.freeze({ rangeM: 160, rings: Object.freeze([50, 100]), max: 12, hz: 10, coneDeg: 35 }),
  ping: Object.freeze({ waveS: 0.9, max: 16, fadeMin: 0.35, R: 54, minPx: 11 }),   // minPx: two blips never closer than this (a pile spreads)   // the ping on the dial: the wave's run, the blips at most, the faintest a blip fades to, the rim (px of 132)
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
  if (state.phase === 'cool') return { ring: state.k, ink: 'cool', glyph: 0.85, wipe: 1 - state.k };   // the wipe: the share still to recharge
  return { ring: 1, ink: 'ready', glyph: 1 };
}

// the cooldown's wipe over a 64 px tile (pure): a navy wedge from the recharged share's edge clockwise round to twelve; '' when
// nothing is left (share 0), the whole tile at 1
export function wipePath(share = 0) {
  const w = Math.min(1, Math.max(0, +share || 0)); if (w <= 0.001) return '';
  if (w >= 0.999) return 'M-4 -4H68V68H-4Z';
  const R = 46, a = (1 - w) * 2 * Math.PI, x = 32 + R * Math.sin(a), y = 32 - R * Math.cos(a);
  return `M32 32L${x.toFixed(2)} ${y.toFixed(2)}A${R} ${R} 0 ${w > 0.5 ? 1 : 0} 1 32 ${32 - R}Z`;
}
// the wipe's leading edge (pure): the clock hand from the tile's centre to its edge, [x, y] of its far end; null with no wipe
export function wipeHand(share = 0) {
  const w = Math.min(1, Math.max(0, +share || 0)); if (w <= 0.001 || w >= 0.999) return null;
  const a = (1 - w) * 2 * Math.PI; return [+(32 + 46 * Math.sin(a)).toFixed(2), +(32 - 46 * Math.cos(a)).toFixed(2)];
}
// a boat's blip shape on the ping's dial by its kind (the bounty's types): a sail a triangle, a runabout an arrowhead, a kayak a slim
// lens, the glass boat a bar, the paddle-wheeler a block, a jet ski a diamond, the Halcyon an outlined triangle
export const BLIP_SHAPE = Object.freeze({ sail: 'tri', rival: 'tri', anchored: 'tri', halcyon: 'otri', power: 'arrow', kayak: 'lens', sup: 'lens', glass: 'bar', paddle: 'block', jetski: 'diamond' });
const BLIP_D = Object.freeze({ tri: 'M0 -6.5L4.2 5H-4.2Z', otri: 'M0 -6.5L4.2 5H-4.2Z', arrow: 'M0 -7L4.6 5.5L0 2.6L-4.6 5.5Z', lens: 'M0 -6.5Q2.6 0 0 6.5Q-2.6 0 0 -6.5Z',
  bar: 'M-2.4 -6H2.4A2.4 2.4 0 0 1 4.8 -3.6V3.6A2.4 2.4 0 0 1 2.4 6H-2.4A2.4 2.4 0 0 1 -4.8 3.6V-3.6A2.4 2.4 0 0 1 -2.4 -6Z', block: 'M-5 -7H5V7H-5Z M-5 -1H5V1H-5Z', diamond: 'M0 -4.6L3.4 0L0 4.6L-3.4 0Z' });
export const blipPath = (shape) => BLIP_D[shape] ?? BLIP_D.tri;
// the ping on the dial (pure): her { x, z, psi }, the boats, the ping { rangeM, at, until, has(id) }, t (her clock), reduced (no
// wave: every blip at once) → each marked boat { id, kind, shape, x, y (px on the 132 dial), rot (deg), d, out (past the range: on
// the rim), on (the wave has reached it), op (its ink: 1 at the ping, fading to fadeMin as the marks run out) }, nearest first
export function pingBlips(her, boats = [], ping = null, t = 0, { reduced = false, max = HUD.ping.max } = {}) {
  if (!her || !ping || !(ping.rangeM > 0)) return [];
  const P = HUD.ping, has = typeof ping.has === 'function' ? ping.has : () => true;
  const at = ping.at ?? t, until = ping.until ?? t + 1, age = t - at;
  const left = Math.min(1, Math.max(0, (until - t) / Math.max(1e-6, until - at))), op = +(P.fadeMin + (1 - P.fadeMin) * left).toFixed(3);
  const c = Math.cos(her.psi), sn = Math.sin(her.psi), out = [];
  for (const b of boats) {
    if (!has(b.id)) continue;
    const dx = b.x - her.x, dz = b.z - her.z, d = Math.hypot(dx, dz), ahead = dx * sn - dz * c, right = dx * c + dz * sn;   // her frame, as sonarBlips
    const k = d / ping.rangeM, r = Math.min(1, k) * P.R, ux = d > 0 ? right / d : 0, vy = d > 0 ? ahead / d : 0;
    out.push({ id: b.id, kind: b.kind, shape: BLIP_SHAPE[b.kind] ?? 'tri', d, x: +(66 + ux * r).toFixed(2), y: +(66 - vy * r).toFixed(2), rot: Math.round(wrap((b.heading ?? 0) - her.psi) / DEG),
      out: k > 1, on: reduced || age >= P.waveS * Math.min(1, k), op });
  }
  out.sort((p, q) => p.d - q.d);
  const shown = out.slice(0, max);
  spread(shown.filter((b) => !b.out), P.minPx, P.R);
  return shown;
}
// blips that would pile up pushed apart to at least min px (pure, deterministic, a few relaxation passes); each keeps its true spot as
// tx, ty and stays inside the rim
function spread(list, min, R) {
  for (const b of list) { b.tx = b.x; b.ty = b.y; }
  for (let it = 0; it < 8; it++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]; let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 1e-3) { const ang = j * 2.39996; dx = Math.cos(ang); dy = Math.sin(ang); d = 0; } else { dx /= d; dy /= d; }   // a coincident pair splits along a golden-angle bearing
      const push = (min - d) / 2;
      a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push; moved = true;
    }
    for (const b of list) { const rx = b.x - 66, ry = b.y - 66, r = Math.hypot(rx, ry); if (r > R) { b.x = 66 + rx * R / r; b.y = 66 + ry * R / r; } }
    if (!moved) break;
  }
  for (const b of list) { b.x = +b.x.toFixed(2); b.y = +b.y.toFixed(2); }
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
#lk-tplay .tp-slot{all:unset;box-sizing:border-box;position:relative;width:64px;height:64px;flex:none;border-radius:14px;color:var(--lk-ink,#f3ecdc)}
#lk-tplay .tp-slot svg{width:100%;height:100%;overflow:visible}
#lk-tplay .tp-slot.empty{border:1.5px solid rgb(var(--lk-cream) / .28);background:rgb(var(--lk-brand-navy) / .35)}
#lk-tplay .tp-slot .bg{fill:rgb(var(--lk-brand-navy) / .86)}
#lk-tplay .tp-slot .base{fill:none;stroke:rgb(var(--lk-cream) / .22);stroke-width:3}
#lk-tplay .tp-slot .cd{fill:rgb(var(--lk-brand-navy) / .74)}
#lk-tplay .tp-slot .ch{stroke:rgb(var(--lk-cream) / .55);stroke-width:1.2;stroke-linecap:round}
#lk-tplay .tp-slot .gl .f{fill:rgb(var(--lk-cream) / .96);stroke:rgb(var(--lk-brand-navy) / .95);stroke-width:2.6;stroke-linejoin:round;paint-order:stroke}
#lk-tplay .tp-slot .gl .d{fill:rgb(var(--lk-brand-navy))}
#lk-tplay .tp-slot .gl .so{fill:none;stroke:rgb(var(--lk-brand-navy) / .95);stroke-width:8.4;stroke-linecap:round;stroke-linejoin:round}
#lk-tplay .tp-slot .gl .s{fill:none;stroke:rgb(var(--lk-cream) / .96);stroke-width:4.6;stroke-linecap:round;stroke-linejoin:round}
#lk-tplay .tp-slot[data-ink=amber] .gl .f{fill:rgb(var(--lk-amber,240 172 64))}
#lk-tplay .tp-slot[data-ink=amber] .gl .s{stroke:rgb(var(--lk-amber,240 172 64))}
#lk-tplay .tp-slot .rg{fill:none;stroke-width:3;stroke-linecap:round;transition:stroke .3s ease,stroke-opacity .3s ease}
#lk-tplay .tp-slot[data-ink=ready] .rg{stroke:rgb(var(--lk-cream));stroke-opacity:.9}
#lk-tplay .tp-slot[data-ink=amber] .rg{stroke:rgb(var(--lk-amber,240 172 64));stroke-opacity:1;transition:none}
#lk-tplay .tp-slot[data-ink=cool] .rg{stroke:rgb(var(--lk-cream));stroke-opacity:.55;transition:none}
#lk-tplay .tp-slot .gl{transition:opacity .3s ease}
#lk-tplay .tp-slot .lv{position:absolute;right:-4px;bottom:-2px;padding:1px 4px;border-radius:6px;background:rgb(var(--lk-brand-navy) / .85);border:1px solid rgb(var(--lk-cream) / .45);font:600 10px/1.2 var(--lk-ui,system-ui);letter-spacing:.04em}
#lk-tplay .tp-slot .nm{position:absolute;left:50%;top:calc(100% + 5px);transform:translateX(-50%);white-space:nowrap;font:700 11px/1 var(--lk-ui,system-ui);letter-spacing:.12em;color:rgb(var(--lk-cream) / .95);text-shadow:0 1px 2px rgb(var(--lk-brand-navy) / .95),0 0 6px rgb(var(--lk-brand-navy) / .8);pointer-events:none}
#lk-tplay .tp-skills[data-tablet] .tp-slot .nm{font-size:12px}
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
#lk-tplay .tp-slot.locked .bg{fill:rgb(var(--lk-brand-navy) / .5)}
#lk-tplay .tp-slot.locked .lt,#lk-tplay .tp-slot.locked .bv,#lk-tplay .tp-slot.locked:not([data-busy]) .cd,#lk-tplay .tp-slot.locked:not([data-busy]) .ch{display:none}
#lk-tplay .tp-slot.locked .base{stroke:rgb(var(--lk-cream) / .2);stroke-width:1.5;stroke-dasharray:4 3}
#lk-tplay .tp-slot.locked .rg,#lk-tplay .tp-slot.locked .pp{display:none}
#lk-tplay .tp-slot.locked .nm{opacity:.5}
#lk-tplay .tp-slot .tr{display:none;position:absolute;left:50%;bottom:6px;transform:translateX(-50%);font:600 10px/1 var(--lk-ui,system-ui);letter-spacing:.04em;color:rgb(var(--lk-cream) / .9);pointer-events:none}
#lk-tplay .tp-slot.locked.trial .tr{display:block}
#lk-tplay .tp-slot.locked.trial[data-busy] .rg{display:inline}
#lk-tplay .tp-slot.locked .kn{background:none;border-color:transparent;opacity:.4}
#lk-tplay .tp-slot[data-halo]{box-shadow:0 0 0 2px rgb(var(--lk-brand-navy) / .55),0 0 0 4px rgb(var(--lk-amber,240 172 64) / .55),0 0 14px 5px rgb(var(--lk-amber,240 172 64) / .28)}   /* a navy hairline keeps the amber apart from the cream ring */
#lk-tplay .tp-slot{transition:box-shadow .4s ease}
#lk-tplay .tp-sonar .pr,#lk-tplay .tp-sonar .hm,#lk-tplay .tp-sonar[data-ping] .r0,#lk-tplay .tp-sonar[data-ping] .cone,#lk-tplay .tp-sonar[data-ping] .me{display:none}
#lk-tplay .tp-sonar[data-ping] .hm{display:inline}
#lk-tplay .tp-sonar .hm circle{fill:rgb(var(--lk-brand-navy) / .85);stroke:rgb(var(--lk-cream) / .6);stroke-width:1}
#lk-tplay .tp-sonar .hm path{fill:rgb(var(--lk-cream));stroke:rgb(var(--lk-brand-navy));stroke-width:1;stroke-linejoin:round}
#lk-tplay .tp-sonar .hm .ht{fill:none;stroke:rgb(var(--lk-cream) / .95);stroke-width:2.4;stroke-linecap:round}
#lk-tplay .tp-sonar[data-ping] .pr{display:inline}
#lk-tplay .tp-sonar[data-ping]:not([data-hidden]) .sw{visibility:hidden}   /* the rim's own label says the range */
#lk-tplay .tp-sonar .pr circle{fill:none;stroke:rgb(var(--lk-cream) / .3);stroke-width:1;stroke-dasharray:2 3}
#lk-tplay .tp-sonar .pr text{font:700 10px/1 var(--lk-ui,system-ui);letter-spacing:.04em;fill:rgb(var(--lk-cream) / .85);stroke:rgb(var(--lk-brand-navy) / .9);stroke-width:3;paint-order:stroke;text-anchor:middle}
#lk-tplay .tp-sonar .pb{fill:rgb(var(--lk-cream) / .97);stroke:rgb(var(--lk-brand-navy) / .9);stroke-width:1.2;paint-order:stroke;transition:opacity .25s ease}
#lk-tplay .tp-sonar .pb.o{fill:rgb(var(--lk-brand-navy) / .6);stroke:rgb(var(--lk-cream) / .97);stroke-width:1.5}
#lk-tplay .tp-sonar .pw{fill:rgb(var(--lk-cream) / .05);stroke:rgb(var(--lk-cream) / .9);stroke-width:2;transform-box:view-box;transform-origin:66px 66px;transform:scale(0);opacity:0;animation:tp-ping .9s cubic-bezier(.25,.6,.35,1) forwards}
#lk-tplay .tp-sonar .pw.e{stroke-width:1;animation-delay:.22s}
@keyframes tp-ping{0%{transform:scale(.04);opacity:1}80%{opacity:.75}100%{transform:scale(1);opacity:0}}
@media (prefers-reduced-motion:reduce){#lk-tplay .tp-slot .rg{transition:none}#lk-tplay .tp-sonar .pw{display:none}}`;

// the five icons (the RTS pass: one bold silhouette each, a distinct shape language, cream on the lit navy tile, a navy outline):
// .f a filled figure, .d a navy detail, .so/.s a thick line's navy outline and its cream body. 64 px grid; the figure keeps clear of
// the frame (3 px) and of the pips (y 51 to 55)
export const ICONS = Object.freeze({
  // her head and neck stretched forward, lunging right, three speed streaks trailing: horizontal, forward ("Tessie dashes")
  dash: '<rect class="f" x="10" y="25.4" width="12" height="4.2" rx="2.1"/><rect class="f" x="6" y="30.8" width="16" height="4.2" rx="2.1"/><rect class="f" x="11" y="36.2" width="10" height="4.2" rx="2.1"/>'
    + '<path class="f" d="M24 36C30 32 36 28.5 42 26.6C46 25.4 50.5 25.4 53.6 27.4C56.2 29 56.2 32.2 53.6 33.8C50.6 35.6 46.4 35.4 42.4 35C36.2 34.6 30.4 36.6 25.2 40.4Z"/><circle class="d" cx="50" cy="29" r="1.6"/><path class="d" d="M47.5 32.6h6" style="stroke:rgb(var(--lk-brand-navy));stroke-width:1;stroke-linecap:round"/>',
  // a hook with its eye and barb, a glint by it: the bait (a vertical curl)
  lure: '<path class="so" d="M38 14.5V35a8 8 0 0 1-16 0v-4.5M22 30.5l4.6 4.4"/><circle class="so" cx="38" cy="11" r="3.4"/>'
    + '<path class="s" d="M38 14.5V35a8 8 0 0 1-16 0v-4.5M22 30.5l4.6 4.4"/><circle class="s" cx="38" cy="11" r="3.4" style="stroke-width:3.2"/>'
    + '<path class="f" d="M20 10l1.8 4.9L26.7 16.7l-4.9 1.8L20 23.4l-1.8-4.9L13.3 16.7l4.9-1.8Z"/>',
  // a radar scope: the ring, a sweep wedge from its centre and two blips (a scope, not a broadcast): radial
  sonar: '<circle class="so" cx="32" cy="29" r="17" style="stroke-width:7"/><circle class="s" cx="32" cy="29" r="17" style="stroke-width:3.6"/>'
    + '<path class="f" d="M32 29L32 14.5A14.5 14.5 0 0 1 44.56 21.75Z"/><circle class="f" cx="32" cy="29" r="2.6"/><circle class="f" cx="23.5" cy="35" r="2.8"/><circle class="f" cx="39.5" cy="37" r="2.3"/>',
  // a breaking wave, its crest curling over, spray off it: low and heavy
  surge: '<rect class="f" x="8" y="42.5" width="48" height="4.4" rx="2.2"/><path class="f" d="M9 45C11 31 21 18 36 17C47 16.5 55 23 55 31C55 37 50 40.5 45.5 39.5C41 38.5 39.5 34 42 31.5C44 29.5 47 30.5 47.5 32.5C48.5 26 43 22.5 37 23.5C28 25 24 35 28 45Z"/>'
    + '<circle class="f" cx="50" cy="13" r="2.3"/><circle class="f" cx="55" cy="18.5" r="1.7"/>',
  // her neck rising out of the water, a splash either side, drops flying: vertical, up
  breach: '<rect class="f" x="9" y="42.5" width="46" height="4.4" rx="2.2"/><path class="f" d="M11.5 43C13.5 39 16 36 19.5 34C18.5 38 18.8 40.5 20.5 43Z"/><path class="f" d="M52.5 43C50.5 39 48 36 44.5 34C45.5 38 45.2 40.5 43.5 43Z"/>'
    + '<path class="f" d="M24 44.5C23.5 31 27 19.5 34 12.5C36.2 10.3 40.2 9.6 42.4 11.8C44 13.4 43.5 16 41.3 17.2C37.3 19.6 35.2 28.5 36.5 44.5Z"/><circle class="d" cx="39.3" cy="13.6" r="1.4"/>'
    + '<circle class="f" cx="15" cy="28" r="2.1"/><circle class="f" cx="49.5" cy="27" r="2.1"/>',
});
// the tile's frame: a rounded square from twelve o'clock, clockwise (the state ring runs along it: pathLength 100)
const FRAME = 'M32 2H50A12 12 0 0 1 62 14V50A12 12 0 0 1 50 62H14A12 12 0 0 1 2 50V14A12 12 0 0 1 14 2Z';
const CREAM = (a) => `stop-color:rgb(var(--lk-cream));stop-opacity:${a}`;
// one tile: the lit ground, the figure, the cooldown wipe, the bevel, the frame and its state ring
export const tileSvg = (id) => `<svg viewBox="0 0 64 64"><defs><radialGradient id="tpl-${id}" cx=".38" cy=".32" r=".78"><stop offset="0" style="${CREAM(0.22)}"/><stop offset=".55" style="${CREAM(0.05)}"/><stop offset="1" style="${CREAM(0)}"/></radialGradient>`
  + `<linearGradient id="tpv-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="${CREAM(0.55)}"/><stop offset=".45" style="${CREAM(0.06)}"/><stop offset="1" style="stop-color:#000;stop-opacity:.5"/></linearGradient>`
  + `<clipPath id="tpc-${id}"><rect x="3" y="3" width="58" height="58" rx="11"/></clipPath></defs>`
  + `<rect class="bg" x="3" y="3" width="58" height="58" rx="11"/><rect class="lt" x="3" y="3" width="58" height="58" rx="11" fill="url(#tpl-${id})"/>`
  + `<g class="gl">${ICONS[id] ?? ''}</g><path class="cd" clip-path="url(#tpc-${id})" d=""/><line class="ch" clip-path="url(#tpc-${id})" x1="32" y1="32" x2="32" y2="32"/>`
  + `<rect class="bv" x="5" y="5" width="54" height="54" rx="9" fill="none" stroke="url(#tpv-${id})" stroke-width="1.4"/>`
  + `<path class="base" d="${FRAME}"/><path class="rg" d="${FRAME}" pathLength="100" stroke-dasharray="100 100"/></svg>`;
const SONAR_SVG = (cone) => `<svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="58" stroke-width="2" style="fill:rgb(var(--lk-brand-navy) / .72);stroke:rgb(var(--lk-cream) / .7)"/>
<circle class="r0" cx="66" cy="66" r="${(54 * 50 / 160).toFixed(1)}" fill="none" stroke-width="1" style="stroke:rgb(var(--lk-cream) / .14)"/><circle class="r0" cx="66" cy="66" r="${(54 * 100 / 160).toFixed(1)}" fill="none" stroke-width="1" style="stroke:rgb(var(--lk-cream) / .14)"/>
<path class="cone" d="M66 66L${(66 + 54 * Math.sin(cone)).toFixed(1)} ${(66 - 54 * Math.cos(cone)).toFixed(1)}A54 54 0 0 0 ${(66 - 54 * Math.sin(cone)).toFixed(1)} ${(66 - 54 * Math.cos(cone)).toFixed(1)}Z" style="fill:rgb(var(--lk-cream) / .06)"/>
<g class="pr"><circle cx="66" cy="66" r="27"/><text class="l1" x="66" y="96"></text><text class="l2" x="66" y="123.5"></text></g><g class="pwg"></g><g class="rim"></g><g class="bls"></g><g class="pbs"></g><path class="me" d="M66 59l4 10h-8z" style="fill:rgb(var(--lk-cream) / .95)"/><g class="hm"><circle cx="66" cy="66" r="8"/><path d="M66 58.5L71 71L66 68L61 71Z"/><path class="ht" d="M66 8.5V16"/></g></svg><b class="sw">SONAR</b>`;

// the DOM: the sonar, the skills row, the legend, made in the play's layer; returns { paint(frame), place(layout), count(code), el }
export function mountHud({ root, doc = globalThis.document, skills = [], storage = null, onSlot = null, onSlotUp = null, keyHints = () => true, rpg = false, reduced = () => false } = {}) {
  if (!root || !doc) return null;
  if (!doc.getElementById('lk-thud-css')) { const st = doc.createElement('style'); st.id = 'lk-thud-css'; st.textContent = HUD_CSS; doc.head.appendChild(st); }
  const sonar = doc.createElement('div'); sonar.className = 'tp-sonar tp-hud'; sonar.setAttribute('aria-hidden', 'true'); sonar.innerHTML = SONAR_SVG(HUD.sonar.coneDeg * DEG);
  const row = doc.createElement('div'); row.className = 'tp-skills tp-hud';
  const circ = 100;   // the frame's pathLength
  const slot = (sk, n) => sk
    ? `<button type="button" class="tp-slot sk" data-skill="${sk.id}" aria-label="${sk.name}, key ${slotLabel(sk.slot ?? 1)}" tabindex="-1">${tileSvg(sk.id)}<i class="lv">Lv ${sk.level}</i><i class="kn">${slotLabel(sk.slot ?? 1)}</i><b class="nm">${sk.name.toUpperCase()}</b></button>`
    : `<i class="tp-slot empty" data-slot="${n}" aria-hidden="true"><i class="kn">${n}</i></i>`;
  // the RPG: every slot is a skill, locked until a point opens it (hud.ranks); the pips in place of the level tag
  const rpgSlot = (sk) => `<button type="button" class="tp-slot sk${sk.id === 'dash' ? '' : ' locked'}" data-skill="${sk.id}" data-rank="${sk.id === 'dash' ? 1 : 0}" aria-label="${sk.name}, key ${slotLabel(sk.slot)}" tabindex="-1">${tileSvg(sk.id)}<i class="pp">${pipsOf(4).map(() => '<b></b>').join('')}</i><i class="tr"></i><i class="kn">${slotLabel(sk.slot)}</i><b class="nm">${sk.short}</b></button>`;
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
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { b.setPointerCapture?.(e.pointerId); } catch { /* a synthetic or gone pointer: the press still counts */ } onSlot?.(b.dataset.skill); });
    // the press lifted (onSlotUp: the RPG's Breach is held on its slot and launches on the release)
    for (const t of ['pointerup', 'pointercancel']) b.addEventListener(t, (e) => { e.stopPropagation(); onSlotUp?.(b.dataset.skill); });
  }
  let counts = {}; try { counts = JSON.parse(storage?.getItem(HUD.storeKey) ?? '{}') ?? {}; } catch { counts = {}; }
  let lastBlips = 0, lay = null, shown = false, pingAt = null, pingRange = null;
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
    // ping (the RPG's Sonar, while its marks last): { rangeM, marks: [{ a }] (a: rad clockwise from her heading), at, until (s, her
    // clock), has(id) (the boat is marked) }: the dial rescales to its range and draws the marked boats (pingBlips)
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
        const cd = s.querySelector('.cd'), wd = look.wipe ? wipePath(look.wipe) : ''; if (cd && cd.getAttribute('d') !== wd) cd.setAttribute('d', wd);   // the cooldown's wipe
        const ch = s.querySelector('.ch'), hd = look.wipe ? wipeHand(look.wipe) : null; if (ch) { ch.setAttribute('x2', hd ? hd[0] : 32); ch.setAttribute('y2', hd ? hd[1] : 32); }   // and its hand
      }
      const lv = legendLevels(counts, lines);
      for (const k of legend.querySelectorAll('.kl')) k.classList.toggle('learned', lv.find((l) => l.id === k.dataset.id)?.level === 'learned');
      api.legendOn();
      sonar.toggleAttribute('data-hidden', !!hidden); const sw = sonar.querySelector('.sw'); const word = hidden ? 'HIDDEN' : ping ? `${Math.round(ping.rangeM)} M` : 'SONAR'; if (sw.textContent !== word) sw.textContent = word;
      if (t - lastBlips < 1 / HUD.sonar.hz && t >= lastBlips) return;
      lastBlips = t;
      const R = 54, g = sonar.querySelector('.bls'), pinged = !!ping && typeof ping.has === 'function';
      sonar.toggleAttribute('data-ping', pinged);
      g.innerHTML = pinged ? '' : sonarBlips(her, boats, { targetId, lockId, seen }).map((b) => {
        const x = 66 + b.u * R, y = 66 - b.v * R, r = (b.rot / DEG).toFixed(0), tg = b.target ? ' data-t=""' : '';
        const shape = b.kind === 'kayak' || b.kind === 'sup' ? `<circle class="bl o"${tg} cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`
          : b.kind === 'glass' ? `<rect class="bl"${tg} x="-2" y="-5" width="4" height="10" rx="2" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r})"/>`
          : `<path class="bl${b.kind === 'halcyon' ? ' o' : ''}"${tg} d="M0 -6L4 5H-4Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r})"/>`;
        const tick = b.seen ? `<path d="M0 7v3" stroke-width="1.2" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r})" style="stroke:rgb(var(--lk-cream) / .8)"/>` : '';
        const ring = b.lock ? `<circle class="lk" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"/>` : '';
        return `<g data-id="${b.id}">${shape}${tick}${ring}</g>`;
      }).join('');
      sonar.dataset.blips = String(g.childElementCount);
      // the ping on the dial: the rings and their labels at its range, the wave once per ping, a blip per marked boat (type-coded,
      // lit as the wave reaches it, fading with the marks); a marked boat past the range a tick on the rim
      const pb = sonar.querySelector('.pbs'), rim = sonar.querySelector('.rim');
      let rimTicks = '';
      if (pinged) {
        if (pingRange !== ping.rangeM) { pingRange = ping.rangeM; sonar.querySelector('.pr .l1').textContent = String(Math.round(ping.rangeM / 2)); sonar.querySelector('.pr .l2').textContent = `${Math.round(ping.rangeM)} m`; }
        let rm = false; try { rm = !!reduced(); } catch { /* */ }
        if (pingAt !== ping.at) { pingAt = ping.at; sonar.querySelector('.pwg').innerHTML = rm ? '' : '<circle class="pw" cx="66" cy="66" r="54"/><circle class="pw e" cx="66" cy="66" r="54"/>'; }
        const P = pingBlips(her, boats, ping, t, { reduced: rm });
        pb.innerHTML = P.map((b) => (b.out
          ? `<line class="rm" data-id="${b.id}" x1="${(66 + (b.x - 66) * 55 / R).toFixed(1)}" y1="${(66 + (b.y - 66) * 55 / R).toFixed(1)}" x2="${(66 + (b.x - 66) * 62 / R).toFixed(1)}" y2="${(66 + (b.y - 66) * 62 / R).toFixed(1)}" style="opacity:${b.on ? b.op : 0}"/>`
          : `<path class="pb${b.shape === 'otri' ? ' o' : ''}" data-id="${b.id}" data-shape="${b.shape}" data-tx="${b.tx}" data-ty="${b.ty}" d="${blipPath(b.shape)}" transform="translate(${b.x} ${b.y}) rotate(${b.rot})" style="opacity:${b.on ? b.op : 0}"/>`)).join('');
        sonar.dataset.pinged = String(P.filter((b) => !b.out).length);
        sonar.dataset.lit = String(P.filter((b) => b.on).length);
        rimTicks = String(P.filter((b) => b.out).length);
      } else {
        if (pingAt != null) { pingAt = null; pingRange = null; sonar.querySelector('.pwg').innerHTML = ''; }
        if (pb.childElementCount) pb.innerHTML = '';
        sonar.dataset.pinged = '0'; sonar.dataset.lit = '0';
        // an older caller's ping (no has): a tick at each marked boat's bearing
        const marks = ping?.marks ?? [];
        rim.innerHTML = marks.map((m) => { const sx = Math.sin(m.a), cy = Math.cos(m.a); return `<line class="rm" x1="${(66 + 55 * sx).toFixed(1)}" y1="${(66 - 55 * cy).toFixed(1)}" x2="${(66 + 62 * sx).toFixed(1)}" y2="${(66 - 62 * cy).toFixed(1)}"/>`; }).join('');
        rimTicks = String(marks.length);
      }
      if (pinged && rim.childElementCount) rim.innerHTML = '';
      sonar.dataset.rim = rimTicks;
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
