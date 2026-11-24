// BACKLOG-v2 #30: the cockpit's winch steps (v2/ui/station.js ▲ ▼) through the real wiring into the sheet, crew trim off. A phone
// held sideways tapped "pull in" and the sheet read 56.3° → 58.5°: the taps never reached the step (the cockpit's hover-only rule
// hid it from a finger, so they fell on the canvas) and the sheet drifted with the hand's start ease. Here each tap is the station's
// own button, handed to the boat as v2/ui/sail.js does (B.station: take, hold, takeFly), then the boat's hands step.
// ▼ "pull the main in" N times: the sheet N × 2° (HELM_IN.step) smaller; ▲ N times: N × 2° bigger. The page half (the finger
// reaches the step on a sideways phone): v2/tests/pages/phoneTouch.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createStation } from '../ui/station.js';
import { HELM_IN } from '../../src/stations/sloop/helmInput.js';
import { installDom, memStorage } from '../../tests/helpers/dom-helm.mjs';

const DEG = Math.PI / 180;
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => { const v = steadyWind(ms, fromDeg)(x, z, t); return { vx: v.vx, vz: v.vz }; } });

test('#30: N taps on a winch step move the main\'s sheet N × 2°, ▼ in and ▲ out (crew trim off)', () => {
  const D = installDom({ width: 874, height: 402 });
  try {
    const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(5, 200) });
    assert.equal(B.assists.crewTrim, false, 'crew trim off: the hand holds the sheet');
    const st = createStation({ rig: null, state: () => B.state, coarse: true, once: false, storage: memStorage() });
    const frame = (dt = 1 / 60) => {
      st.update(dt);
      B.station({ helm: st.steer, main: st.take('main'), jib: st.take('jib'), mainHold: st.hold('main'), jibHold: st.hold('jib'), fly: { main: st.takeFly('main'), jib: st.takeFly('jib') } });
      B.step(dt, { steer: 0, pull: 0 });
    };
    for (let i = 0; i < 120; i++) frame();   // under way; the hand's sheet set (its start ease)
    const btn = (d) => st.el.querySelector(`.stp[data-w=main] button[data-d="${d}"]`);
    assert.equal(btn(1).getAttribute('aria-label'), 'pull the main in');
    const tap = (b) => { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })); frame(); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })); for (let i = 0; i < 7; i++) frame(); };
    // the first tap ends the start ease (a hand on the sheet), so the counts below are the steps alone
    tap(btn(1));
    const N = 4, step = HELM_IN.step / DEG;
    const s0 = B.ctl.sheet / DEG;
    for (let i = 0; i < N; i++) tap(btn(1));
    const s1 = B.ctl.sheet / DEG;
    assert.ok(Math.abs((s0 - s1) - N * step) < 0.01, `▼ × ${N} pulls in ${N * step}° (${s0.toFixed(2)}° → ${s1.toFixed(2)}°)`);
    for (let i = 0; i < N; i++) tap(btn(-1));
    const s2 = B.ctl.sheet / DEG;
    assert.ok(Math.abs((s2 - s1) - N * step) < 0.01, `▲ × ${N} eases ${N * step}° (${s1.toFixed(2)}° → ${s2.toFixed(2)}°)`);
    st.dispose();
  } finally { D.uninstall(); }
});
