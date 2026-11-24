// The fireworks' sound and music (S4): the plan, without Web Audio. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPEED_OF_SOUND, delayFor, distanceGain, airLowpassHz, calibre, bangBank, cuesFor, createPlan, cuesArriving, wallLevel, VoicePool,
  echoImpulse, ceilingCurve, LIMITER, SOUND, BANKS, burstAt, mortarAt, panFor, cheerCue, ECHO, isolation,
} from '../src/fireworks/sound.js';
import { musicWant, hourOfShow, MUSIC, duckDb } from '../src/fireworks/music.js';
import { makeShow, SHOW_LENGTH } from '../src/fireworks/show.js';
import { bargesWorld, SILL, VIEW, SCALE, fitShow, farStage, FAR_SPREAD } from '../src/fireworks/stage.js';
import { thinStars, FAR_STARS, buildShell } from '../src/fireworks/shells.js';
import { lonLatToWorld } from '../src/sim/geo.js';

const BARGES = bargesWorld(), SHOW = fitShow(makeShow(1));
const AT_SILL = { x: VIEW[0], y: 3, z: VIEW[1], fx: 0.6, fz: -0.8 };   // the listener at the viewing spot (realism round: was the sill)

test('S4: a sound arrives distance / 343 m/s after it leaves (≈ 2.3 s for 780 m)', () => {
  assert.equal(SPEED_OF_SOUND, 343);
  assert.ok(Math.abs(delayFor(780) - 2.274) < 0.001);
  for (const e of SHOW.events.filter((x) => !x.ground).slice(0, 40)) {
    const [bang] = cuesFor(e, { barges: BARGES, scale: SCALE, listener: AT_SILL }).filter((c) => c.kind === 'bang');
    const p = burstAt(e, BARGES, SCALE), d = Math.hypot(p[0] - AT_SILL.x, p[1] - AT_SILL.y, p[2] - AT_SILL.z);
    assert.ok(Math.abs(bang.dist - d) < 1e-6);
    assert.ok(Math.abs(bang.at - (e.burst + d / 343)) < 1e-9, `${e.type}: bang at burst + d/343`);
    const [launch] = cuesFor(e, { barges: BARGES, scale: SCALE, listener: AT_SILL }).filter((c) => c.kind === 'launch');
    const m = mortarAt(e, BARGES, SCALE);
    assert.ok(Math.abs(launch.at - (e.t + Math.hypot(m[0] - AT_SILL.x, m[1] - AT_SILL.y, m[2] - AT_SILL.z) / 343)) < 1e-9, 'the thump from the barge');
    assert.ok(launch.at < bang.at, 'the launch is heard before its burst');
  }
  // the barge on the deck at 250 m (wow round): 0.73 s
  const e = { ...SHOW.events.find((x) => !x.ground), jitter: [0, 0], barge: 0 };
  const [l] = cuesFor(e, { barges: BARGES, scale: SCALE, listener: { ...AT_SILL, y: 2.5 } }).filter((c) => c.kind === 'launch');
  assert.ok(Math.abs(l.at - e.t - 250 / 343) < 0.01, `${(l.at - e.t).toFixed(3)} s`);
});

test('S4: bigger shells are louder, deeper and duller; distance quiets and darkens', () => {
  const c3 = calibre(3), c6 = calibre(6), c12 = calibre(12);
  assert.ok(c3.gain < c6.gain && c6.gain < c12.gain, 'louder');
  assert.ok(c3.rate > c6.rate && c6.rate > c12.rate, 'played slower: deeper');
  assert.ok(c3.lp > c6.lp && c6.lp > c12.lp, 'duller');
  assert.deepEqual([bangBank(4), bangBank(8), bangBank(12)], ['fw_bang', 'fw_deep', 'fw_boom']);
  assert.ok(distanceGain(500) > distanceGain(1000) && distanceGain(1000) > distanceGain(4000));
  assert.ok(Math.abs(distanceGain(2000) - 0.5) < 1e-9, '1/r');
  assert.ok(airLowpassHz(800) > airLowpassHz(1200) && airLowpassHz(1200) > airLowpassHz(3600) && airLowpassHz(3600) > airLowpassHz(7700));
  assert.ok(airLowpassHz(3600) < 500 && airLowpassHz(7700) < 200, 'the far shows: low thuds');
  // the same event heard from twice as far: quieter, duller, later
  const e = SHOW.events.find((x) => x.type === 'peony' && x.inches === 8) ?? SHOW.events.find((x) => !x.ground);
  const near = cuesFor(e, { barges: BARGES, scale: SCALE, listener: AT_SILL }).find((c) => c.kind === 'bang');
  const farL = { ...AT_SILL, x: SILL[0] - 1500 };
  const far = cuesFor(e, { barges: BARGES, scale: SCALE, listener: farL }).find((c) => c.kind === 'bang');
  assert.ok(far.gain < near.gain && far.lp < near.lp && far.at > near.at);
  // a salute is the loudest report of its size
  const sal = SHOW.events.find((x) => x.type === 'salute'), b = cuesFor(sal, { barges: BARGES, scale: SCALE, listener: AT_SILL }).find((c) => c.kind === 'bang');
  const peony = cuesFor({ ...sal, type: 'peony' }, { barges: BARGES, scale: SCALE, listener: AT_SILL }).find((c) => c.kind === 'bang');
  assert.ok(b.gain > peony.gain * 1.5);
});

test('S4: the cues come from the show\'s own events: one launch and one bang per aerial, crackle after crackle shells, the far shows thuds only', () => {
  const plan = createPlan({ show: SHOW, barges: BARGES, scale: SCALE });
  const all = plan.between(-100, SHOW_LENGTH + 40, AT_SILL);
  const aerials = SHOW.events.filter((e) => !e.ground);
  const bangs = all.filter((c) => c.kind === 'bang' && !/:bang:1\d$/.test(c.id));
  const multi = aerials.filter((e) => e.type === 'multibreak').length;
  assert.equal(bangs.length, aerials.length + 3 * multi, 'one bang an aerial (a multibreak 4)');
  assert.equal(all.filter((c) => c.kind === 'launch' && c.id.endsWith(':launch:0')).length, aerials.length + SHOW.events.filter((e) => e.ground && e.type !== 'niagara').length);
  for (const e of aerials.filter((x) => x.type === 'crackle')) {
    const cs = all.filter((c) => c.id.startsWith(`n${e.i}:`));
    const bang = cs.find((c) => c.kind === 'bang'), cr = cs.find((c) => c.kind === 'crackle');
    assert.ok(cr && cr.at > bang.at, 'the sizzle after the bang');
  }
  // in arrival order, every one inside the window, deterministic
  for (let i = 1; i < all.length; i++) assert.ok(all[i].at >= all[i - 1].at);
  assert.deepEqual(all, createPlan({ show: SHOW, barges: BARGES, scale: SCALE }).between(-100, SHOW_LENGTH + 40, AT_SILL));
  // windows tile: [a, b) + [b, c) = [a, c)
  const a = plan.between(240, 260, AT_SILL), b2 = plan.between(260, 280, AT_SILL), ab = plan.between(240, 280, AT_SILL);
  assert.deepEqual([...a, ...b2].map((c) => c.id).sort(), ab.map((c) => c.id).sort());
  // the whistles: some, not most
  const wh = all.filter((c) => c.kind === 'whistle').length;
  assert.ok(wh > 0.04 * aerials.length && wh < 0.25 * aerials.length, `${wh} whistles of ${aerials.length}`);
  // the far shows: bangs only, low-passed to thuds, later (3.6 and 7.7 km)
  const fs = farStage(1, lonLatToWorld);
  const fc = cuesArriving(SHOW, 0, 300, { barges: BARGES, scale: SCALE, far: fs, listener: AT_SILL }).filter((c) => c.id.startsWith('f'));
  assert.ok(fc.length > 40 && fc.every((c) => c.kind === 'bang' && c.lp <= SOUND.farLowpassHz && c.dist > 3000));
  // the cheer after the last salvo, once; and one after the opening salvo
  const ch = cheerCue(SHOW, AT_SILL), last = Math.max(...aerials.map((e) => e.burst));
  assert.ok(ch.at > last && ch.at < last + 6);
  const cheers = plan.between(0, 400, AT_SILL).filter((c) => c.kind === 'cheer');
  assert.deepEqual(cheers.map((c) => c.id), ['cheer0', 'cheer']);
  const open = aerials.filter((e) => e.burst <= 12);
  assert.ok(cheers[0].at > Math.max(...open.map((e) => e.burst)) && cheers[0].at < 20, 'the shore greets the opening salvo');
});

test('S4: the finale rolls as a wall; the voices are capped; the limiter never lets a sample past −0.5 dBFS', () => {
  assert.ok(wallLevel(SHOW, 284) > 0.6, `finale ${wallLevel(SHOW, 284).toFixed(2)}`);
  assert.ok(wallLevel(SHOW, 60) < 0.05 && wallLevel(SHOW, 150) === 0, 'not in the build or the gap');
  // the pool: never over its cap; a louder cue steals the quietest; a quieter one is dropped
  const pool = new VoicePool(4);
  for (let i = 0; i < 4; i++) assert.ok(pool.admit({ id: `a${i}`, gain: 0.2 + i * 0.1 }, 0, 10).ok);
  assert.deepEqual(pool.admit({ id: 'quiet', gain: 0.1 }, 1, 10), { ok: false, steal: null });
  assert.deepEqual(pool.admit({ id: 'loud', gain: 2 }, 1, 10), { ok: true, steal: 'a0' });
  assert.equal(pool.count, 4);
  assert.ok(pool.admit({ id: 'later', gain: 0.01 }, 11, 12).ok, 'ended voices free their places');
  // over the finale at the sill, the desktop cap holds every moment
  const fin = createPlan({ show: SHOW, barges: BARGES, scale: SCALE }).between(240, 300, AT_SILL), P = new VoicePool(SOUND.voices.desktop);
  let most = 0;
  for (const c of fin) { P.admit(c, c.at, c.at + BANKS[c.bank].slot / c.rate); most = Math.max(most, P.count); }
  assert.ok(most <= SOUND.voices.desktop);
  // the ceiling: linear below the knee, never past LIMITER.ceiling (input to +12 dBFS)
  const curve = ceilingCurve();
  assert.ok(Math.max(...curve.map(Math.abs)) <= LIMITER.ceiling + 1e-6);
  const at = (x) => curve[Math.round(((x / 4) + 1) / 2 * (curve.length - 1))];
  assert.ok(Math.abs(at(0.3) - 0.3) < 0.01 && Math.abs(at(-0.4) + 0.4) < 0.01, 'linear under the knee');
  assert.ok(at(2) > 0.9 && at(2) <= LIMITER.ceiling, 'a +6 dB pile-up lands under the ceiling');
  // the plan's worst pile-up (bank peaks −1 dBFS, attacks inside 50 ms) stays within the compressor's reach (≤ +12 dBFS)
  let worst = 0;
  for (let i = 0; i < fin.length; i++) { let s = 0; for (let j = i; j < fin.length && fin[j].at < fin[i].at + 0.05; j++) s += fin[j].gain * 0.89; worst = Math.max(worst, s); }
  assert.ok(worst * SOUND.level < 4, `worst 50 ms pile-up ${(20 * Math.log10(worst)).toFixed(1)} dBFS before the limiter`);
});

test('S4 fix: a burst heard alone is louder and fuller than the same shell in the finale; the thumps carry; every opening burst has its bang', () => {
  assert.ok(isolation(0) === 1 && isolation(5) === 0 && isolation(1) > isolation(3), 'alone 1, in a pile 0');
  const e = { ...SHOW.events.find((x) => x.type === 'peony' && x.inches === 8 && !x.ground) };
  const at = (n) => cuesFor(e, { barges: BARGES, scale: SCALE, listener: AT_SILL, neighbours: n });
  const alone = at(0), pile = at(6);
  const bA = alone.find((c) => c.kind === 'bang'), bP = pile.find((c) => c.kind === 'bang');
  assert.ok(Math.abs(bA.gain / bP.gain - SOUND.single.boost) < 1e-9, `alone ${(20 * Math.log10(bA.gain / bP.gain)).toFixed(1)} dB louder`);
  assert.ok(bA.wet > bP.wet, 'a wetter echo send alone');
  assert.equal(bA.at, bP.at, 'the same arrival: the physics is unchanged');
  const body = alone.find((c) => c.kind === 'body');
  assert.ok(body && body.bank === 'fw_boom' && body.rate < bA.rate && body.lp <= 900 && Math.abs(body.at - bA.at) < 0.05, 'a deep body under it');
  assert.equal(pile.find((c) => c.kind === 'body'), undefined, 'none in the pile');
  // a salute: the loudest report, with its body even inside a salvo
  const sal = SHOW.events.find((x) => x.type === 'salute');
  const sc = cuesFor(sal, { barges: BARGES, scale: SCALE, listener: AT_SILL, neighbours: 3 });
  assert.ok(sc.find((c) => c.kind === 'body'), 'the salute booms');
  // the thump: within ≈ 9 dB of a 6" bang alone, from the same spot
  const six = { ...e, inches: 6 }, c6 = cuesFor(six, { barges: BARGES, scale: SCALE, listener: AT_SILL });
  const th = c6.find((c) => c.kind === 'launch'), b6 = c6.find((c) => c.kind === 'bang');
  assert.ok(20 * Math.log10(b6.gain / th.gain) < 9, `thump ${(20 * Math.log10(b6.gain / th.gain)).toFixed(1)} dB under the bang`);
  // the plan counts neighbours from the show: the finale's bursts are piled, the opening's singles alone
  const plan = createPlan({ show: SHOW, barges: BARGES, scale: SCALE });
  const fin = SHOW.events.filter((x) => !x.ground && x.burst > 275 && x.burst < 290);
  assert.ok(fin.filter((x) => plan.neighboursOf(x) >= 4).length > 0.8 * fin.length, 'the finale is a pile');
  const singles = SHOW.events.filter((x) => !x.ground && x.burst > 12 && x.burst < 30);
  assert.ok(singles.length >= 3 && singles.every((x) => plan.neighboursOf(x) <= 1), 'the opening singles stand alone');
  // every aerial bursting in the first 30 s has its bang, burst + distance / 343 later
  const cues = plan.between(-10, 60, AT_SILL);
  for (const x of SHOW.events.filter((y) => !y.ground && y.burst < 30)) {
    const b = cues.find((c) => c.id === `n${x.i}:bang:0`);
    assert.ok(b && Math.abs(b.at - x.burst - b.dist / 343) < 1e-9, `event ${x.i}`);
  }
});

test('S4: the echoes are deterministic: slap-backs off the walls, then a long ridge tail that dies', () => {
  const sr = 8000, a = echoImpulse(sr, { seed: 3 }), b = echoImpulse(sr, { seed: 3 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(echoImpulse(sr, { seed: 3, channel: 1 }), a, 'two channels differ (width)');
  assert.equal(a.length, ECHO.seconds * sr);
  const rms = (t0, t1) => { let s = 0, n = 0; for (let i = Math.round(t0 * sr); i < Math.round(t1 * sr); i++) { s += a[i] * a[i]; n++; } return Math.sqrt(s / n); };
  assert.equal(rms(0, 0.5), 0, 'no dry path');
  assert.ok(rms(0.6, 0.7) > rms(0.75, 0.85) * 2, 'the first slap-back');
  assert.ok(rms(1.5, 2.5) > rms(5, 6) * 3 && rms(6.6, 7) < rms(2, 3) / 5, 'the tail decays');
});

test('S4: the pan follows the camera; the banks match the sound pack', () => {
  assert.ok(panFor([SILL[0] + 100, 0, SILL[1]], { x: SILL[0], z: SILL[1], fx: 0, fz: -1 }) > 0.7, 'east is right when facing north');
  assert.ok(panFor([SILL[0] - 100, 0, SILL[1]], { x: SILL[0], z: SILL[1], fx: 0, fz: -1 }) < -0.7);
  assert.ok(Math.abs(panFor([SILL[0], 0, SILL[1] - 100], { x: SILL[0], z: SILL[1], fx: 0, fz: -1 })) < 1e-9, 'ahead is centre');
  const pack = JSON.parse(readFileSync(new URL('../audio/sources.json', import.meta.url))).fireworks;
  for (const [k, b] of Object.entries(BANKS)) {
    const e = pack.find((x) => x.name === k);
    assert.ok(e && e.kind === 'bank', k);
    assert.equal(e.slot_s, b.slot, `${k} slot`); assert.equal(e.picks.length, b.n, `${k} slots`);
  }
});

test('S4 fix: the far shows draw a few dozen points a burst, opened wider (no glowing disc over the horizon)', () => {
  const sh = buildShell('peony', { inches: 5, tier: 'phone', seed: 9 });
  const t = thinStars(sh.stars);
  assert.equal(t.length, FAR_STARS);
  assert.deepEqual(t, thinStars(sh.stars), 'deterministic');
  assert.equal(new Set(t).size, FAR_STARS, 'distinct stars');
  // spread evenly over the sphere: both hemispheres
  assert.ok(t.some((s) => s.v[1] > 0.5 * Math.hypot(...s.v)) && t.some((s) => s.v[1] < -0.5 * Math.hypot(...s.v)));
  const small = sh.stars.slice(0, 10); assert.equal(thinStars(small), small);
  const fs = farStage(1, lonLatToWorld);
  assert.ok(fs.show.events.filter((e) => !e.ground).every((e) => e.spread === FAR_SPREAD) && FAR_SPREAD > 1);
  assert.equal(fs.barges.length, 2);
  assert.ok(Math.abs(Math.hypot(fs.barges[0].x - SILL[0], fs.barges[0].z - SILL[1]) - 3600) < 1);
});

test('S4 music: Sail\'s show is natural sound; Over The Clouds after the finale\'s echoes, through the drift home; the score and the radio by choice', () => {
  const w = (o) => musicWant({ mode: 'sail', ...o }).want;
  assert.equal(w({ showT: 120, hour: hourOfShow(120) }), null, 'the show: no music');
  assert.equal(w({ showT: 292, hour: hourOfShow(292) }), null, 'the last salvo: no music');
  assert.equal(w({ showT: 305, hour: hourOfShow(305) }), 'home', 'the echoes have died');
  assert.equal(w({ showT: null, hour: 22.8 }), 'home', 'the drift home');
  assert.equal(w({ showT: null, hour: 23.3 }), null, 'gone by the moonrise');
  assert.equal(w({ showT: null, hour: 21.0 }), null);
  assert.equal(musicWant({ mode: 'cruise', showT: 305, hour: hourOfShow(305) }).want, null, 'Cruise keeps its own playlist');
  // the score: only when asked (S5: Cruise), during the show, in sync with the show clock
  assert.equal(w({ showT: 100, hour: hourOfShow(100) }), null);
  const s = musicWant({ mode: 'cruise', score: true, showT: 100, hour: hourOfShow(100) });
  assert.equal(s.want, 'score'); assert.equal(s.offset, 100 - MUSIC.score.fromShowT);
  assert.ok(MUSIC.score.fromShowT + MUSIC.score.lengthS <= SHOW_LENGTH - 5, 'it ends with the finale');
  // the radio wins when on; off silences all
  assert.equal(w({ radio: true, showT: 305, hour: hourOfShow(305) }), 'radio');
  assert.equal(w({ radio: true, hour: 12 }), 'radio');
  assert.equal(musicWant({ off: true, radio: true, hour: 22.5 }).want, null);
  // the duck: slight, only under the big bursts
  assert.equal(duckDb(0.2), 0);
  assert.ok(duckDb(0.6) < 0 && duckDb(0.6) >= -6 && duckDb(5) === -6);
});
