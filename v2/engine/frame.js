// The frame graph (tiny, explicit): a list of passes, each a render pass with a target and a draw list, or a compute
// pass (kind: 'compute') with a dispatch list, run in order inside one command encoder and one submit. M1's graph:
//   water-sim → compute: evolve, 16 FFT stages, assemble, the mip levels                   [water]
//   sky-lut   → compute: the sky-view LUT for this frame's sun                              [sky]
//   scene     → HDR colour (rgba16float, msaa 1 or 4 with a resolve) + depth32float          [terrain, water, sky]
// M2: the depth is reversed (near → 1, far → 0, cleared to 0, compare 'greater') in a float buffer: a 24-bit buffer
// with a 0.5 m near plane resolved ≈ 3 m at 5 km, where the water meets the shore (it z-fought); reversed float keeps
// millimetres there.
//   bloom     → own: the post chain's half-size mip chain from the scene's colour (render/bloom.js; where its row is on)
//   composite → the swap chain (tonemap + bloom + sRGB + dither)                             [tonemap]
// Targets are made on resize only. GPU timestamps (when the device has the feature) bracket every pass; the frame
// resolves them into a ring of 3 readback buffers, so a mapping never waits on this frame's GPU work, and the stats
// read the newest resolved pair. Nothing is created in the frame (#31: a live MSAA change remakes the targets between frames).
export function createFrameGraph({ device, context, format, msaa = 1, timestamps = false, errors = [] }) {
  const passes = [];
  const targets = { hdr: null, hdrView: null, resolve: null, resolveView: null, depth: null, depthView: null, w: 0, h: 0 };
  const hdrFormat = 'rgba16float', depthFormat = 'depth32float';
  const onResize = [];

  // --- timestamps: 2 queries per pass, one query set, one resolve buffer, 3 mappable copies ---
  const Q = timestamps ? makeTimer(device, 32) : null;   // 2 queries a pass, up to 16 passes (M5c: the terrain shadow pass; ultra M2: the caustics; 2026-11-18: the bloom, the 12th with the fireworks)

  function resize(w, h) {
    if (w === targets.w && h === targets.h && targets.hdr) return false;
    alloc(w, h);
    return true;
  }
  // BACKLOG-v2 #31: the scene's sample count, live. The targets are made again at the new count (the same size), between
  // two frames: the next frame's scene pass clears them and draws every pixel, so no frame shows the old ones (no flash)
  // and none is skipped. The caller moves the pipeline registry to the same count first (reg.use: refused unless built).
  // Returns the ms it took (the textures' create and destroy, the onResize listeners' bind groups), or false (no change)
  function setMsaa(n, w = targets.w, h = targets.h) {
    if (n === msaa && w === targets.w && h === targets.h) return false;
    const t = performance.now();
    msaa = n;
    alloc(w, h);
    return performance.now() - t;
  }
  function alloc(w, h) {
    for (const k of ['hdr', 'resolve', 'depth']) targets[k]?.destroy();
    targets.w = w; targets.h = h;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT;
    targets.hdr = device.createTexture({ label: 'hdr', size: [w, h], format: hdrFormat, sampleCount: msaa, usage: usage | (msaa === 1 ? GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC : 0) });   // COPY_SRC: the fireworks' post copies the picture it composites over
    targets.hdrView = targets.hdr.createView();
    if (msaa > 1) {
      targets.resolve = device.createTexture({ label: 'hdr-resolve', size: [w, h], format: hdrFormat, usage: usage | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      targets.resolveView = targets.resolve.createView();
    } else { targets.resolve = null; targets.resolveView = targets.hdrView; }
    targets.depth = device.createTexture({ label: 'depth', size: [w, h], format: depthFormat, sampleCount: msaa, usage: usage | GPUTextureUsage.TEXTURE_BINDING });   // M5e: the composite reads it (the rainbow's distance)
    targets.depthView = targets.depth.createView();
    for (const f of onResize) f(targets);
  }

  // a render pass: { name, target: 'hdr' | 'swap', clear: [r,g,b,a] | null, depth: bool, draw(pass, ctx, counters) }
  // a compute pass: { name, kind: 'compute', run(pass, ctx, counters) }  (counters.dispatches counts its dispatches)
  // an own pass (M3: the boat's shadow map): { name, kind: 'custom', encode(encoder, ctx, counters, timestampWrites) }
  // records its own render pass on the frame's encoder (its own attachments), with the frame's timestamps if it uses them
  const addPass = (p) => { if (passes.length >= 16) throw new Error("frame graph: at most 16 passes (the timer query set)"); passes.push({ ...p, index: passes.length }); return p; };

  function descriptorOf(p) {
    const color = p.target === 'swap'
      ? { view: context.getCurrentTexture().createView(), loadOp: p.clear ? 'clear' : 'load', storeOp: 'store', clearValue: p.clear ? { r: p.clear[0], g: p.clear[1], b: p.clear[2], a: p.clear[3] } : undefined }
      : { view: targets.hdrView, resolveTarget: msaa > 1 ? targets.resolveView : undefined, loadOp: p.clear ? 'clear' : 'load', storeOp: msaa > 1 ? 'discard' : 'store', clearValue: p.clear ? { r: p.clear[0], g: p.clear[1], b: p.clear[2], a: p.clear[3] } : undefined };
    const d = { label: p.name, colorAttachments: [color] };
    // p.depthStore() → 'store' | 'discard' (the speed pass: the scene's depth is read after the pass only by the storm's
    // grade; a tile GPU writes the multisampled depth out to memory only when a reader needs it)
    if (p.depth) d.depthStencilAttachment = { view: targets.depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: p.depthStore ? p.depthStore() : 'store' };
    if (Q) d.timestampWrites = { querySet: Q.set, beginningOfPassWriteIndex: p.index * 2, endOfPassWriteIndex: p.index * 2 + 1 };
    return d;
  }

  const counters = { calls: 0, triangles: 0, dispatches: 0 };
  const computeDesc = (p) => (Q ? { label: p.name, timestampWrites: { querySet: Q.set, beginningOfPassWriteIndex: p.index * 2, endOfPassWriteIndex: p.index * 2 + 1 } } : { label: p.name });
  const beforeSubmit = [], afterSubmit = [], drains = [];
  const skip = new Set(), on = new Uint8Array(16);   // perf(v2) phone: pass names the diag sweep skips for a moment (never the scene or the composite)
  let tag = 0;   // perf(v2) phone round 2: a number the next render's timestamps carry back (the sweep's case and state)
  // one encoder, every pass, one submit; returns the submit's promise of completion when awaited by a capture
  function render(ctx) {
    counters.calls = 0; counters.triangles = 0; counters.dispatches = 0;
    const enc = device.createCommandEncoder({ label: 'frame' });
    for (const p of passes) {
      // perf(v2) phone: a pass the diag sweep skips (engine/sweep.js), or an own pass with nothing to draw this frame (its
      // encode returns false: the terrain shadow's map standing), is not encoded at all; the timer reads it as 0 ms. An
      // empty pass cost more than nothing: on a tile GPU an empty render pass loads and stores its attachments, and an
      // empty compute pass between render passes measured 0.3 ms on the Mac
      on[p.index] = 1;
      if (skip.size && skip.has(p.name)) { on[p.index] = 0; continue; }
      if (p.kind === 'compute') { const pass = enc.beginComputePass(computeDesc(p)); p.run(pass, ctx, counters); pass.end(); continue; }
      if (p.kind === 'custom') { if (p.encode(enc, ctx, counters, Q ? computeDesc(p).timestampWrites : undefined) === false) on[p.index] = 0; continue; }
      const pass = enc.beginRenderPass(descriptorOf(p));
      p.draw(pass, ctx, counters);
      pass.end();
    }
    for (const f of beforeSubmit) f(enc);   // copies out of the frame (the water's readback ring) ride the same encoder
    Q?.resolve(enc, passes.length * 2, on, tag);
    device.queue.submit([enc.finish()]);
    Q?.afterSubmit();
    for (const f of afterSubmit) f();
  }

  return {
    get targets() { return targets; }, passes, counters, hdrFormat, depthFormat, format,
    get msaa() { return msaa; },   // #31: live (setMsaa)
    resize, setMsaa, addPass, render, skip,
    setTag(t) { tag = t; },
    onResize: (f) => onResize.push(f),
    onBeforeSubmit: (f) => beforeSubmit.push(f),   // f(encoder): record copies after the passes
    onAfterSubmit: (f) => afterSubmit.push(f),     // f(): start a map, rotate a ring
    onDrain: (d) => drains.push(d),                // async d(): awaited by settle()
    get hasTimestamps() { return !!Q; },
    // the newest resolved pass times, ms: { total, span, work, passes: [ms per pass], own: [ms per pass], gap, seq, tag } or
    // null (seq counts resolved frames; own: each pass's exclusive share of the span, see makeTimer; gap: the span's idle
    // time; work: the shares' sum, span − gap)
    gpuMs: () => Q?.latest() ?? null,
    gpuTail: () => Q?.tail() ?? [],   // the last ≤ 240 resolved totals (a median for the stats)
    gpuSpanTail: () => Q?.spanTail() ?? [],   // perf(v2) phone round 2: the last ≤ 240 busy spans
    gpuWorkTail: () => Q?.workTail() ?? [],   // fix(v2) governor: the last ≤ 240 work sums (the span less its idle)
    gpuOwnMedians: () => Q?.ownMedians() ?? [],   // perf(v2) phone round 2: per pass, the median of its own share
    gpuPassMedians: () => Q?.passMedians() ?? [],   // per pass, the median of the last ≤ 240 (stats() only: it allocates)
    // a capture awaits this: the GPU done and this frame's timestamps mapped
    async settle() { await device.queue.onSubmittedWorkDone(); if (Q) await Q.drain(); await Promise.all(drains.map((d) => d())); },
  };
}

function makeTimer(device, count) {
  const set = device.createQuerySet({ type: 'timestamp', count });
  const bytes = count * 8;
  const resolveBuf = device.createBuffer({ label: 'ts-resolve', size: bytes, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const ring = Array.from({ length: 3 }, (_, i) => ({ buf: device.createBuffer({ label: `ts-read-${i}`, size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false, pending: null, mask: new Uint8Array(count >> 1).fill(1), tag: 0 }));
  let slot = 0, latest = null, used = 0, written = false, seq = 0;
  const tail = [], passTail = [], spanTail = [], ownTail = [], workTail = [];   // the last ≤ 240 totals (and spans); per pass, the last ≤ 240 times and own shares (medians for the stats)
  function finish(r, n) {
    const mask = r.mask;
    const a = new BigInt64Array(r.buf.getMappedRange());
    const per = [], own = []; let total = 0, lo = null, hi = null, reach = null;
    for (let i = 0; i + 1 < n; i += 2) {
      if (!mask[i >> 1]) { per.push(0); own.push(0); continue; }   // perf(v2) phone: not encoded this frame
      const b = a[i], e = a[i + 1];
      const ms = Number(e - b) / 1e6; per.push(ms); total += ms;
      // perf(v2) phone round 2: the pass's own share, its end minus the later of its start and every earlier pass's end. On
      // Apple's tile GPU a pass's start is stamped when its vertex stage starts, which can be while the last pass's fragments
      // still run, so a light pass after a heavy one read as heavy (the owner's composite: 5.1 ms for one triangle). The
      // shares sum to the busy span less its idle gaps; a wait inside a pass (a swap-chain image not yet free) stays its own
      let o = 0;
      if (e > b) {
        const from = reach != null && reach > b ? reach : b;
        o = e > from ? Number(e - from) / 1e6 : 0;
        if (reach == null || e > reach) reach = e;
        if (lo == null || b < lo) lo = b; if (hi == null || e > hi) hi = e;
      }
      own.push(o);
    }
    r.buf.unmap(); r.busy = false; r.pending = null;
    if (total > 0 && total < 10000) {
      // perf(v2) phone: the span (the first pass's start to the last pass's end) beside the sum: a tile GPU (Apple) overlaps
      // one pass's vertex work with the last one's fragments, so the sum can exceed the frame (Safari: 42 ms of passes in
      // 33 ms frames); the span is the GPU's busy window for the frame, the number the governor and the ladder now read
      const span = lo != null ? Math.min(Number(hi - lo) / 1e6, total) : total;
      const ownSum = own.reduce((x, y) => x + y, 0);
      // fix(v2) governor: the work, the shares' sum (the span less its idle gaps), is what the governor, the ladder, the
      // refresh probe and the sweep read. The owner's iPhone at 60 fps: span 22.5 ms, idle 11.7, work 10.8; the span held
      // gaps where the GPU waited (on the next frame's encode, the compositor, or ran another frame's passes)
      const work = Math.min(span, ownSum);
      latest = { total, span, work, passes: per, own, gap: Math.max(0, span - ownSum), seq: ++seq, tag: r.tag }; tail.push(total); if (tail.length > 240) tail.shift(); spanTail.push(span); if (spanTail.length > 240) spanTail.shift(); workTail.push(work); if (workTail.length > 240) workTail.shift();
      own.forEach((ms, k) => { const t = (ownTail[k] ??= []); t.push(ms); if (t.length > 240) t.shift(); });
      per.forEach((ms, k) => { const t = (passTail[k] ??= []); t.push(ms); if (t.length > 240) t.shift(); });
    }
  }
  return {
    set,
    resolve(enc, n, mask = null, tag = 0) {
      const r = ring[slot];
      if (!r.busy) { if (mask) r.mask.set(mask); else r.mask.fill(1); r.tag = tag; }
      if (r.busy) { written = false; return; }   // every readback in flight: skip this frame's copy (its queries are still written)
      enc.resolveQuerySet(set, 0, n, resolveBuf, 0);
      enc.copyBufferToBuffer(resolveBuf, 0, r.buf, 0, bytes);
      used = n; written = true;
    },
    afterSubmit() {
      if (!written) return;
      const r = ring[slot]; r.busy = true;
      r.pending = r.buf.mapAsync(GPUMapMode.READ).then(() => finish(r, used), () => { r.busy = false; r.pending = null; });
      slot = (slot + 1) % ring.length;
    },
    async drain() { await Promise.all(ring.map((r) => r.pending).filter(Boolean)); },
    latest: () => latest,
    tail: () => tail,
    spanTail: () => spanTail,
    workTail: () => workTail,
    ownMedians: () => ownTail.map((t) => { const a = t.slice().sort((x, y) => x - y); return a[a.length >> 1]; }),
    passMedians: () => passTail.map((t) => { const a = t.slice().sort((x, y) => x - y); return a[a.length >> 1]; }),
  };
}
