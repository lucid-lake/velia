// The bursts' air glow behind the land (owner, 2026-11-18: "the island and other items are supposed to occlude the
// fireworks"). The stars, their trails and the smoke are depth-tested against the scene on the GPU (render/fireworks.js), and
// the bloom is built from those visible stars only; but the flash bank (the bursts' light: the glow round them on the sky, its
// mirror on the water, the smoke's and the props' light) is a list of points, so a burst behind Fannette still lit the sky
// over the island. Each bank slot is weighed here by how much of the burst the eye sees past the terrain (and a canopy over
// the land: Fannette's pines): five points of the burst (its centre and four at R m round it, across the view and up and
// down), each a ray marched over the ground. Its light × the visible share. Pure, deterministic (no time, no random).
//   const occ = createOccluder({ heightAt })   occ.apply(flash, eye) scales flash.pos[k].w and flash.col[k].w in place
const OCCLUDE = Object.freeze({ R: 45, canopy: 14, landFrom: 0.8, steps: 80 });

export function createOccluder({ heightAt, K = OCCLUDE } = {}) {
  if (!heightAt) return { apply: () => 0, seen: () => 1 };
  const ground = (x, z) => { const h = heightAt(x, z); return h > K.landFrom ? h + K.canopy : h; };
  // is the point p seen from the eye e over the ground? (the ray's height at each step against the ground there)
  const clear = (e, px, py, pz) => {
    const dx = px - e[0], dz = pz - e[2], dy = py - e[1];
    for (let i = 1; i < K.steps; i++) {
      const t = i / K.steps;
      if (ground(e[0] + dx * t, e[2] + dz * t) > e[1] + dy * t) return false;
    }
    return true;
  };
  const seen = (e, p) => {
    const dx = p[0] - e[0], dz = p[2] - e[2], L = Math.hypot(dx, dz) || 1, ax = -dz / L, az = dx / L;   // across the view
    let n = 0;
    if (clear(e, p[0], p[1], p[2])) n++;
    if (clear(e, p[0] + ax * K.R, p[1], p[2] + az * K.R)) n++;
    if (clear(e, p[0] - ax * K.R, p[1], p[2] - az * K.R)) n++;
    if (clear(e, p[0], p[1] + K.R, p[2])) n++;
    if (clear(e, p[0], p[1] - K.R, p[2])) n++;
    return n / 5;
  };
  return {
    seen,
    // flash: { pos, col } (4 floats a slot: xyz intensity; rgb glow); → the light hidden (the sum of 1 − seen over lit slots)
    apply(flash, eye) {
      let hidden = 0;
      const n = flash.pos.length / 4;
      for (let k = 0; k < n; k++) {
        const o = k * 4;
        if (flash.pos[o + 3] + flash.col[o + 3] <= 0) continue;
        const v = seen(eye, [flash.pos[o], flash.pos[o + 1], flash.pos[o + 2]]);
        if (v < 1) { flash.pos[o + 3] *= v; flash.col[o + 3] *= v; hidden += 1 - v; }
      }
      return hidden;
    },
  };
}
