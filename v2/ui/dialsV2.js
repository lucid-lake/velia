// The dials' north star (owner, 2026-11-25; the design: the private research note 98), the cues both dials read. Two dials with one
// job each:
//   the Chart (geo-centric: a compass and the mini map, src/ui/chartplotter.js poi/shoreWarn): head-up, the nearest place as a
//     bearing line and its distance, the shore and the shallows as amber arcs on the compass band, the depth
//   the Coach (boat-centric: a new sailor's cheat sheet, src/ui/captainView.js coach): a word only when something needs doing (a
//     sail luffing or stalled, an overpowered boat, a sheet at its stop, in irons); the colours, the point of sail, the tack,
//     windward and leeward, SPEED and WIND ("feels N" on the arrow) always
// The experts' numbers are the Pro instruments panel (ui/proHud.js). Pure helpers, exported for the tests.
import { BOAT } from '../../src/sim/boat.js';
import { DIAL_MODULES } from './dials.js';

const DEG = Math.PI / 180;
export const DIALS_V2 = Object.freeze({
  boatK: 1.0,          // × --lk-d: both dials' size (was 0.8: the words and the mini map need the room)
  liftPx: 26,          // px above --lk-by: the larger circles clear the cockpit's fold tabs in the bottom corners (was 12)
  overHeelDeg: 20,     // heel past this (smoothed) is overpowered: "ease or reef" (the auto-reef starts at 21°)
  luffFill: 0.5,       // a sail's fill under this is luffing
  stallAt: 0.6,        // a sail's stall over this (and the wind forward of 80°) is stalled
  inSlackDeg: 2,       // a sheet within this of its stop is all the way in (or out)
  gybeAwaDeg: 165,     // the wind this far aft: the gybe zone
  hereM: 200,          // a point of interest closer than this is where she is: the next one is shown
  poiShort: Object.freeze({ mark: 'Mark', anchorage: 'Anch', race: 'Mark', birthplace: 'Harbour' }),   // with PRO's bearing: the row stays inside the circle
  poiKinds: Object.freeze({ mark: 'Mark', birthplace: 'Harbour', anchorage: 'Anchorage', race: 'Next mark' }),
  shoreReachM: 240,    // the shore arcs: land or shallow water this close, on 24 bearings
  shoreStepM: 30,
  shoreDepthM: 2.2,    // shallower than this (the draft 1.6 m + 0.6 m) counts
});

// One sail's state and the book's word for its fix. s: the boat state; sail: 'main' | 'jib'.
//   → { state: 'draw' | 'luff' | 'stall', word: '' | 'pull in' | 'ease out' }
export function trimCue(s, sail = 'main') {
  if (!s) return { state: 'draw', word: '' };
  const fill = sail === 'jib' ? s.jibFill ?? 1 : s.mainFill ?? 1, stall = sail === 'jib' ? s.jibStall ?? 0 : s.mainStall ?? 0;
  const awa = Math.abs(s.apparentWind?.angle ?? 0);
  if (fill < DIALS_V2.luffFill) return { state: 'luff', word: 'pull in', atStop: sheetAtStop(s, sail, 'in') };
  if (stall > DIALS_V2.stallAt && awa < 80 * DEG) return { state: 'stall', word: 'ease out', atStop: sheetAtStop(s, sail, 'out') };
  return { state: 'draw', word: '' };
}
// A sheet at its stop: the sail cannot follow the word, so the helm must (luffing all the way in: bear away; stalled all the way out: head up)
export function sheetAtStop(s, sail, end = 'in') {
  const a = Math.abs((sail === 'jib' ? s?.jibAngle : s?.boomAngle) ?? 0) / DEG;
  const lo = sail === 'jib' ? BOAT.jib.lead / DEG : BOAT.main.minDeg, hi = sail === 'jib' ? BOAT.jib.maxDeg : BOAT.main.maxDeg;
  return end === 'in' ? a <= lo + DIALS_V2.inSlackDeg : a >= hi - DIALS_V2.inSlackDeg;
}
// The helm's word: '' | 'bear away' | 'head up' (in irons, or a sail that cannot be trimmed further)
export function steerCue(s, posId = null) {
  if (!s) return '';
  if (posId === 'irons') return 'bear away';
  for (const sail of ['jib', 'main']) {
    const c = trimCue(s, sail);
    if (c.state === 'luff' && c.atStop) return 'bear away';
    if (c.state === 'stall' && c.atStop) return 'head up';
  }
  return '';
}
// Heel: '' | 'ease or reef' (overpowered); heelDeg smoothed by the caller
export const heelCue = (heelDeg) => (Math.abs(heelDeg) > DIALS_V2.overHeelDeg ? 'ease or reef' : '');
// The tack from the true wind's side (+ from starboard): 'starboard' | 'port' | '' (head to wind or dead downwind)
export function tackOf(twaRad) {
  const a = Math.abs(twaRad) / DEG;
  if (a < 3 || a > 177) return '';
  return twaRad > 0 ? 'starboard' : 'port';
}

// The single nearest point of interest: the set mark first (or the next race mark), else the nearest of the rest.
// boat { x, z }; list [{ kind, name, x, z }] → { kind, name, x, z, dM, brgDeg (true, 0 = north) } | null
// World axes: +x east, −z north (the chart's own: view.dirPx(0) points up for north).
export function nearestPoi(boat, list = []) {
  if (!boat || !list.length) return null;
  const first = list.find((p) => p.kind === 'mark' || p.kind === 'race');
  let best = first ?? null, bd = Infinity;
  if (!best) for (const p of list) { const d = Math.hypot(p.x - boat.x, p.z - boat.z); if (d >= DIALS_V2.hereM && d < bd) { bd = d; best = p; } }
  if (!best) return null;
  const dx = best.x - boat.x, dz = best.z - boat.z;
  return { ...best, dM: Math.hypot(dx, dz), brgDeg: ((Math.atan2(dx, -dz) / DEG) % 360 + 360) % 360 };
}
// nm for the chart's foot: under 1 nm to two places, else one
export const nmText = (m) => { const nm = m / 1852; return nm < 1 ? nm.toFixed(2).replace(/^0/, '') : nm.toFixed(1); };

// ---- the dials' layout: both at 1.0 x --lk-d (the words and the mini map need the room); a phone's compact Coach keeps the boat, the
// sails' colours and SPEED, and its tap-to-enlarge brings the words and the rows back ----
const CSS = `
:root.lk-dm.lk-dv2:not(.lk-flat):not(.lk-flat):not(.lk-flat){--lk-dmw:round(calc(var(--lk-d) * ${DIALS_V2.boatK}),1px);--lk-edge-foot:calc(var(--lk-by) + ${DIALS_V2.liftPx}px + var(--lk-dmw) + ${DIAL_MODULES.gap}px)}
:root.lk-dm.lk-dv2:not(.lk-flat):not(.lk-flat):not(.lk-flat) .lk-chart .small{width:var(--lk-dmw);height:var(--lk-dmw);left:calc(var(--lk-dm-cx,calc(var(--lk-mx) + var(--lk-sal,0px) + var(--lk-dmw) / 2)) - var(--lk-dmw) / 2);bottom:calc(var(--lk-by) + ${DIALS_V2.liftPx}px)}
:root.lk-dv2 .lk-chart .small .poi i{text-transform:none;letter-spacing:.02em}
:root.lk-dv2 .lk-chart .small .cogr[hidden]{display:none}
:root.lk-dm.lk-dv2:not(.lk-flat):not(.lk-flat):not(.lk-flat) .lk-cv{--d:var(--lk-dmw);left:calc(var(--lk-dm-wx,calc(100vw - var(--lk-mx) - var(--lk-sar,0px) - var(--lk-dmw) / 2)) - var(--lk-dmw) / 2);bottom:calc(var(--lk-by) + ${DIALS_V2.liftPx}px)}
:root.lk-dm.lk-dv2:not(.lk-flat):not(.lk-flat):not(.lk-flat):not(.lk-cockpit):has(#hands) .lk-cv{left:calc(100vw - ${DIAL_MODULES.hands}px - var(--lk-sar,0px) - var(--lk-dmw))}
:root.lk-dm.lk-dv2.lk-flat:not(.lk-fl-wup) .lk-cv.coach :is(.cg,.rw.c1,.rw.c3){display:none}
:root.lk-dm.lk-dv2.lk-flat .lk-chart .small :is(.poi,.cogr){display:none}
`;
export function mountDialsLayout(doc = globalThis.document) {
  if (!doc.getElementById('lk-dv2-css')) { const st = doc.createElement('style'); st.id = 'lk-dv2-css'; st.textContent = CSS; doc.head.appendChild(st); }
  doc.documentElement.classList.add('lk-dv2');
  return { dispose() { doc.getElementById('lk-dv2-css')?.remove(); doc.documentElement.classList.remove('lk-dv2'); } };
}

// The shore arcs (pure): for each of n bearings (true, 0 = north; world x east, z south), the first distance within reach where the
// ground is above -depth (land, or water too shallow), else 0. heightAt(x, z): m above the lake (negative: the bed).
export function shoreArcs(heightAt, x, z, { n = 24, reach = DIALS_V2.shoreReachM, step = DIALS_V2.shoreStepM, depth = DIALS_V2.shoreDepthM } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = (i * 2 * Math.PI) / n, sx = Math.sin(b), sz = -Math.cos(b);
    let hit = 0;
    for (let d = step; d <= reach; d += step) if (heightAt(x + sx * d, z + sz * d) > -depth) { hit = d; break; }
    out.push(hit);
  }
  return out;
}

// the Chart's foot row for the nearest place: a short birthplace name, else its kind; PRO adds the bearing (and the label shortens)
export function poiRow(n, pro = false) {
  if (!n) return null;
  const named = n.kind === 'birthplace' && n.name && n.name.length <= 14;
  const nm = named ? n.name : DIALS_V2.poiKinds[n.kind];
  return { ...n, name: named ? '' : n.name, label: pro && !named ? (DIALS_V2.poiShort[n.kind] ?? nm) : nm, dText: nmText(n.dM),
    bText: pro ? ` ${String(Math.round(n.brgDeg) % 360).padStart(3, '0')}°` : '' };
}
