// The canvas colour as numbers (split from src/boat/canvas.js for the shared sim; Sprint 0): ?canvas=a|b|c
// picks a variant from canvas.json (the same table the Blender build reads); with none, canvas.json "default". The
// procedural spars (src/boat/spars.js) read it without three.js; src/boat/canvas.js recolours the GLB's materials.
import VARIANTS from '../../boat/canvas.json' with { type: 'json' };
import { FLAGS, toFlags } from '../core/flags.js';

export { VARIANTS as CANVAS_VARIANTS };

export function canvasVariant(flags = FLAGS) {   // flags: a flags object (or a query string: the tests)
  const key = toFlags(flags).canvas;
  return key && VARIANTS.variants[key] ? key : VARIANTS.default;
}

// The variant's canvas colour as a 0xRRGGBB number, scaled by k (a darker shade for cloth that is seen edge-on)
export function canvasHex(k = 1, key = canvasVariant()) {
  const h = parseInt(VARIANTS.variants[key].canvas.slice(1), 16);
  return [16, 8, 0].reduce((n, s) => n | (Math.round(((h >> s) & 255) * k) << s), 0);
}
