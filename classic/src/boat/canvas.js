// The canvas colour (dodger; later the bimini and sail cover): one GLB, its canvas base map a greyscale tone that the
// material colour multiplies. ?canvas=a|b|c picks a variant from canvas.json (the same table the Blender build reads);
// with none, canvas.json "default". The hood's shade (its liner and the deck under it) takes a dark tint of the canvas.
import { Color } from 'three/webgpu';
import { CANVAS_VARIANTS as VARIANTS, canvasVariant, canvasHex } from '../../../src/sim/boat/canvasHex.js';   // the numbers (no three.js)

export { canvasHex };

const WHITE = new Color(1, 1, 1);
// Halcyon's canvas is 15–20 years old: sun-faded a little, towards a warm grey (the dodger, the cushions, the bimini boot)
const FADE = new Color(0.62, 0.60, 0.56);
const faded = (hex) => new Color(hex).lerp(FADE, 0.14);

// Recolour the canvas and trim materials under root; returns the variant applied, or null.
export function applyCanvas(root, key = canvasVariant()) {
  const v = key && VARIANTS.variants[key];
  if (!v) return null;
  root.traverse((o) => {
    const m = o.material;
    if (!m) return;
    if (m.name === 'canvas') m.color.copy(faded(v.canvas));
    else if (m.name === 'dodger_trim') m.color.copy(faded(v.trim));
    else if (m.name.startsWith('canvas_cushion')) m.color.copy(faded(v.canvas));   // the cushions and the bimini's boot (cockpit.glb)
    else if (m.name.startsWith('canvas_piping')) m.color.copy(faded(v.trim));      // the cushions' piping
    else if (m.name === 'dodger_shade') { m.color.set(v.canvas); m.color.multiplyScalar(1 / Math.max(m.color.r, m.color.g, m.color.b)); m.color.lerp(WHITE, 0.4).multiplyScalar(0.10); }
  });
  return key;
}
