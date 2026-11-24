// The system registry (refactor Phase 2 step 3): every per-frame update of the
// core and the world, in five phases, run in one fixed order by the frame (src/core/loop.js drawOnce).
//
//   const systems = createSystems();
//   systems.add({ id: 'water', phase: 'sim', update(ctx) { … }, dispose() { … } });   // order: within a phase (default 0)
//   await systems.run(ctx);      // pre, sim, scene, audio, post; in a phase by order, then by registration
//   systems.dispose();           // each system's dispose, in the reverse of the frame's order
//
// An update may return a promise (the stream's settle, the water's read-back, the draw): run() waits for it before the
// next system, and only then (a plain return costs no microtask, so the frame's timing is what it was).
//
// Cross-system values go through the per-frame env (createEnv), each written by the one system that owns it, before
// the systems that read it in the same frame: the daylight writes hour and sun, the storm writes rain and shelter; the
// birds and the sound read them. No system reads another's object for these.
export const PHASES = Object.freeze(['pre', 'sim', 'scene', 'audio', 'post']);

export function createEnv() {
  return { rain: 0, shelter: 0, hour: null, sun: null };
}

export function createSystems() {
  const list = [];   // registration order
  let sorted = null;
  const order = () => (sorted ??= list.map((s, i) => [s, i])
    .sort((a, b) => PHASES.indexOf(a[0].phase) - PHASES.indexOf(b[0].phase) || (a[0].order ?? 0) - (b[0].order ?? 0) || a[1] - b[1])
    .map(([s]) => s));
  const reg = {
    trace: null,   // an array: run() pushes each system's id as it updates it (the call-order check)
    add(sys) {
      if (!sys || typeof sys.id !== 'string' || typeof sys.update !== 'function') throw new TypeError('a system needs an id and update(ctx)');
      if (!PHASES.includes(sys.phase)) throw new TypeError(`system ${sys.id}: phase must be one of ${PHASES.join(', ')}`);
      if (list.some((s) => s.id === sys.id)) throw new Error(`system ${sys.id} is already registered`);
      list.push(sys); sorted = null;
      return sys;
    },
    remove(id) {
      const i = list.findIndex((s) => s.id === id);
      if (i < 0) return null;
      const [s] = list.splice(i, 1); sorted = null;
      return s;
    },
    get: (id) => list.find((s) => s.id === id),
    ids: () => order().map((s) => s.id),
    get size() { return list.length; },
    async run(ctx) {
      const all = order(), trace = reg.trace;
      for (let i = 0; i < all.length; i++) {
        const s = all[i];
        if (trace) trace.push(s.id);
        const r = s.update(ctx);
        if (r && typeof r.then === 'function') await r;
      }
    },
    dispose() {
      const all = order();
      for (let i = all.length - 1; i >= 0; i--) all[i].dispose?.();
      list.length = 0; sorted = null;
    },
  };
  return reg;
}
