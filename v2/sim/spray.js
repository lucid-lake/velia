// The bow spray's flight (v2): v1's src/boat/spray.js createSpray().update as plain JS (that file is three-bound: its
// drawing is TSL; the flight is copied here line for line, the drawing is render/wake.js's). Deterministic: v1's seeded
// generator (src/sim/core/rng.js mulberry32), the same draws in the same order, no Math.random(); no allocation a step.
//   nothing under 15 kn (7.7 m/s, more than the sloop sails), more with speed, a burst when the bow drops into a wave
//   (the float's pitch rate); the thrill cues: a slam (state.slam: the bow meeting a face faster than Ochi's threshold)
//   throws a sheet up off the bow, a surf (state.surf) a low white sheet off both bows; each droplet drags toward the
//   true wind at deck height, so upwind the slam's sheet blows aft over the deck, as on a real boat.
//   const s = createSpraySim({ length, beam, seed });  s.update(state, wave, dt)   (wave: HullFloat's { heave, pitch })
//   s.core: { pos, rel, size, alpha, count } (the drawing's per-droplet data); s.alive (droplets in the air now)
//   speed feel (owner, 2026-11-17): the lee rail in the water throws a thin stream of droplets off the lee side amidships
//   (railWet × speedK, the drawn heel: the physics' heel plus the waves' roll) and, heeled and fast, a bow dropping into
//   chop throws a little spray up off the windward bow that the wind carries aft; both from this pool, both × S.gain
//   (the quality level's share: v2/sim/speedFeel.js FEEL_Q; 0: none, no draw made)
import { mulberry32 } from '../../src/sim/core/rng.js';
import { speedK, leeK, railWet } from './speedFeel.js';
import { kdRoll } from './knockdownFx.js';

// v1's SPRAY and SPRAY_LOOK (src/boat/spray.js), copied: the drag time toward the air (s), the deck wind's share of the
// 10 m wind (the 1/7 power law), the slam and surf rates and lives, the slam's throw (m/s up), its clot size
export const SPRAY = Object.freeze({ dragS: 0.3, deckWind: Math.pow(1.5 / 10, 0.14), slamRate: 700, surfRate: 90, slamLife: [0.8, 0.5], surfLife: [0.45, 0.3], slamUp: [4, 2.6], slamSize: 1.6 });
// how a droplet is drawn (fix/helm-spray, owner 2026-11-06: never big white balls): a thin streak along its motion
// relative to the boat over blurS; width m; capW / capL the most it may subtend (rad); near the fade by the eye (m);
// alpha its peak opacity, the energy spread along it; amb / glint / glintPow: lit, with the sun behind the drop
// the speed feel's two (per second at full): the lee rail's droplets and the bow's chop spray (its rate per unit of the bow's
// drop past bowOn rad/s of pitch rate × 6, v1's slam measure); their lives (s), throws (m/s) and the rail's reach along the hull
export const FEEL_SPRAY = Object.freeze({ railRate: 70, railLife: [0.35, 0.3], railOut: [0.5, 0.9], railUp: [0.6, 1.0], railAlong: [-0.18, 0.22],
  bowRate: 60, bowOn: 1.5, bowSpan: 3, bowLife: [0.6, 0.4], bowUp: [2.4, 1.4] });
// K2, the knockdown: a heavy burst along the whole lee rail as it goes under (kind 5: the rail's length, thrown
// out and up, more while the heel is rising), and the rig slapping the water (kind 6: the boom's end and the main's foot where they
// meet the water: up and out, heavier as they strike). Both × S.gain.kd (the quality level's share; 0: none) and only past 40° of
// heel (kdRoll), so the pool is untouched while she is upright. The boom: its gooseneck boomY over the waterline at boomZ aft of
// the middle, boomL long (the C28's 3.3 m boom; the hull frame of src/sim/boat/dims.js).
export const KD_SPRAY = Object.freeze({ width: [0.06, 0.12], railRate: 700, railLife: [0.55, 0.5], railOut: [0.9, 1.8], railUp: [1.4, 2.4], railAlong: [-0.46, 0.44],
  slapRate: 450, slapLife: [0.6, 0.5], slapUp: [1.6, 2.6], boomY: 1.75, boomZ: 0.55, boomL: 3.3, rateGain: 2.5 });
export const SPRAY_LOOK = Object.freeze({ width: [0.02, 0.055], slamWidth: [0.03, 0.065], sheetGrow: 2.2, sheetT: 0.3, blurS: 0.025,
  capW: 0.008, capL: 0.25, near: [0.6, 1.6], alpha: 0.9, minSpread: 0.45, spread: 4, amb: 0.85, glint: 1.6, glintPow: 6 });

export function createSpraySim({ length = 7.26, beam = 3.15, count = 640, seed = 1, look = SPRAY_LOOK } = {}) {
  const rand = mulberry32(seed * 7919 + 13), rLook = mulberry32(seed * 104729 + 7);
  const pos = new Float32Array(count * 3), size = new Float32Array(count), alpha = new Float32Array(count), rel = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3), age = new Float32Array(count).fill(1e9), life = new Float32Array(count).fill(1), big = new Float32Array(count).fill(1);
  const kindOf = new Uint8Array(count), w0 = new Float32Array(count), a0 = new Float32Array(count).fill(1);
  let next = 0, carry = 0, carrySlam = 0, carrySurf = 0, carryRail = 0, carryBow = 0, carryKdR = 0, carryKdS = 0, lastPitch = null, lastHeel = null, alive = 0, version = 0;
  const slapAt = [0, 0, 0];   // the rig's point in the water this step (world)
  const S = {
    core: { pos, rel, size, alpha, age, life, big, count },
    gain: { rail: 1, bow: 1, kd: 1 },   // the speed feel's share and the knockdown's (main.js sets them from the quality level; 0 turns a kind off)
    fed: { rail: 0, bow: 0, kdRail: 0, kdSlap: 0 },    // droplets each has thrown (the tests, the budget)
    get alive() { return alive; }, get version() { return version; },
    update(state, wave = { heave: 0, pitch: 0 }, dt = 1 / 60) {
      const u = Math.max(state.u ?? 0, 0), h = state.heading;
      const fx = Math.sin(h), fz = -Math.cos(h), sx = -fz, sz = fx;
      const pitchRate = lastPitch === null ? 0 : (wave.pitch - lastPitch) / Math.max(dt, 1e-4);
      lastPitch = wave.pitch;
      const slam = Math.max(0, -pitchRate) * 6;
      const rate = 90 * Math.min(1, Math.max(0, (u - 7.7) / 1.5)) + 120 * Math.min(1, Math.max(0, slam - 2) / 4);
      const slamL = state.slam ?? 0, surfL = state.surf ?? 0;
      carry += rate * dt; carrySlam += SPRAY.slamRate * slamL * dt; carrySurf += SPRAY.surfRate * surfL * dt;
      // the speed feel: the drawn heel (the waves' roll on the physics' heel), its lee side, the speed's share of hull speed
      const heelD = (state.heel ?? 0) + (wave.roll ?? 0), lee = heelD < 0 ? -1 : 1, sk = speedK(state.sog ?? u);
      const gR = S.gain.rail, gB = S.gain.bow, FS = FEEL_SPRAY;
      if (gR > 0) carryRail += FS.railRate * gR * railWet(heelD) * sk * dt; else carryRail = 0;
      if (gB > 0) carryBow += FS.bowRate * gB * Math.min(1, Math.max(0, slam - FS.bowOn) / FS.bowSpan) * sk * leeK(heelD) * dt; else carryBow = 0;
      // K2: the knockdown's burst along the lee rail and the rig's slap (the drawn heel; its rate: more while she goes over)
      const kdK = kdRoll(heelD), gK = S.gain.kd, KS = KD_SPRAY, ah = Math.abs(heelD);
      const heelRate = lastHeel === null ? 0 : (ah - lastHeel) / Math.max(dt, 1e-4);
      lastHeel = ah;
      let slapK = 0;
      if (gK > 0 && kdK > 0) {
        const rise = 1 + KS.rateGain * Math.min(1, Math.max(0, heelRate) / 0.6);
        carryKdR += KS.railRate * gK * kdK * rise * dt;
        // the boom's end (the drawn boom angle's side is the lee): its height over the water at this heel
        const ba = Math.abs(state.boomAngle ?? 0.5), out = Math.sin(ba) * KS.boomL, aft = KS.boomZ + Math.cos(ba) * KS.boomL;
        const yEnd = (wave.heave ?? 0) + KS.boomY * Math.cos(ah) - out * Math.sin(ah), across = KS.boomY * Math.sin(ah) + out * Math.cos(ah);
        if (yEnd < 0.15) {
          slapK = Math.min(1, (0.15 - yEnd) / 0.6);
          slapAt[0] = state.x - fx * aft + sx * lee * across; slapAt[1] = (wave.heave ?? 0) + 0.05; slapAt[2] = state.z - fz * aft + sz * lee * across;
          carryKdS += KS.slapRate * gK * slapK * rise * dt;
        } else carryKdS = 0;
      } else { carryKdR = 0; carryKdS = 0; }
      const bowY = (wave.heave ?? 0) + Math.sin(wave.pitch ?? 0) * length * 0.42;
      const emit = (kind) => {
        const i = next; next = (next + 1) % count;
        const side = rand() < 0.5 ? -1 : 1, f = length * (kind === 1 ? 0.40 + 0.06 * rand() : 0.36 + 0.08 * rand());
        const halfB = beam * 0.5 * 0.86 * Math.sqrt(1 - f / (length * 0.5)) + 0.1;
        pos[3 * i] = state.x + fx * f + sx * side * halfB;
        pos[3 * i + 1] = bowY + 0.1;
        pos[3 * i + 2] = state.z + fz * f + sz * side * halfB;
        let out, up, carryU;
        if (kind === 3) {   // the lee rail: low droplets off the lee side amidships, thrown out and up, left behind by the hull
          const fa = length * (FEEL_SPRAY.railAlong[0] + (FEEL_SPRAY.railAlong[1] - FEEL_SPRAY.railAlong[0]) * rand()), hb = beam * 0.5;
          pos[3 * i] = state.x + fx * fa + sx * lee * hb; pos[3 * i + 1] = (wave.heave ?? 0) + 0.05; pos[3 * i + 2] = state.z + fz * fa + sz * lee * hb;
          const o = FEEL_SPRAY.railOut[0] + FEEL_SPRAY.railOut[1] * rand(), upv = FEEL_SPRAY.railUp[0] + FEEL_SPRAY.railUp[1] * rand(), cu = u * (0.45 + 0.2 * rand());
          vel[3 * i] = sx * lee * o + fx * cu; vel[3 * i + 1] = upv; vel[3 * i + 2] = sz * lee * o + fz * cu;
          age[i] = 0; life[i] = FEEL_SPRAY.railLife[0] + FEEL_SPRAY.railLife[1] * rand(); big[i] = 1; kindOf[i] = kind;
          w0[i] = look.width[0] + (look.width[1] - look.width[0]) * rLook(); a0[i] = 0.35 + 0.45 * rLook();
          return;
        }
        if (kind === 5) {   // K2: the lee rail going under: the rail's whole length, thrown out and up, heavier than the speed feel's
          const fa = length * (KD_SPRAY.railAlong[0] + (KD_SPRAY.railAlong[1] - KD_SPRAY.railAlong[0]) * rand()), hb = beam * 0.5 * (0.75 + 0.25 * Math.sqrt(Math.max(0, 1 - (2 * fa / length) ** 2)));
          pos[3 * i] = state.x + fx * fa + sx * lee * hb; pos[3 * i + 1] = (wave.heave ?? 0) + 0.08; pos[3 * i + 2] = state.z + fz * fa + sz * lee * hb;
          const o = KD_SPRAY.railOut[0] + KD_SPRAY.railOut[1] * rand(), upv = KD_SPRAY.railUp[0] + KD_SPRAY.railUp[1] * rand(), cu = u * (0.3 + 0.3 * rand());
          vel[3 * i] = sx * lee * o + fx * cu; vel[3 * i + 1] = upv; vel[3 * i + 2] = sz * lee * o + fz * cu;
          age[i] = 0; life[i] = KD_SPRAY.railLife[0] + KD_SPRAY.railLife[1] * rand(); big[i] = 1.3; kindOf[i] = kind;
          w0[i] = KD_SPRAY.width[0] + (KD_SPRAY.width[1] - KD_SPRAY.width[0]) * rLook(); a0[i] = 0.6 + 0.4 * rLook();
          return;
        }
        if (kind === 6) {   // K2: the rig slapping the water: up and out round the boom's end and along the main's foot
          const along = rand();
          pos[3 * i] = slapAt[0] + (state.x - slapAt[0]) * 0.55 * along + (rand() - 0.5) * 0.6; pos[3 * i + 1] = slapAt[1]; pos[3 * i + 2] = slapAt[2] + (state.z - slapAt[2]) * 0.55 * along + (rand() - 0.5) * 0.6;
          const o = 0.5 + 1.4 * rand(), upv = KD_SPRAY.slapUp[0] + KD_SPRAY.slapUp[1] * rand(), cu = u * 0.2;
          vel[3 * i] = sx * lee * o + fx * cu; vel[3 * i + 1] = upv; vel[3 * i + 2] = sz * lee * o + fz * cu;
          age[i] = 0; life[i] = KD_SPRAY.slapLife[0] + KD_SPRAY.slapLife[1] * rand(); big[i] = 1.4; kindOf[i] = kind;
          w0[i] = KD_SPRAY.width[0] + (KD_SPRAY.width[1] - KD_SPRAY.width[0]) * rLook(); a0[i] = 0.6 + 0.4 * rLook();
          return;
        }
        if (kind === 4) {   // the bow in chop: up off the windward bow; the wind's drag below carries it aft over the deck
          const fb = length * (0.40 + 0.06 * rand()), hb = beam * 0.5 * 0.86 * Math.sqrt(1 - fb / (length * 0.5)) + 0.1;
          pos[3 * i] = state.x + fx * fb - sx * lee * hb; pos[3 * i + 1] = bowY + 0.1; pos[3 * i + 2] = state.z + fz * fb - sz * lee * hb;
          const o = 0.4 + 0.8 * rand(), upv = FEEL_SPRAY.bowUp[0] + FEEL_SPRAY.bowUp[1] * rand(), cu = u * (0.75 + 0.15 * rand());
          vel[3 * i] = -sx * lee * o + fx * cu; vel[3 * i + 1] = upv; vel[3 * i + 2] = -sz * lee * o + fz * cu;
          age[i] = 0; life[i] = FEEL_SPRAY.bowLife[0] + FEEL_SPRAY.bowLife[1] * rand(); big[i] = 1; kindOf[i] = kind;
          w0[i] = look.width[0] + (look.width[1] - look.width[0]) * rLook(); a0[i] = 0.45 + 0.55 * rLook();
          return;
        }
        if (kind === 1) { out = (0.8 + 1.6 * rand()) * (0.6 + 0.4 * slamL); up = (SPRAY.slamUp[0] + SPRAY.slamUp[1] * rand()) * (0.7 + 0.3 * slamL); carryU = u; }
        else if (kind === 2) { out = (1.5 + 1.5 * rand()) * Math.min(1.5, u / 3); up = (0.8 + 1.2 * rand()) * surfL; carryU = u * 0.6; }
        else { out = (1.2 + 1.8 * rand()) * Math.min(1.5, u / 2.5); up = (1.5 + 2.0 * rand()) * Math.min(1.5, u / 2.5) * (1 + 0.5 * slam); carryU = u * 0.35; }
        vel[3 * i] = sx * side * out + fx * carryU;
        vel[3 * i + 1] = up;
        vel[3 * i + 2] = sz * side * out + fz * carryU;
        const L = kind === 1 ? SPRAY.slamLife : kind === 2 ? SPRAY.surfLife : [0.35, 0.3];
        age[i] = 0; life[i] = L[0] + L[1] * rand(); big[i] = kind === 1 ? SPRAY.slamSize : 1; kindOf[i] = kind;
        const wr = kind === 1 ? look.slamWidth : look.width; w0[i] = wr[0] + (wr[1] - wr[0]) * rLook(); a0[i] = 0.45 + 0.55 * rLook();
      };
      while (carry >= 1) { carry -= 1; emit(0); }
      while (carrySlam >= 1) { carrySlam -= 1; emit(1); }
      while (carrySurf >= 1) { carrySurf -= 1; emit(2); }
      while (carryRail >= 1) { carryRail -= 1; emit(3); S.fed.rail++; }
      while (carryBow >= 1) { carryBow -= 1; emit(4); S.fed.bow++; }
      while (carryKdR >= 1) { carryKdR -= 1; emit(5); S.fed.kdRail++; }
      while (carryKdS >= 1) { carryKdS -= 1; emit(6); S.fed.kdSlap++; }
      void slapK;
      const tw = state.trueWind ?? { speed: 0, angle: 0 }, toDir = h + tw.angle + Math.PI, ws = tw.speed * SPRAY.deckWind;
      const wx = Math.sin(toDir) * ws, wz = -Math.cos(toDir) * ws, kd = 1 - Math.exp(-dt / SPRAY.dragS);
      const bvx = Math.sin(h) * u, bvz = -Math.cos(h) * u;
      let n = 0;
      for (let i = 0; i < count; i++) {
        if (age[i] >= 1e8) continue;   // never emitted (v1 walks them too; they stay at size 0)
        age[i] += dt;
        const t = age[i] / life[i];
        if (t >= 1) { alpha[i] = 0; size[i] = 0; continue; }
        vel[3 * i + 1] -= 9.81 * dt;
        vel[3 * i] += (wx - vel[3 * i]) * kd; vel[3 * i + 2] += (wz - vel[3 * i + 2]) * kd; vel[3 * i + 1] *= 1 - 0.6 * dt;
        for (let k = 0; k < 3; k++) pos[3 * i + k] += vel[3 * i + k] * dt;
        if (pos[3 * i + 1] < -0.05) { age[i] = life[i]; alpha[i] = 0; size[i] = 0; continue; }
        const sheet = kindOf[i] === 1 ? 1 + (look.sheetGrow - 1) * Math.max(0, 1 - t / look.sheetT) : 1;
        size[i] = w0[i] * sheet;
        alpha[i] = look.alpha * a0[i] * (1 - t) * Math.min(1, t * 10) / Math.sqrt(sheet);
        rel[3 * i] = vel[3 * i] - bvx; rel[3 * i + 1] = vel[3 * i + 1]; rel[3 * i + 2] = vel[3 * i + 2] - bvz;
        n++;
      }
      if (n || alive) version++;
      alive = n;
    },
  };
  return S;
}
