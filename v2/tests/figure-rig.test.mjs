// The kayakers' figure on other craft (v2/render/figureRig.js): a paddleboarder's pose (v2/sim/supPose.js) and a jet ski rider's
// targets put the wrists and the ankles where asked (within the figure's reach), keep every bone its own length, keep the kayak's
// paddle folded away, and write only finite numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKayakAsset } from '../render/kayak/asset.js';
import { createClips } from '../sim/kayak-clip.js';
import { createFigureRig } from '../render/figureRig.js';
import { supPose, BOARD } from '../sim/supPose.js';

const asset = await parseKayakAsset(readFileSync(new URL('../assets/kayak/kayak.kyb.gz', import.meta.url)));
const clips = createClips(asset), rig = createFigureRig(asset.json, clips), J = asset.json;
const bi = (n) => J.bones.indexOf(n);
const at = (pal, s, p) => { const o = s * 12; return [0, 1, 2].map((r) => pal[o + r * 4] * p[0] + pal[o + r * 4 + 1] * p[1] + pal[o + r * 4 + 2] * p[2] + pal[o + r * 4 + 3]); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('a paddleboarder: the wrists on their targets, the soles on the deck, the bones their own lengths, the kayak paddle folded', () => {
  for (const sex of J.sexes) for (const u of [0, 0.2, 0.45, 0.7, 0.9]) {
    const P = supPose({ u, side: u < 0.5 ? 1 : -1, roll: 0.05 }), sc = rig.scale(sex), joints = J.figures[sex].joints;
    const hands = P.hand.map((g, h) => { const sh = P.shoulder[h], d = [g[0] - sh[0], g[1] - sh[1], g[2] - sh[2]], l = Math.hypot(...d); return g.map((v, i) => v - d[i] / l * 0.075 * sc); });
    const feet = P.ankle.map((a) => [a[0], BOARD.top + 0.085 * sc, a[2]]);
    const pal = rig.pose(sex, { hip: P.hip, up: P.up, across: P.across, hands, feet, armReach: 1.12 }, new Float32Array(J.slots * 12));
    assert.ok(pal.every(Number.isFinite), 'finite');
    ['l', 'r'].forEach((s, h) => {
      const wrist = at(pal, bi(`hand_${s}`), joints[bi(`hand_${s}`)]);
      assert.ok(dist(wrist, hands[h]) < 0.06, `${sex} u ${u}: the ${s} wrist ${dist(wrist, hands[h]).toFixed(3)} m off its target`);
      const ankle = at(pal, bi(`foot_${s}`), joints[bi(`foot_${s}`)]);
      assert.ok(dist(ankle, feet[h]) < 0.03, `${sex} u ${u}: the ${s} ankle ${dist(ankle, feet[h]).toFixed(3)} m off`);
      // the elbow where both arm bones put it (the chain is joined), the shin its own length
      const e1 = at(pal, bi(`upperarm_${s}`), joints[bi(`lowerarm_${s}`)]), e2 = at(pal, bi(`lowerarm_${s}`), joints[bi(`lowerarm_${s}`)]);
      assert.ok(dist(e1, e2) < 1e-3, `${sex}: the ${s} elbow joined (${dist(e1, e2).toFixed(4)})`);
      const k = at(pal, bi(`calf_${s}`), joints[bi(`calf_${s}`)]), shin = dist(joints[bi(`calf_${s}`)], joints[bi(`foot_${s}`)]) * sc;
      assert.ok(Math.abs(dist(k, ankle) - shin) < 1e-3, `${sex}: the ${s} shin keeps its length`);
      // the sole on the deck, not through it: the toes' tip within 3 cm of the deck's top
      const toe = at(pal, bi(`ball_leaf_${s}`), joints[bi(`ball_leaf_${s}`)]);
      assert.ok(Math.abs(toe[1] - BOARD.top) < 0.03, `${sex}: the ${s} toes at ${toe[1].toFixed(3)} m (deck ${BOARD.top})`);
    });
    // standing: the head over the hips, about the figure's own height above the deck
    const head = at(pal, bi('Head'), joints[bi('Head')]);
    assert.ok(head[1] > 1.35 && head[1] < 1.85, `${sex}: the head at ${head[1].toFixed(2)} m`);
    assert.ok(pal.subarray(J.paddleSlot * 12, J.paddleSlot * 12 + 12).every((v) => v === 0), 'the kayak paddle folded away');
  }
});

test('the figure faces the bow (−z) and its left hand is to port', () => {
  const P = supPose({ u: 0.3, side: 1 }), sex = 'male', joints = J.figures[sex].joints;
  const pal = rig.pose(sex, { hip: P.hip, up: P.up, across: P.across }, new Float32Array(J.slots * 12));
  const toe = at(pal, bi('ball_leaf_l'), joints[bi('ball_leaf_l')]), heel = at(pal, bi('foot_l'), joints[bi('foot_l')]);
  assert.ok(toe[2] < heel[2] - 0.08, `toes ahead of the ankle (${toe[2].toFixed(2)} vs ${heel[2].toFixed(2)})`);
  const l = at(pal, bi('upperarm_l'), joints[bi('upperarm_l')]), r = at(pal, bi('upperarm_r'), joints[bi('upperarm_r')]);
  assert.ok(l[0] < 0 && r[0] > 0, `the left shoulder to port (${l[0].toFixed(2)}, ${r[0].toFixed(2)})`);
});
