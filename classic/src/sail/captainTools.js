// The captain's two tools (owner, 2026-10-29): the binoculars (B or the dock's icon raises them and
// they stay up, B again lowers them; the gamepad: the left stick's click, held) and the VHF on the pedestal (O, or the left-stick click): the weather channel's forecast from the game's own
// wind, and now and then a wordless call on 16 near the harbour. Live pages only (controls.js builds it).
//   const tools = createCaptainTools(core, { boat, phys, hint, captain });
//   each frame, from controls.update: const cam = tools.camera(dt, pose, normalPose, { held, look });  tools.update(dt)
import { Binoculars, blendPose } from '../../../src/boat/binoculars.js';
import { camerasFor } from '../../../src/sim/craft/index.js';
import { createBinocularsView } from '../../../src/ui/binocularsView.js';
import { createVhf } from '../boat/vhf.js';
import { createRadio } from '../../../src/vhf/radio.js';
import { forecastJob } from '../../../src/vhf/forecast.js';
import { createHarbourMaster } from '../../../src/vhf/harbourMaster.js';
import { advisoryWeight } from '../../../src/sim/wind.js';

// the harbour's chatter: within nearM of the entrance, one call every gapS (± half), never over the forecast
export const AUTO_FORECAST_S = 20;   // the weather channel speaks by itself this long after the start (VHF on)
export const CHATTER = { nearM: 700, gapS: [70, 160], firstS: 25 };

export function createCaptainTools(core, { boat, phys, hint = null, captain = null, dock = null, helmPick = null, icons = {}, auto = true }) {
  const { flags, renderer, wind, terrain, audio, harbour, services } = core;
  // ---- the binoculars ----
  const bino = new Binoculars({ eye: camerasFor(phys.vessel).helm.eye });   // the craft's helm eye (step 7)
  const view = createBinocularsView({ canvas: renderer.domElement });
  let last = { k: 0, aim: null };
  function camera(dt, pose, normal, { held, look }) {
    const b = bino.update(dt, pose, { held, look, from: normal });
    last = b;
    view.update(b.k, b.blurPx);
    // the hints and the glyph step aside while the glasses are up (they return as they were)
    const hide = b.k > 0.05;
    if (hint) hint.el.style.visibility = hide ? 'hidden' : '';
    if (captain) captain.el.style.visibility = hide ? 'hidden' : '';
    if (api.camOverride) return api.camOverride(normal);   // a probe's close-up: fn(normal) → a pose (tools/probe_bino.mjs vhf-set)
    return b.pose ? blendPose(normal, b.pose, b.k) : normal;
  }

  // the terrain's detail where the glasses look (terrain-lod.js focus): a virtual eye on the aim, 1/mag of the way from
  // the land the aim meets (a ray over the terrain, ≤ 8 km), refreshed 4× a second; null with the glasses down
  let focus = null, focusT = 0;
  function lodFocus(dt) {
    const a = last.k >= 0.999 ? last.aim : null;
    if (!a) { focus = null; return null; }
    focusT -= dt; if (focus && focusT > 0) return focus;
    focusT = 0.25;
    let D = 3000;
    for (let s = 60; s < 8000; s *= 1.06) { if (terrain.heightAt(a.x + a.fx * s, a.z + a.fz * s) > a.y + a.fy * s) { D = s; break; } }
    const r = D * (1 - 1 / bino.o.mag);
    focus = { x: a.x + a.fx * r, y: a.y + a.fy * r, z: a.z + a.fz * r };
    return focus;
  }

  // ---- the VHF ----
  const vhf = createVhf();
  boat.sockets.hull.add(vhf.group);
  const radio = createRadio({ audio });
  let job = null, fc = null, shownFor = 0, channel = '16', lastRx = false;
  let rt = 0, nextChatter = CHATTER.firstS, chatterN = 0;
  // the radio is on by default (owner, 2026-10-30; the Settings key 'vhf', saved): the forecast at the start of a sail, the harbour master and the chatter play by themselves;
  // the Pro trim panel's VHF button turns it off and on. O (and the set in the helm view) still asks for the forecast now.
  const prefs = () => services.get('settings') ?? null;   // the shell's shared settings (src/shell.js)
  const isOn = () => prefs()?.get?.('vhf') !== false;
  let autoFc = false;   // the start-of-sail forecast has been asked
  const setOn = (on) => { prefs()?.set?.('vhf', !!on); if (!on) { radio.stop(); job = null; channel = '16'; } return isOn(); };
  const toggle = () => setOn(!isOn());
  const hm = createHarbourMaster(); let hmCall = null;   // the harbour master's calls on 16: the weather and the big moments
  const harbourAt = harbour?.layout?.entrance?.centre;
  function listen() {
    if (radio.state.playing || job) { radio.stop(); job = null; channel = '16'; return false; }   // a second press turns it back to 16
    channel = 'WX 1';
    // the forecast is sampled a time step per frame (≈ 3 ms each), so the press never stalls a frame
    job = forecastJob({ wind, t: core.time, terrain });
    return true;
  }
  function update(dt) {
    rt += dt;
    const live = isOn();
    if (!live && (radio.state.playing || job)) { radio.stop(); job = null; channel = '16'; }
    // the forecast by itself, once, a little after the start (never in a headless capture)
    if (live && auto && !autoFc && !flags.fv && rt > AUTO_FORECAST_S && !job && !radio.state.playing && flags.headless !== '1' && flags.hm) { autoFc = true; listen(); }
    if (job) {
      const r = job.next();
      if (r.done) { fc = r.value; job = null; radio.play(radio.plan(fc.tokens)); shownFor = 0; }
    }
    // the harbour master: a call when the moment is real and the radio is quiet (never over the forecast); the LCD shows it
    if (live && !job && channel === '16' && flags.hm) {
      const adv = !!wind.day?.advisory && advisoryWeight(wind.hourAt(core.time)) > 0.5;
      const c = hm.step(dt, { anchored: services.get('seamanship')?.anchoredNow ?? false, tws: phys.state.trueWind?.speed ?? 0, advisory: adv, busy: radio.state.playing || radio.state.chatter });
      if (c) { hmCall = c; radio.play(radio.plan(c.tokens)); }
    }
    const st = radio.update(dt);
    if (!st.playing && channel === 'WX 1' && !job && fc) { shownFor += dt; if (shownFor > 4) channel = '16'; }
    // the harbour's chatter: rare, quiet, on 16 only
    if (live && harbourAt && channel === '16' && !st.playing && rt > nextChatter) {
      const near = Math.hypot(phys.state.x - harbourAt[0], phys.state.z - harbourAt[1]) < CHATTER.nearM;
      chatterN++;
      const r = ((chatterN * 2654435761) >>> 0) / 4294967296;
      nextChatter = rt + CHATTER.gapS[0] + (CHATTER.gapS[1] - CHATTER.gapS[0]) * r;
      if (near && flags.chatter) radio.chatter(chatterN);
    }
    // the LCD's line follows the voice: the spoken token's characters, spread over its clip
    const plan = radio.state.plan;
    let charAt = null;
    if (st.playing && plan && st.token >= 0) {
      const lcd = hmCall && plan.items[0]?.id === hmCall.tokens[0].id ? hmCall.text : fc?.text ?? '';
      const it = plan.items.find((i) => i.token === st.token), c0 = plan.charAt[st.token], c1 = plan.charAt[st.token + 1] ?? lcd.length;
      charAt = c0 + Math.min(1, Math.max(0, (st.at - it.at) / it.dur)) * (c1 - c0);
    }
    const rx = st.playing || st.chatter;
    vhf.update({ channel, text: hmCall && radio.state.plan?.items[0]?.id === hmCall.tokens[0].id ? hmCall.text : fc?.text ?? '', charAt, rx }, rx !== lastRx ? 1 : dt);
    lastRx = rx;
  }
  // the mouse and B (owner, 2026-11-12: "click B should be same as mouse left click"): the dock's
  // binoculars and a B press are one toggle: they latch the glasses up, and a click again, B again, Escape or a click on
  // the water lowers them; the mouse aims meanwhile. A key up never lowers them. This is the one B listener (Sail,
  // Cruise, Regatta): no repeats, no dock or pad stand-in keys, no modifier, not while typing in a field.
  let latched = false;
  const setLatch = (on) => { latched = !!on; };
  const typing = () => { const a = globalThis.document?.activeElement; return /^(INPUT|SELECT|TEXTAREA)$/.test(a?.tagName ?? '') || !!a?.isContentEditable; };
  addEventListener('keydown', (e) => {
    if (e.lkDock || e.lkVirtual) return;
    if (e.code === 'Escape') { latched = false; return; }
    if (e.code === 'KeyB' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !typing()) setLatch(!latched);
  });
  dock?.register({ id: 'binoculars', key: 'B', name: 'binoculars', icon: icons.binoculars, order: 30, action: () => setLatch(!latched) });
  dock?.register({ id: 'radio', key: 'O', name: 'VHF radio', icon: icons.radio, order: 40, action: () => toggle() });   // the panel's VHF button: the radio on / off
  helmPick?.register({ id: 'radio', object: vhf.set, kind: 'click', action: () => listen() });

  const api = { lodOn: flags.binolod, camera, update, listen, lodFocus, bino, vhf, radio, isOn, setOn, toggle, get on() { return isOn(); }, get forecast() { return fc; }, get channel() { return channel; },
    // the harbour master: a call the game asks for (the staged first visit's storm advisory, src/ui/firstStage.js), and the calls made
    hmAsk: (id) => hm.ask(id), get hmDone() { return hm.done; },
    // the glasses' eye and aim while fully raised (discoveries.js S.bino), else null
    get aim() { return last.k >= 0.999 ? last.aim : null; }, get k() { return last.k; }, get latched() { return latched; }, setLatch,
    dispose() { view.dispose(); radio.stop(); boat.sockets.hull.remove(vhf.group); } };
  services.provide('captainTools', api);   // tools/probe_bino.mjs
  return api;
}
