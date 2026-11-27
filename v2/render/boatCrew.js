// The player's sloop's crew drawn (the choreography: render/boat/crew.js): the helmsman and the crew as the
// kayakers' figure on the kayaks' skin pipeline ('kayak-skin', render/kayaks.js share), posed by render/figureRig.js in the HULL
// frame and carried by the hull's own matrix (render/boat.js crewFrame), so they heel, pitch and heave with her exactly.
// Two figures, two indexed draws at most; nothing on the rivals or the lake's boats (their cost stays flat).
//   const R = createBoatCrewRender({ device, reg, sky, shadow, kayakRender, tier })   tier: 'full' (the detail LOD near) | 'lite' (the core LOD, nearer)
//   R.update(frame, { dt, eye, focal, helmK })   once a frame (frame: render/boat.js crewFrame; null draws nothing)
//   R.draw(pass, c)                               in the scene pass, opaque, before the water
import { SLOTS, IREC } from './kayaks.js';
import { createFigureRig } from './figureRig.js';
import { createBoatCrew, crewShown } from './boat/crew.js';
import { pickLook } from '../../src/sim/props/paddler/look.js';

// the two looks (fixed: the same people every sail): a man at the helm in a navy aid and a cream cap, a woman crewing in a yellow
// aid and a navy cap (no red or green on them: those mean port and starboard here)
export const CREW_LOOKS = Object.freeze({
  helm: Object.freeze({ seed: 9101, o: Object.freeze({ sex: 'male', pfd: 'blue', hatColour: '#E9E4D8' }) }),
  crew: Object.freeze({ seed: 9102, o: Object.freeze({ sex: 'female', pfd: 'yellow', hatColour: '#1D2B4A' }) }),
});
// draw distances (m from the eye to the hull) and the detail LOD's switch (the figure's height on screen, px)
export const CREW_DRAW = Object.freeze({ full: Object.freeze({ maxM: 160, detailPx: 140 }), lite: Object.freeze({ maxM: 90, detailPx: Infinity }) });

export function createBoatCrewRender({ device, reg, sky, shadow, kayakRender, tier = 'full' }) {
  const lim = CREW_DRAW[tier] ?? CREW_DRAW.full;
  const C = createBoatCrew();
  const looks = { helm: pickLook(CREW_LOOKS.helm.seed, CREW_LOOKS.helm.o), crew: pickLook(CREW_LOOKS.crew.seed, CREW_LOOKS.crew.o) };
  const WHO = ['helm', 'crew'];
  let rig = null, rigClips = null, pal = null, ins = null, insU = null, palBuf = null, insBuf = null, bg = null, bgl = null;
  const rows = new Float32Array(12), figs = [];
  const stats = { tier, figures: 0, calls: 0, triangles: 0, side: 0, cross: -1, hold: 0, hidden: '' };
  const ensure = (share, clips) => {
    if (!share || !clips) return false;
    if (rig && rigClips === clips && bg && bgl === share.skinBGL) return true;
    rig = createFigureRig(kayakRender.json, clips); rigClips = clips;
    pal = new Float32Array(2 * SLOTS * 12); ins = new Float32Array(2 * IREC * 4); insU = new Uint32Array(ins.buffer);
    palBuf = device.createBuffer({ label: 'crew-palette', size: pal.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    insBuf = device.createBuffer({ label: 'crew-instances', size: ins.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    bgl = share.skinBGL;
    bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: palBuf } }, { binding: 1, resource: { buffer: insBuf } }, { binding: 2, resource: shadow.view }, { binding: 3, resource: shadow.sampler }, { binding: 4, resource: { buffer: shadow.buffer } }] });
    return true;
  };
  function update(frame, { dt = 0, eye = [0, 0, 0], focal = 1000, helmK = 0 } = {}) {
    figs.length = 0; stats.figures = 0; stats.hidden = '';
    if (!frame) { stats.hidden = 'no boat'; return; }
    C.step(dt, frame);   // the choreography runs whether or not they are drawn (a view back from the helm finds them where they were)
    const st = C.state; stats.side = st.side; stats.cross = +st.cross.toFixed(3); stats.hold = +st.hold.toFixed(2);
    const M = frame.M, d = Math.hypot(eye[0] - M[12], eye[1] - M[13], eye[2] - M[14]);
    const why = crewShown({ helmK, distM: d, maxM: lim.maxM });
    if (why) { stats.hidden = why; return; }
    const share = kayakRender?.share, clips = kayakRender?.clips;
    if (!ensure(share, clips)) { stats.hidden = 'asset'; return; }
    // the hull's rows (column-major mat4 → three rows of a 3 × 4)
    for (let r = 0; r < 3; r++) { rows[r * 4] = M[r]; rows[r * 4 + 1] = M[4 + r]; rows[r * 4 + 2] = M[8 + r]; rows[r * 4 + 3] = M[12 + r]; }
    const px = 1.75 * focal / Math.max(1, d);   // a standing figure's height on screen
    for (let i = 0; i < 2; i++) {
      const lk = looks[WHO[i]], sc = rig.scale(lk.sex);
      rig.pose(lk.sex, C.targets(WHO[i], sc), pal, i * SLOTS * 12);
      share.writeInst(i, rows, i * SLOTS, -1, share.colours({ colour: 'yellow', look: lk }), null, ins, insU);
      figs.push({ part: lk.sex, detail: px > lim.detailPx });
    }
    device.queue.writeBuffer(palBuf, 0, pal, 0, figs.length * SLOTS * 12);
    device.queue.writeBuffer(insBuf, 0, ins, 0, figs.length * IREC * 4);
    stats.figures = figs.length;
  }
  function draw(pass, c) {
    stats.calls = 0; stats.triangles = 0;
    const share = kayakRender?.share;
    if (!figs.length || !share) return;
    pass.setPipeline(reg.get('kayak-skin')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg); pass.setVertexBuffer(0, share.vb); pass.setIndexBuffer(share.ib, 'uint16');
    for (let i = 0; i < figs.length; i++) {
      const p = share.parts[figs[i].part], cnt = figs[i].detail ? p.indexCount : p.coreIndexCount ?? p.indexCount;
      pass.drawIndexed(cnt, 1, p.firstIndex, p.firstVertex, i); c.calls++; c.triangles += cnt / 3; stats.calls++; stats.triangles += cnt / 3;
    }
  }
  return { update, draw, stats, crew: C };
}
