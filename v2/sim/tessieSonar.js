// Play as Tessie, the Sonar, the "super radar" (the Tessie RPG, phase 3; behind ?tessierpg=1). Pure: no DOM, no clock, no Math.random.
// One ping: every boat within the rank's range is marked for the rank's mark time: a faint cream ring on the water under each hull
// (living/tessiePlayer.js draws it into the world), and on her SONAR dial, rescaled to the ping's range while the marks last, a
// blip per marked boat at its bearing and range (v2/ui/tessieHud.js pingBlips; rimMarks still gives each one's bearing). The boats
// within SONAR.hearM hear it (the seen tick) unless she pings from HIDDEN.
//   sonarPing(her { x, z }, list [{ id, kind, x, z }], { rangeM, max }) → [{ id, kind, d }] nearest first, at most max
//   rimMarks(her { x, z, psi }, list, has(id) → bool, out) → out: [{ id, a }] (a: rad clockwise from her heading, up = ahead)
//   markRing(L) → the ring's radius under a hull of length L (m)
export const SONAR = Object.freeze({
  max: 16,            // marks at once (the world's ring pool)
  hearM: 60,          // m: the boats this near hear the ping (they have seen her) unless she is HIDDEN
  ringK: 0.75,        // the ring's radius as a share of the hull's length
  ringMinM: 2.5,      // m: the smallest ring (a kayak's)
  tailK: 1.6,         // rank 3+: the heading tail's length as a share of the ring's radius
  pulseK: 1.8,        // the pulse's ease-in (its radius ∝ u^pulseK)
  pulseS: 0.9,        // s: the ping's pulse runs out to the range (one thin ring on the water, the only ring a skill draws)
  arcDeg: 110,        // the pulse's bright front: this wide about her heading (the sweep), the rest of the ring fainter
  flashS: 0.4,        // s: a boat's mark flashes as the pulse reaches it (its ring grows in from 1.8 ×, thick, then settles)
});

export function sonarPing(her, list = [], { rangeM = 300, max = SONAR.max } = {}) {
  if (!her) return [];
  const out = [];
  for (const b of list) {
    if (b.kind === 'sup') continue;
    const d = Math.hypot(b.x - her.x, b.z - her.z);
    if (d <= rangeM) out.push({ id: b.id, kind: b.kind, d });
  }
  out.sort((a, b) => a.d - b.d);
  if (out.length > max) out.length = max;
  return out;
}

export function rimMarks(her, list = [], has = () => false, out = []) {
  out.length = 0;
  if (!her) return out;
  const c = Math.cos(her.psi), s = Math.sin(her.psi);
  for (const b of list) {
    if (!has(b.id)) continue;
    const dx = b.x - her.x, dz = b.z - her.z, ahead = dx * s - dz * c, right = dx * c + dz * s;
    out.push({ id: b.id, a: Math.atan2(right, ahead) });
  }
  return out;
}

// the ping's pulse: its radius u (0 … 1) of the way through SONAR.pulseS (slow round her, then racing out: the ring is seen leaving
// her before it nears the horizon), and the share of pulseS at which it reaches d m
export const pulseR = (rangeM, u) => rangeM * Math.pow(Math.max(0, Math.min(1, u)), SONAR.pulseK);
export const pulseU = (rangeM, d) => Math.pow(Math.max(0, Math.min(1, d / rangeM)), 1 / SONAR.pulseK);
export const markRing = (L = 8.5) => Math.max(SONAR.ringMinM, SONAR.ringK * (L || 8.5));
