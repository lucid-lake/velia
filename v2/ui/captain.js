// The captain's two tools on v2 (BACKLOG-v2 #5, #6): v1's binoculars and VHF radio (src/sail/captainTools.js) on v2's page.
// captainTools.js itself reaches three (the VHF set's 3D model, src/boat/vhf.js; the craft registry), so this is its logic on
// v1's own three-free modules, as they are:
//   the binoculars   src/boat/binoculars.js (Binoculars: the 6.5° field at the helm's eye, the raise and the lowering, the
//                    world-held aim, the steadying, the hand sway, the focus pull; blendPose), src/ui/binocularsView.js (the
//                    figure-eight lens mask, the rim and its fringe, the focus blur on the page's canvas), src/ui/binocularsHud.js
//                    (the compass, the mil reticle, the rangefinder, 7×50 and the focus, the glare): driven by v2's camera chain
//                    (m4.camera: the views' pose is the "normal" the glasses rise from) and drawn by v2's engine at their field
//   the VHF          src/vhf/radio.js (the clips through a radio: the band-pass, the presence lift, the soft clip, the hiss and
//                    the squelch; the plan from the sprite's clip lengths; the wordless chatter on 16), src/vhf/forecast.js (the
//                    forecast from v2's WindField: the bay's sampled wind over the next hour, the trend, the waves, the advisory),
//                    src/vhf/harbourMaster.js (the harbour master's calls on 16)
// v1's rules, as captainTools.js has them: B (or the PRO recess's BINOS) latches the glasses up and again lowers them; Escape or a
// click on the water lowers them; while they are up the mouse aims them with no drag, a drag (or one finger) aims too, and the
// views underneath get no look. O asks the weather channel now (a second press turns back to 16). The radio is on by default
// (the settings key 'vhf', saved): the forecast by itself 20 s into a sail, the harbour master and the harbour's chatter, the voices
// only once the player has used the radio (O, or the VHF turned on;: the sprite loads on first use); the
// Pro panel's VHF (the recess's dome, or the trim panel's push-button) turns it off and on.
// The sound: v2's page AudioContext (engine/audio.js, made in the first gesture), the radio on its own gain node (a bus that
// eases in, and eases out before a stop: no click), into the page's master. The clips (audio/vhf/forecast.opus + .json, or the
// .m4a twin) are fetched only after the first frame (this chunk loads after Sail's UI) and only while the radio is on: the
// clip table when the radio is made, the sprite on its first play. Live pages, plus a ?filmui=1 page with ?bino=1 (the golden).
//   const cap = createCaptain({ B, windField, terrain, settings, audio, services, hint, dial, canvas, flags, v2flags });
//   each frame: cap.takeLook(hands) (main.js readHands: the drag goes to the glasses while they are up),
//               pose = cap.camera(dt, normal, sun) (m4.camera, after the views), cap.update(dt) (m4.beforeStep: the radio)
import { Binoculars, blendPose as binoBlend } from '../../src/boat/binoculars.js';
import { createBinocularsView } from '../../src/ui/binocularsView.js';
import { createBinocularsHud } from '../../src/ui/binocularsHud.js';
import { createRadio } from '../../src/vhf/radio.js';
import { forecastJob } from '../../src/vhf/forecast.js';
import { createHarbourMaster } from '../../src/vhf/harbourMaster.js';
import { VHF, lcdView } from '../../src/boat/vhfFace.js';
import { advisoryWeight } from '../../src/sim/wind.js';
import { cameras as sloopCameras } from '../../src/sim/craft/sloop/cameras.js';
import { FLAGS } from '../../src/sim/core/flags.js';
import WORLD from './logbookWorld.json' with { type: 'json' };
import { feature } from '../../src/core/features.js';
import { teaHouseTop, RANGE_MARGIN_M } from '../sim/teaHouse.js';   // the rangefinder reads the tea house's walls on a desktop (owner 2026-11-18)

// captainTools.js's numbers (that module is three-bound, so they are copied; v2/tests/captain.test.mjs holds them to v1's source)
export const AUTO_FORECAST_S = 20;   // the weather channel speaks by itself this long after the start (VHF on)
export const CHATTER = { nearM: 700, gapS: [70, 160], firstS: 25 };
// the radio's own bus on the page's master: eased in when the context comes, eased out before a stop (no click)
export const VHF_BUS = { gain: 1, inS: 0.03, outS: 0.012, stopMs: 60 };
const DEG = Math.PI / 180;
// the mouse's aim while the glasses are up, no drag (src/deck/index.js: movementX × 0.005, movementY × 0.004)
// BACKLOG-v2 (2026-11-19): the glasses' pitch could not reach the ridge: the cursor hits the screen's top edge after about half
// a screen of travel and movementY stops, and at 1/7 of a drag's rate that was only about +15 deg from a level start. So the
// up-down aim has pitchGain x the rate (the whole -20..+35 deg range in about 600 px), and a cursor held in the top or bottom
// edgeFrac of the window keeps tilting (edgeDegS at the very edge) so the range never depends on how far the pointer can go.
export const AIM = { x: 0.005, y: 0.004, clickPx: 6, pitchGain: 3, edgeFrac: 0.08, edgeDegS: 30 };

// v1's terrain.shoreDistance for the forecast's fetch (fetchTrace: from the bay's middle upwind to the shore), from v2's heights
// alone: water (height < 0) steps stepM at a time, land is the shore. fetchTrace's 400 steps reach 10 km at 25 m.
export const shoreFromHeights = (heightAt, stepM = 25) => (x, z) => (heightAt(x, z) >= 0 ? 0 : -stepM);

// The wind the forecast samples. v1's day clock runs on a Sail page, so forecast.js finds the scene time of each hour ahead by
// bisection on wind.hourAt (timeAtHour). v2's live clock may be frozen (timerate 0, the default until the day clock comes): the
// bisection then doubles out to ≈ 10^13 s and the gust cells at that time exhausted the page (a renderer crash on O). With a frozen
// clock the forecast reads the same field on a 1 h / h clock from now (the day's base held at the hour, the gusts and shifts
// moving on); with a running one it is the field itself.
export function forecastWind(wind, t0) {
  const h0 = wind.hourAt?.(t0);
  if (!wind.day || h0 == null || wind.hourAt(t0 + 3600) - h0 > 1e-6) return wind;
  return new Proxy(wind, { get: (w, k) => (k === 'hourAt' ? (t) => h0 + (t - t0) / 3600 : typeof w[k] === 'function' ? w[k].bind(w) : w[k]) });
}

// #35: the VHF set's LCD, v1's captainTools.update tail and createVhf().update's gate: what the set shows from the radio's
// state (the channel, the call's or the forecast's text, the character the voice is at, RX), its view re-made at most VHF.hz a
// second (a change of RX at once) and published ({ view, n }: n moves only when the view changed; render/boatInstruments.js
// redraws the face then). No allocation in a frame where the gate is shut.
export function createLcd() {
  const input = { channel: '16', text: '', charAt: null, rx: false };
  const out = { view: lcdView({}), n: 0 };
  let acc = 1, key = '', lastRx = false;
  key = `${out.view.big}|${out.view.tag}|${out.view.line}`;
  return {
    out, input,
    // channel; st the radio's state (or null); text the words on air (the call's or the forecast's); dt the real dt
    step(channel, st, text, dt) {
      const plan = st?.plan;
      let charAt = null;
      if (st?.playing && plan && st.token >= 0) {
        let it = null; for (const i of plan.items) if (i.token === st.token) { it = i; break; }
        const c0 = plan.charAt[st.token], c1 = plan.charAt[st.token + 1] ?? text.length;
        charAt = c0 + Math.min(1, Math.max(0, (st.at - it.at) / it.dur)) * (c1 - c0);
      }
      const rx = !!(st?.playing || st?.chatter);
      input.channel = channel; input.text = text; input.charAt = charAt; input.rx = rx;
      acc += rx !== lastRx ? 1 : dt; lastRx = rx;
      if (acc < 1 / VHF.hz) return false;
      acc = 0;
      const v = lcdView(input), k = `${v.big}|${v.tag}|${v.line}`;
      if (k === key) return false;
      key = k; out.view = v; out.n++;
      return true;
    },
  };
}

// the binoculars' HUD reads a three camera (matrixWorld's columns: right, up, back; position): a pose turned into that shape
export function cameraShim(out = { matrixWorld: { elements: new Float64Array(16) }, position: { x: 0, y: 0, z: 0 } }) {
  return {
    cam: out,
    set(p) {
      const e = out.matrixWorld.elements;
      let fx = p.target[0] - p.pos[0], fy = p.target[1] - p.pos[1], fz = p.target[2] - p.pos[2];
      const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      const u = p.up ?? [0, 1, 0];
      let rx = fy * u[2] - fz * u[1], ry = fz * u[0] - fx * u[2], rz = fx * u[1] - fy * u[0];   // right = fwd × up
      const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
      const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;   // up = right × fwd
      e[0] = rx; e[1] = ry; e[2] = rz; e[4] = ux; e[5] = uy; e[6] = uz; e[8] = -fx; e[9] = -fy; e[10] = -fz; e[15] = 1;
      out.position.x = p.pos[0]; out.position.y = p.pos[1]; out.position.z = p.pos[2];
      return out;
    },
  };
}

// v1's src/audio.js attach(fn) on v2's page sound: fn({ ctx, master }) once the context runs, with master the radio's own bus
export function radioAudio(audio, bus = VHF_BUS) {
  const S = { node: null, ctx: null };
  return {
    S,
    attach(fn) {
      audio?.ready?.then?.(({ ctx, master }) => {
        const g = new GainNode(ctx, { gain: 0 });
        g.connect(master);
        g.gain.setTargetAtTime(bus.gain, ctx.currentTime, bus.inS);
        S.node = g; S.ctx = ctx;
        fn({ ctx, master: g });
      });
    },
    // the bus down over a few ms, then fn (the radio's own stop: its sources end on silence), then the bus back up
    quiet(fn) {
      if (!S.node) { fn(); return; }
      const t = S.ctx.currentTime, g = S.node.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(0, t, bus.outS);
      setTimeout(() => { fn(); const t2 = S.ctx.currentTime; g.cancelScheduledValues(t2); g.setValueAtTime(g.value, t2); g.setTargetAtTime(bus.gain, t2 + 0.02, bus.inS); }, bus.stopMs);
    },
  };
}

export function createCaptain({ B, windField, terrain, settings = null, audio = null, services = null, hint = null, dial = null, canvas = null, flags = FLAGS, bino: binoAtStart = false,
  live = true, auto = true, root = globalThis.document?.body, dom = !!globalThis.document, makeRadio = createRadio, base = 'audio/vhf/' } = {}) {
  const heightAt = (x, z) => terrain.field.height(x, z);
  const doc = globalThis.document;
  // ---- the binoculars ----
  const bino = new Binoculars({ eye: sloopCameras(B.vessel).helm.eye });   // the sloop's helm eye (v1: camerasFor(vessel).helm.eye)
  const view = dom ? createBinocularsView({ canvas, root }) : null;
  // the rangefinder: the terrain, and the tea house's walls where it stands (a desktop: the ruin is drawn there only)
  const rangeAt = feature('teaHouse').on ? (x, z) => Math.max(heightAt(x, z), teaHouseTop(x, z, RANGE_MARGIN_M)) : heightAt;
  const hud = dom ? createBinocularsHud({ terrain: { heightAt: rangeAt }, root }) : null;
  const shim = cameraShim();
  // bino: true, or [bearingDeg, pitchDeg] (?bino=228.4,1: raised from the start and aimed there, the golden's framing)
  let last = { k: 0, aim: null, pose: null }, latched = binoAtStart === true || Array.isArray(binoAtStart), aimX = 0, aimY = 0, edgeY = 0, aimStart = Array.isArray(binoAtStart) ? binoAtStart : null;
  const up = () => latched || last.k > 0;
  const setLatch = (on) => { latched = !!on; };
  // the views' look while the glasses are up goes to their aim (v1: viewLook null, the look to tools.camera)
  function takeLook(hands) {
    if (!up()) return hands;
    if (hands.orbit) { aimX += hands.orbit[0]; aimY += hands.orbit[1] * AIM.pitchGain; }
    hands.orbit = null; hands.zoom = 0;
    return hands;
  }
  // normal: the views' pose (follow | helm | the move between) → the glasses' pose blended over it; sun: { x, y, z } for the glare
  const cardUp = () => !!(services?.get?.('menu')?.isOpen || services?.get?.('logbook')?.logbook?.isOpen);
  function camera(dt, normal, sun = null) {
    // a card coming up (the Menu by its button, the logbook) lowers them. Escape lowers them before the Menu (#34: front.js
    // logLinks escFirst names the raised glasses, so v1's card lets that press through to onKey below, as v1's shell)
    if (latched && cardUp()) latched = false;
    if (!latched) edgeY = 0;
    else if (edgeY) aimY += edgeY * AIM.edgeDegS * DEG * 7 * Math.min(dt, 0.1);   // the cursor held at the top or bottom edge (rad of look; the glasses scale it by 1/7)
    const look = aimX || aimY ? [aimX, aimY] : null;
    aimX = 0; aimY = 0;
    let b = bino.update(dt, B.pose, { held: latched, look: latched ? look : null, from: normal });
    if (aimStart && b.pose) { bino.yaw = aimStart[0] * DEG; bino.pitch = aimStart[1] * DEG; aimStart = null; b = bino.update(0, B.pose, { held: latched }); }   // ?bino=bearing,pitch
    last = b;
    view?.update(b.k, b.blurPx);
    // the skipper's line and the wind dial step aside while the glasses are up (they return as they were)
    const hide = b.k > 0.05;
    if (hint?.el) hint.el.style.visibility = hide ? 'hidden' : '';
    if (dial?.el) dial.el.style.visibility = hide ? 'hidden' : '';
    const pose = b.pose ? binoBlend(normal, b.pose, b.k) : normal;
    if (hud) hud.update(b.k, b.k > 0 ? shim.set(pose) : null, sun, dt);
    if (dom && doc.documentElement.classList.contains('lk-bino-up') !== up()) doc.documentElement.classList.toggle('lk-bino-up', up());   // v1's deck.setBino: no chart circle over the glasses
    return pose;
  }

  // ---- the VHF ----
  const prefs = () => settings ?? services?.get?.('settings') ?? null;
  const isOn = () => prefs()?.get?.('vhf') !== false;
  const bus = radioAudio(audio);
  let radio = null;
  const ensureRadio = () => (radio ??= isOn() ? makeRadio({ audio: bus, base }) : null);
  let job = null, fc = null, shownFor = 0, channel = '16';
  let rt = 0, nextChatter = CHATTER.firstS, chatterN = 0, autoFc = false;
  //, 2026-11-17: "the VHF forecast audio loads on first use of the radio"; every device): the voices'
  // sprite (233 KB) is fetched on its first play, and nothing plays it before the player first uses the radio (O, the VHF button
  // turning it on): until then no forecast by itself and no harbour master's call; then the forecast comes as before (at 20 s, or at
  // once if that is past). The chatter on 16 is made in code (no fetch) and stays
  let used = false;
  const hm = createHarbourMaster(); let hmCall = null;
  const harbourAt = WORLD.harbour?.entrance?.centre;
  const fcTerrain = { heightAt, shoreDistance: shoreFromHeights(heightAt) };
  // the stop eased: the bus down, then v1's stop (its sources end on silence); a new call started meanwhile is left alone (its own
  // play() already stopped the old sources). The state reads stopped at once, as v1's stop().
  const stopRadio = () => {
    if (!radio || !(radio.state.playing || radio.state.chatter)) return;
    const r = radio, gen = ++stopGen;
    r.state.playing = false; r.state.chatter = false; r.state.token = -1;
    bus.quiet(() => { if (gen === stopGen && !r.state.playing && !r.state.chatter) r.stop(); });
  };
  let stopGen = 0;
  const setOn = (on) => { prefs()?.set?.('vhf', !!on); if (!on) { stopRadio(); job = null; channel = '16'; } else { used = true; ensureRadio(); } return isOn(); };
  const toggle = () => setOn(!isOn());
  function listen() {
    used = true;
    if (radio?.state.playing || job) { stopRadio(); job = null; channel = '16'; return false; }   // a second press turns it back to 16
    if (!ensureRadio()) return false;
    channel = 'WX 1';
    job = forecastJob({ wind: forecastWind(windField, B.t), t: B.t, terrain: fcTerrain });   // one time step a frame (≈ 3 ms each): a press never stalls a frame
    return true;
  }
  const lcd = createLcd();
  const onAir = () => (hmCall && radio?.state.plan?.items[0]?.id === hmCall.tokens[0].id ? hmCall.text : fc?.text ?? '');
  function update(dt) {
    rt += dt;
    const on = isOn();
    if (!on) { if (radio?.state.playing || job) { stopRadio(); job = null; channel = '16'; } lcd.step(channel, radio?.state ?? null, onAir(), dt); return; }
    ensureRadio();
    // the forecast by itself, once, a little after the start (never in a capture or a first visit's stage)
    if (auto && live && used && !autoFc && !flags.fv && rt > AUTO_FORECAST_S && !job && !radio.state.playing && flags.headless !== '1' && flags.hm !== false) { autoFc = true; listen(); }
    if (job) { const r = job.next(); if (r.done) { fc = r.value; job = null; radio.play(radio.plan(fc.tokens)); shownFor = 0; } }
    // the harbour master: a call when the moment is real and the radio is quiet (never over the forecast)
    if (live && !job && channel === '16' && flags.hm !== false) {   // (unused: the harbour master keeps his watch, the radio reads busy)
      const adv = !!windField.day?.advisory && advisoryWeight(windField.hourAt(B.t)) > 0.5;
      const c = hm.step(dt, { anchored: services?.get?.('seamanship')?.anchoredNow ?? false, tws: B.state.trueWind?.speed ?? 0, advisory: adv, busy: !used || radio.state.playing || radio.state.chatter });
      if (c) { hmCall = c; radio.play(radio.plan(c.tokens)); }
    }
    const st = radio.update(dt);
    if (!st.playing && channel === 'WX 1' && !job && fc) { shownFor += dt; if (shownFor > 4) channel = '16'; }
    // the harbour's chatter: rare, quiet, on 16 only, within 700 m of the entrance
    if (live && harbourAt && channel === '16' && !st.playing && rt > nextChatter) {
      const near = Math.hypot(B.state.x - harbourAt[0], B.state.z - harbourAt[1]) < CHATTER.nearM;
      chatterN++;
      const r = ((chatterN * 2654435761) >>> 0) / 4294967296;
      nextChatter = rt + CHATTER.gapS[0] + (CHATTER.gapS[1] - CHATTER.gapS[0]) * r;
      if (near && flags.chatter !== false) radio.chatter(chatterN);
    }
    lcd.step(channel, radio.state, onAir(), dt);   // #35: the set's LCD follows the voice
  }

  // ---- the hands: B, Escape (O went: the VHF is its button's and Conditions'); the mouse's aim; a click lowers the glasses ----
  const typing = () => { const a = doc?.activeElement; return /^(INPUT|SELECT|TEXTAREA)$/.test(a?.tagName ?? '') || !!a?.isContentEditable; };
  const onKey = (e) => {
    if (e.lkDock || e.lkVirtual) return;
    if (e.code === 'Escape') { latched = false; return; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing()) return;
    if (cardUp()) return;   // a card is up: its keys
    if (e.code === 'KeyB') setLatch(!latched);
  };
  const onMove = (e) => {
    if (!latched || (e.buttons & 7)) { edgeY = 0; return; }
    aimX += (e.movementX ?? 0) * AIM.x; aimY += (e.movementY ?? 0) * AIM.y * AIM.pitchGain;
    const h = (typeof innerHeight === 'number' && innerHeight) || 0, f = AIM.edgeFrac;   // -1 at the top edge (tilt up) to +1 at the bottom
    const r = h && Number.isFinite(e.clientY) ? e.clientY / h : 0.5;
    edgeY = r < f ? -(f - r) / f : r > 1 - f ? (r - (1 - f)) / f : 0;
  };
  let down = null;
  const onDown = (e) => { down = latched ? [e.clientX, e.clientY] : null; };
  const onUp = (e) => { if (down && latched && e.button === 0 && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < AIM.clickPx) latched = false; down = null; };   // v1: a click while the glasses are up lowers them, no course
  if (live && typeof addEventListener === 'function') {
    addEventListener('keydown', onKey); addEventListener('mousemove', onMove);
    canvas?.addEventListener?.('pointerdown', onDown); canvas?.addEventListener?.('pointerup', onUp);
  }
  ensureRadio();   // on: the radio (its clip table, 3.4 kB) as this chunk comes, after the first frame; the sprite on its first play
  const offSettings = prefs()?.on?.((k, v) => { if (k === 'vhf') { if (v === false) { stopRadio(); job = null; channel = '16'; } else ensureRadio(); } });

  const api = {
    bino, view, hud, camera, takeLook, update, listen, isOn, setOn, toggle, setLatch,
    get latched() { return latched; }, get k() { return last.k; }, get binoUp() { return up(); },
    // the glasses' eye and aim while fully raised (discoveries.js S.bino, the logbook's sight finds), else null
    get aim() { return last.k >= 0.999 ? last.aim : null; },
    get on() { return isOn(); }, get used() { return used; }, get radio() { return radio; }, get forecast() { return fc; }, get channel() { return channel; }, get job() { return job; },
    get hmDone() { return hm.done; }, hmAsk: (id) => hm.ask(id), get hmCall() { return hmCall; }, get bus() { return bus.S.node; },
    get lcd() { return lcd.out; },   // #35: the VHF set's LCD ({ view: { big, tag, line }, n }), read by render/boat.js
    row() { return { latched, k: +last.k.toFixed(3), on: isOn(), channel, playing: !!radio?.state.playing, chatter: !!radio?.state.chatter, token: radio?.state.token ?? -1, at: +(radio?.state.at ?? 0).toFixed(2), forecast: fc?.text ?? null, hm: hm.done }; },
    dispose() { removeEventListener?.('keydown', onKey); removeEventListener?.('mousemove', onMove); canvas?.removeEventListener?.('pointerdown', onDown); canvas?.removeEventListener?.('pointerup', onUp); offSettings?.(); view?.dispose(); hud?.dispose(); radio?.stop(); },
  };
  services?.provide?.('captainTools', api);   // v1's service name: the logbook's sight finds, the panel's lit states
  return api;
}
