// The gust you see coming, on the water (wow/gusts, 2026-11-05; TSL, src/water.js calls it per water pixel).
// The water already reads a gust patch from the wind texture (water.js gustW0: the local wind over the ≈ 800 m mean,
// water-spectrum.js gustVisual). A real cat's paw on a sunny lake is obvious: a matte blue-grey patch with a crisp
// leading edge. What makes it so: its fine ripples (a few cm) tilt every facet, so the patch no longer mirrors the
// horizon (the bright sky, the sun's glitter, or a dark ridge) but averages the open sky above it. So here:
// 1. the weight: the gust's own outline, thresholded on the wind texture's ratio (a contour of the bilinear field is a
//    crisp line, ragged by a 9 m noise), the old soft weight under it, and a darker band where the gust is fresh (its
//    wind well over the wind 28 m downwind: the front racing in). It rides with the gust (the field's advection).
// 2. the sky the patch mirrors: only its luminance moves toward the open sky above (darker against a bright sky, a
//    touch lighter against a dark ridge), capped at −10 % / +9 %, the hue kept: Tahoe stays navy (fix/gust-water).
// 3. the mirror is cut (fres), the traced ridge blurred (gustFxRough) and the glitter dimmed: the patch reads through
//    texture and the lost reflection. Its fine ripples × ≈ 1.1, broken up by the gust's own noise (no tiling).
// One extra wind-texture tap and one noise tap a pixel.
// The gust look is a water feature (src/waters/features.js): gustWater() fills its slots; ?gustfx=0 or ?gustlook=0 leave
// it out of the list (src/core/world.js).
import * as THREE from 'three/webgpu';
import { float, vec3, dot, max, clamp, smoothstep, length, mix, normalize, pmremTexture, mx_noise_float } from 'three/tsl';

const GUST_FX = { gain: 1.45, crisp: [1.05, 1.075], crispW: 0.9, rag: 0.012, ragM: 9, edgeM: 28, edge: 0.5, edgeRatio: [0.03, 0.12],
  slope: 1.1, glint: 0.8, sky: 1, matte: 10, dark: 0.6, lumDown: 0.1, lumUp: 0.09, skyUp: 0.6, skyRough: 0.5, fres: 0.3, ssr: 0.5 };

// gustW0: water.js's gust weight (0..1); gRatio: local / around; wv, localU: the local wind (vec2, m/s); aroundU: the
// mean around (m/s); windAt(xz): the wind texture's wind at a point; xz: this pixel's world point. Returns the weight.
function gustFxWeight({ gustW0, gRatio, wv, localU, aroundU, windAt, xz }) {
  const wd = wv.div(max(localU, 0.1));
  const downU = length(windAt(xz.add(wd.mul(GUST_FX.edgeM))));   // the wind just downwind: still the old air at a front
  const fresh = gRatio.sub(downU.div(aroundU));                    // how much the gust rises across the last 28 m
  const onset = smoothstep(1.0, 2.0, localU);
  const front = smoothstep(GUST_FX.edgeRatio[0], GUST_FX.edgeRatio[1], fresh).mul(smoothstep(1.03, 1.08, gRatio)).mul(onset);
  const rag = mx_noise_float(xz.div(GUST_FX.ragM)).mul(GUST_FX.rag);
  const crisp = smoothstep(GUST_FX.crisp[0], GUST_FX.crisp[1], gRatio.add(rag)).mul(onset);
  return clamp(max(gustW0.mul(GUST_FX.gain), crisp.mul(GUST_FX.crispW)).add(front.mul(GUST_FX.edge)), 0, 1);
}
// the fine ripples' slope in a patch: × slope on average, broken up by the gust's own noise (7 m and 23 m) so the two
// crossed ripple trains never read as a tiled lattice (fix/gust-water: the flat 1.6× boost tiled the near water)
const gustFxSlope = (on, xz) => (on
  ? mx_noise_float(xz.div(7)).mul(0.55).add(mx_noise_float(xz.div(23).add(4.1)).mul(0.35)).add(1).mul(GUST_FX.slope).max(0.2)
  : float(1));
// the sun's glitter in a gust patch: its rough facets send the sun's light every way: × (1 − glint × weight)
const gustFxGlint = (w) => float(1).sub(w.mul(GUST_FX.glint));
// the roughness the screen-space reflection reads (water.js reflections(): it keeps the mirror under 0.4, drops it by 0.8):
// a patch blurs the traced ridge's reflection (its taps spread with the roughness) and weakens it a little
const gustFxRough = (r, w) => max(r, w.mul(GUST_FX.ssr));
// the sky a patch mirrors (fix/gust-water: Tahoe stays navy). Its facets see the open sky above (water.js: the probe ≈ 30°
// up, × matte) instead of the horizon; only the luminance moves toward that, capped at −lumDown / +lumUp, the hue kept:
// a patch reads through texture and the lost mirror and glitter, never as a paler, greyer lake
const gustFxSky = (skyRefl, w, openSky) => {
  const L = vec3(0.2126, 0.7152, 0.0722), Ls = max(dot(skyRefl, L), 1e-5), open = openSky.mul(GUST_FX.matte);
  const bright = smoothstep(0.8, 1.25, Ls.div(max(dot(open, L), 1e-5)));
  const goal = dot(mix(open, skyRefl.mul(GUST_FX.dark), bright), L).div(Ls);
  return skyRefl.mul(mix(float(1), clamp(goal, 1 - GUST_FX.lumDown, 1 + GUST_FX.lumUp), w.mul(GUST_FX.sky)));
};

// the gust look as a water feature (src/waters/features.js slots): its weight, its fine ripples' gain, the open sky its
// patch mirrors (a second lookup of the water's reflection probe), the mirror cut, the traced mirror's blur and the
// dimmed glitter
export function gustWater() {
  return {
    id: 'gust',
    slope: {
      weight: (w, c) => gustFxWeight({ gustW0: w, gRatio: c.gRatio, wv: c.wv, localU: c.localU, aroundU: c.aroundU, windAt: c.windAt, xz: c.world.xz }),
      fine: (g, c) => { const s = gustFxSlope(true, c.rest); return g ? g.mul(s) : s; },
    },
    sky: {
      // a patch's fine ripples see the open sky above, not the mirror: matte blue-grey
      mirror: (sky, c) => {
        const open = c.probe ? pmremTexture(new THREE.Texture(), normalize(vec3(c.r.x, GUST_FX.skyUp, c.r.z)), float(GUST_FX.skyRough)) : null;
        if (open) c.probeLookup(open);
        return gustFxSky(sky, c.gustW, open ? open.rgb : mix(c.horizon, c.zenith, 0.5));
      },
      fres: () => GUST_FX.fres,
      trace: (r, c) => gustFxRough(r, c.gustW),
    },
    glint: { after: (g, c) => g.mul(gustFxGlint(c.gustW)) },   // a gust patch's rough facets scatter the glitter
  };
}
