// The wind texture off the page's thread (split from src/water.js, refactor round 2 Phase D; the code is unchanged): the
// worker that fills the wind texture, and the world stream's hook that builds the texture's terrain cache ahead.
import { workerName, primeWorker } from '../../src/sim/terrain-data.js';   // the workers load the same grid set as the page (phone or full)
import { WIND_TEX, WIND_EXTENT } from '../../src/sim/wind-texture.js';

// the wind texture's worker: one request at a time; `latest` is its newest result
export function windFiller(seed) {
  const w = new Worker(new URL('./wind-worker.js', import.meta.url), { type: 'module', name: workerName() });
  primeWorker(w);   // a phone: the page's grid bytes, before any job
  const F = { busy: false, latest: null, failed: false };
  w.onmessage = ({ data }) => { F.busy = false; if (data.error) { console.warn('wind worker:', data.error); return; } F.latest = data; };
  w.onerror = (e) => { F.busy = false; F.failed = true; console.warn('wind worker failed', e.message); };
  F.request = (key, state, cx, cz) => { if (F.failed) return; F.busy = true; w.postMessage({ key, seed, state, cx, cz }); };
  return F;
}

// World streaming: the wind texture's terrain cache for each 512 m centre the camera is heading to (the
// predicted path's centres, and the neighbours whose snap line is within reach) is built in the stream's workers
// and adopted before the camera crosses the snap; the centre under the camera is "due". run: the worker pool's run.
export function attachWindStream(wind, stream, run) {
  if (!wind.textureCache || !run) return;
  const snap = (v) => Math.round(v / 512) * 512;
  let wantKey = null, list = [];
  stream.register({
    name: 'wind',
    want(view) {
      const bins = wind.textureBins(), reach = 150 + view.speed * view.lead, out = new Map();
      const add = (cx, cz, eta, due) => { const k = `${cx},${cz}|${bins[0]},${bins.at(-1)}`, o = out.get(k); if (!o || eta < o.eta) out.set(k, { key: k, eta, due: due || (o?.due ?? false), cx, cz, bins }); };
      for (const p of view.path) {
        add(snap(p.x), snap(p.z), p.t, p.t === 0);
        // a snap line within reach of the point: the centre past it too (a turn, or the path's own error)
        const fx = p.x / 512 - Math.floor(p.x / 512), fz = p.z / 512 - Math.floor(p.z / 512), r = reach / 512;
        const nx = fx > 0.5 - r && fx < 0.5 + r ? (fx < 0.5 ? 1 : -1) : 0, nz = fz > 0.5 - r && fz < 0.5 + r ? (fz < 0.5 ? 1 : -1) : 0;
        const cx = snap(p.x), cz = snap(p.z);
        if (nx) add(cx + nx * 512, cz, p.t + 1, false);
        if (nz) add(cx, cz + nz * 512, p.t + 1, false);
        if (nx && nz) add(cx + nx * 512, cz + nz * 512, p.t + 2, false);
      }
      const key = [...out.keys()].join(';');
      if (key !== wantKey) { wantKey = key; list = [...out.values()]; }
      else for (const w of list) w.due = out.get(w.key).due;
      return list;
    },
    keep: () => false,   // the field keeps its own cache (the 9 newest centres); nothing to free here
    build: (k) => { const w = list.find((x) => x.key === k) ?? out0(k); return wind.texturePrepared(WIND_TEX, WIND_EXTENT, w.cx, w.cz) ? null : run('windtex', { seed: wind.seed, sizePx: WIND_TEX, extentM: WIND_EXTENT, cx: w.cx, cz: w.cz, bins: w.bins }); },
    upload: (k, c) => { if (c) { const [cx, cz] = k.split('|')[0].split(',').map(Number); wind.adoptTexture(WIND_TEX, WIND_EXTENT, cx, cz, c); } return true; },
    drop: () => {},
  });
  const out0 = (k) => { const [c, b] = k.split('|'), [cx, cz] = c.split(',').map(Number), [b0, b1] = b.split(',').map(Number); const bins = []; for (let i = b0; i <= b1; i++) bins.push(i); return { cx, cz, bins }; };
}
