// Play as Tessie, the Tail Surge (the Tessie RPG, phase 4; behind ?tessierpg=1). Pure: no DOM, no clock, no Math.random.
// A 1.2 s wind-up (she coils, her tail lifts), then a tail slap: a ring wave runs out from her body's middle to the rank's ring
// radius over SURGE.waveS. Every boat inside heels away from her as it passes, toward the rank's heel angle by distance (the full
// angle inside the knock radius, easing to SURGE.edgeK of it at the ring). One boat within the knock radius that is already heeled
// past SURGE.overDeg (the wind helps) goes over: a knockdown, scored as wrecked; so does one slapped point-blank (within SURGE.closeK of
// the knock radius) whatever its lean; in Light wind (under SURGE.lightKn at that boat) nothing goes over, it only heels. The kayaks within SURGE.kayakM are splashed (scored). The slap reveals her to the boats inside.
//   surgeHeel(d, row) → the heel (deg) the wave gives a boat d m from her (0 outside the ring)
//   awaySide(b { x, z, heading }, at { x, z }) → the side a wave from her heels the boat to (+1 starboard down: away from her)
//   surgeResolve(at { x, z }, list [{ id, kind, x, z, heading, heelDeg (now, + starboard down), twsMs }], row, { grace })
//     (grace(id) → true: a boat knocked down within the last 45 s, sim/tessieHits.js grace: it only heels, never goes over again;
//     bodyD(b) → m from the boat to the nearest part of her body: the knock radius counts from her whole 19 m body, not only its middle,
//     so a boat beside her nose is in it; absent, the distance from the ring's centre)
//     → { heels: [{ id, kind, d, lean, heelDeg, side, atS }], knock: { id, kind, d, lean, side, atS } | null, kayaks: [ids], seen: [ids], light,
//         upright (a boat inside the knock radius stayed up: too upright and not close enough; the reason the player is told) }
//       (lean: its heel when the slap lands, deg)
//       (side: +1 starboard down; a heel goes away from her, the knock over the way the boat already leans; atS: s after the slap
//       the wave reaches it)
// The heel itself: v2/sim/waveRoll.js on the busy lake's hulls and the Halcyon; the glass boat's scripted roll (sim/tourBoat.js knock's peakDeg).

const KN = 0.514444;
export const SURGE = Object.freeze({
  windupS: 1.2,        // s: she coils, her tail lifts
  waveS: 2.0,          // s: the ring runs out to the ring radius (any rank: a bigger ring runs faster)
  fadeS: 1.0,          // s: the in-world ring fades after it reaches the ring radius
  edgeK: 0.3,          // the heel at the ring's edge, a share of the rank's heel angle (the full angle inside the knock radius)
  overDeg: 12,         // a boat already heeled past this (the wind helps) inside the knock radius goes over: 12° so a boat on the
                       // wind at the default 15 kn (about 20°) and in Medium (10–12 kn: 14–18°) can go over; Light never (lightKn)
  closeK: 0.6,         // a boat within this share of the knock radius (rank 1: 7.2 m) goes over whatever its lean: the boats that see her
                       // bear away and sit upright (about 2° at 15 kn), so the lean rule alone knocked 0 of 28 slaps from the surface
  lightKn: 7.5,        // kn: under this at the boat (the Light band, 4–7 kn) nothing goes over, only heels
  kayakM: 20,          // m: the kayaks within this are splashed (scored)
  heelKinds: Object.freeze(['sail', 'halcyon', 'glass']),   // what the wave heels (the powerboats and the paddle-wheeler: not by a ring wave)
  knockKinds: Object.freeze(['sail', 'halcyon']),           // what may go over (they heel under sail; the glass boat never goes over)
});
// her ranks: ring 40 → 48 → 56 → 64 m, knock radius 12 → 14 → 16 → 18 m, heel 35 → 38 → 41 → 45°; every 30 s from the press (the slot's
// ring: amber over the wind-up and the wave, then dim)
const surgeRank = (ringM, knockM, heelDeg) => Object.freeze({ ringM, knockM, heelDeg, everyS: 30, activeS: SURGE.windupS + SURGE.waveS, cooldownS: 30 - SURGE.windupS - SURGE.waveS });
export const SURGE_RANKS = Object.freeze([null, surgeRank(40, 12, 35), surgeRank(48, 14, 38), surgeRank(56, 16, 41), surgeRank(64, 18, 45)]);
export const lightWind = (twsMs) => Number.isFinite(twsMs) && twsMs < SURGE.lightKn * KN;

export function surgeHeel(d, row) {
  if (!row || !(d <= row.ringM)) return 0;
  if (d <= row.knockM) return row.heelDeg;
  return row.heelDeg * (1 - (1 - SURGE.edgeK) * (d - row.knockM) / (row.ringM - row.knockM));
}

// +1 when she lies on the boat's port side (a wave from there heels it to starboard), -1 on its starboard side
export function awaySide(b, at) {
  const h = b.heading ?? 0, dot = (at.x - b.x) * Math.cos(h) + (at.z - b.z) * Math.sin(h);
  return dot > 0 ? -1 : 1;
}

export function surgeResolve(at, list = [], row, { grace = null, bodyD = null } = {}) {
  const out = { heels: [], knock: null, kayaks: [], seen: [], light: false, upright: false };
  if (!at || !row) return out;
  const speed = row.ringM / SURGE.waveS;
  let best = null;
  for (const b of list) {
    const d = Math.hypot(b.x - at.x, b.z - at.z);
    if (b.kind === 'kayak') { if (d <= SURGE.kayakM) out.kayaks.push(b.id); continue; }
    if (b.kind === 'sup' || !(d <= row.ringM)) continue;
    out.seen.push(b.id);
    if (!SURGE.heelKinds.includes(b.kind)) continue;
    const lean = Number.isFinite(b.heelDeg) ? b.heelDeg : 0;
    const near = Math.min(d, bodyD?.(b) ?? Infinity);
    if (SURGE.knockKinds.includes(b.kind) && near <= row.knockM && !grace?.(b.id)) {
      const leans = Math.abs(lean) > SURGE.overDeg, close = near <= row.knockM * SURGE.closeK;
      if (!leans && !close) out.upright = true;
      else if (lightWind(b.twsMs)) out.light = true;
      else if (!best || near < best.near) best = { id: b.id, kind: b.kind, d, near, lean, side: leans ? (lean >= 0 ? 1 : -1) : awaySide(b, at), atS: d / speed };
    }
    out.heels.push({ id: b.id, kind: b.kind, d, lean, heelDeg: surgeHeel(d, row), side: awaySide(b, at), atS: d / speed });
  }
  if (best) { delete best.near; out.knock = best; out.upright = false; out.heels = out.heels.filter((h) => h.id !== best.id); }
  out.heels.sort((a, b) => a.d - b.d);
  return out;
}
