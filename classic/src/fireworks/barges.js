// The show's barges (owner decision 2026-11-08, strategy A; S2): low-poly but real. Since the wow round they lie
// inside the bay, in the evening only (src/fireworks/presence.js: 20:30–23:30, never popping into view; solid for our boat:
// src/fireworks/solids.js, which also gives their poses for a tow and a shoved patrol boat, setPoses). Per barge: a flat steel deck barge
// (60 × 18 m, raked ends, 2.5 m freeboard) with rows of mortar racks, a work shed and two containers; a pusher tug at its
// stern (push knees, a deckhouse, a raised wheelhouse, a mast with two white masthead lights and the sidelights); dim work
// lights before the show; on the 300 m safety zone, two patrol boats (8.5 m, a console and T-top) with blinking blue light bars.
//   const b = createBarges({ barges: [{ x, z, axis: [ax, az] }], waterY: 0, toward: [x, z], wet }); scene.add(b.group)
//   wet(x, z): is there water here (realism round: the barges came in by the mouth, and a patrol boat's ±35° spot on the zone
//   fell on Eagle Point; it swings round the zone toward the viewer until it floats)
//   b.update(showT, { exposure, showOn, night })   each frame: the lights' levels (screen levels / exposure), the blue blink
//   b.setPoses(solids.bodies)                       the groups where the solids are (a tow, a patrol boat shoved)
import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4, uv, float } from 'three/tsl';

export const BARGE = { length: 60, beam: 18, freeboard: 2.5, zone: 110, work: 0.8, blue: 3.0, nav: 1.6 };
// the patrol boat (m; lampPx/navPx: the sprites' screen size, as the spectators' anchor lights; wash: the hull's blue
// lift at a flash and its faint base, screen levels)
// the deck, shed and tug lamps (fix/barge-collision round 2, the coordinator: "large translucent cream discs float round the
// barge"; they were glowing spheres 1.0, 0.8 and 0.6 m in radius, 2 m discs, 55 px wide from 30 m): now a real-sized
// fixture (a dark housing, a 0.1 m bulb) and a soft point of a fixed screen size (px: sizeAttenuation off, ≈ 3–4 px at
// 720 p at every range); workPt: the point's level (screen levels, × night / exposure, dimmed 70 % once the show runs)
const LAMP = { workPx: 0.007, mastPx: 0.0045, sidePx: 0.004, workPt: 2.4, bulb: 0.1 };
export const PATROL = { length: 8.5, beam: 2.7, free: 0.9, draft: 0.45, lampPx: 0.005, navPx: 0.0035, wash: 0.12, washBase: 0.015, bar: 0.6 };

export const patrolAngle = (base, s, b, wet = null) => {
  for (let k = 0; k <= 12; k++) { const a = base + s * (0.6 - 0.1 * k); if (!wet || wet(b.x + Math.sin(a) * BARGE.zone, b.z + Math.cos(a) * BARGE.zone)) return a; }
  return base + s * 0.6;
};

export function createBarges({ barges, waterY = 0, toward = [0, 0], wet = null } = {}) {
  const group = new THREE.Group(); group.name = 'fireworks-barges';
  const uWork = uniform(0), uBlue = uniform(0), uNav = uniform(0), uWash = uniform(0), uBar = uniform(0);
  const std = (c, r = 0.85, m = 0.2) => new THREE.MeshStandardNodeMaterial({ color: c, roughness: r, metalness: m });
  const hullMat = std(0x34302c), deckMat = std(0x4a4640), rackMat = std(0x5a4632, 0.9, 0), tubeMat = std(0x2a2c2e, 0.6, 0.5);
  const shedMat = std(0x8a8678), roofMat = std(0x3c4044), contA = std(0x7a2c22), contB = std(0x2c4a6a);
  const tugHull = std(0x1f2a33), tugHouse = std(0xd8d2c4, 0.6, 0.1), tugTrim = std(0xb8401f);
  const glow = (c, u) => { const m = new THREE.MeshBasicNodeMaterial({ fog: false }); m.colorNode = vec4(vec3(...c).mul(u), 1); return m; };
  const workMat = glow([1.0, 0.78, 0.5], uWork);
  // a light as a point: a sprite of a fixed screen size (sizeAttenuation off), additive (the spectators' anchor lights' way),
  // round: a soft falloff from its centre (a square of 3–4 px read as a pixel block)
  const point = (c, u) => {
    const m = new THREE.SpriteNodeMaterial({ sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const f = float(1).sub(uv().sub(0.5).length().mul(2)).clamp(0, 1);
    m.colorNode = vec4(vec3(...c).mul(u).mul(f.mul(f)), 1);
    return m;
  };
  const uWorkPt = uniform(0), workPoint = point([1.0, 0.82, 0.58], uWorkPt);
  const whitePoint = point([1, 0.96, 0.9], uNav);
  const blueMat = point([0.04, 0.16, 1.0], uBlue), redPoint = point([1, 0.08, 0.04], uNav), greenPoint = point([0.1, 1, 0.25], uNav);
  // the patrol boat: lit faintly by its own blue flashes (a blue wash on the hull, uWash) over the night's own light
  const washed = (c, r, m) => { const mt = std(c, r, m); mt.emissiveNode = vec3(0.35, 0.5, 1.0).mul(uWash); return mt; };
  const patrolMat = washed(0xe6e4de, 0.5, 0.1), railMat = washed(0x5a6068, 0.6, 0.2), frameMat = std(0xb8bcc0, 0.4, 0.7);
  const screenMat = std(0x0e141a, 0.15, 0.3), barMat = glow([0.03, 0.1, 0.9], uBar);
  // its hull: the plan (a pointed bow, a square transom) extruded to the freeboard and the draft
  const PL = PATROL.length, PB = PATROL.beam;
  const plan = new THREE.Shape();
  plan.moveTo(-PB / 2, PL / 2); plan.lineTo(PB / 2, PL / 2); plan.lineTo(PB / 2, -PL / 2 + 2.6);
  plan.quadraticCurveTo(PB / 2 - 0.1, -PL / 2 + 0.6, 0, -PL / 2); plan.quadraticCurveTo(-PB / 2 + 0.1, -PL / 2 + 0.6, -PB / 2, -PL / 2 + 2.6); plan.closePath();
  const patrolHull = new THREE.ExtrudeGeometry(plan, { depth: PATROL.free + PATROL.draft, bevelEnabled: false, curveSegments: 6 });
  patrolHull.rotateX(Math.PI / 2); patrolHull.translate(0, PATROL.free, 0);   // the plan's y → −z (the bow ahead), the deck at the freeboard
  const patrolRail = new THREE.ExtrudeGeometry(plan, { depth: 0.12, bevelEnabled: false, curveSegments: 6 });
  patrolRail.rotateX(Math.PI / 2); patrolRail.scale(1.04, 1, 1.02); patrolRail.translate(0, PATROL.free - 0.05, 0);
  const whiteNav = glow([1, 0.96, 0.9], uNav), redNav = glow([1, 0.08, 0.04], uNav), greenNav = glow([0.1, 1, 0.25], uNav);
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const bulbGeo = new THREE.SphereGeometry(LAMP.bulb, 8, 6), houseGeo = new THREE.BoxGeometry(0.34, 0.24, 0.24);
  // a lamp at (x, y, z) in `parent`: its bulb (glowing, real size), a dark housing behind it (work lamps), and its point
  const lamp = (parent, x, y, z, bulbMat, pt, px, housing = false) => {
    const b = new THREE.Mesh(bulbGeo, bulbMat); b.position.set(x, y, z); parent.add(b);
    if (housing) { const h = new THREE.Mesh(houseGeo, tubeMat); h.position.set(x, y + 0.12, z); parent.add(h); }
    const sp = new THREE.Sprite(pt); sp.scale.setScalar(px); sp.position.set(x, y, z); parent.add(sp);
  };

  // the barge's hull: its side profile (raked bow and stern) extruded across the beam
  const L = BARGE.length, Bm = BARGE.beam, F = BARGE.freeboard, D = 1.6;   // D: the draft below the water
  const prof = new THREE.Shape();
  prof.moveTo(-L / 2 + 4, -D); prof.lineTo(L / 2 - 4, -D); prof.lineTo(L / 2, F); prof.lineTo(-L / 2, F); prof.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(prof, { depth: Bm, bevelEnabled: false });
  hullGeo.translate(0, 0, -Bm / 2); hullGeo.rotateY(Math.PI / 2);   // length along local z
  // the mortar tubes: one instanced mesh a barge, in its group (racks of 10 tubes, 2 rows of 12 racks a barge), so a barge
  // moves with its tubes (the tow, fix/barge-collision)
  const tubesPer = 2 * 12 * 10, tubeGeo = new THREE.CylinderGeometry(0.13, 0.13, 1.1, 6);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const items = [];   // per barge: its group (the barge and tug) and its two patrol boats' groups

  barges.forEach((b) => {
    const ax = b.axis ?? [0, 1], yaw = Math.atan2(ax[0], ax[1]);
    const g = new THREE.Group(); g.position.set(b.x, waterY, b.z); g.rotation.y = yaw;
    g.add(new THREE.Mesh(hullGeo, hullMat));
    const tubes = new THREE.InstancedMesh(tubeGeo, tubeMat, tubesPer); let ti = 0;
    const deck = box(Bm - 0.4, 0.1, L - 1, deckMat); deck.position.y = F + 0.05; g.add(deck);
    for (const side of [-1, 1]) for (let i = 0; i < 12; i++) {
      const z = -22 + i * 3.6, x = side * 4.2;
      const rk = box(2.4, 0.9, 1.1, rackMat); rk.position.set(x, F + 0.45, z); g.add(rk);
      for (let k = 0; k < 10; k++) {
        v.set(x - 1.0 + (k % 5) * 0.5, F + 1.0, z - 0.25 + Math.floor(k / 5) * 0.5);
        tubes.setMatrixAt(ti++, m4.compose(v, q, one));
      }
    }
    tubes.count = ti; tubes.instanceMatrix.needsUpdate = true; tubes.computeBoundingSphere?.(); g.add(tubes);
    const item = { g, patrols: [] }; items.push(item);
    const shed = box(6, 3, 4, shedMat); shed.position.set(0, F + 1.5, 24); g.add(shed);
    const roof = box(6.6, 0.25, 4.6, roofMat); roof.position.set(0, F + 3.1, 24); g.add(roof);
    const c1 = box(2.4, 2.6, 12, contA); c1.position.set(-6.5, F + 1.3, 20); g.add(c1);
    const c2 = box(2.4, 2.6, 6, contB); c2.position.set(6.5, F + 1.3, 22); g.add(c2);
    for (let i = 0; i < 6; i++) {   // on 3 m poles at the deck's edges
      const x = (i % 2 ? 1 : -1) * (Bm / 2 - 0.5), z = -25 + i * 10;
      const pole = box(0.08, 3, 0.08, tubeMat); pole.position.set(x, F + 1.5, z); g.add(pole);
      lamp(g, x, F + 3, z, workMat, workPoint, LAMP.workPx, true);
    }
    lamp(g, 0, F + 2.6, 19.85, workMat, workPoint, LAMP.workPx, true);   // over the shed's door (its face toward the bow)
    // the pusher tug at the stern: square bow with push knees, deckhouse, raised wheelhouse, a mast with its lights
    const tug = new THREE.Group(); tug.position.set(0, 0, L / 2 + 11);
    const th = box(8, 3.2, 20, tugHull); th.position.y = 0.4; tug.add(th);
    const sheer = box(8.2, 0.3, 20.2, tugTrim); sheer.position.y = 2.1; tug.add(sheer);
    for (const sx of [-2.6, 2.6]) { const knee = box(0.6, 3.4, 0.8, tugHull); knee.position.set(sx, 3.2, -9.6); tug.add(knee); }
    const house = box(6, 2.6, 9, tugHouse); house.position.set(0, 3.3, 2); tug.add(house);
    const wh = box(5, 2.4, 4, tugHouse); wh.position.set(0, 5.8, 0.5); tug.add(wh);
    const glass = box(5.05, 0.9, 4.05, std(0x10161c, 0.2, 0.3)); glass.position.set(0, 6.2, 0.5); tug.add(glass);
    const mast = box(0.25, 5, 0.25, tugTrim); mast.position.set(0, 9.4, 0.5); tug.add(mast);
    for (const y of [11.4, 10.4]) lamp(tug, 0, y, 0.5, whiteNav, whitePoint, LAMP.mastPx);   // pushing ahead: two masthead lights
    lamp(tug, -2.6, 6.4, -1.4, redNav, redPoint, LAMP.sidePx);
    lamp(tug, 2.6, 6.4, -1.4, greenNav, greenPoint, LAMP.sidePx);
    lamp(tug, 0, 7.2, -1.6, workMat, workPoint, LAMP.workPx, true);
    g.add(tug);
    group.add(g);
    // two patrol boats on the zone's edge, on the viewer's side, ±35° off the line toward `toward` (polish round, owner:
    // the blue light read as a floating ring): an 8.5 m patrol boat sitting on the water at its draft (a pointed hull,
    // a grey rub rail, a centre console with a dark screen, a T-top) with a slim blue light bar on the T-top; its two
    // lamps are small screen-sized points that double-blink, and each flash washes the hull and console faintly blue
    const base = Math.atan2(toward[0] - b.x, toward[1] - b.z);
    for (const s of [-1, 1]) {
      const a = patrolAngle(base, s, b, wet), p = new THREE.Group();
      p.position.set(b.x + Math.sin(a) * BARGE.zone, waterY, b.z + Math.cos(a) * BARGE.zone); p.rotation.y = a + Math.PI / 2;
      const hull = new THREE.Mesh(patrolHull, patrolMat); p.add(hull);
      const rail = new THREE.Mesh(patrolRail, railMat); p.add(rail);
      const con = box(1.3, 1.1, 1.2, patrolMat); con.position.set(0, PATROL.free + 0.55, 0.2); p.add(con);
      const scr = box(1.25, 0.45, 0.06, screenMat); scr.position.set(0, PATROL.free + 1.05, -0.38); scr.rotation.x = -0.5; p.add(scr);
      for (const sx of [-0.8, 0.8]) for (const sz of [-0.2, 1.4]) { const post = box(0.06, 1.9, 0.06, frameMat); post.position.set(sx, PATROL.free + 0.95, sz); p.add(post); }
      const top = box(1.9, 0.08, 2.0, frameMat); top.position.set(0, PATROL.free + 1.94, 0.6); p.add(top);
      const bar = box(1.1, 0.12, 0.2, barMat); bar.position.set(0, PATROL.free + 2.04, 0.0); p.add(bar);
      for (const sx of [-0.45, 0.45]) { const l = new THREE.Sprite(blueMat); l.scale.setScalar(PATROL.lampPx); l.position.set(sx, PATROL.free + 2.12, 0.0); p.add(l); }
      const rl = new THREE.Sprite(redPoint); rl.scale.setScalar(PATROL.navPx); rl.position.set(-1.1, PATROL.free + 0.1, -3.2); p.add(rl);
      const gl = new THREE.Sprite(greenPoint); gl.scale.setScalar(PATROL.navPx); gl.position.set(1.1, PATROL.free + 0.1, -3.2); p.add(gl);
      group.add(p); item.patrols.push(p);
    }
  });

  // night: 0 by day, 1 from the sun 8° down (the lights on); showOn: 1 once the show runs (the work lights dim)
  function update(t, { exposure = 2172, showOn = 0, night = 1 } = {}) {
    const k = night / Math.max(exposure, 1e-6);
    uWork.value = BARGE.work * k * (1 - 0.7 * showOn);
    uWorkPt.value = LAMP.workPt * k * (1 - 0.7 * showOn);
    uNav.value = BARGE.nav * k;
    const ph = (((t % 1e4) + 1e4) * 1.5) % 1;   // the blue lights: a double blink each 0.67 s
    const on = ph < 0.08 || (ph > 0.18 && ph < 0.26);
    uBlue.value = (on ? BARGE.blue : 0) * k;
    uBar.value = (on ? PATROL.bar : 0.04) * k;
    uWash.value = (PATROL.washBase + (on ? PATROL.wash : 0)) * k;
  }
  // the poses from the solids (src/fireworks/solids.js bodies: the tow, a patrol boat shoved and back on station); a group's
  // rotation.y is −heading
  function setPoses(bodies) {
    for (const b of bodies) {
      const it = items[b.barge]; if (!it) continue;
      const o = b.kind === 'barge' ? it.g : b.kind === 'patrol' ? it.patrols[b.side] : null;
      if (!o) continue;
      o.position.x = b.x; o.position.z = b.z; o.rotation.y = -b.heading;
    }
  }
  return { group, update, items, setPoses };
}
