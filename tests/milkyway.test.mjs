// The Milky Way (stage S0): the fade by the sun, the moon's dimming, the load rule,
// and the band's place: the galactic core through the same ECI → ECEF → world chain the sky node samples with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { PNG } from 'pngjs';
import { AtmosphereContext } from '@takram/three-atmosphere/webgpu';
import { nightFade, moonDim, milkyWayLevel, galacticToJ2000, uvOfJ2000, encodeLum, decodeLum, lightDomeAt } from '../src/core/milkyway-math.js';
import { createMilkyWay, MW_URL } from '../classic/src/core/milkyway.js';
import { getECIToECEFRotationMatrix, getMoonDirectionECEF } from '../classic/src/core/celestial.js';
import { worldToECEF } from '../classic/src/core/sky.js';
import { timeAt } from '../src/sim/place.js';

const PLACE = { latDeg: 38.954159, lonDeg: -120.100464, altM: 1897.9, date: '2026-07-04', day: 'highlight', utcOffsetH: -7 };
const root = new URL('../', import.meta.url);

// a J2000 direction → the scene's world frame (x east, y up, z south) → altitude and true bearing, as the shader does
function altAzOf(dirJ2000, hour, place = PLACE) {
  const eciToEcef = getECIToECEFRotationMatrix(new Date(timeAt(hour, place)));
  const { matrix } = worldToECEF(place);
  const ecefToWorld = new THREE.Matrix4().copy(matrix).invert().setPosition(0, 0, 0);
  const v = new THREE.Vector3(...dirJ2000).applyMatrix4(eciToEcef).applyMatrix4(ecefToWorld).normalize();
  return { alt: Math.asin(v.y) * 180 / Math.PI, az: (Math.atan2(v.x, -v.z) * 180 / Math.PI + 360) % 360 };
}

test('the fade: nothing above −10°, full from −18°, rising in between', () => {
  assert.equal(nightFade(30), 0);
  assert.equal(nightFade(-10), 0);
  assert.equal(nightFade(-18), 1);
  assert.equal(nightFade(-40), 1);
  let last = 0;
  for (let s = -10; s >= -18; s -= 0.5) { const f = nightFade(s); assert.ok(f >= last); last = f; }
  assert.ok(nightFade(-11.6) < 0.15, 'the night golden (sun −11.6°) is barely touched');
  assert.equal(milkyWayLevel({ sunDeg: 20 }), 0, 'off by day');
  assert.equal(milkyWayLevel({ sunDeg: -25 }), 1, 'a moonless dark night: all of it');
});

test('the moon dims it by its lit share and its height', () => {
  assert.equal(moonDim(-10, 1), 1, 'a full moon below the horizon: no dimming');
  assert.ok(moonDim(40, 1) <= 0.11, 'a full moon high: about a tenth left');
  assert.ok(moonDim(40, 0.02) > 0.98, 'a thin crescent: nearly none');
  assert.ok(moonDim(5, 0.8) < moonDim(1, 0.8) && moonDim(20, 0.8) < moonDim(5, 0.8), 'more as it climbs');
  assert.ok(milkyWayLevel({ sunDeg: -25, moonAltDeg: 30, moonLit: 0.8 }) < 0.35);
});

test('the galactic core stands where the plan computed it (2026-07-04 at Fannette, within 1°)', () => {
  const core = galacticToJ2000(0, 0).dir;
  for (const [hour, alt, az] of [[21.75, 15.8, 151], [22 + 27 / 60, 19.2, 160], [23.3, 21.6, 172]]) {
    const p = altAzOf(core, hour);
    assert.ok(Math.abs(p.alt - alt) < 1, `${hour} h: alt ${p.alt.toFixed(2)} vs ${alt}`);
    assert.ok(Math.abs(p.az - az) < 1, `${hour} h: az ${p.az.toFixed(2)} vs ${az}`);
  }
  // the band crosses due east at about 36° at 21:45: the plane's point nearest az 87 there
  let best = null;
  for (let l = 0; l < 360; l += 0.5) { const p = altAzOf(galacticToJ2000(l, 0).dir, 21.75); if (p.alt > 0 && (!best || Math.abs(p.az - 87) < Math.abs(best.az - 87))) best = p; }
  assert.ok(Math.abs(best.alt - 36) < 1.5, `east crossing ${best.alt.toFixed(1)}°`);
});

test('the texture layout: the core, the LMC and the poles at their J2000 places; the core is warm in the tint', () => {
  const c = uvOfJ2000(...galacticToJ2000(0, 0).dir);
  assert.ok(Math.abs(c.u - (0.5 - 266.405 / 360 + 1)) < 0.002 && Math.abs(c.v - (90 + 28.936) / 180) < 0.002, JSON.stringify(c));
  const ra = 80.894 * Math.PI / 180, dec = -69.756 * Math.PI / 180;   // the LMC
  const l = uvOfJ2000(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
  assert.ok(Math.abs(l.u - (0.5 - 80.894 / 360)) < 0.002 && Math.abs(l.v - (90 + 69.756) / 180) < 0.002);
  assert.ok(Math.abs(uvOfJ2000(0, 0, 1).v) < 1e-9 && Math.abs(uvOfJ2000(0, 0, -1).v - 1) < 1e-9);
  const png = PNG.sync.read(readFileSync(new URL('data/sky/milkyway-tint.png', root)));
  const at = (uv) => { const x = Math.min(png.width - 1, Math.floor(uv.u * png.width)), y = Math.min(png.height - 1, Math.floor(uv.v * png.height)); const o = (y * png.width + x) * 4; return png.data.slice(o, o + 3); };
  const core = at(c), anti = at(uvOfJ2000(...galacticToJ2000(180, 0).dir));
  assert.ok(core[0] / core[2] > anti[0] / anti[2], `core r/b ${core[0] / core[2]} warmer than the anticentre ${anti[0] / anti[2]}`);
});

test('the encoding round-trips, and the files ship small (4K about 2.4 MB, 2K under 1 MB)', () => {
  for (const x of [0, 0.001, 0.0138, 0.2, 1]) assert.ok(Math.abs(decodeLum(encodeLum(x)) - x) < 1e-9);
  assert.ok(encodeLum(0.001) > 20 / 255, 'the darkest lanes keep 20+ levels');
  const size = (u) => statSync(new URL(u.slice(1), root)).size;
  assert.ok(size(MW_URL[4096]) < 3e6 && size(MW_URL[2048]) < 1e6 && size(MW_URL.tint) < 1e5);
});

test('the light domes: over South Lake Tahoe low in the east, nothing high or to the west', () => {
  assert.ok(lightDomeAt(88, 1) > 0.15);
  assert.ok(lightDomeAt(88, 30) < 0.01);
  assert.ok(lightDomeAt(250, 1) < 1e-3);
  assert.ok(lightDomeAt(88, 2) > lightDomeAt(50, 2), 'Reno fainter than South Lake Tahoe');
});

test('the node: dark until loaded, loads only once armed and the sun is below −6°, follows the sun and the moon', async () => {
  const atmosphere = new AtmosphereContext();
  const { matrix } = worldToECEF(PLACE);
  atmosphere.matrixWorldToECEF.value.copy(matrix);
  const sky = { starsNode: vec3(0) };
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return { ok: false, status: 404 }; };
  const mw = createMilkyWay({ atmosphere, sky, place: PLACE, matrixWorldToECEF: matrix, size: 2048, fetchImpl });
  assert.notEqual(sky.starsNode, null);
  const frame = (hour, elevDeg) => {
    getMoonDirectionECEF(new Date(timeAt(hour, PLACE)), atmosphere.moonDirectionECEF.value);
    mw.daylight({ hour, elevDeg });
  };
  frame(22.5, -20);
  assert.equal(calls.length, 0, 'not armed: no load (the first visit is never delayed)');
  assert.equal(mw.uniforms.scale.value, 0, 'nothing drawn before the textures');
  assert.ok(mw.state.level > 0.9, `22:30, moon down: ${mw.state.level}`);
  mw.arm();
  frame(14, 60);
  assert.equal(calls.length, 0, 'by day: no load');
  assert.equal(mw.state.level, 0);
  frame(21.3, -8);
  assert.deepEqual(calls, ['/data/sky/milkyway-2k.webp', '/data/sky/milkyway-tint.png'], 'the night loads the tier\'s size');
  await mw.load();
  assert.match(mw.state.error ?? '', /404/, 'a failed load is kept, not thrown');
  // 23:50 on 4 July: the waning gibbous moon is up in the east: dimmer than at 22:30
  frame(23 + 50 / 60, -25);
  assert.ok(mw.state.moonAltDeg > 3 && mw.state.moonLit > 0.6, `moon ${mw.state.moonAltDeg.toFixed(1)}° lit ${mw.state.moonLit.toFixed(2)}`);
  assert.ok(mw.state.level < 0.9);
});

test('the starlit night: a light floor for the hand-set colours, a night light and an airglow brighter with the moon', async () => {
  const { createDaylight } = await import('../classic/src/daylight.js');
  const { NIGHT_LIGHT_FLOOR, moonLightShare } = await import('../src/core/milkyway-math.js');
  const { NIGHT_LIGHT, AIRGLOW } = await import('../classic/src/core/milkyway.js');
  const d = createDaylight({ place: PLACE, matrixWorldToECEF: worldToECEF(PLACE).matrix, nightFloor: NIGHT_LIGHT_FLOOR });
  const night = d.update({ hour: 22.5, elevDeg: -19, exposure: 2172, light: 5e-6 });
  assert.equal(night.light, NIGHT_LIGHT_FLOOR, 'the night keeps the floor');
  const day = d.update({ hour: 14, elevDeg: 60, exposure: 6, light: 1 });
  assert.equal(day.light, 1, 'the day is untouched');
  const dark = createDaylight({ place: PLACE, matrixWorldToECEF: worldToECEF(PLACE).matrix }).update({ hour: 22.5, elevDeg: -19, exposure: 2172, light: 5e-6 });
  assert.equal(dark.light, 5e-6, 'without the night floor: no floor');
  assert.equal(moonLightShare(-10, 1), 0); assert.equal(moonLightShare(30, 1), 1);
  const atmosphere = new AtmosphereContext();
  const { matrix } = worldToECEF(PLACE);
  atmosphere.matrixWorldToECEF.value.copy(matrix);
  const mw = createMilkyWay({ atmosphere, sky: { starsNode: vec3(0) }, place: PLACE, matrixWorldToECEF: matrix, fetchImpl: async () => ({ ok: false, status: 404 }) });
  const at = (hour) => { getMoonDirectionECEF(new Date(timeAt(hour, PLACE)), atmosphere.moonDirectionECEF.value); mw.daylight({ hour, elevDeg: -20 }); return { air: mw.uniforms.air.value, light: mw.nightLight.intensity }; };
  const moonless = at(22.5), moonlit = at(25.5);   // 01:30 on 5 July: the waning gibbous moon well up
  assert.equal(moonless.air, AIRGLOW); assert.equal(moonless.light, NIGHT_LIGHT.intensity);
  assert.ok(moonlit.air > 2 * moonless.air && moonlit.light > 2 * moonless.light, JSON.stringify(moonlit));
  const off = createMilkyWay({ atmosphere, sky: { starsNode: vec3(0) }, place: PLACE, matrixWorldToECEF: matrix, starlit: false });
  assert.equal(off.uniforms.air.value, 0); assert.equal(off.nightLight.intensity, 0);
});
