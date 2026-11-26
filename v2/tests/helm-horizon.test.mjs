// The Helm view holds the horizon on the bigger sea (fix 2026-11-25: "in the Helm view the camera rocks up and down a lot; a
// normal user might not be able to stay in that mode for a long time"). The eye rides in the cockpit, but the view keeps only a
// small, slow share of the hull's pitch and heel (sim/steadyCamera.js HORIZON), so the horizon stays nearly level and still while
// the cockpit, rigid with the hull, heels and pitches in the frame. Behaviour only: the boat sim at 16 kn of wind on a sea of two
// long-crested trains (one on the bow, one on the beam), the views' Helm pose each frame, projected as the page projects it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { hullToWorld } from '../sim/shots.js';
import { createViews } from '../ui/views.js';
import { HORIZON, HORIZON_REDUCED } from '../sim/steadyCamera.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';

const DEG = Math.PI / 180, G = 9.81, W = 1280, H = 720, HZ = 60;

// trains [{ A m, T s, dirDeg compass it travels toward }], deep water, their orbital current; the clock is the boat's (B.t)
function sea(trains, now) {
  const tw = trains.map(({ A, T, dirDeg }) => { const w = 2 * Math.PI / T; return { A, w, k: w * w / G, dx: Math.sin(dirDeg * DEG), dz: -Math.cos(dirDeg * DEG) }; });
  const ph = (q, x, z) => q.k * (x * q.dx + z * q.dz) - q.w * now();
  return waterFor((x, z) => tw.reduce((s, q) => s + q.A * Math.cos(ph(q, x, z)), 0), { now, velocityAt: (x, z, o, out) => { out[0] = out[1] = 0; for (const q of tw) { const u = q.A * q.w * Math.cos(ph(q, x, z)); out[0] += u * q.dx; out[1] += u * q.dz; } return out; } });
}

const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const unit = (p) => { const l = Math.hypot(...p); return p.map((v) => v / l); };
// a pose's screen: the horizon under the aim (y px at the frame's centre) and its tilt (deg), a hull point's place (px)
function screen(c) {
  const f = unit(sub(c.target, c.pos)), r = unit(cross(f, c.up ?? [0, 1, 0])), u = cross(r, f), k = (H / 2) / Math.tan(c.fov * DEG / 2);
  const proj = (v) => { const z = dot(v, f); return [W / 2 + k * dot(v, r) / z, H / 2 - k * dot(v, u) / z]; };
  const yaw = Math.atan2(f[0], -f[2]), hd = (a) => [Math.sin(yaw + a), 0, -Math.cos(yaw + a)];
  const l = proj(hd(-0.15)), m = proj(hd(0)), rr = proj(hd(0.15));
  return { horizonY: m[1], tilt: Math.atan2(rr[1] - l[1], rr[0] - l[0]) / DEG, at: (p) => proj(sub(p, c.pos)) };
}

// s seconds of the Helm view at 60 Hz after a 20 s settle and 4 s in the view; per frame the horizon (its height at the frame's
// centre, its tilt), the bow's place on screen and the deck's heel IN the frame (a line across the side decks 4 m ahead of the eye:
// its screen angle), the hull's drawn pitch and heel. The default sea: a swell on the bow and a sea on the beam that rock the
// hull as the live page's bigger sea does at 16 kn (drawn pitch sd 1.7°, heel sd 2.2°; the page measured 0.9–1.2° and 2.2–2.7°).
// Main's helm camera on it: the horizon's height sd 5.8 px, its tilt sd 0.62°, a steady 11° heel tilting it 6.8°. `reduced`: the OS's switch
const DECK = [[-1.2, 0.98, -1], [1.2, 0.98, -1]], BOW = [0, 1.07, -4.12];
function sailHelm({ windMs = 8.23, trains = [{ A: 0.12, T: 3.6, dirDeg: 251 + 180 }, { A: 0.12, T: 2.8, dirDeg: 251 + 90 }], s = 12, reduced = false } = {}) {
  let B = null;
  const water = sea(trains, () => (B ? B.t : 0));
  const wind = { sample: (x, z, t) => { const v = steadyWind(windMs, 161)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  B = createBoatSim({ water, heightAt: () => -40, wind, start: { x: 0, z: 0, headingDeg: 251, speed: 3 }, flags: {} });
  const V = createViews({ vessel: CURRENT_VESSEL, view: 'helm', reduced: () => reduced });
  B.viewOf = () => V.view;
  B.settle(20);
  const rows = [];
  for (let i = 0; i < (s + 4) * HZ; i++) {
    B.step(1 / HZ, { steer: 0, pull: 0 });
    const c = V.pose(1 / HZ, B.camera(1 / HZ), B.pose, B.helmLook);
    if (i < 4 * HZ) continue;
    const S = screen(c), l = S.at(hullToWorld(B.pose, DECK[0])), r = S.at(hullToWorld(B.pose, DECK[1]));
    rows.push({ horizonY: S.horizonY, tilt: S.tilt, bow: S.at(hullToWorld(B.pose, BOW)), deckHeel: Math.atan2(r[1] - l[1], r[0] - l[0]) / DEG, pitch: B.pose.pitch / DEG, heel: B.pose.heel / DEG });
  }
  return rows;
}
const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
const pp = (a) => Math.max(...a) - Math.min(...a);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const col = (r, k) => r.map((x) => (k === 'bowY' ? x.bow[1] : x[k]));
const report = (r) => `horizon y sd ${sd(col(r, 'horizonY')).toFixed(2)} px (pp ${pp(col(r, 'horizonY')).toFixed(1)}), tilt sd ${sd(col(r, 'tilt')).toFixed(3)}° (pp ${pp(col(r, 'tilt')).toFixed(2)}°); in the frame: bow y pp ${pp(col(r, 'bowY')).toFixed(1)} px, deck heel sd ${sd(col(r, 'deckHeel')).toFixed(2)}°; hull pitch sd ${sd(col(r, 'pitch')).toFixed(2)}°, heel sd ${sd(col(r, 'heel')).toFixed(2)}°`;

test('the Helm view at 16 kn on the bigger sea: the horizon holds nearly level and still, while the boat pitches and heels in the frame', () => {
  const r = sailHelm(), msg = report(r);
  assert.ok(sd(col(r, 'pitch')) > 1.5 && sd(col(r, 'heel')) > 1.5, `the sea rocks the hull, or the test proves nothing: ${msg}`);
  // the horizon: its height at the frame's centre and its tilt (the old camera kept 30–60 % of the hull's pitch and heel)
  assert.ok(sd(col(r, 'horizonY')) < 1.5, `the horizon's height holds (sd under 1.5 px at 720p): ${msg}`);
  assert.ok(sd(col(r, 'tilt')) < 0.25, `the horizon's tilt holds (sd under 0.25°): ${msg}`);
  // the cockpit is rigid with the hull: it moves in the frame (the bow rises and falls, the deck heels)
  assert.ok(pp(col(r, 'bowY')) > 40, `the bow rides the waves on screen (over 40 px): ${msg}`);
  assert.ok(sd(col(r, 'deckHeel')) > 1.2, `the deck heels in the frame (sd over 1.2°): ${msg}`);
  console.log(`# helm, 16 kn: ${msg}`);
});

test('the Helm view: a steady heel (a gust) leans the cockpit in the frame; the horizon tilts only a little', () => {
  const r = sailHelm({ windMs: 11, trains: [{ A: 0.01, T: 2, dirDeg: 0 }] });
  const heel = mean(col(r, 'heel')), tilt = mean(col(r, 'tilt')), deck = mean(col(r, 'deckHeel'));
  assert.ok(Math.abs(heel) > 6, `she heels in 21 kn (${heel.toFixed(1)}°)`);
  assert.ok(Math.abs(tilt) < Math.abs(heel) * (HORIZON.roll + 0.03), `the horizon tilts ${tilt.toFixed(2)}° for a heel of ${heel.toFixed(1)}°`);
  assert.ok(Math.abs(deck) > Math.abs(heel) * 0.7, `the deck leans ${deck.toFixed(1)}° in the frame for a heel of ${heel.toFixed(1)}°`);
  console.log(`# helm, steady heel ${heel.toFixed(1)}°: the horizon tilts ${tilt.toFixed(2)}°, the deck leans ${deck.toFixed(1)}° in the frame`);
});

test('reduce motion: the Helm view holds the horizon steadier still; the cockpit still moves in the frame', () => {
  const off = sailHelm(), on = sailHelm({ reduced: true });
  assert.ok(sd(col(on, 'horizonY')) < sd(col(off, 'horizonY')) && sd(col(on, 'tilt')) < sd(col(off, 'tilt')), `steadier: ${report(off)} → ${report(on)}`);
  assert.ok(HORIZON_REDUCED.pitch < HORIZON.pitch && HORIZON_REDUCED.roll < HORIZON.roll && HORIZON_REDUCED.heaveCapM > HORIZON.heaveCapM);
  assert.ok(pp(col(on, 'bowY')) > 40, `the bow still rides on screen: ${report(on)}`);
  console.log(`# helm, reduce motion: ${report(on)}`);
});
