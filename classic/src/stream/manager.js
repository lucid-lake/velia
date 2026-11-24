// The streaming manager: one queue for every streamed system. Plain JS (no three.js):
// node tests drive it with a fake clock.
//
//   import { StreamManager } from './stream/manager.js';
//   const stream = new StreamManager();
//   stream.register({
//     name: 'terrain',
//     want(view)            → [{ key, eta, due }]   what the system needs for this view, nearest need first:
//                             eta: s until the camera needs it (0 now; the predicted path's time for a prefetch),
//                             due: the camera is there now (a non-resident `due` item is an incomplete arrival)
//     keep?(key, view)      → bool                  resident but no longer wanted: keep it (hysteresis)? default no
//     build(key)            → payload | Promise     the heavy part, off the main thread where it can be (workers)
//     upload(key, payload)  → true | false          one main-thread slice; false: call again (next slice), true: done
//     drop(key)                                     free it (GPU buffers, CPU arrays)
//   });
//   each frame: stream.update(camera, dt)   (dt: the sim step, s; the camera's ground velocity comes from its moves)
//   stream.request(name, key, eta), stream.prefetch(path) (the systems' want() sees view.path), stream.budget(ms),
//   stream.dispose(name, key), stream.settle() (a promise: everything wanted is resident; captures wait on it),
//   stream.report() (stats and the incomplete-arrival log)
//
// The view each want() gets: { x, y, z (the camera), vx, vz (m/s, smoothed), speed, lead (s), nearR (m), path:
// [{ x, z, t }] (the predicted ground path over the lead time) }. The lead time is the measured request → resident
// time × the safety factor (src/stream/config.js), so a faster camera prefetches further ahead without a code change.
import { STREAM, nearRadius, leadTime, setStreamTier } from './config.js';
import { predictPath } from './grid.js';

export class StreamManager {
  constructor({ config = STREAM, now = () => performance.now() } = {}) {
    this.cfg = config; this.now = now;
    this.systems = new Map();     // name → { sys, resident: Map key → { t } , inflight: Map key → t0, ready: Map key → { payload, t0, eta } }
    this.vel = { x: 0, z: 0 }; this.last = null;
    this.measured = config.lead.buildS;   // s, request → resident (a running max that decays)
    this.budgetMs = config.upload.budgetMs; this.forcedBudget = null;
    this.log = []; this.missing = new Set();
    this.stats = { frames: 0, uploads: 0, slices: 0, builds: 0, drops: 0, maxSliceMs: 0, maxFrameUploadMs: 0, raisedFrames: 0, buildFails: 0 };
    this.view = { x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0, lead: leadTime(this.measured, config), nearR: config.bands.near, path: [] };
    this.extraPath = null;
    this.waiters = [];
  }

  // the quality tier's radii and upload budget, in play (the governor's step down, Settings); config: this manager's own
  setTier(tier) { if (tier?.stream) setStreamTier(this.cfg, tier.stream); }

  register(sys) {
    const s = { sys, resident: new Map(), inflight: new Map(), ready: new Map(), wanted: new Map(), todo: [], changed: true };
    this.systems.set(sys.name, s);
    return s;
  }

  budget(ms) { this.forcedBudget = ms; }
  prefetch(path) { this.extraPath = path; }   // an extra path the systems should prefetch (a scripted camera's route)
  request(name, key, eta = 0) { const s = this.systems.get(name); if (s && !s.resident.has(key)) { s.wanted.set(key, { key, eta, due: false, extra: true }); s.extras = true; s.changed = true; } }
  isResident(name, key) { return this.systems.get(name)?.resident.has(key) ?? false; }
  dispose(name, key) {
    const s = this.systems.get(name); if (!s || !s.resident.has(key)) return;
    s.resident.delete(key); s.sys.drop(key); this.stats.drops++; s.changed = true;
  }

  // the camera's ground velocity from its moves (a jump over cfg.speed.jump is a cut: the velocity resets)
  _track(cam, dt) {
    const p = cam.position ?? cam;
    if (this.last && dt > 0) {
      const dx = p.x - this.last.x, dz = p.z - this.last.z;
      if (Math.hypot(dx, dz) > this.cfg.speed.jump) { this.vel.x = 0; this.vel.z = 0; }
      else { const a = 1 - Math.exp(-dt / this.cfg.speed.tau); this.vel.x += (dx / dt - this.vel.x) * a; this.vel.z += (dz / dt - this.vel.z) * a; }
    }
    this.last = { x: p.x, z: p.z };
    const v = this.view, speed = Math.hypot(this.vel.x, this.vel.z);
    v.x = p.x; v.y = p.y; v.z = p.z; v.vx = this.vel.x; v.vz = this.vel.z; v.speed = speed;
    v.lead = leadTime(this.measured, this.cfg);
    v.nearR = nearRadius(speed, v.lead, this.cfg);
    v.path = predictPath(p, this.vel, v.lead);
    if (this.extraPath) v.path = v.path.concat(this.extraPath);
    return v;
  }

  update(cam, dt = 1 / 60) {
    const view = this._track(cam, dt), cfg = this.cfg, t = this.now();
    this.stats.frames++;
    let behind = false;
    // 1. what each system wants; drop what it no longer wants (unless it keeps it)
    for (const s of this.systems.values()) {
      // a system that returns the same list as last frame (it recomputes on a step) keeps its map: no per-frame
      // rebuild of thousands of items; the items themselves may change (their `due`)
      const list = s.sys.want(view);
      let changed = s.changed; s.changed = false;
      if (list !== s.lastList || s.extras) {
        const extra = s.extras ? [...s.wanted.values()].filter((w) => w.extra) : [];
        s.wanted = new Map();
        for (const w of list) { const o = s.wanted.get(w.key); if (!o) s.wanted.set(w.key, w); else if (w.eta < o.eta || w.due) s.wanted.set(w.key, { ...w, due: w.due || o.due }); }
        for (const w of extra) if (!s.wanted.has(w.key)) s.wanted.set(w.key, w);
        s.lastList = list; s.extras = extra.length > 0; changed = true;
      }
      // the drop scan and the not-resident list only when the wanted set or the residents changed (an upload): a
      // system with thousands of tiles costs nothing on a quiet frame
      if (changed) {
        for (const key of [...s.resident.keys()]) if (!s.wanted.has(key) && !(s.sys.keep?.(key, view))) { s.resident.delete(key); s.sys.drop(key); this.stats.drops++; }
        for (const key of [...s.ready.keys()]) if (!s.wanted.has(key)) s.ready.delete(key);   // built, no longer wanted: never uploaded
        s.todo = []; for (const w of s.wanted.values()) if (!s.resident.has(w.key)) s.todo.push(w);
      }
      // 2. arrivals: a due item that is not resident (logged once until it lands)
      for (const w of s.todo) {
        if (s.resident.has(w.key)) continue;
        if (w.due) {
          const id = `${s.sys.name}:${w.key}`;
          if (!this.missing.has(id)) { this.missing.add(id); this.log.push({ frame: this.stats.frames, system: s.sys.name, key: w.key, speed: +view.speed.toFixed(1), x: Math.round(view.x), z: Math.round(view.z), state: s.ready.has(w.key) ? 'uploading' : s.inflight.has(w.key) ? 'building' : 'queued' }); }
        }
        if (w.eta <= view.lead * 0.5) behind = true;
      }
    }
    if (this.missing.size) for (const id of this.missing) { const i = id.indexOf(':'), s = this.systems.get(id.slice(0, i)); if (!s || s.resident.has(id.slice(i + 1)) || !s.wanted.has(id.slice(i + 1))) this.missing.delete(id); }
    // 3. builds: per system, the most urgent first, up to cfg.upload.builds at a time each (one system's flood, the
    // terrain at a high speed, never starves another's slow job, the wind cache)
    for (const s of this.systems.values()) {
      if (s.inflight.size >= cfg.upload.builds) continue;
      const todo = [];
      for (const w of s.todo) if (!s.resident.has(w.key) && !s.inflight.has(w.key) && !s.ready.has(w.key)) todo.push([w.eta - (w.due ? 1e3 : 0), w]);
      todo.sort((a, b) => a[0] - b[0]);
      for (const [, w] of todo.slice(0, cfg.upload.builds - s.inflight.size)) this._build(s, w);
    }
    // 4. uploads: time-sliced; the budget rises when an item due soon is not resident
    const budget = this.forcedBudget ?? (behind ? cfg.upload.maxBudgetMs : cfg.upload.budgetMs);
    this.budgetMs = budget; if (behind) this.stats.raisedFrames++;
    const queue = [];
    for (const s of this.systems.values()) for (const [key, r] of s.ready) queue.push([s.wanted.get(key)?.eta ?? 1e9, s, key, r]);
    queue.sort((a, b) => a[0] - b[0]);
    const u0 = this.now();
    for (const [, s, key, r] of queue) {
      if (this.now() - u0 >= budget) break;
      let done = false;
      while (!done && this.now() - u0 < budget) {
        const a = this.now(); done = s.sys.upload(key, r.payload); const d = this.now() - a;
        this.stats.slices++; this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, d);
      }
      if (done) {
        s.ready.delete(key); s.resident.set(key, { t: this.now() }); this.stats.uploads++; s.changed = true;
        const took = (this.now() - r.t0) / 1000;   // request → resident, s
        this.measured = Math.max(took, this.measured * 0.98);   // a running max that decays (≈ 2 % a tile)
      }
    }
    this.stats.maxFrameUploadMs = Math.max(this.stats.maxFrameUploadMs, this.now() - u0);
    if (this.waiters.length && this.idle()) for (const w of this.waiters.splice(0)) w();
    void t;
    return view;
  }

  _build(s, w) {
    const t0 = this.now(); s.inflight.set(w.key, t0); this.stats.builds++;
    Promise.resolve().then(() => s.sys.build(w.key)).then((payload) => {
      s.inflight.delete(w.key);
      if (s.wanted.has(w.key)) s.ready.set(w.key, { payload, t0 });
    }, (e) => { s.inflight.delete(w.key); this.stats.buildFails++; console.warn(`stream: ${s.sys.name} ${w.key} failed`, e); });
  }

  // everything wanted is resident (and nothing is building or waiting to upload); due: only what the camera needs now
  // exact (with due): the picture's own needs (`need`, else `due`): captures; without it only `due`: the live start
  idle({ due = false, exact = true } = {}) {
    for (const s of this.systems.values()) {
      if (!due && (s.inflight.size || s.ready.size)) return false;
      for (const [k, w] of s.wanted) if ((!due || (exact ? (w.need ?? w.due) : w.due)) && !s.resident.has(k)) return false;   // need: the exact picture (a system may call a late item not due when something finer covers it)
    }
    return true;
  }
  // a promise that resolves when idle(); the caller keeps calling update() (captures: an unbudgeted loop, settleNow)
  settle() { return this.idle() ? Promise.resolve() : new Promise((r) => this.waiters.push(r)); }
  // captures and the start: run update() with no budget until idle (or the timeout), yielding to the workers
  // (due: true, the default: only what the camera needs now: the picture is complete; the prefetch goes on later)
  async settleNow(cam, { timeoutMs = 20000, due = true, exact = true } = {}) {
    const prev = this.forcedBudget; this.forcedBudget = 1e9;
    const t0 = this.now();
    this.settling = true;   // systems may build in place now (the start, captures: no worker warm-up to wait on)
    try {
      this.update(cam, 0);
      while (!this.idle({ due, exact }) && this.now() - t0 < timeoutMs) { await new Promise((r) => setTimeout(r, 4)); this.update(cam, 0); }
    } finally { this.forcedBudget = prev; this.settling = false; }
    return this.idle({ due, exact });
  }

  resetLog() { this.log.length = 0; this.missing.clear(); for (const k of Object.keys(this.stats)) this.stats[k] = 0; }

  report() {
    const sys = {};
    for (const [name, s] of this.systems) sys[name] = { resident: s.resident.size, wanted: s.wanted.size, inflight: s.inflight.size, ready: s.ready.size };
    return { ...this.stats, maxSliceMs: +this.stats.maxSliceMs.toFixed(2), maxFrameUploadMs: +this.stats.maxFrameUploadMs.toFixed(2), measuredS: +this.measured.toFixed(3),
      view: { speed: +this.view.speed.toFixed(1), lead: +this.view.lead.toFixed(2), nearR: Math.round(this.view.nearR) }, systems: sys,
      incompleteArrivals: this.log.length, arrivals: this.log.slice(0, 50) };
  }
}
