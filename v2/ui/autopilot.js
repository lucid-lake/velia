// The pilot pad in the cockpit (owner, 2026-11-16): in the old rudder readout's spot under the wheel's hub, one ROUND assist key and AUTO
// as a HALF-MOON on its right side, wrapping it (room left for a second half-moon on the left). Desktop and tablet (the 3D cockpit,
// station.js apHud); a phone has its flat controls (ui/flat.js: Auto the left corner, the assist the right).
//   AUTO     no target: the pilot holds the heading she has now (B.holdCourse, as the phone's Auto). A chart or double-tap target set
//            (the beacon's, main.js navTarget): she sails there, routing and tacking as Cruise's autopilot does (sim/autoNav.js: v1's
//            navigator and skipper through B.drive); at the mark she holds the heading she has; a target off the navigator's chart
//            (Cruise's, the bay) or with no safe way: hold, and its line on the hint row, once. A target set after AUTO, or while the
//            navigator still loads ("Plotting a course to the mark."), is taken up when it can be; a new target re-targets live. A hand on the helm (the wheel, the steering
//            keys) gives the helm back; AUTO again lets go. Its inner ring lit amber while it is on
//   the key  the assist (ui/assist.js): TACK, GYBE, FREE or REFLOAT by the boat's state, dim where a press does nothing; its inner ring
//            amber only while the manoeuvre runs; with AUTO holding, the pilot holds the new heading after it; with AUTO to a target,
//            the key hands the course back to HOLD first (the navigator tacks on its own). Space presses it too (sail.js)
// Hit areas are the drawn shapes exactly, each at least 44 px (the key's diameter, the half-moon's thickness at its middle). Pure pieces
// (node tests: v2/tests/autopilot.test.mjs, assist.test.mjs): createPilot (the rules), hudState, padGeometry, inPad. createHelmHud
// fills station.js's apHud.

import { PILOT_LABEL } from './pilotLabel.js';   // the button's one name on screen (NAV; owner 2026-11-17)

const DEG = 180 / Math.PI;
const norm360 = (d) => ((Math.round(d) % 360) + 360) % 360;
export const deg3 = (rad) => `${String(norm360(rad * DEG)).padStart(3, '0')}°`;

// the rules. B: the boat (holdCourse, setPilot, holdHeading, handInput, phys); target(): the beacon's target ({ x, z, key, name }) or
// null; nav(): sim/autoNav.js's (or a promise of it; null until loaded); tack: the assist (ui/assist.js createAssist: { press, active, offer, kind })
export const PILOT_SAY = { plotting: 'Plotting a course to the mark.', beat: 'Beating up — tacking at the layline' };
// tip(id, text): a once-only tip (sail.js keeps it once per device): 'beat' at AUTO's first tack toward an upwind mark
export function createPilot({ B, target = () => null, nav = () => null, tack = null, say = () => {}, tip = () => {} } = {}) {
  let tipped = false;
  let mode = 'off', held = null, assistWas = null, navNow = null, navAsk = null, toKey = null, tacking = false, refused = null, tried = null;
  const said = new Set();   // the lines said once per target (a refusal, the plotting line)
  const sayOnce = (k, text) => { if (!text || said.has(`${k}|${text}`)) return; said.add(`${k}|${text}`); say(text); };
  const keyOf = (tg) => tg.key ?? `${Math.round(tg.x)}|${Math.round(tg.z)}`;
  const hands = () => { const h = B?.handInput ?? {}; return !!h.steer || h.helm != null; };
  // the navigator loads at the first AUTO with a target in force (its chunk, the lake and the whole-lake chart, after the terrain is
  // whole), once; "plotting" is said while it comes (owner 2026-11-17: the plan chart on first use; it used to
  // load as soon as a target showed, and sail.js asked at once)
  const navReady = (force = false) => { if (!navNow && !navAsk && (force || target())) { navAsk = Promise.resolve(nav()).then((v) => { navNow = v ?? null; if (!navNow) navAsk = null; }); } return navNow; };
  function hold() { if (assistWas == null) assistWas = !!B.assists?.pilot; held = B.holdCourse(); mode = 'hold'; toKey = null; }
  function off() {
    if (mode === 'to') navNow?.release();
    if (mode !== 'off' && assistWas != null) { const h = B.holdHeading; B.setPilot(assistWas); if (assistWas && h != null) B.holdCourse(h); }
    mode = 'off'; held = null; assistWas = null; toKey = null; tried = null;
  }
  function goTo(tg) {
    const n = navReady(); if (!n) return false;
    if (assistWas == null) assistWas = !!B.assists?.pilot;
    const r = n.engage(tg); if (!r.ok) { refused = r.say ?? 'refused'; return false; }
    refused = null;
    mode = 'to'; held = null; toKey = keyOf(tg);
    return true;
  }
  // AUTO holding with a target in force: sail to it once the navigator is in (a target set before or after AUTO, the navigator still
  // loading at the press); a target it cannot take (off its chart, no safe way) is tried once and its line said once
  function seek() {
    const tg = target(); if (!tg) return false;
    const k = keyOf(tg); if (k === tried) return false;
    if (!navReady()) { sayOnce(k, PILOT_SAY.plotting); return false; }
    tried = k;
    if (goTo(tg)) return true;
    sayOnce(k, refused);
    return false;
  }
  const P = {
    get mode() { return mode; }, get held() { return held; }, get engaged() { return mode !== 'off'; },
    get dest() { return mode === 'to' ? navNow?.dest ?? null : null; }, distance: () => (mode === 'to' ? navNow?.distance() ?? null : null),
    get handSteer() { return hands(); },
    // AUTO's own tack or gybe under way toward a mark ('tack' | 'gybe' | null): the assist key shows it lit (ui/assist.js pilotTurn)
    get turning() { return mode === 'to' ? navNow?.turning ?? null : null; },
    get state() { return { mode, target: target(), navLoaded: !!navNow, navAsked: !!navAsk, toKey, refused, tried, said: [...said] }; },   // for the page tests and tools
    get nav() { return navNow; },
    load() { navReady(true); return navAsk ?? Promise.resolve(navNow); },   // the navigator now, target or not
    // AUTO: engage (to the target when one is set and reachable, else hold, and take the target up as soon as it can) or let go
    auto() {
      if (!B) return mode;
      if (mode !== 'off') { off(); return mode; }
      tried = null;
      if (!seek()) hold();
      return mode;
    },
    // the assist key (TACK, GYBE, FREE, REFLOAT); to a target, the course back to HOLD first (the pilot holds after the turn, the target stays declined until
    // it changes or AUTO is pressed again)
    tack() {
      if (!tack?.offer && !tack?.active) return false;   // a reach, stopped, anchored or the sails down: nothing to do (the key is dim)
      if (mode === 'to') { tried = toKey; navNow?.release(); hold(); }
      const ok = !!tack?.press?.();
      if (ok && mode === 'hold') tacking = true;
      return ok;
    },
    // each frame (after the boat stepped)
    update() {
      if (!B) return mode;
      if (mode === 'hold') {
        if (tacking || tack?.active) { tacking = !!tack?.active; if (!tacking) held = B.holdCourse(); return mode; }   // the turn ran: hold her new heading
        if (hands()) { if (assistWas === false) B.assists.pilot = false; mode = 'off'; held = null; assistWas = null; tried = null; return mode; }   // a hand on the helm: AUTO lets go; Setup's pilot assist as it was
        if (seek()) return mode;   // a target to sail to
        if (B.holdHeading == null) B.holdCourse(held);   // the hands let the course go for a moment (a sheet let fly, the anchor): AUTO keeps it
        else if (B.holdHeading !== held) held = B.holdHeading;   // the shallow-water assist bore away: AUTO holds the course it left her on
      } else if (mode === 'to') {
        const tg = target();
        if (hands()) { off(); return mode; }
        if (!navNow?.on) { tried = toKey; hold(); return mode; }   // at the mark: hold the heading she has (that target is done)
        if (!tg) { navNow.release(); hold(); return mode; }   // the target cleared: hold
        const k = keyOf(tg);
        if (k !== toKey) { navNow.release(); tried = null; hold(); seek(); return mode; }   // a new target: sail there instead (or hold, and say why)
        if (!tipped && navNow.turning === 'tack' && navNow.beating !== false) { tipped = true; tip('beat', PILOT_SAY.beat); }   // the first tack of a beat: one line, once
      }
      return mode;
    },
    release: off,
  };
  return P;
}

// The pilot pad's state (pure): AUTO's half-moon lit while the pilot is on; the round key's word, lit (a manoeuvre runs), dim (a press
// does nothing) and cue (the soft brighten, 0 … 1) from the assist (ui/assist.js)
export function hudState({ mode = 'off', assist = null } = {}) {
  return { auto: mode !== 'off', word: assist?.word ?? 'TACK', lit: !!assist?.lit, dim: assist ? !!assist.dim : true, cue: assist?.cue ?? 0 };
}

export const HUD_HIT = 44;   // px: the hit floor (the round key's hit circle; the half-moon's hit sector is at least this tall)
// The pilot pad (owner, 2026-11-16): the ROUND assist key, the hero, centred on the wheel's hub (kept inside the window), and AUTO as a
// slim crescent hugging its right side; the left side free for a later crescent (moonPath(-1), inPad's 'left'). Sized from the wheel's
// rim radius R (css px; PAD.rimRef at 1280 × 720), so it sits inside the hub area and covers none of the rim ("the buttons are too big
// and cover the wheel"). The key: radius r. The crescent: a hairline gap, then the band between the key's ring (radius ri) and an outer
// circle (radius ro, its centre dx out to its side) that meets the ring at ±span/2: `moon` thick at its middle (35–40 % of the key's
// diameter). Hit areas: the key a circle of at least HUD_HIT across; the crescent an annular sector from the key's hit edge out to
// ri + hitT over its span (at least HUD_HIT tall), clear of the rim; outside them the wheel takes the drag.
export const PAD = Object.freeze({ rimRef: 89.4, r: 22, gap: 1, moonK: 0.375, spanDeg: 130, hitT: 24 });
export function padGeometry(R = PAD.rimRef) {
  const k = R / PAD.rimRef;
  const r = Math.max(14, Math.round(PAD.r * k)), gap = Math.max(1, Math.round(PAD.gap * k)), moon = Math.round(PAD.moonK * 2 * r);
  const ri = r + gap, D = ri + moon, half = PAD.spanDeg / 2 * Math.PI / 180;
  const xt = ri * Math.cos(half), yt = ri * Math.sin(half), dx = (D * D - ri * ri) / (2 * (D - xt)), ro = D - dx;   // the outer circle through both tips
  const tall = (HUD_HIT / 2) / Math.sin(half) + 1;   // the sector's outer radius that makes it HUD_HIT tall
  const hitK = Math.max(r, HUD_HIT / 2), hitO = Math.max(tall, Math.min(ri + Math.round(PAD.hitT * Math.max(1, k)), Math.floor(0.58 * R)));   // never past 0.58 R: the rim's drag wins
  return { k, R, r, gap, moon, ro, ri, dx, xt, yt, half, hitK, hitO, spanDeg: PAD.spanDeg, ext: { w: D, h: Math.max(r, ro) } };
}
// a crescent inset by d from its outline (the band between radii ri + d and an outer circle d smaller, about the same centres; its tips
// where the two meet): the steel edge, the cap and the on-ring follow the crescent's own arcs and end caps
export function moonInset(G, d) {
  const ri = G.ri + d, ro = G.ro - d, xt = (ri * ri - ro * ro + G.dx * G.dx) / (2 * G.dx), yt = Math.sqrt(Math.max(0, ri * ri - xt * xt));
  return { ...G, ri, ro, xt, yt };
}
// a crescent's outline (right side) as points: the outer arc about (dx, 0) from the top tip round the right to the bottom tip, then
// the inner arc about the key's centre back up (both always the right-hand arcs: no SVG arc flags to get wrong when an inset's tips
// pass the outer circle's centre)
export function moonOutline(G, n = 40) {
  const pts = [], at = Math.atan2(-G.yt, G.xt - G.dx), ab = Math.atan2(G.yt, G.xt - G.dx), bt = Math.atan2(G.yt, G.xt);
  for (let i = 0; i <= n; i++) { const a = at + (ab - at) * i / n; pts.push([G.dx + G.ro * Math.cos(a), G.ro * Math.sin(a)]); }
  for (let i = 1; i < n; i++) { const a = bt - 2 * bt * i / n; pts.push([G.ri * Math.cos(a), G.ri * Math.sin(a)]); }
  return pts;
}
// a crescent's outline (side +1 right, −1 left) as an SVG path, offset by (ox, oy)
function moonPath(G, side = 1, ox = 0, oy = 0) {
  const f = (v) => +v.toFixed(2);
  return moonOutline(G).map(([x, y], i) => `${i ? 'L' : 'M'}${f(side * x + ox)} ${f(y + oy)}`).join('') + 'Z';
}
const circlePath = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
// the crescent's hit sector (side +1 right) as an SVG path, offset by (ox, oy)
function sectorPath(G, side = 1, ox = 0, oy = 0) {
  const f = (v) => +v.toFixed(2), a0 = Math.max(G.ri, G.hitK), a1 = G.hitO, c = Math.cos(G.half), sn = Math.sin(G.half), sw = side > 0 ? 1 : 0;
  const P = (rr, sy) => `${f(side * rr * c + ox)} ${f(sy * rr * sn + oy)}`;
  return `M${P(a0, -1)}L${P(a1, -1)}A${f(a1)} ${f(a1)} 0 0 ${sw} ${P(a1, 1)}L${P(a0, 1)}A${f(a0)} ${f(a0)} 0 0 ${1 - sw} ${P(a0, -1)}Z`;
}
// the drawn shapes (pure): 'key' | 'right' | null (what the eye sees; the rim's cover is measured on these)
export function inDrawn(G, x, y) {
  const d = Math.hypot(x, y);
  if (d <= G.r) return 'key';
  if (d < G.ri) return null;
  if (x > 0 && Math.hypot(x - G.dx, y) <= G.ro) return 'right';
  return null;
}
// which target a point (css px about the key's centre) is on (pure): 'key' | 'right' | 'left' | null; the hit areas
export function inPad(G, x, y) {
  const d = Math.hypot(x, y);
  if (d <= G.hitK) return 'key';
  if (d < Math.max(G.ri, G.hitK) || d > G.hitO) return null;
  const a = Math.atan2(Math.abs(y), Math.abs(x));
  if (a > G.half) return null;
  return x > 0 ? 'right' : 'left';
}
// the finish (owner, 2026-11-16: "top-touch design", the pilot pod's refined look-A keys brought back): each key a turned steel bezel
// with the dials' bezel profile (fine concentric turning, lit from above), a slightly domed satin cap, the word engraved (a dark cut
// with a light lower edge), an inner ring that lights amber while on; set in a graphite case with machined edges and a soft contact
// shadow. Vector (SVG), so every edge is crisp at 1× and 2×. Dim: the word's ink at 40 %. The cue: one soft brighten of the cap.
const CSS = `
.lk-helm .rd.ap{z-index:3;pointer-events:none;padding:0;border-radius:0;background:none;transform:none;width:0;height:0;display:block;font-size:inherit;overflow:visible}
.lk-helm .rd.ap .pp{position:absolute;left:0;top:0;--cue:0}
.lk-helm .rd.ap svg.pd{position:absolute;overflow:visible;pointer-events:none}
.lk-helm .rd.ap button{all:unset;position:absolute;box-sizing:border-box;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent;touch-action:manipulation;
  color:transparent;font-size:1px;overflow:hidden}
.lk-helm .rd.ap button.dim{cursor:default}
.lk-helm .rd.ap:not(.in) button{pointer-events:none}
.lk-helm .rd.ap button:focus-visible{outline:none}
.lk-helm .rd.ap .fx{opacity:0;transition:opacity .15s linear}
.lk-helm .rd.ap .pp.kf .fx.k,.lk-helm .rd.ap .pp.af .fx.a{opacity:1}
.lk-helm .rd.ap .lab{font:600 var(--pd-fs,10px)/1 var(--lk-ui);letter-spacing:var(--pd-tr,.06em);text-anchor:middle;dominant-baseline:central;text-transform:uppercase}
.lk-helm .rd.ap .lab.sm{font-size:var(--pd-fs2,8px);letter-spacing:.14em}
.lk-helm .rd.ap .lab .cut{fill:rgb(22 26 38 / .86)}
.lk-helm .rd.ap .lab .lip{fill:rgb(255 255 255 / .55)}
.lk-helm .rd.ap .dim .lab{opacity:.4}
.lk-helm .rd.ap .ring{fill:none;stroke:rgb(var(--lk-amber));opacity:0;transition:opacity .15s linear;filter:drop-shadow(0 0 2.5px rgb(var(--lk-amber) / .8))}
.lk-helm .rd.ap .on .ring{opacity:1}
.lk-helm .rd.ap .on .lab .cut{fill:rgb(150 92 10 / .95)}
.lk-helm .rd.ap .glow{opacity:calc(var(--cue) * .55);mix-blend-mode:screen}
.lk-helm .rd.ap .hov{opacity:0;transition:opacity .15s linear}
/* the mark set and NAV off: NAV's cap brightens once, slow and calm (the key's cue, in one beat), then rests */
.lk-helm .rd.ap .mglow{opacity:0;mix-blend-mode:screen}
.lk-helm .rd.ap .pp.pulse .mglow{animation:lk-nav-pulse 1.8s cubic-bezier(.4,0,.6,1) 1 both}
.lk-helm .rd.ap .pp.pulse g.moon{animation:lk-nav-halo 1.8s cubic-bezier(.4,0,.6,1) 1 both}
@keyframes lk-nav-pulse{0%{opacity:0}35%{opacity:.85}100%{opacity:0}}
@keyframes lk-nav-halo{0%{filter:none}35%{filter:brightness(1.18) drop-shadow(0 0 5px rgb(255 255 255 / .95))}100%{filter:none}}
@media (prefers-reduced-motion:reduce){.lk-helm .rd.ap .pp.pulse .mglow{animation:none;opacity:.5}.lk-helm .rd.ap .pp.pulse g.moon{animation:none}}
.lk-helm .rd.ap .pp.kh .key .hov,.lk-helm .rd.ap .pp.ah .moon .hov{opacity:.12}
:root[data-lk-theme=night] .lk-helm .rd.ap .lab .cut{fill:rgb(255 150 130 / .9)}
:root[data-lk-theme=night] .lk-helm .rd.ap .lab .lip{fill:rgb(0 0 0 / .35)}
:root[data-lk-theme=night] .lk-helm .rd.ap .ring{stroke:rgb(255 110 90);filter:drop-shadow(0 0 2.5px rgb(255 90 70 / .8))}
:root[data-lk-theme=night] .lk-helm .rd.ap svg.pd{filter:brightness(.55) saturate(.6)}
`;
// the finish's layers (pure, css px): the key's case rim cs and steel bezel b, its cap's radius and its on-ring's radius; the crescent's
// steel edge mb, its cap's inset and its on-ring's inset from its outline (the ring 1.25 px inside the cap's edge, as the key's)
export function padLayers(G) {
  const cs = Math.max(1, Math.round(1.5 * G.k)), b = Math.max(1.5, +(2.25 * G.k).toFixed(2)), cap = G.r - cs - b, mb = Math.max(1, +(1.25 * G.k).toFixed(2));
  const mCap = cs * 0.6 + mb;
  return { cs, b, cap, keyRing: cap - 1.75, ringW: 1.25, mb, mSteel: cs * 0.6 + mb / 2, mCap, mRing: mCap + 1.25 };
}
// the drawing (one SVG about the key's centre, every piece in css px)
function padSvg(G, id) {
  const Ly = padLayers(G), { r, ri, ro, dx } = G, { cs, b, cap } = Ly, W = ri + G.moon + 6, Hh = Math.max(r, ro) + 8;
  const g = (n) => `${id}-${n}`;
  // a crescent inset by d from its outline (the band between radii ri + d and an outer circle d smaller)
  const inset = (d) => moonInset(G, d);
  const rb = r - cs - b / 2;   // the steel bezel's centre line
  const turn = Array.from({ length: 4 }, (_, i) => `<circle r="${(rb - b / 2 + 0.35 + i * (b - 0.7) / 3).toFixed(2)}" fill="none" stroke="rgb(${i % 2 ? '255 255 255 / .16' : '40 46 56 / .14'})" stroke-width=".4"/>`).join('');
  const mb = Ly.mb;   // the crescent's thinner steel edge
  const moon = moonPath(G, 1), mSteel = moonPath(inset(Ly.mSteel), 1), mCap = moonPath(inset(Ly.mCap), 1), mRing = moonPath(inset(Ly.mRing), 1);
  // AUTO along the crescent's middle line, top to bottom (an arc at the band's centre radius)
  const rm = ri + G.moon / 2 - 0.5, am = G.half * 0.92, arc = `M${(rm * Math.cos(am)).toFixed(2)} ${(-rm * Math.sin(am)).toFixed(2)}A${rm.toFixed(2)} ${rm.toFixed(2)} 0 0 1 ${(rm * Math.cos(am)).toFixed(2)} ${(rm * Math.sin(am)).toFixed(2)}`;
  const W2 = W + r + 8;
  return `<svg class="pd" viewBox="${-r - 8} ${-Hh} ${W2} ${2 * Hh}" style="left:${-r - 8}px;top:${-Hh}px;width:${W2}px;height:${2 * Hh}px" aria-hidden="true">
<defs>
 <linearGradient id="${g('steel')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f9fb"/><stop offset=".38" stop-color="#bcc3cb"/><stop offset=".5" stop-color="#8d959e"/><stop offset=".62" stop-color="#b4bbc3"/><stop offset="1" stop-color="#e3e7eb"/></linearGradient>
 <radialGradient id="${g('cap')}" cx=".42" cy=".3" r=".8"><stop offset="0" stop-color="#eef0f2"/><stop offset=".6" stop-color="#cdd2d7"/><stop offset="1" stop-color="#a7aeb5"/></radialGradient>
 <radialGradient id="${g('capM')}" gradientUnits="userSpaceOnUse" cx="${(ri + G.moon * 0.4).toFixed(1)}" cy="${(-ro * 0.5).toFixed(1)}" r="${(ro * 1.3).toFixed(1)}"><stop offset="0" stop-color="#eef0f2"/><stop offset=".6" stop-color="#cdd2d7"/><stop offset="1" stop-color="#a3aab1"/></radialGradient>
 <linearGradient id="${g('case')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#454b55"/><stop offset=".5" stop-color="#2b2f37"/><stop offset="1" stop-color="#1a1d23"/></linearGradient>
 <linearGradient id="${g('edge')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(255 255 255 / .55)"/><stop offset=".45" stop-color="rgb(255 255 255 / .08)"/><stop offset="1" stop-color="rgb(0 0 0 / .55)"/></linearGradient>
 <linearGradient id="${g('dome')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(255 255 255 / .28)"/><stop offset=".5" stop-color="rgb(255 255 255 / 0)"/><stop offset="1" stop-color="rgb(0 0 0 / .1)"/></linearGradient>
 <filter id="${g('sh')}" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="${(1.8 * G.k).toFixed(2)}"/></filter>
 <path id="${g('arc')}" d="${arc}"/>
</defs>
<g class="shadow" filter="url(#${g('sh')})" opacity=".6" transform="translate(0 ${(2 * G.k).toFixed(1)})"><path d="${circlePath(0, 0, r)}" fill="#000"/><path d="${moon}" fill="#000"/></g>
<g class="key">
 <circle r="${r}" fill="url(#${g('case')})"/>
 <circle r="${r - 0.5}" fill="none" stroke="url(#${g('edge')})" stroke-width="1"/>
 <circle r="${rb}" fill="none" stroke="url(#${g('steel')})" stroke-width="${b}"/>
 ${turn}
 <circle r="${cap + 0.25}" fill="none" stroke="rgb(20 24 30 / .5)" stroke-width=".75"/>
 <circle r="${cap}" fill="url(#${g('cap')})"/>
 <circle r="${cap}" fill="url(#${g('dome')})"/>
 <circle class="glow" r="${cap}" fill="rgb(255 255 255)"/>
 <circle class="hov" r="${cap}" fill="rgb(255 255 255)"/>
 <circle class="ring" r="${Ly.keyRing.toFixed(2)}" stroke-width="${Ly.ringW}"/>
 <text class="lab"><tspan class="lip" x="0" y=".6"></tspan></text><text class="lab"><tspan class="cut" x="0" y="0"></tspan></text>
</g>
<g class="moon">
 <path d="${moon}" fill="url(#${g('case')})"/>
 <path d="${moon}" fill="none" stroke="url(#${g('edge')})" stroke-width=".75"/>
 <path d="${mSteel}" fill="none" stroke="url(#${g('steel')})" stroke-width="${mb}" stroke-linejoin="round"/>
 <path d="${mCap}" fill="url(#${g('capM')})" stroke="rgb(20 24 30 / .5)" stroke-width=".6" stroke-linejoin="round"/>
 <path d="${mCap}" fill="url(#${g('dome')})"/>
 <path class="hov" d="${mCap}" fill="rgb(255 255 255)"/>
 <path class="mglow" d="${mCap}" fill="rgb(255 255 255)"/>
 <path class="ring" d="${mRing}" stroke-width="${Ly.ringW}" stroke-linejoin="round"/>
 <text class="lab sm" dy=".6"><textPath class="lip" href="#${g('arc')}" startOffset="50%">${PILOT_LABEL}</textPath></text><text class="lab sm"><textPath class="cut" href="#${g('arc')}" startOffset="50%">${PILOT_LABEL}</textPath></text>
</g>
</svg>`;
}
// el: station.js's apHud (placed and shown by the station: the readout's spot, while the cockpit is up; this keeps the pad inside the
// window); pilot: createPilot's; assist: ui/assist.js's createAssist
let padId = 0;
export function createHelmHud({ el, pilot, assist = null, onUse = () => {}, doc = document, win = globalThis }) {
  if (!doc.getElementById('lk-aphud-css')) { const st = doc.createElement('style'); st.id = 'lk-aphud-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const id = `lkpd${padId++}`;
  let G = null, pp = null, btn = {}, word = null, cutK = null, lipK = null, gkey = null, gmoon = null;
  let key = '', st = hudState(), cueAt = -1, dyAt = null;
  // the wheel's rim radius (css px): the station's (dataset.rim, from the rig), else the 1280 × 720 reference
  const rimNow = () => { const v = parseFloat(el.dataset?.rim); return Number.isFinite(v) && v > 20 ? Math.round(v * 2) / 2 : PAD.rimRef; };
  // the word's size: the longest the key shows (FLOAT: REFLOAT's short form on this small key) fits the cap with a margin, one size for
  // every word (measured once the bar's font is in); AUTO a size smaller along the crescent
  const fitWord = () => {
    const cap = G.r - Math.max(1, Math.round(1.5 * G.k)) - Math.max(1.5, 2.25 * G.k), base = 10.5 * Math.max(1, G.k);
    pp.style.setProperty('--pd-fs', `${base}px`);
    const was = cutK.textContent; cutK.textContent = 'FLOAT';
    let len = 0; try { len = cutK.getComputedTextLength?.() ?? 0; } catch { len = 0; }
    cutK.textContent = was;
    const fs = len > 0 ? Math.min(base, base * (2 * cap - 5) / len) : Math.min(base, (2 * cap - 5) / (5 * 0.66));
    pp.style.setProperty('--pd-fs', `${fs.toFixed(2)}px`);
    pp.style.setProperty('--pd-fs2', `${Math.max(7, Math.min(fs * 0.82, G.moon * 0.62)).toFixed(2)}px`);
  };
  const build = () => {
    G = padGeometry(rimNow());
    el.innerHTML = `<div class="pp">${padSvg(G, id)}<button type="button" data-id="key" class="key">TACK</button><button type="button" data-id="auto" class="moon" aria-label="${PILOT_LABEL}: autopilot">${PILOT_LABEL}</button></div>`;
    pp = el.querySelector('.pp'); gkey = el.querySelector('g.key'); gmoon = el.querySelector('g.moon');
    cutK = gkey.querySelector('.cut'); lipK = gkey.querySelector('.lip');
    btn = { key: el.querySelector('button[data-id=key]'), auto: el.querySelector('button[data-id=auto]') };
    // the hit areas (a clip-path on each button's own box): the key's circle (≥ 44 px), the crescent's sector; nothing else
    const hk = G.hitK, kb = { x: -hk, y: -hk, w: 2 * hk, h: 2 * hk }, hs = G.hitO * Math.sin(G.half), a0 = Math.max(G.ri, G.hitK) * Math.cos(G.half);
    const mb = { x: Math.floor(a0), y: -Math.ceil(hs), w: Math.ceil(G.hitO - Math.floor(a0)), h: 2 * Math.ceil(hs) };
    const place = (b, bx, path) => Object.assign(b.style, { left: `${bx.x}px`, top: `${bx.y}px`, width: `${bx.w}px`, height: `${bx.h}px`, clipPath: `path('${path}')` });
    place(btn.key, kb, circlePath(hk, hk, hk));
    place(btn.auto, mb, sectorPath(G, 1, -mb.x, -mb.y));
    // the word's size: the longest (REFLOAT) fits the cap with a margin, one size for every word
    fitWord(); doc.fonts?.ready?.then(fitWord).catch(() => {});
    for (const [k, b] of Object.entries(btn)) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('pointerenter', () => pp.classList.add(k === 'key' ? 'kh' : 'ah'));
      b.addEventListener('pointerleave', () => pp.classList.remove(k === 'key' ? 'kh' : 'ah'));
      b.addEventListener('focus', () => pp.classList.add(k === 'key' ? 'kf' : 'af')); b.addEventListener('blur', () => pp.classList.remove(k === 'key' ? 'kf' : 'af'));
      b.addEventListener('click', (e) => { e.stopPropagation(); b.blur(); if (k === 'auto') pilot.auto(); else pilot.tack(); onUse(); dispatchEvent(new Event('lk-click')); });
    }
    word = null; key = ''; cueAt = -1; dyAt = null;
  };
  build();
  let rAt = G.R;
  function update() {
    pilot.update();
    st = hudState({ mode: pilot.mode, assist });
    { const R = rimNow(); if (Math.abs(R - rAt) > 0.5) { rAt = R; build(); } }   // the wheel's size changed (a resize): redraw to it
    if (st.word !== word) { word = st.word; const w = word === 'REFLOAT' ? 'FLOAT' : word; cutK.textContent = w; lipK.textContent = w; btn.key.textContent = word; }
    const k = `${st.auto}|${st.lit}|${st.dim}|${st.word}`;
    if (k !== key) {
      key = k;
      gmoon.classList.toggle('on', st.auto); btn.auto.setAttribute('aria-pressed', String(st.auto));
      gkey.classList.toggle('on', st.lit); gkey.classList.toggle('dim', st.dim); btn.key.classList.toggle('dim', st.dim); btn.key.setAttribute('aria-disabled', String(st.dim));
      const name = { TACK: 'Tack', GYBE: 'Gybe', FREE: 'Free: get out of irons', REFLOAT: 'Refloat: kedge off' }[st.word] ?? st.word;
      btn.key.setAttribute('aria-label', st.word === 'TACK' || st.word === 'GYBE' ? `${name} (Space)` : name);
    }
    const cue = Math.round(st.cue * 50) / 50;
    if (cue !== cueAt) { cueAt = cue; pp.style.setProperty('--cue', String(cue)); }
    // inside the window: the key on the hub's centre (the station's spot), lifted just enough that the drawn pad clears the bottom by 4 px
    const top = parseFloat(el.style.top) || 0, dy = Math.min(0, Math.round((win.innerHeight ?? 720) - 4 - G.ext.h - top));
    if (dy !== dyAt) { dyAt = dy; pp.style.transform = dy ? `translateY(${dy}px)` : ''; }
    return st;
  }
  // NAV's one calm pulse: the mark was set and NAV is off; once, never a loop (the class stays until the next pulse restarts it)
  let pulseN = 0, pulseT = null;
  const pulse = () => {
    if (!pp) return false;
    pp.classList.remove('pulse'); void pp.offsetWidth; pp.classList.add('pulse'); pulseN++;
    win.clearTimeout?.(pulseT); pulseT = win.setTimeout?.(() => pp.classList.remove('pulse'), 2000);
    return true;
  };
  return { update, pulse, get pulses() { return pulseN; }, get state() { return { ...st }; }, get buttons() { return btn; }, get geometry() { return G; }, get offsetY() { return dyAt ?? 0; } };
}
