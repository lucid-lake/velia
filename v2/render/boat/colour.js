// The boat's colour rule (moved from models.js, refactor round 3 C6, so lifeRing.js reads it without an import cycle):
// three's Color(hex) as linear RGB. models.js re-exports hexLinear for its other readers.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);   // three's Color(hex): sRGB → linear
export const hexLinear = (hex) => { const h = typeof hex === 'string' ? parseInt(hex.slice(1), 16) : hex; return [lin(((h >> 16) & 255) / 255), lin(((h >> 8) & 255) / 255), lin((h & 255) / 255)]; };
