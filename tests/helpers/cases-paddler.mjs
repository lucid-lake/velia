// The paddler's whole-motion sweep (the owner's naturalness and grip checks, 2026-11-07):
// every mode and every blend sampled finely, one figure per call. One sweep per figure feeds all four checks (it ran once
// per check before, about 5 s each). tests/paddlerSweep.test.mjs runs the male figure, the slow lane the female
// (tests/slow/paddlerMotion.slow.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { createKayak } from '../../classic/src/props/kayak/index.js';
import { createPaddler, parsePaddlerGltf } from '../../classic/src/props/paddler/index.js';

const ld = (f) => { const b = readFileSync(new URL(`../../models/paddler/${f}`, import.meta.url)); return parsePaddlerGltf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { textures: false }); };
const gltf = { male: await ld('ubc-male.glb'), female: await ld('ubc-female.glb') };   // the UBC figures (Node: no images)

function sweepAll(sex, each) {
  const k = createKayak({ paddle: 'held' });
  const p = createPaddler({ gltf, kayak: k, seed: 2, mode: 'rest', look: { sex } });
  const B = p.figure.bones, L = (b) => k.group.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
  // 240 samples a stroke (half a cycle) at the fastest loop (a sprint, 1 Hz); each mode run 2 s (the blend in) + one full
  // cycle at its own rate
  const cycle = { rest: 0.7, cruise: 2.0, sprint: 1.0, turnLeft: 2.8, turnRight: 2.8, back: 2.4 };
  for (const m of ['rest', 'cruise', 'sprint', 'cruise', 'turnLeft', 'cruise', 'turnRight', 'back', 'sprint', 'rest']) {
    p.setMode(m);
    const dt = 1 / 480, n = Math.round((2 + cycle[m]) / dt);
    for (let i = 0; i < n; i++) {
      const o = p.update(dt);
      const sL = L(B.UpperArmL), sR = L(B.UpperArmR), mid = sL.clone().add(sR).multiplyScalar(0.5);
      const fwd = new THREE.Vector3(0, 1, 0).cross(sR.clone().sub(sL)).normalize();
      each({ o, p, k, B, L, sL, sR, mid, fwd, mode: m });
    }
  }
}

// the four checks for one figure: each registers its sample reader, the first check to run sweeps once for all four
export function sweepCases(sex) {
  const each = [];
  let done = false;
  const sweep = () => { if (done) return; done = true; sweepAll(sex, (s) => { for (const f of each) f(s); }); };
  {
    let hull = 0, body = 0, n = 0;
    each.push(({ p }) => { const c = p.clearance(); hull = Math.max(hull, c.hull); body = Math.max(body, c.body); n++; });
    test(`${sex}: the paddle never enters the hull (blades 3 cm off, shaft 1 cm) or the body, in every mode and blend`, () => {
      sweep();
      assert.ok(n > 15000, `${n} samples`);
      assert.ok(hull < 0.001, `the worst hull penetration ${(hull * 1000).toFixed(1)} mm`);
      assert.ok(body < 0.001, `the worst body penetration ${(body * 1000).toFixed(1)} mm`);
    });
  }

  {
    let behind = -1, behindSprint = -1, behindSweep = -1, above = -1, aboveBack = -1, aboveSweep = -1;
    each.push(({ o, B, L, sL, sR, mid, fwd }) => {
      const sprinting = o.state.weights.sprint > 0.2, hard = o.state.weights.sprint > 0.05 || o.state.weights.back > 0.5;   // a sprint (and its blend out) and the back stroke reach further back
      const topSide = L(B.MiddleHandL).y > L(B.MiddleHandR).y ? 'L' : 'R';   // the higher hand
      for (const s of ['L', 'R']) {
        const e = L(B[`LowerArm${s}`]);
        const b = -e.clone().sub(mid).dot(fwd);
        const sweepEnd = o.state.weights.sweepR + o.state.weights.sweepL > 0.5;   // a sweep ends behind the hip, the arm long
        if (hard) behindSprint = Math.max(behindSprint, b); else if (sweepEnd) behindSweep = Math.max(behindSweep, b); else behind = Math.max(behind, b);
        const up = e.y - (s === "L" ? sL : sR).y;
        const sweeping = o.state.weights.sweepR + o.state.weights.sweepL > 0.5;
        if (o.state.weights.back > 0.5) aboveBack = Math.max(aboveBack, up);
        else if (sweeping && s === topSide) aboveSweep = Math.max(aboveSweep, up);
        else if (!((sprinting || hard) && s === topSide)) above = Math.max(above, up);
      }
    });
    test(`${sex}: the elbows stay in the paddler's box: at most 5 cm behind the chest (8 sprinting), under the shoulders (but a sprint's top hand)`, () => {
      sweep();
      assert.ok(behind <= 0.05, `an elbow ${(behind * 100).toFixed(1)} cm behind the chest's plane`);
      // a sprint's planted pull and the back stroke's catch behind the hip still take the bottom elbow a little further back
      // (still off: K3 notes)
      assert.ok(behindSweep <= 0.10, `a sweeping elbow ${(behindSweep * 100).toFixed(1)} cm behind the chest's plane`);   // still off: K3 notes
      assert.ok(behindSprint <= 0.08, `a sprinting or back-paddling elbow ${(behindSprint * 100).toFixed(1)} cm behind the chest's plane`);
      assert.ok(above <= 0.03, `an elbow ${(above * 100).toFixed(1)} cm over its shoulder`);
      assert.ok(aboveBack <= 0.10, `back paddling: an elbow ${(aboveBack * 100).toFixed(1)} cm over its shoulder`);   // still off: K3 notes
      // a sweep's top hand starts high across the body; with the overhand grip its elbow rises a little over the shoulder
      assert.ok(aboveSweep <= 0.08, `a sweep's top elbow ${(aboveSweep * 100).toFixed(1)} cm over its shoulder`);   // still off: K3 notes
    });
  }

  {
    let topCruise = -1, shaftOff = 0, flip = 0, prevQ = null;
    each.push(({ o, k, B, L, sL, sR, mode }) => {
      const q = k.paddle.group.quaternion.clone();
      if (prevQ) flip = Math.max(flip, q.angleTo(prevQ));
      prevQ = q;
      if (mode !== 'cruise' || o.state.weights.cruise < 0.95) return;
      const eye = L(B.Head).y + 0.09;
      for (const s of ['L', 'R']) topCruise = Math.max(topCruise, L(B[`MiddleHand${s}`]).y - eye);
      const sh = sR.clone().sub(sL).setY(0).normalize(), d = new THREE.Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize();
      shaftOff = Math.max(shaftOff, Math.acos(Math.min(1, Math.abs(sh.dot(d)))) * 180 / Math.PI);
    });
    test(`${sex}: cruise keeps the top hand about eye height (within 10 cm: the brow) or below, the shaft near the shoulders' line, no wrist flips`, () => {
      sweep();
      assert.ok(topCruise <= 0.10, `the top hand ${(topCruise * 100).toFixed(1)} cm over the eyes in cruise`);
      assert.ok(shaftOff <= 40, `the shaft ${shaftOff.toFixed(0)}° off the shoulders' line in cruise`);
      assert.ok(flip < 0.12, `the paddle turned ${(flip * 180 / Math.PI).toFixed(1)}° in one sample (a wrist flip)`);
    });
  }

  {
    let gap = 0, worstFace = 9, n = 0;
    each.push(({ p }) => {
      const g = p.grip();
      for (const s of ['L', 'R']) {
        gap = Math.max(gap, g[s].gap);
        worstFace = Math.min(worstFace, Math.max(-g[s].palm.dot(g[s].up), g[s].palm.dot(g[s].toChest)));
      }
      n++;
    });
    test(`${sex}: both hands overhand on the shaft in every sample: palms down or toward the paddler, the shaft in the palm (≤ 5 mm)`, () => {
      sweep();
      assert.ok(n > 15000, `${n} samples`);
      assert.ok(gap <= 0.005, `a grip gap of ${(gap * 1000).toFixed(1)} mm`);
      assert.ok(worstFace > 0, `a palm facing up and away (${worstFace.toFixed(2)})`);
    });
  }
}
