// The paddler's look picks (v2 seam, 2026-11-13: moved out of src/props/paddler/look.js unchanged, which re-exports them):
// the gear colours, the skin tones and pickLook(seed, overrides). Plain JS, no three.js.
// (the kayak's own presets for the hues that AgX and the sun-side compensation bring out true: dims.js KAYAK_COLOURS)
export const PFD_COLOURS = Object.freeze({ red: '#B8420F', orange: '#E89404', yellow: '#D6BA0C', blue: '#1C4F8C' });
const TOP_COLOURS = Object.freeze({ navy: '#1D2433', charcoal: '#2A2B2E', teal: '#18393C', black: '#141416', grey: '#4A4D52' });
const SHORTS_COLOURS = Object.freeze({ black: '#18181A', navy: '#1C2230', olive: '#353A2A', charcoal: '#2C2C30' });
// skin: a spread of real tones, light to deep (sRGB albedo, unlit)
// Real skin tones, sRGB, measured-style swatches across Fitzpatrick I–VI (warm undertones, some redness; the owner
// 2026-11-07: every tone a healthy, lit human skin, never grey or muddy). The body's colour map adds the face's shading
// as a detail around 1, so the base colour IS the tone (not a dimmed texture). Hair to suit each tone.
// (listed in pick order: seed 1, the demo's default, draws III, a light-to-medium tone)
export const SKIN = Object.freeze([
  { name: 'I', hex: '#EAC4AE', hair: ['#C9A36B', '#A0522D', '#8A6A44'] },
  { name: 'II', hex: '#DFB396', hair: ['#8A5A2B', '#B8905A', '#5A3E26'] },
  { name: 'IV', hex: '#BF8559', hair: ['#3B2A1E', '#2A1F18', '#1E1814'] },
  { name: 'V', hex: '#93603D', hair: ['#1E1814', '#2A1F18', '#141010'] },
  { name: 'III', hex: '#D9A47C', hair: ['#5A3E26', '#3B2A1E', '#8A5A2B'] },
  { name: 'VI', hex: '#5E3B26', hair: ['#141010', '#1E1814', '#100C0A'] },
]);
// a look override for a tone by name: the tone and its first hair colour
export function skinLook(name) { const t = SKIN.find((x) => x.name === name); return t ? { skin: t.hex, hair: t.hair[0] } : {}; }
// caps only by default (owner, 2026-11-07: the sun hat read as a pith helmet); the sun hat stays as an override (look.hat)
const HATS = Object.freeze(['cap']);
const HAT_COLOURS = Object.freeze({ cap: ['#E9E4D8', '#1D2B4A', '#B83A26', '#2F5E8C', '#3A3A3A'], sunhat: ['#C9BC9C', '#B9B3A3', '#7D7A68', '#E3DCCB'] });

// a small deterministic RNG (mulberry32)
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

export function pickLook(seed = 1, o = {}) {
  const r = rng(seed * 7919 + 13);
  // every pick is drawn even when overridden, so an override changes only its own field
  const pfdPick = pick(r, Object.keys(PFD_COLOURS)), hatPick = pick(r, HATS);
  const pfdName = o.pfd && PFD_COLOURS[o.pfd] ? o.pfd : pfdPick;
  const hat = o.hat ?? hatPick;
  return {
    seed,
    pfdName,
    pfd: o.pfd && !PFD_COLOURS[o.pfd] ? o.pfd : PFD_COLOURS[pfdName],
    top: pick(r, Object.values(TOP_COLOURS)),
    shorts: pick(r, Object.values(SHORTS_COLOURS)),
    shoes: pick(r, ['#202124', '#2C2F36', '#3A3530']),
    ...(() => { const t = pick(r, SKIN), h = pick(r, t.hair); return { skin: o.skin ?? t.hex, skinName: t.name, hair: o.hair ?? h }; })(),
    // a man or a woman (the UBC figures); drawn last so the earlier picks stay as they were
    sex: (() => { const v = r() < 0.5 ? 'male' : 'female'; return o.sex ?? v; })(),
    hat,
    hatColour: (() => { const v = pick(r, HAT_COLOURS[hat] ?? HAT_COLOURS.cap); return o.hatColour ?? v; })(),
  };
}
