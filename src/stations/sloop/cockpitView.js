// The cockpit's numbers and its camera, pure (no three.js): split out of cockpit3d.js unchanged (M4 of Velia v2, 2026-11-13)
// so v2's cockpit (v2/ui/station.js) lays out on v1's own numbers. cockpit3d.js re-exports all of it; v1's behaviour is the same
// bytes. Tests: tests/cockpit3d.test.mjs (through cockpit3d.js), v2/tests/station.test.mjs.
const DEG = Math.PI / 180;
// Metres; the pedestal's column at x = 0, z = 0; the sole at y = 0; +x starboard (screen right), +y up, +z aft (toward the
// camera). Screen targets are shares of the viewport height (at 1080: the hub at 1090, the cap's lip at 990).
export const COCKPIT = {
  hfov: 50, camZ: 8, ref: 16 / 9,
  hub: { y: 0.55, z: 0.14, at: 0.996 },    // the wheel's hub: about half the rim above the screen's edge (round 2's fix a)
  cap: { y: 0.40, z: -1.72, at: 0.89 },   // the cap's top at the centre (CH + CAPT)   // the cap's lip at the centre
  helmScale: 1.35,                         // the pedestal and the wheel, a stage concession as the cockpit's width is (round 2: 213 px, now 288 at 1080)
  wheelR: 0.4065,                          // the boat's wheel's rim radius (wheel.glb), before helmScale
  winchScale: 1.7, leverScale: 1.45, tackScale: 2.0, toggleScale: 1.15, moorScale: 1.6,   // round 2's fix c: bigger, nearer the wheel, real-looking at screen size
  // the dials (feat/cockpit-dials): set into the coaming's ends, so the face is rebalanced: the PRO recess to port (wider), the
  // engine panel beside the lever, the switches beyond it to starboard, MOOR a push-button on the cap like TACK, MAIN's word
  // centred under its winch again
  // look/pro-panel C3 (owner 2026-11-12): BINOS and VHF small push-buttons in TACK's style, on the face between each instrument and
  // its recess (BINOS by the chart, VHF by the wind), their words engraved under them; `tool` their height on the face, `toolScale`
  // their size (TACK's parts × it)
  x: { tack: -0.98, jib: -1.62, main: 1.62, moor: 2.2, inst: 2.8, binos: -2.43, vhf: 2.43 },
  toolY: 0.17, toolScale: 0.9, toolPx: 15,
  // the names cut into the cap (labelConsts' default): each beside its item toward the wheel, along the coaming (m of arc from the
  // item's centre): a winch's base and TACK's cover the cap's whole depth, so none fits on the helm side under its item
  capPx: 20, capDx: { jib: 0.32, tack: 0.31, main: -0.32 },
  // the single lever on its own post on the sole beside the pedestal (stage 1b: off the cap, so nothing on the cap rises into the
  // subtitle's lane between the winches). fix/cockpit-lever (owner 2026-11-11: "the lever is too short ... words ... barely can be
  // read"; then "the lever should be self explain": no words): a top-mount control box (box: w, h, d before leverScale) with a
  // fore-aft gate in its top; the stem rises out of the gate from a pivot `pivot` under the top, `stem` long (was 0.18), the knob
  // `knob` in radius (was 0.038); the top slopes `slope` down toward the helmsman (box h at the middle). Outboard of the wheel's rim.
  lever: { x: 0.70, y: 0.58, z: 0.06, box: [0.14, 0.12, 0.13], slope: 22 * DEG, pivot: 0.035, stem: 0.32, knob: 0.048 },
  CH: 0.35, CAPT: 0.05, CAPO: 0.19, LIP: 0.03,          // the face's height, the cap's thickness, its reach aft, its lip
  RY0: 0.04, RY1: 0.235, RD: 0.04,                     // the recesses: foot, head, depth (a band above them for the words)
  holes: { pro: [-2.24, -0.93, undefined, -0.10], engine: [0.92, 1.34], switches: [1.37, 2.34] },   // [x0, x1, head, foot]; every recess under the band now (JIB, TACK, MAIN, MOOR's words over them)
  // look/pro-panel A (owner 2026-11-12: "the bottom 4 items are too crowded ... can we expand the panel to bottom little bit"): the PRO
  // recess goes 0.14 m deeper, its foot under the sole, through a shallow footwell let into the sole in front of it (d aft, its floor
  // `below` under the recess's foot); the screen there showed teak sole, so the cockpit covers no more of the view
  well: { d: 0.32, below: 0.05 },
  // the PRO recess (look C3): only the trim controls and PRO's own button; BINOS and VHF are push-buttons by the instruments, LOG is the menu's
  pro: { buttons: [['pro', 'PRO']],
    sliders: [['traveller', 'TRAVELLER'], ['jibLead', 'JIB LEAD'], ['vang', 'VANG'], ['backstay', 'BACKSTAY']],
    btnY: 0.203, trackY: 0.132, wordY: 0.071, track: 0.22, openS: 0.4, px: 13 },
  fold: { tilt: 0.22, sink: 2.0 },          // the fold-away: the top tips away 0.22 rad as the object sinks 2 m
  toggles: [['sails', 'SAILS', 1.532], ['anchor', 'ANCHOR', 1.855], ['reef', 'REEF', 2.178]],
  // the two instruments (chart to port, wind to starboard), flush in the coaming's ends: the plan turns through a straight facet
  // there (45°), the face leans back `lean` above y0 and steps up `rise` (the cap with it) over `ramp` m of arc; R the face's
  // radius, y its centre's height; each a dark smoked-glass face in a slim dark bezel with a stainless lip and a rubber gasket
  inst: { R: 0.27, y: 0.365, lean: 30 * DEG, y0: 0.095, rise: 0.32, ramp: 0.32, pad: 0.03, down: 0.7 },
  carHover: 1.4,                          // a slider car's ribs' glow under the pointer (× 6 / exposure, as the lit amber; look/pro-sliders)
  wordFloor: 0.45,                        // a plate word's own floor by day, by the world's light (× 1 / exposure: screen terms; look/cockpit-light)
  faceGain: [3.2, 1.2],                   // the faces' backlight by day and by night, in screen terms (× 1 / exposure); × glow while it matters
  bandY: 0.279,                            // the band's words (JIB, TACK, MAIN, MOOR): centred in the face between the recesses' head and the lip's shadow
  band: 'face', bandPx: 17,                // the names (JIB, TACK, MAIN, MOOR): 'face' (on the band: ?cockpitlabels=a), 'plate' (each on its own engraved
                                         // placard on the cap's edge under its part: labelConsts, the default)
  platePx: 17, plateGap: 0.014,           // the placards' letters (px at 1080, as the face's words) and the gap over the recesses' head (the
                                         // placard stands proud of the face, so from above it reads lower: it cleared PRO's top row on a phone)
  plateDx: { main: 0.14 },                 // a placard's shift along the coaming, m (MAIN's clears its winch's tail, which leads aft and inboard)
  toggleY: 0.15, togglePx: 15,             // the port recess's toggles: their nut's height on the plate, their words' size
  btnScale: 1, carScale: 1, btnWord: 'side',   // the PRO recess's push buttons and slider cars (× size); its buttons' words beside them or 'below'
  subGap: 26 / 1080,                       // the subtitle's foot over the wheel's top (round 2's fix d: was 10 px)
  // the PRO recess (look C3; labelConsts lays it over its own), in the deeper recess (its foot in a footwell): PRO's toggle in a
  // column `toggleW` wide (its nut and its placard at the switches' own heights), then a 2 x 2 grid of identical
  // sliders: track length = column − 2 · trackMargin, the top row's track at trackY, the bottom row's rowPitch under it, each word
  // wordY − trackY over its track; car: w, h; knob: its handle's radius; one tick scale for all.
  // look/pro-sliders (owner 2026-11-12: "very hard for ppl to read what it is and understand it can be move"; "go sliders"): each a
  // 'rail', deck hardware that slides: a wide brushed rail with a black slot, black end stops, three ticks, − and + faint at its ends;
  // a bigger car with a ridged grip (`ridges` stainless ribs across a black bed); the names larger (px) and lighter (wordFloor)
  proLook: { layout: 'c', toggleW: 0.32, trackY: 0.17, rowPitch: 0.2, wordY: 0.262, trackMargin: 0.05, trackH: 0.04, scaleH: 0.02,
    car: [0.125, 0.072], ridges: 7, px: 16, wordFloor: 0.8, kinds: { traveller: 'rail', jibLead: 'rail', vang: 'rail', backstay: 'rail' } },
};

// The phone held sideways (feat/cockpit-phone, stage 3; owner 2026-11-06: "phones, landscape-first"): the same object on a short,
// wide screen (844 x 390 to 932 x 430). The lens spans the phone's own width (no 16:9 middle: the coaming keeps its desktop width
// and its ends, the instruments, stay inside the frame), narrower, so the parts read at a finger's size; the hub and the cap sit a
// little higher on the screen. Only these numbers differ: cockpitConsts(true) merges them over COCKPIT.
// TACK steps inboard of the PRO recess (on a desktop it stands over the recess's end; on a phone the recess's ≥ 44 px rows reach up
// over the cap there), and the recess ends short of it.
// Look C3: a phone has no 44 px room for BINOS and VHF on the face beside the instruments (nor beside TACK or the lever), so there they
// stand on the console's cap over each instrument (toolOn 'cap'), no word (it would be under 6 px).
export const COCKPIT_PHONE = { hfov: 40, ref: Infinity, hub: { at: 0.985 }, cap: { at: 0.84 }, x: { tack: -0.7, binos: -2.8, vhf: 2.8 }, toolOn: 'cap', toolScale: 1.1, holes: { pro: [-2.24, -1.02, undefined, -0.10] }, proLook: { ...COCKPIT.proLook, px: 14 },
  platePx: 18, plateDx: { main: 0.14, jib: -0.06 },   // the placards: a size up (the phone draws the face smaller); JIB's into the gap between BINOS and VHF (the recess is narrower here)
  maxPx: 1800 };   // the render target's long side on a phone (≈ 2.1 px per css px at 844: crisper than the Low scene, a third of 3x's pixels)
export function cockpitConsts(phone = false) {
  if (!phone) return COCKPIT;
  const P = COCKPIT_PHONE, C = { ...COCKPIT, ...P };
  for (const k of ['hub', 'cap', 'x', 'holes', 'inst', 'pro']) if (P[k]) C[k] = { ...COCKPIT[k], ...P[k] };
  return C;
}

// The JIB / TACK / MAIN words (owner 2026-11-10: "more rooms for the control buttons"; then "we need to engrave the texts jib,
// main, tack etc to that physical item nicely"). No band: each name is engraved on its own placard, a dark powder-coated plate
// with a polished rim screwed to the teak cap's edge under its part, letters cut as the panels' words (one look). The band's height goes to the recesses (their head RY1 rises to 0.31 m) and their
// parts grow with it; the words' width is the limit along the face (TRAVELLER, ANCHOR fill their column), so only words with room
// grow. A desktop and a phone alike (C0: cockpitConsts(phone)). ?cockpitlabels=a keeps the old band for one release.
export const LABEL_MODES = ['a', 'b'];
export function labelConsts(mode = 'b', C0 = COCKPIT) {
  if (mode === 'a') return C0;
  const ry1 = 0.31, vs = (ry1 - C0.RY0) / (C0.RY1 - C0.RY0), Y = (y) => C0.RY0 + (y - C0.RY0) * vs;
  const P = C0.pro;
  return { ...C0, RY1: ry1, band: 'plate', names: 'cap',
    toggleY: Y(C0.toggleY) - 0.022, toggleScale: C0.toggleScale * vs, togglePx: 16,
    btnScale: vs, carScale: Math.min(vs, 1.3), btnWord: 'below',
    pro: { ...P, track: P.track * Math.min(vs, 1.2), btnY: 0.272, btnWordY: 0.188, trackY: 0.128, wordY: 0.070, btnPx: 16, ...(C0.proLook ?? {}) } };
}

// ---- the camera (pure) ---------------------------------------------------------------------------------------------------
// The lens spans the viewport's width up to 16:9 (an ultrawide keeps the 16:9 middle's scale); its height and pitch are solved
// so the hub and the cap's lip land on their screen shares. Returns the focal length (px), the vertical fov, the camera's
// height yc and pitch th (down, rad), the coaming's half-width hw (so its ends leave the frame), and projections.
export function cockpitView({ w, h, phone = false }, C = cockpitConsts(phone)) {
  const fw = Math.min(w, h * C.ref), f = (fw / 2) / Math.tan(C.hfov * DEG / 2), vfov = 2 * Math.atan((h / 2) / f);
  const H = { ...C.hub, px: C.hub.at * h }, P = { ...C.cap, px: C.cap.at * h };
  const yOf = (yc, th, p) => h / 2 + f * Math.tan(Math.atan((yc - p.y) / (C.camZ - p.z)) - th);
  let yc = 3, th = 0;
  let lo = 0.6, hi = 14;
  for (let k = 0; k < 60; k++) {
    yc = (lo + hi) / 2;
    th = Math.atan((yc - H.y) / (C.camZ - H.z)) - Math.atan((H.px - h / 2) / f);
    if (yOf(yc, th, P) - P.px > 0) lo = yc; else hi = yc;
  }
  const hw = 3.3 * Math.max(1, (w / h) / C.ref);
  const y = (p) => yOf(yc, th, p);
  const x = (px, pz) => w / 2 + f * px / ((C.camZ - pz) * Math.cos(th));   // near enough for layout (the exact one: the camera)
  const wheelR = C.wheelR * C.helmScale;
  const wheelTop = y({ y: C.hub.y + wheelR, z: C.hub.z });
  return { f, vfov, yc, th, hw, w, h, y, x, wheelTop, hubY: y(C.hub), capY: y(C.cap), wheelPx: 2 * wheelR * f / (C.camZ - C.hub.z),
    subBottom: wheelTop - C.subGap * h };
}
