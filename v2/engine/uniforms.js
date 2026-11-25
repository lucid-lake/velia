// The one shared per-frame uniform block, as a ring. Every pipeline binds the same `Frame` struct at group 0; the frame
// writes it once into its ring slot (a CPU mirror of typed arrays made at start) and uploads it with one writeBuffer. The
// ring (3 slots) lets the GPU read last frame's slot while the CPU fills the next; the bind group is one, with a dynamic
// offset of slot × stride. Nothing here allocates after construction.
//   Fields hold only f32 vec4 / mat4x4 (as Cold Smoke), so the WGSL struct and this layout agree with no padding rules.
//   const u = createFrameUniforms();  u.begin(); u.set('sun', [x, y, z, w]); u.mat4('viewProj', m); u.upload(queue, buf)
//   u.wgsl()   the matching WGSL struct text
export const FRAME_FIELDS = Object.freeze([
  ['viewProj', 'mat4x4f', 16],
  ['invViewProj', 'mat4x4f', 16],
  ['sun', 'vec4f', 4],        // direction toward the sun (x east, y up, z south), w = sin elevation
  ['cam', 'vec4f', 4],        // eye position, w = sim time s
  ['res', 'vec4f', 4],        // backing width, height, 1/w, 1/h
  ['params', 'vec4f', 4],     // exposure factor, hour, render scale, the water's choppiness lambda
  // M1 rows (appended, so the M0 offsets hold; 64 floats = one 256 B slot)
  ['wind', 'vec4f', 4],       // wind speed m/s, the waves' travel angle (rad, atan2(z, x)), the spectrum gain, the sim time mod 300 s
  ['water', 'vec4f', 4],      // the four cascades' tile lengths m
  ['sky', 'vec4f', 4],        // sun illuminance (the HDR scale), the night floor, the camera's altitude km, the sun disc's cos radius
  ['grid', 'vec4f', 4],       // the water readback window's snapped centre x, z (m: the boat's spot since M3; the mesh centres on the eye), the grid's first cell a (m), its growth b
  // M5e rows (the night and the storm; appended: every earlier offset holds; the block grows to a 512 B slot)
  ['moon', 'vec4f', 4],       // the moon's direction (x east, y up, z south), w = its lit fraction 0–1
  ['night', 'vec4f', 4],      // the airglow's level (0 by day; the moon lifts it), the light domes', the band's and the stars', the lamps' switch k (0 day … 1 night)
  ['storm', 'vec4f', 4],      // the storm: on (0 | 1), the sun's shade at the eye (1 = no shade), dark (the grade), gold (the clearing's grade)
  ['rain', 'vec4f', 4],       // the rain at the eye 0–1, the flash 0–1.5, the haze 0–1, the rainbow's amount 0–1
  ['cell', 'vec4f', 4],       // the storm cell: x, z, radius (m), its cover
  ['front', 'vec4f', 4],      // the outflow line: the reference x, z, its place along the drift (m), its strength
  ['bow', 'vec4f', 4],        // toward the departing rain x, z, the flash's lift (flashAdd), the arc's seconds
  // fix(v2) frame look (appended: every earlier offset holds; still one 512 B slot)
  ['look', 'vec4f', 4],       // v1's camera: the tone curve (> 0 AgX, its value the water's keep: sim/exposure.js waterKeep; 0 ACES), the noon LUT's strength, the sky polariser's strength, the sky match's (render/grade.js)
  // the spume and the wind on the water (2026-11-14; appended after the frame look: every earlier offset holds, the slot stays 512 B)
  ['spume', 'vec4f', 4],      // v1's fold threshold J0 for the spume (render/spume.js: the quantile at Monahan's cover), on (1; 0: the in-page A/B), 0, 0
  ['windfx', 'vec4f', 4],     // audit W1–W3: the wind texture's centre x, z (m), the switches (render/windWater.js BITS), the sea's Hs at the boat (m)
  // play as Tessie, phase 2a (appended: every earlier offset holds, the slot stays 512 B): the eye under the water
  ['under', 'vec4f', 4],      // the eye's depth under the local surface (m; + under, − over), the surface's height at the lens (m), its slopes dh/dx, dh/dz
  ['underK', 'vec4f', 4],     // the scene drawn from under the water (1; 0 in the air: every under branch off), the waterline near the lens (0–1: the crossing's split), the tier (2 full, 1 lite), 0
  // storm round 2 (appended: every earlier offset holds, the slot stays 512 B)
  ['track', 'vec4f', 4],      // the storm cell's drift (unit x, z: the one wind's steering flow, v2/sim/storm.js), 0, 0
  ['mist', 'vec4f', 4],       // the spray mist (v2/sim/mist.js): the level's amount (0 off), 0, the wisps' drift x, z (m)
]);

export function makeLayout(fields = FRAME_FIELDS, align = 256) {
  const offsets = {}; let f = 0;
  for (const [name, , n] of fields) { offsets[name] = f; f += n; }
  const bytes = f * 4, stride = Math.ceil(bytes / align) * align;
  return Object.freeze({ offsets, floats: f, bytes, stride, align });
}

export function wgslStruct(fields = FRAME_FIELDS, name = 'Frame') {
  return `struct ${name} {\n${fields.map(([n, t]) => `  ${n}: ${t},`).join('\n')}\n}`;
}

export function createFrameUniforms({ fields = FRAME_FIELDS, slots = 3, align = 256 } = {}) {
  const layout = makeLayout(fields, align);
  const data = new Float32Array((layout.stride / 4) * slots);
  const views = Array.from({ length: slots }, (_, s) => data.subarray((layout.stride / 4) * s, (layout.stride / 4) * s + layout.floats));
  const sizes = Object.fromEntries(fields.map(([n, , k]) => [n, k]));
  let slot = -1, frame = -1, cur = views[0], pinned = null;   // pinned: a byte offset every draw binds instead of the slot's (play as Tessie's split: its own copy of the block)
  const at = (name) => { const o = layout.offsets[name]; if (o == null) throw new Error(`uniforms: no field "${name}"`); return o; };
  return {
    layout, slots, data,
    get slot() { return slot; },
    get byteOffset() { return pinned ?? slot * layout.stride; },
    pin(offset = null) { pinned = offset; },   // bind another copy of the block for a while (null: the slot's again)
    get view() { return cur; },
    begin() { frame++; slot = frame % slots; cur = views[slot]; return slot; },
    set(name, v) { const o = at(name), n = sizes[name]; if (v.length !== n) throw new Error(`uniforms: "${name}" takes ${n} floats, got ${v.length}`); for (let i = 0; i < n; i++) cur[o + i] = v[i]; },
    set4(name, a, b = 0, c = 0, d = 0) { const o = at(name); cur[o] = a; cur[o + 1] = b; cur[o + 2] = c; cur[o + 3] = d; },
    mat4(name, m) { this.set(name, m); },
    // one writeBuffer of this slot's bytes (data.buffer is the mirror; no copy is made)
    upload(queue, buffer) { queue.writeBuffer(buffer, this.byteOffset, data.buffer, this.byteOffset, layout.stride); },
    wgsl: () => wgslStruct(fields),
  };
}
