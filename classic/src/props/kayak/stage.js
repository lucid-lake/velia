// The kayak's demo stage in Sail (feat/kayak). Only with ?kayak=: the live game
// is unchanged (no kayak in the world; the owner wants no empty kayak on the water). Loaded by a dynamic import, so the
// game's bundle does not carry it.
//
//   ?kayak=<colour>[,<wear 0–1>[,<seed>[,<lift m>[,bag]]]]   colour: a preset (yellow, red, orange, lime, blue, teal), a
//                                           scheme (sunset, orange-white, blue-white) or a hex; bag: a dry bag in the tank well
//                                           (E2B12C); lift holds it that high over the water (the shape study: the hull's lines)
//   ?kayakpos=<x>,<z>[,<heading°>|s<deg>]   where it floats (world m); default 40 m ahead and 12 m to starboard of the
//                                           start; s<deg>: the heading relative to the sun's bearing (s90: broadside to it)
//   ?paddler=<seed>[,<what>[,<pfd>[,<figure>]]]  the paddler (src/props/paddler/): on by default, =0 an empty kayak; what: a
//                                           mode, mode@phase, script or a key pose; pfd: red, orange, yellow, blue; figure:
//                                           male / female (else the seed picks), man (the first round's figure); a 5th field:
//                                           a skin tone (I … VI, look.js SKIN) with its hair
//   ?kayakcam=<dist>,<height>,<az°>[,<fov>[,<look m>[,w<lead m>|s<lag s>]]] the camera on the kayak: az from astern (0), the starboard beam (90), ahead (180),
//                                           or f<deg> from the sun's side (f0 front-lit, f180 into the sun);
//                                           a live page orbits it (a turntable, 8°/s) and shows the colour and wear switches
// The kayak floats on the real water: its heave, pitch and roll from the surface's heights under the bow, the stern and
// both sides, its draft from the hull's own volume (shape.js waterlineFor), the wet band at that line.
import * as THREE from 'three/webgpu';
import { createKayak, KAYAK_COLOURS, KAYAK_SCHEMES } from './index.js';

export function parsePaddlerFlag(v) {
  // ?paddler=<seed>[,<what>[,<pfd>]]: default on, paddling at cruise (a kayak never shows empty); =0 the empty kayak (the
  // hull studies). what: a mode (rest, cruise, sprint, turnLeft, turnRight, back), a mode at a held phase of its stroke
  // (cruise@0.25: a still), 'script' (the 12 s demo: rest → cruise → sprint → a turn → rest) or a key pose (poses.js)
  if (v === '0' || v === 'off') return null;
  const [sd = '1', what = 'cruise', pfd = '', fig = '', skin = ''] = String(v ?? '').split(',');
  const [w, at] = (what || 'cruise').split('@');
  const out = { seed: parseInt(sd, 10) || 1, what: w, phase: at != null && Number.isFinite(parseFloat(at)) ? parseFloat(at) : null, pfd: pfd || undefined };
  if (fig) out.figure = fig;   // 'man': the first round's figure; 'male' / 'female': that UBC figure whatever the seed
  if (skin) out.skin = skin;   // a skin tone by its name (look.js SKIN: I … VI)
  return out;
}

// the 12 s demo (?paddler=…,script): [start s, mode]
export const PADDLER_SCRIPT = Object.freeze([[0, 'rest'], [2, 'cruise'], [5, 'sprint'], [8, 'turnLeft'], [10.5, 'rest']]);

const DEG = Math.PI / 180;

export function parseKayakFlag(v) {
  const [c = 'yellow', w = '0.35', sd = '1', lf = '0', extra = ''] = String(v ?? '').split(',');
  const colour = KAYAK_COLOURS[c] || KAYAK_SCHEMES[c] ? c : /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : 'yellow';
  const wear = Number.isFinite(parseFloat(w)) ? Math.min(1, Math.max(0, parseFloat(w))) : 0.35;
  return { colour, wear, seed: parseInt(sd, 10) || 1, lift: Math.max(0, parseFloat(lf) || 0), bag: extra === 'bag' };
}

export async function attachKayakStage(core, player) {
  const { flags, scene, camera, water, headless } = core;
  const opt = parseKayakFlag(flags.kayak);
  const po = parsePaddlerFlag(flags.paddler);
  const k = createKayak({ colour: opt.colour, wear: opt.wear, seed: opt.seed, bag: opt.bag, paddle: po ? 'held' : 'stowed' });
  scene.add(k.group);
  let paddler = null, splash = null, script = null;
  if (po) {
    const P = await import('../paddler/index.js');
    const isMode = !!P.MODES[po.what], isPose = !isMode && !!P.KEY_POSES[po.what];   // 'rest' is the mode (with its idles)
    paddler = P.createPaddler({ gltf: await P.loadPaddlerGltf(po.figure === 'man' ? 'man' : 'ubc'), kayak: k, seed: po.seed,
      look: { ...(po.pfd ? { pfd: po.pfd } : {}), ...(po.figure === 'male' || po.figure === 'female' ? { sex: po.figure } : {}), ...(po.skin ? P.skinLook(po.skin) : {}) },
      pose: isPose ? po.what : null, mode: isMode ? po.what : po.what === 'script' ? 'rest' : 'cruise' });
    if (po.what === 'script') script = PADDLER_SCRIPT;
    if (!isPose && po.phase != null) paddler.snap(po.phase);
    else if (!isPose && headless && !script) paddler.snap(0.1);   // a still of a moving mode: straight into it
    splash = P.createSplash({ seed: po.seed, waterY: paddler.waterY });
    scene.add(splash.mesh); scene.add(splash.rings);   // the water off the blades lives in the world (the boat runs past it)
  }
  const st = player.phys.state;
  // where: ?kayakpos, else ahead and to starboard of the boat's start
  let x, z, heading;
  // the sun's bearing (compass, clockwise from north = −z), for the sun-relative heading and camera ('s…', 'f…')
  const sd = core.sun?.direction ?? core.sunWorld, hSun = sd ? Math.atan2(sd.x, -sd.z) : 0;
  const ang = (v, dflt) => (v == null || v === '' ? dflt : /^s/.test(v) ? hSun + parseFloat(v.slice(1)) * DEG : Number.isFinite(parseFloat(v)) ? parseFloat(v) * DEG : dflt);
  const raw = flags.kayakpos?.split(',');
  const pos = raw?.map(parseFloat);
  if (pos && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) { x = pos[0]; z = pos[1]; heading = ang(raw[2], st.heading + 0.5); }
  else {
    const h = st.heading, ahead = 40, stbd = 12;
    x = st.x + Math.sin(h) * ahead + Math.cos(h) * stbd; z = st.z - Math.cos(h) * ahead + Math.sin(h) * stbd; heading = ang(raw?.[2], h + 0.5);   // ?kayakpos=,,s90: the default spot, a sun-relative heading
  }
  const draft = k.draft(k.dims.mass.empty + k.dims.mass.paddle + (paddler ? k.dims.mass.paddler : 0));
  k.setWaterline(opt.lift > 0 ? -1 : draft);
  const L = k.dims.length * 0.38, B = k.dims.beam * 0.40;
  const hAt = (lx, lz, t) => {   // the water's height under a point of the kayak frame
    const wx = x + Math.cos(heading) * lx - Math.sin(heading) * lz, wz = z + Math.sin(heading) * lx + Math.cos(heading) * lz;
    return water.surface.heightAt(wx, wz, t, {});
  };
  // the kayak moves as the paddler's strokes drive it (src/props/paddler/index.js: the planted blade's push on a simple
  // hull, ≈ 1.2 m/s cruising, 2.3 sprinting, a glide between strokes): the stage only applies the step's advance and yaw,
  // so the planted blade stays put in the world. Each pull dips the hull a little. (A demo, not the game's physics.)
  const ride = { v: 0, dip: 0 };
  // ?kayakref=<n>[,<spacing m>[,<offset m>]]: n fixed race marks (1.2 m orange spheres) along the kayak's start line, every
  // spacing m ahead, offset m to starboard (negative: to port), floating on the water: still references for a film, so a
  // fixed camera shows the kayak moving past them (round 9: the owner saw no convincing forward motion)
  const refs = []; let marksMod = null;
  if (flags.kayakref) {
    const [n = 3, sp = 4, off = -3] = String(flags.kayakref).split(',').map(parseFloat);
    marksMod = await import('../../marks/models.js');
    const { buildMark } = marksMod;
    for (let i = 0; i < (Number.isFinite(n) ? n : 3); i++) {
      const m = buildMark('sphere', { colour: 'orange' }), d = (Number.isFinite(sp) ? sp : 4) * (i - 0.5), o = Number.isFinite(off) ? off : -3;
      m.userData.x = x + Math.sin(heading) * d + Math.cos(heading) * o; m.userData.z = z - Math.cos(heading) * d + Math.sin(heading) * o;
      scene.add(m); refs.push(m);
    }
  }
  function push(out, dt) {
    if (!out || dt <= 0) return;
    heading += out.boat.dyaw;
    x += Math.sin(heading) * out.boat.advance; z -= Math.cos(heading) * out.boat.advance;   // ahead is (sin h, −cos h)
    ride.v = out.boat.v;
    ride.dip += (Math.min(0.25, Math.abs(out.thrust) * 0.0025) - ride.dip) * (1 - Math.exp(-6 * dt));   // eased, frame-rate independent
  }
  function float(t) {
    const c = hAt(0, 0, t), bow = hAt(0, -L, t), stern = hAt(0, L, t), port = hAt(-B, 0, t), stbd = hAt(B, 0, t);
    const mean = (2 * c + bow + stern + port + stbd) / 6;
    k.group.position.set(x, mean - draft + opt.lift - ride.dip * 0.03, z);
    k.group.rotation.set(Math.atan2(bow - stern, 2 * L) * 0.85 - ride.dip * 0.01, -heading, Math.atan2(stbd - port, 2 * B) * 0.6, 'YXZ');
    k.group.updateMatrixWorld(true);
  }
  const sunCol = new THREE.Color();
  function light() {
    const e = core.sun?.elevationDeg ?? 30, dir = core.sun?.direction ?? core.sunWorld;
    // the backlight's strength in scene units: sunlit white (as the boat's spray, assemble.js) fading with the sun's height
    const lum = 0.6 / (core.sun?.exposure ?? 6), g = THREE.MathUtils.smoothstep(e, -1, 8);
    sunCol.setRGB(1.0, 0.86 - 0.12 * (1 - THREE.MathUtils.smoothstep(e, 4, 25)), 0.72 - 0.2 * (1 - THREE.MathUtils.smoothstep(e, 4, 25))).multiplyScalar(lum * 3.9 * g);
    if (dir) k.setSun(dir, sunCol);
    marksMod?.setDaylight(e);   // the marks' fluorescent orange by daylight (without it they render dark red)
    k.materials.u.sunK.value = THREE.MathUtils.smoothstep(e, 0, 10);
  }
  const camRaw = flags.kayakcam?.split(','), cam = camRaw?.map(parseFloat);
  // az: degrees from the kayak's stern, clockwise; or 'f<deg>' from the sun's side (f0: the sun behind the camera, f180:
  // looking into the sun, the backlit edges)
  const sunAz = camRaw?.[2] && /^f/.test(camRaw[2]) ? parseFloat(camRaw[2].slice(1)) || 0 : null;
  let orbit = 0;
  // a 6th field: 'w<lead m>' a camera fixed in the world (set once, aimed at the kayak's start plus lead metres ahead: the
  // kayak runs past a still camera, the planted blades stay put), 's<τ s>' a camera that follows smoothly (lag τ)
  const camMode = camRaw?.[5] ?? '', worldCam = /^w/.test(camMode), smoothCam = /^s/.test(camMode);
  const camLead = worldCam ? parseFloat(camMode.slice(1)) || 0 : 0, camTau = smoothCam ? parseFloat(camMode.slice(1)) || 0.8 : 0;
  let camFixed = false; const camTarget = new THREE.Vector3(); let camHeading = null;
  function aim(dt = 0) {
    if (!cam || !Number.isFinite(cam[0])) return;
    if (worldCam && camFixed) return;
    const [dist, h, az0 = 0, fov, look] = cam, az = Number.isFinite(az0) ? az0 : 0;
    const want = k.group.position.clone();
    if (worldCam) want.add(new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading)).multiplyScalar(camLead));
    if (smoothCam && dt > 0) { const kf = 1 - Math.exp(-dt / camTau); camTarget.lerp(want, kf); camHeading += (heading - camHeading) * kf; }
    else { camTarget.copy(want); camHeading = heading; }
    const a = sunAz != null ? hSun + (sunAz - orbit) * DEG - Math.PI : camHeading - (az + orbit) * DEG;
    const c = camTarget;
    // az 0: from astern (the kayak's +z), clockwise seen from above
    camera.position.set(c.x - Math.sin(a) * dist, c.y + h, c.z + Math.cos(a) * dist);
    camera.lookAt(c.x, c.y + (Number.isFinite(look) ? look : 0.18), c.z);   // look: the aim's height over the keel (the paddler: ≈ 0.6)
    if (Number.isFinite(fov)) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    camFixed = true;
  }
  const t0 = core.time;
  float(t0); light(); aim(); k.update(camera.position);
  const panel = headless ? null : makePanel(k, opt, () => cam, paddler);
  let clock = 0, scriptAt = -1, last = null;
  // one step of the paddler: the script's mode, the motion, the water off the blades, the push on the kayak
  function paddle(dt) {
    if (!paddler) return null;
    clock += dt;
    if (script) { let i = 0; for (let j = 0; j < script.length; j++) if (clock >= script[j][0]) i = j; if (i !== scriptAt) { scriptAt = i; paddler.setMode(script[i][1]); } }
    const out = paddler.update(dt);
    splash.setWater(k.group.position.y + paddler.waterY);
    for (const e of out.events) {
      const sp = Math.abs(out.blades[e.side].speed) + Math.abs(out.boat.v) * 0.5;
      if (e.type === 'catch') splash.catch(k.group.localToWorld(e.at.clone()), 0.4 + sp * 0.4);   // a few droplets; no ring (owner, 2026-11-07)
      else {
        const side = e.side; splash.exit(() => k.group.localToWorld((last?.blades ?? out.blades)[side].tip.clone()), 0.5 + sp * 0.3);
      }
    }
    splash.update(dt);
    push(out, dt);
    last = out;
    return out;
  }
  function step(dt, { orbitOn = false, aimOn = true } = {}) {
    paddle(dt);
    float(core.time); light();
    for (const m of refs) m.position.set(m.userData.x, water.surface.heightAt(m.userData.x, m.userData.z, core.time, {}) + 0.25, m.userData.z);
    if (orbitOn) orbit += 8 * dt;
    if (aimOn && cam) aim(dt);
    k.update(camera.position);
    return last;
  }
  // step(dt): a film frame (tools/paddler-film.mjs: after Sail's film.step advanced the scene clock)
  // recam(): a world-fixed camera is set again from here (a film sets it after its run-up)
  const pub = core.services.provide('kayak', { kayak: k, paddler, float, aim, step, recam: () => { camFixed = false; aim(0); }, at: () => ({ x, z, heading, draft, v: ride.v }) });
  return {
    kayak: k, paddler,
    update(dt) {
      step(Math.min(dt, 0.1), { orbitOn: !headless && cam && panel?.spin(), aimOn: !headless });
    },
    dispose() { for (const m of refs) scene.remove(m); panel?.remove(); paddler?.dispose(); if (splash) { scene.remove(splash.mesh); scene.remove(splash.rings); splash.dispose(); } scene.remove(k.group); k.dispose(); core.services.remove('kayak', pub); },
  };
}

// the live demo's switches: a navy glass plate with the colour chips, a wear slider and the turntable toggle
function makePanel(k, opt, hasCam, paddler) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:50;padding:12px 14px;border-radius:12px;background:rgba(28,35,64,.86);'
    + 'backdrop-filter:blur(12px);color:rgb(239,230,210);font:500 15px/1.4 system-ui,sans-serif;display:grid;gap:8px;min-width:240px';
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  for (const [name, hex] of [...Object.entries(KAYAK_COLOURS), ...Object.entries(KAYAK_SCHEMES).map(([n, s]) => [n, `linear-gradient(90deg, ${s.a}, ${s.b})`])]) {
    const b = document.createElement('button'); b.title = name; b.setAttribute('aria-label', name);
    b.style.cssText = `width:28px;height:28px;border-radius:50%;border:1px solid rgba(239,230,210,.5);background:${hex};cursor:pointer`;
    b.onclick = () => k.setColour(name); row.appendChild(b);
  }
  const wear = document.createElement('input'); wear.type = 'range'; wear.min = '0'; wear.max = '1'; wear.step = '0.01'; wear.value = String(opt.wear);
  wear.oninput = () => k.setWear(parseFloat(wear.value));
  const wl = document.createElement('label'); wl.textContent = 'Wear '; wl.appendChild(wear);
  const spin = document.createElement('input'); spin.type = 'checkbox'; spin.checked = true;
  const sl = document.createElement('label'); sl.appendChild(spin); sl.append(' Turntable');
  d.append(row, wl);
  if (paddler) {   // the paddler's modes (the controller a later traffic system or player mode drives)
    const pr = document.createElement('div'); pr.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    for (const [m, label] of [['rest', 'Rest'], ['cruise', 'Cruise'], ['sprint', 'Sprint'], ['turnLeft', 'Turn left'], ['turnRight', 'Turn right'], ['back', 'Back']]) {
      const b = document.createElement('button'); b.textContent = label;
      b.style.cssText = 'padding:6px 10px;border-radius:8px;border:1px solid rgba(239,230,210,.5);background:rgba(239,230,210,.08);color:rgb(239,230,210);font:500 14px system-ui,sans-serif;cursor:pointer';
      b.onclick = () => paddler.setMode(m); pr.appendChild(b);
    }
    d.append(pr);
  }
  if (hasCam()) d.append(sl);
  document.body.appendChild(d);
  return { spin: () => spin.checked, remove: () => d.remove() };
}
