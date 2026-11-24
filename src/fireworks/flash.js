// The flash bank (stage S1): each burst's light as one slot, colour × intensity × a fade over 0.3–1 s;
// the 8 brightest at any moment. S2 feeds the sky dome and the cloud deck from it; S1 lights the smoke and a faint sky
// glow in the demo. Plain JS (the engine copies the slots into two uniform arrays).
//   flashSlots(bursts, t, n) → [{ pos [x, y, z], colour [r, g, b], intensity, glow }] (n slots, the unused ones 0)
//   bursts: [{ burst (s), pos, colour, peak, tau }] (the engine keeps one per spawned shell)

export const FLASH_SLOTS = 8;
// the peak (screen level, before the exposure) and the fade (s) by type: a big willow glows long, a strobe flickers
const FLASH = {
  peony: { peak: 1.0, tau: 0.35 }, pistil: { peak: 1.0, tau: 0.35 }, dahlia: { peak: 0.8, tau: 0.6 },
  chrysanthemum: { peak: 1.0, tau: 0.45 }, changer: { peak: 0.9, tau: 0.5 }, willow: { peak: 0.8, tau: 1.0 },
  horsetail: { peak: 0.7, tau: 0.8 }, palm: { peak: 0.9, tau: 0.5 }, ring: { peak: 0.7, tau: 0.3 }, saturn: { peak: 0.9, tau: 0.35 },
  crossette: { peak: 0.8, tau: 0.5 }, strobe: { peak: 0.9, tau: 0.6 }, crackle: { peak: 1.1, tau: 0.6 }, brocade: { peak: 0.9, tau: 0.8 },
  multibreak: { peak: 0.9, tau: 0.9 }, salute: { peak: 3.0, tau: 0.25 },
  cake: { peak: 0.5, tau: 1.0 }, mine: { peak: 0.6, tau: 0.4 }, niagara: { peak: 0.4, tau: 3.0 }, vcomets: { peak: 0.4, tau: 0.8 },
};
export const flashOf = (type, inches) => ({ peak: FLASH[type].peak * (inches / 6) ** 2, tau: FLASH[type].tau });

// the intensity of one burst's flash at t: a 40 ms rise, then exp(−age / tau); nothing after 4 tau
export function flashAt(b, t) {
  const a = t - b.burst;
  if (a < 0 || a > 4 * b.tau) return 0;
  return b.peak * Math.min(1, a / 0.04) * Math.exp(-a / b.tau);
}

// look round 1: the burn. A shell's stars keep burning for seconds after the flash, and it is that light the
// smoke and the night air hold in a photo. A second, slower level per slot: GLOW.level of the peak, fading over
// GLOW.stretch x tau (never past GLOW.maxS). The smoke and the air glow read flash + glow; the land's wash the flash only.
export const GLOW = { level: 0.8, stretch: 4, maxS: 10 };
export function glowAt(b, t) {
  const a = t - b.burst, tau = b.tau * GLOW.stretch;
  if (a < 0 || a > Math.min(4 * tau, GLOW.maxS)) return 0;
  return b.peak * GLOW.level * Math.min(1, a / 0.04) * Math.exp(-a / tau);
}

export function flashSlots(bursts, t, n = FLASH_SLOTS) {
  const live = [];
  for (const b of bursts) { const i = flashAt(b, t), g = glowAt(b, t); if (i > 1e-4 || g > 1e-4) live.push({ pos: b.pos, colour: b.colour, intensity: i, glow: g }); }
  // the n that give the most light (flash + glow), then the brightest flash first
  live.sort((x, y) => (y.intensity + y.glow) - (x.intensity + x.glow));
  const out = live.slice(0, n).sort((x, y) => (y.intensity - x.intensity) || (y.glow - x.glow));
  while (out.length < n) out.push({ pos: [0, 0, 0], colour: [0, 0, 0], intensity: 0, glow: 0 });
  return out;
}
