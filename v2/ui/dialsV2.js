// The dials' north star, the mock stage (?dials=v2, WIP behind the flag; the design: the private research note 98). Two dials with
// one job each and a Pro panel:
//   the chart dial (geo-centric: a compass and the mini map): head-up, the nearest point of interest as a bearing line and its
//     distance, the shore and the shallows as amber arcs on the compass band, the depth; SOG leaves it for the boat dial
//   the boat dial (boat-centric: a new sailor's cheat sheet, src/ui/captainView.js coach): each sail's trim word on the drawn sail,
//     the point of sail and the tack, windward and leeward, the no-go zone, heel, the boat's speed and the wind (real and felt)
//   the Pro panel: the experts' numbers (COG, TWA, AWA, VMG, HEEL, RUD) on one glass plate above the chart dial, shown with Pro on;
//     the left edge's nav column steps aside
// Pure helpers (the cues) are exported for tests; createProPanel mounts the plate.
import { ensureTokens } from '../../src/ui/tokens.js';
import { createReadings, fmt } from '../../src/ui/navColumn.js';
import { BOAT } from '../../src/sim/boat.js';

const DEG = Math.PI / 180;
export const DIALS_V2 = Object.freeze({
  boatK: 1.0,          // × --lk-d: both dials' size (was 0.8: the words and the mini map need the room)
  overHeelDeg: 20,     // heel past this (smoothed) is overpowered: "ease or reef" (the auto-reef starts at 21°)
  luffFill: 0.5,       // a sail's fill under this is luffing
  stallAt: 0.6,        // a sail's stall over this (and the wind forward of 80°) is stalled
  inSlackDeg: 2,       // a sheet within this of its stop is all the way in (or out)
  gybeAwaDeg: 165,     // the wind this far aft: the gybe zone
  hereM: 200,          // a point of interest closer than this is where she is: the next one is shown
  poiShort: Object.freeze({ mark: 'Mark', anchorage: 'Anch', race: 'Mark' }),
  poiKinds: Object.freeze({ mark: 'Mark', birthplace: 'Harbour', anchorage: 'Anchorage', place: 'Landmark', race: 'Next mark' }),
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

// ---- the Pro panel: one glass plate of instrument cells above the chart dial ----
const PRO_CELLS = ['cog', 'twa', 'vmg', 'awa', 'heel', 'rud'];
const LABEL = { cog: 'COG', twa: 'TWA', vmg: 'VMG', awa: 'AWA', heel: 'HEEL', rud: 'RUD' };
const CSS = `
:root.lk-dv2 .lk-nav{display:none!important}
:root.lk-dm.lk-dv2:not(.lk-flat):not(.lk-flat):not(.lk-flat){--lk-dmw:round(calc(var(--lk-d) * ${DIALS_V2.boatK}),1px);--lk-edge-foot:calc(var(--lk-by) + 12px + var(--lk-dmw) + 12px)}
:root.lk-dm.lk-dv2:not(.lk-flat):not(.lk-flat):not(.lk-flat) .lk-chart .small{width:var(--lk-dmw);height:var(--lk-dmw);left:calc(var(--lk-dm-cx,calc(var(--lk-mx) + var(--lk-sal,0px) + var(--lk-dmw) / 2)) - var(--lk-dmw) / 2)}
:root.lk-dv2 .lk-chart .small .poi i{text-transform:none;letter-spacing:.02em}
:root.lk-dm.lk-dv2:not(.lk-flat):not(.lk-flat):not(.lk-flat) .lk-cv{--d:var(--lk-dmw);left:calc(var(--lk-dm-wx,calc(100vw - var(--lk-mx) - var(--lk-sar,0px) - var(--lk-dmw) / 2)) - var(--lk-dmw) / 2)}
.lk-pro2{position:fixed;z-index:var(--lk-z-hud);pointer-events:none;display:grid;grid-template-columns:repeat(3,auto);gap:6px 14px;padding:10px 14px 9px;box-sizing:border-box;
  border-radius:var(--lk-glass-r,14px);background:var(--lk-glass-dense);backdrop-filter:var(--lk-glass-blur);-webkit-backdrop-filter:var(--lk-glass-blur);box-shadow:inset 0 0 0 1px var(--lk-glass-edge),0 8px 18px rgb(0 0 0 / .3);
  font:var(--lk-medium) var(--lk-fs-caption)/1 var(--lk-ui);font-variant-numeric:tabular-nums;color:var(--lk-ink);opacity:0;transition:opacity .24s ease;
  left:calc(var(--lk-dm-cx,calc(var(--lk-mx) + var(--lk-sal,0px) + var(--lk-dmw) / 2)) - var(--lk-dmw) / 2);bottom:calc(var(--lk-by) + 12px + var(--lk-dmw) + 10px)}
.lk-pro2.on{opacity:1}
:root.lk-dm-off .lk-pro2,:root.lk-flat .lk-pro2{display:none}
.lk-pro2 .c{display:flex;flex-direction:column;gap:3px;min-width:3.6em}
.lk-pro2 i{font-style:normal;letter-spacing:var(--lk-track-caps);color:var(--lk-ink-soft)}
.lk-pro2 b{font-weight:var(--lk-medium);font-size:var(--lk-fs-num);white-space:nowrap}
.lk-pro2 small{font-size:var(--lk-fs-caption);color:var(--lk-ink-soft);margin-left:.12em}
.lk-pro2 em{font-style:normal;font-size:var(--lk-fs-caption);margin-left:.25em;padding:0 .3em;border-radius:.3em;color:rgb(var(--lk-navy))}
.lk-pro2 em.p{background:rgb(var(--lk-port))}.lk-pro2 em.s{background:rgb(var(--lk-stbd))}.lk-pro2 em:empty{display:none}
`;
export function createProPanel({ state = () => null, on = () => false, doc = document } = {}) {
  ensureTokens();
  if (!doc.getElementById('lk-dv2-css')) { const st = doc.createElement('style'); st.id = 'lk-dv2-css'; st.textContent = CSS; doc.head.appendChild(st); }
  doc.documentElement.classList.add('lk-dv2');
  const el = doc.createElement('div'); el.className = 'lk-pro2';
  el.innerHTML = PRO_CELLS.map((k) => `<div class="c" data-k="${k}"><i>${LABEL[k]}</i><b><span></span><small></small><em></em></b></div>`).join('');
  doc.body.appendChild(el);
  const readings = createReadings();
  const cells = Object.fromEntries(PRO_CELLS.map((k) => { const c = el.querySelector(`[data-k=${k}]`); return [k, { n: c.querySelector('span'), u: c.querySelector('small'), e: c.querySelector('em') }]; }));
  let acc = 1;
  return {
    el,
    update(dt = 1 / 60) {
      const show = !!on();
      el.classList.toggle('on', show);
      acc += dt; if (!show || acc < 0.25) return;
      const s = state(); if (!s) return;
      const r = readings.step({ cog: s.cog, twsMs: s.trueWind?.speed, twa: s.trueWind?.angle, sogMs: s.sog, heel: s.heel, rudder: s.rudderAngle }, acc); acc = 0;
      const awa = Math.round((s.apparentWind?.angle ?? 0) / DEG);
      const rows = { ...Object.fromEntries(['cog', 'twa', 'vmg', 'heel', 'rud'].map((k) => [k, fmt(k, r)])), awa: { num: String(Math.abs(awa)), unit: '°', side: awa > 0 ? 'S' : awa < 0 ? 'P' : '' } };
      for (const k of PRO_CELLS) {
        const v = rows[k], c = cells[k], side = String(v.side ?? '').charAt(0).toUpperCase();
        if (c.n.textContent !== v.num) c.n.textContent = v.num;
        if (c.u.textContent !== v.unit) c.u.textContent = v.unit;
        if (c.e.textContent !== side) { c.e.textContent = side; c.e.className = side === 'P' ? 'p' : side === 'S' ? 's' : ''; }
      }
    },
    dispose() { el.remove(); doc.documentElement.classList.remove('lk-dv2'); },
  };
}
