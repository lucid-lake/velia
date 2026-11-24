// The pipeline registry. Every render and compute pipeline is declared before the first frame and built with
// createRenderPipelineAsync / createComputePipelineAsync (a descriptor with `compute` is a compute pipeline) inside
// buildAll(), behind the loading veil; the frame only ever calls get(). After seal()
// (the first frame drawn) a new add() or build is a loud error: it is pushed to `errors`, counted in `late`, and the
// stats hook shows it, so a shader that compiles in play can never hide again (v1's 175–495 ms hitches).
//   const reg = createPipelineRegistry(device, { errors });
//   reg.add('sky', { layout, vertex: {…}, fragment: {…}, primitive, depthStencil });
//   await reg.buildAll();  reg.seal();  reg.get('sky')
// Compile messages come back line-numbered through getCompilationInfo on the shader modules we made (`reg.shader`).
//
// BACKLOG-v2 #31, MSAA live: the scene's pipelines exist once per sample count. Given { msaa, counts } (the count the scene
// starts at, and every count the ladder may move to), a scene pipeline (one whose `multisample.count` is the start count,
// or one declared as a function of the count: add(name, (n) => desc), for a shader or a layout that changes with it) is
// declared for each count at add(), so every shader module is made at load. buildAll() builds the start count only (the
// load costs what it did); buildCount(n) builds another count's set later, async (createRenderPipelineAsync, off the
// frame), and is the one build allowed after seal(). use(n) moves get() to that set, only once ready(n); get() of a set
// not built still throws and counts as late. Nothing is ever built synchronously.
//
// perf(v2) iOS pipelines: groups and the deferred build. iPhone WebKit compiles one pipeline at a time in its GPU process
// (the owner's report, 2026-11-17: 95 pipelines, 26.4 s before the first frame). With { defer: true } every add() made
// under group(g) (a plug-in's pipelines) belongs to g; buildAll() builds 'core' and the groups release(g) named before it;
// after the first frame release(g) builds a group one pipeline at a time (paced: at most one compile queued, a frame between
// two, so a device that compiles on its GPU queue never holds a frame for more than one pipeline), and buildCount(n) does
// the same. ready(g) / whenReady(g) say when a group serves; a frame never draws a group before it is ready (main.js gates
// the draws and the streams). get() of a pipeline not built still throws: a missed gate stays loud. Without defer every
// group is released at add() (captures and the goldens: everything before the first frame, as before).
// timings(): each pipeline's time in buildAll (resolved minus the later of its issue and the previous resolve: on a device
// that compiles one at a time that is its own compile), summed by family (the name before its first '-').
// delayMs (?pipedelay=, perf(v2) phone build): a wait before each build, the builds then one at a time (an emulated slow compiler:
// iPhone WebKit's one-at-a-time compile on this Mac's parallel one; the phone page tests and tools/v2-phone-load.mjs --slow).
export function createPipelineRegistry(device, { errors = [], msaa = null, counts = null, defer = false, delayMs = 0 } = {}) {
  const descs = new Map(), built = new Map(), modules = [];
  const groupOf = new Map(), released = new Set(['core']), groupMs = new Map();   // name → group; the groups built or building; group → its build ms
  let tag = 'core', queue = Promise.resolve(), times = [], loadBuilt = false;   // loadBuilt: buildAll() has taken its list
  const isReleased = (n) => !defer || released.has(groupOf.get(n) ?? 'core');
  // #31: name → Map(count → desc) and Map(count → pipeline) for the scene's per-count pipelines
  const perCount = new Map(), builtAt = new Map();
  const COUNTS = msaa == null ? [] : [...new Set([msaa, ...(counts ?? [])])].sort((a, b) => a - b);
  let sealed = false, late = 0, buildMs = 0, failure = null, active = msaa;
  const bg = new Map();   // count → { promise, ms, n, error }
  const fail = (msg) => { errors.push(msg); throw new Error(msg); };
  // a descriptor at another count: the multisample state moved (alpha to coverage needs more than one sample)
  const atCount = (d, n) => ({ ...d, multisample: { ...d.multisample, count: n, ...(d.multisample?.alphaToCoverageEnabled ? { alphaToCoverageEnabled: n > 1 } : {}) } });
  let slow = Promise.resolve();   // delayMs: the one-at-a-time chain
  async function create(n, d) {
    if (delayMs > 0) { const turn = slow.then(() => new Promise((ok) => setTimeout(ok, delayMs))); slow = turn; await turn; }
    device.pushErrorScope?.('validation');
    let p = null, err = null;
    const t = now();
    try { p = d.compute ? await device.createComputePipelineAsync(d) : await device.createRenderPipelineAsync(d); } catch (e) { err = e; }
    const done = now();
    const scope = await device.popErrorScope?.().catch(() => null);
    return [n, p, err ?? scope, t, done];
  }
  // one pipeline at a time after the first frame, a macrotask between two (the frame's rAF gets its turn)
  const paced = (n, d) => { const r = queue.then(() => create(n, d)); queue = r.then(() => new Promise((ok) => setTimeout(ok, 0)), () => null); return r; };
  const countsWanted = () => [...new Set([active, msaa, ...bg.keys()])].filter((c) => COUNTS.includes(c));   // the load's count, the active one, any built or building
  const groupNames = (g) => [...descs.keys(), ...perCount.keys()].filter((n) => (groupOf.get(n) ?? 'core') === g);
  const builtNow = (n) => (perCount.has(n) ? builtAt.get(n).has(active) : built.has(n));
  const groupReady = (g) => (!defer || released.has(g) && !pendingGroups.has(g)) && groupNames(g).every(builtNow);
  const pendingGroups = new Map();   // group → its build's promise (after the first frame)
  async function failed(n, err) {
    const info = await compileInfo(modules);
    failure = { name: n, message: String(err?.message ?? err ?? 'no pipeline'), info };
    return `pipeline "${n}" failed: ${err?.message ?? err ?? 'no pipeline'}${info ? '\n' + info : ''}`;
  }
  const countReady = (c) => [...perCount.keys()].filter(isReleased).every((n) => builtAt.get(n)?.has(c));
  return {
    get size() { return descs.size; },
    get built() { return built.size + [...builtAt.values()].reduce((s, m) => s + m.size, 0); },
    get computeCount() { return [...descs.values()].filter((d) => d.compute).length; },
    get late() { return late; },
    get sealed() { return sealed; },
    get buildMs() { return buildMs; },
    get failure() { return failure; },   // the phone pass: the first pipeline that failed { name, message, info } (the diag panel)
    // #31: the sample count get() serves, the counts declared, the scene pipelines per count
    get sampleCount() { return active; },
    get counts() { return COUNTS.slice(); },
    get perCount() { return perCount.size; },
    shader(label, code) {
      const m = device.createShaderModule({ label, code });
      modules.push([label, m, code]);
      return m;
    },
    add(name, desc) {
      // a late group (Regatta's props and lines, imported when a race first asks): after the first frame a
      // deferred registry takes add() into a group no one has released yet ('core' never), and release(g) builds it paced
      if (sealed && !(defer && tag !== 'core' && !released.has(tag))) { late++; fail(`pipeline "${name}" declared after the first frame (pipelines are built at load only)`); }
      if (descs.has(name) || perCount.has(name)) fail(`pipeline "${name}" declared twice`);
      groupOf.set(name, tag);
      const fn = typeof desc === 'function';
      // ultra M2: an own-target pipeline whose sample count only happens to match the scene's (the caustics' 4× splat) says
      // fixedSamples: true and is built once, at its own count, never moved with the scene's
      const fixed = !fn && desc.fixedSamples === true;
      if (fixed) { desc = { ...desc }; delete desc.fixedSamples; }
      if (fn && msaa == null) desc = desc(1);
      else if (!fixed && (fn || (msaa != null && desc.multisample?.count === msaa))) {
        // #31: one descriptor per count, every module made now (a function's shaders too)
        const m = new Map();
        for (const c of COUNTS) { const d = fn ? desc(c) : atCount(desc, c); m.set(c, { ...d, label: `${d.label ?? name}${c === msaa ? '' : `@${c}x`}` }); }
        perCount.set(name, m); builtAt.set(name, new Map());
        return;
      }
      descs.set(name, { ...desc, label: desc.label ?? name });
    },
    async buildAll() {
      if (sealed) { late++; fail('buildAll() after the first frame'); }
      const t = now();
      loadBuilt = true;
      const pending = [...descs].filter(([n]) => !built.has(n) && isReleased(n)).map(([n, d]) => [n, d, null]);
      for (const [n, m] of perCount) if (!builtAt.get(n).has(msaa) && isReleased(n)) pending.push([n, m.get(msaa), msaa]);
      const results = await Promise.all(pending.map(async ([n, d, c]) => [...(await create(n, d)), c]));
      for (const [n, p, err, , , c] of results) {
        if (err || !p) fail(await failed(n, err));
        if (c == null) built.set(n, p); else builtAt.get(n).set(c, p);
      }
      times = costs(results.map(([n, , , t0, t1]) => [n, t0, t1]));
      buildMs += now() - t;
      return this.built;
    },
    // perf(v2) iOS pipelines: the plug-in's group for the add() calls that follow (returns the one before); 'core' by default
    group(g) { const prev = tag; tag = g || 'core'; return prev; },
    // a group's pipelines: before buildAll(), built with the load's; after the first frame, built paced in the background at
    // the active count (and any count already building or built). Resolves { group, n, ms }; a second call shares the first
    release(g) {
      if (!defer || released.has(g) && !pendingGroups.has(g) && loadBuilt) return Promise.resolve({ group: g, n: 0, ms: 0 });
      if (pendingGroups.has(g)) return pendingGroups.get(g);
      released.add(g);
      if (!loadBuilt) return Promise.resolve({ group: g, n: 0, ms: 0 });   // built by buildAll()
      const t0 = now();
      const todo = [];
      for (const n of groupNames(g)) {
        if (perCount.has(n)) { for (const c of countsWanted()) if (!builtAt.get(n).has(c)) todo.push([n, perCount.get(n).get(c), c]); }
        else if (!built.has(n)) todo.push([n, descs.get(n), null]);
      }
      const p = Promise.all(todo.map(([n, d, c]) => paced(n, d).then(async ([, pl, err]) => {
        if (err || !pl) { const msg = await failed(n, err); errors.push(msg); throw new Error(msg); }
        if (c == null) built.set(n, pl); else builtAt.get(n).set(c, pl);
      }))).then(() => { const ms = now() - t0; groupMs.set(g, ms); pendingGroups.delete(g); return { group: g, n: todo.length, ms }; },
        (e) => { pendingGroups.delete(g); released.delete(g); throw e; });
      pendingGroups.set(g, p);
      return p;
    },
    // ready(g) for a group name ('core', 'forest', …); ready(n) for a sample count (#31)
    ready: (x) => (typeof x === 'number' ? COUNTS.includes(x) && countReady(x) : groupReady(x)),
    whenReady(g) { return groupReady(g) ? Promise.resolve(true) : this.release(g).then(() => true); },
    // every group and its state: { n, released, ready, ms } (the stats hook, the load report)
    groups() {
      const out = {};
      for (const n of [...descs.keys(), ...perCount.keys()]) { const g = groupOf.get(n) ?? 'core'; (out[g] ??= { n: 0, released: !defer || released.has(g), ready: false, ms: groupMs.has(g) ? +groupMs.get(g).toFixed(0) : null }).n++; }
      for (const g of Object.keys(out)) out[g].ready = groupReady(g);
      return out;
    },
    // the load's per-pipeline times (ms): { total, n, families: [[family, ms, n]…] slowest first, top: [[name, ms]…] }
    timings() {
      const fam = new Map();
      for (const [n, ms] of times) { const f = n.split(/[-@]/)[0]; const o = fam.get(f) ?? [f, 0, 0]; o[1] += ms; o[2]++; fam.set(f, o); }
      const r = (x) => Math.round(x);
      return { total: r(times.reduce((s, [, ms]) => s + ms, 0)), n: times.length, families: [...fam.values()].sort((a, b) => b[1] - a[1]).map(([f, ms, k]) => [f, r(ms), k]),
        top: times.slice().sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, ms]) => [n, r(ms)]) };
    },
    // #31: another count's scene pipelines, async, after the first frame too (the one build allowed in play: nothing waits
    // on it, the frame keeps drawing with the active set). Resolves { count, n, ms }; a second call shares the first's promise
    buildCount(c) {
      if (!COUNTS.includes(c)) return Promise.reject(new Error(`sample count ${c} was not declared (${COUNTS.join(', ') || 'none'})`));
      if (bg.has(c)) return bg.get(c).promise;
      const rec = { promise: null, ms: null, n: 0, error: null, t0: now() };
      rec.promise = (async () => {
        const todo = [...perCount].filter(([n]) => !builtAt.get(n).has(c) && isReleased(n));
        const results = await Promise.all(todo.map(([n, m]) => (sealed ? paced : create)(n, m.get(c))));
        for (const [n, p, err] of results) {
          if (err || !p) { const msg = await failed(n, err); rec.error = msg; errors.push(msg); throw new Error(msg); }
          builtAt.get(n).set(c, p);
        }
        rec.n = todo.length; rec.ms = now() - rec.t0;
        return { count: c, n: rec.n, ms: rec.ms };
      })();
      bg.set(c, rec);
      return rec.promise;
    },
    // the background builds: count → { ms, n, error, building }
    background: () => Object.fromEntries([...bg].map(([c, r]) => [c, { ms: r.ms == null ? null : +r.ms.toFixed(1), n: r.n, error: r.error, building: r.ms == null && !r.error }])),
    // #31: get() serves count c from now on; refused (loud) unless every scene pipeline at c is built
    use(c) {
      if (c === active) return true;
      if (!COUNTS.includes(c) || !countReady(c)) { if (sealed) late++; fail(`sample count ${c} is not built (buildCount(${c}) first): the scene would build in play`); }
      active = c;
      return true;
    },
    seal() { sealed = true; },
    get(name) {
      const per = builtAt.get(name);
      const p = per ? per.get(active) : built.get(name);
      if (!p) {
        if (sealed) late++;
        fail(`pipeline "${name}" is not built${per ? ` at ${active}x` : ''}${descs.has(name) || per ? ' (buildAll() did not run)' : ' (never declared)'}`);
      }
      return p;
    },
    names: () => [...descs.keys(), ...perCount.keys()],
    groupOf: (n) => groupOf.get(n) ?? 'core',
    has: (n) => builtNow(n),   // the pipeline serves get() now (at the active count)
    // the phone pass: every module's text (the Safari scan, engine/wgsl-lint.js; v2/tests/pages/safariWgsl.page.mjs)
    modules: () => modules.map(([label, , code]) => ({ label, code })),
  };
}

const now = () => (globalThis.performance?.now?.() ?? Date.now());

// each pipeline's own time from [name, issued, resolved]: in resolve order, resolved minus the later of its issue and the
// previous resolve (a device that compiles one at a time: its compile; a parallel one: its share of the span)
export function costs(rows) {
  let prev = -Infinity;
  return rows.slice().sort((a, b) => a[2] - b[2]).map(([n, t0, t1]) => { const ms = Math.max(0, t1 - Math.max(t0, prev)); prev = t1; return [n, ms]; });
}

async function compileInfo(modules) {
  const out = [];
  for (const [label, m, code] of modules) {
    try {
      const info = await m.getCompilationInfo?.();
      for (const msg of info?.messages ?? []) if (msg.type === 'error') {
        const line = code.split('\n')[msg.lineNum - 1] ?? '';
        out.push(`${label}:${msg.lineNum}:${msg.linePos} ${msg.message}\n    ${line.trim()}`);
      }
    } catch { /* no info on this device */ }
  }
  return out.join('\n');
}

// perf(v2) iOS pipelines: the deferred groups released one group at a time, in `order` (the hero first), after start();
// now(g) moves a group to the front (its first use: a race entered, the storm come in); ready(g) resolves once it is built
// (and never starts it). A group already built (or released with the load) resolves at once.
//   const q = createReleaseQueue(reg, ['boatModels', 'forest', …]);   q.start();   await q.ready('forest');   q.now('regatta')
export function createReleaseQueue(reg, order = []) {
  const todo = [...order], waits = new Map(), done = new Set();
  let running = false, started = false;
  const settle = (g, ok) => { done.add(g); const w = waits.get(g); if (w) { waits.delete(g); w.res(ok); } };
  async function pump() {
    if (running || !started) return;
    running = true;
    while (todo.length) {
      const g = todo.shift();
      if (reg.ready(g)) { settle(g, true); continue; }
      try { await reg.release(g); settle(g, true); } catch { settle(g, false); }   // the registry has the error (loud)
    }
    running = false;
  }
  return {
    start() { if (!started) { started = true; pump(); } },
    get started() { return started; },
    now(g) { const i = todo.indexOf(g); if (i > 0) { todo.splice(i, 1); todo.unshift(g); } else if (i < 0 && !done.has(g) && !reg.ready(g)) todo.unshift(g); started = true; pump(); },
    ready(g) {
      if (done.has(g) || reg.ready(g)) return Promise.resolve(true);
      if (!waits.has(g)) { let res; const p = new Promise((r) => { res = r; }); waits.set(g, { p, res }); }
      return waits.get(g).p;
    },
    has: (g) => done.has(g) || reg.ready(g),
    get pending() { return todo.slice(); },
  };
}
