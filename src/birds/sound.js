// The birds' voices: real recordings (public domain and CC0; audio/sources.json "birds", ATTRIBUTION.md), placed in
// the world (a panner per call, the listener at the camera) and kept quiet: a call is a thing you notice, not a
// soundtrack. The flight model's events drive them (src/birds/flight.js: call, honk, plunge, lift, wingslap, patter,
// land); a species is never heard twice within its gap, nothing beyond its range.
import { decodeFile } from '../audioFormat.js';
import { cardFetch } from '../ui/deferLoad.js';

// clip: the file under audio/birds/ (.opus, with an .m4a twin); level: linear at 25 m; gap: s between two of its kind;
// range: m beyond which it is not played
export const BIRD_SOUNDS = {
  osprey: { clips: ['osprey_a', 'osprey_b'], level: 0.32, gap: 3.5, range: 500 },
  eagle: { clips: ['eagle_a'], level: 0.28, gap: 9, range: 600 },
  gull: { clips: ['gull_a', 'gull_b'], level: 0.22, gap: 4, range: 400 },
  goose: { clips: ['goose_a', 'goose_b'], level: 0.3, gap: 0.7, range: 600 },
  splash: { clips: ['splash_big'], level: 0.55, gap: 0.5, range: 300 },
  slap: { clips: ['splash_small'], level: 0.2, gap: 0.25, range: 150 },
};
// which sound an event makes
export function soundFor(e) {
  switch (e.kind) {
    case 'call': return e.species === 'eagle' ? 'eagle' : e.species === 'gull' ? 'gull' : 'osprey';
    case 'honk': return 'goose';
    case 'plunge': case 'land': return 'splash';
    case 'wingslap': case 'patter': case 'lift': return 'slap';
  }
  return null;
}
// the level at a distance: inverse from 25 m (the Web Audio "inverse" model), cut at the range
export function levelAt(kind, d, gain = 1) {
  const S = BIRD_SOUNDS[kind];
  if (!S || d > S.range) return 0;
  return S.level * gain * 25 / Math.max(25, d);
}

export function createBirdSound({ audio, base = '/audio/birds/', fetchFn = cardFetch } = {}) {   // fetchFn: on a phone, once the card is live (src/ui/deferLoad.js)
  let ctx = null, out = null;
  const buffers = {}, last = {};
  let pick = 0;
  audio?.attach?.(({ ctx: c, master }) => {
    ctx = c; out = c.createGain(); out.gain.value = 1; out.connect(master);
    for (const S of Object.values(BIRD_SOUNDS)) for (const n of S.clips) {
      if (buffers[n]) continue;
      buffers[n] = decodeFile(ctx, fetchFn, `${base}${n}.opus`).catch(() => null);
    }
  });
  const L = { x: 0, y: 0, z: 0 };
  return {
    update(events, camera, t) {
      if (!ctx || ctx.state !== 'running') return;
      const l = ctx.listener, e = camera.matrixWorld.elements;
      L.x = e[12]; L.y = e[13]; L.z = e[14];
      if (l.positionX) {
        const at = ctx.currentTime;
        l.positionX.setValueAtTime(L.x, at); l.positionY.setValueAtTime(L.y, at); l.positionZ.setValueAtTime(L.z, at);
        l.forwardX.setValueAtTime(-e[8], at); l.forwardY.setValueAtTime(-e[9], at); l.forwardZ.setValueAtTime(-e[10], at);
        l.upX.setValueAtTime(e[4], at); l.upY.setValueAtTime(e[5], at); l.upZ.setValueAtTime(e[6], at);
      }
      for (const ev of events) {
        const kind = soundFor(ev); if (!kind) continue;
        const d = Math.hypot(ev.pos[0] - L.x, ev.pos[1] - L.y, ev.pos[2] - L.z);
        const g = levelAt(kind, d, ev.gain ?? 1);
        if (g < 0.003 || (last[kind] != null && t - last[kind] < BIRD_SOUNDS[kind].gap && t >= last[kind])) continue;
        last[kind] = t;
        const S = BIRD_SOUNDS[kind], name = S.clips[(pick++) % S.clips.length];
        Promise.resolve(buffers[name]).then((buf) => {
          if (!buf || !ctx) return;
          const src = ctx.createBufferSource(); src.buffer = buf;
          src.playbackRate.value = 0.96 + 0.08 * ((ev.id ?? 0) * 0.37 % 1);
          const pan = ctx.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 25; pan.rolloffFactor = 1; pan.maxDistance = 3000;
          pan.positionX ? (pan.positionX.value = ev.pos[0], pan.positionY.value = ev.pos[1], pan.positionZ.value = ev.pos[2]) : pan.setPosition(ev.pos[0], ev.pos[1], ev.pos[2]);
          const gn = ctx.createGain(); gn.gain.value = S.level * (ev.gain ?? 1);
          src.connect(gn).connect(pan).connect(out);
          src.start();
        });
      }
    },
  };
}
