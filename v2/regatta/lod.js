// The fleet's level of detail (BACKLOG-v2 #12 R4; the race fixes, 2026-11-18). Pure: no GPU, no allocation per
// call (the caller's out array and state are filled in place). Each rival gets a band by its distance from the camera's eye:
//   'near'  full detail (v2's boat: the hull, v1's models without the cabin, the cloth sails with their flutter; render/boat.js
//           setRivals, each boat on her own slot)
//   'mid'   the lite boat (render/raceProps.js 'sloop': the hull, spars, two solid sails; no cloth, no shadow, a cheaper mesh)
//   'far'   the impostor-grade silhouette (raceProps 'far': ≤ 16 triangles)
// No swap in view (the owner's ask, 2026-11-18: "start fixing race bugs"; filmed: the 3rd close boat drew the lite model and a pass
// swapped the model and the colour in one frame). A boat changes band only far from the eye: she becomes near when she crosses
// inward over nearM (150 m: a hull is about 50 px wide at 1280 px there) and stays near until she is past exitM (175 m); mid and far
// part at midM with hystM either side. A boat inside nearM that is not near (every slot taken when she crossed: a phone's one slot)
// stays as she is until she leaves the ring. maxNear: the Mac every rival (5: the six-boat cap); lite (a phone, a tablet, the ladder's
// L2-L3 or the race ladder's lite fleet; src/core/features.js 'fleetDetail') one full boat, as before (a phone pays for draws on its
// CPU, § 8.1). The first frame, a restart (state.reset) or a camera cut (the eye jumped over cutM in one frame) bands afresh: the
// nearest maxNear under nearM near.
//   const st = lodState();  fleetLod(eye, boats, bands, out, st) → out: out[i] = 'near' | 'mid' | 'far' for boats[i] ({ x, z })
//   without a state every call is a fresh banding
export const LOD_BANDS = Object.freeze({
  mac: Object.freeze({ nearM: 150, exitM: 175, midM: 250, hystM: 15, maxNear: 5 }),
  lite: Object.freeze({ nearM: 150, exitM: 175, midM: 200, hystM: 15, maxNear: 1 }),
});
export const LOD_CUT_M = 40;
export function lodState() {
  return { eye: [0, 0, 0], has: false, n: 0, d: new Float64Array(8), band: [], reset() { this.has = false; } };
}
const D = new Float64Array(8);   // the distances, reused (6 boats at most; 8 spare)

export function fleetLod(eye, boats, bands = LOD_BANDS.mac, out = [], st = null) {
  const n = Math.min(boats.length, D.length);
  out.length = n;
  for (let i = 0; i < n; i++) D[i] = Math.hypot(boats[i].x - eye[0], boats[i].z - eye[2]);
  const fresh = !st || !st.has || st.n !== n || Math.hypot(eye[0] - st.eye[0], eye[2] - st.eye[2]) > LOD_CUT_M;
  let near = 0;
  if (fresh) {
    for (let i = 0; i < n; i++) out[i] = D[i] < bands.midM ? 'mid' : 'far';
    // the nearest under nearM, at most maxNear of them (a selection without sorting: n ≤ 6)
    for (let k = 0; k < bands.maxNear; k++) {
      let best = -1, bd = bands.nearM;
      for (let i = 0; i < n; i++) if (out[i] !== 'near' && D[i] < bd) { bd = D[i]; best = i; }
      if (best < 0) break;
      out[best] = 'near';
    }
  } else {
    for (let i = 0; i < n; i++) {
      const was = st.band[i], d = D[i];
      if (was === 'near' && d < bands.exitM) { out[i] = 'near'; near++; continue; }
      out[i] = was === 'far' ? (d < bands.midM - bands.hystM ? 'mid' : 'far') : (d > bands.midM + bands.hystM ? 'far' : 'mid');
    }
    // the boats crossing inward over nearM this frame take the free slots, the nearest first
    for (let k = near; k < bands.maxNear; k++) {
      let best = -1, bd = bands.nearM;
      for (let i = 0; i < n; i++) if (out[i] !== 'near' && st.d[i] >= bands.nearM && D[i] < bd) { bd = D[i]; best = i; }
      if (best < 0) break;
      out[best] = 'near';
    }
  }
  if (st) { st.has = true; st.n = n; st.eye[0] = eye[0]; st.eye[1] = eye[1]; st.eye[2] = eye[2]; st.band.length = n; for (let i = 0; i < n; i++) { st.d[i] = D[i]; st.band[i] = out[i]; } }
  return out;
}
