// The readback ring: a GPU buffer copied into one of `slots` mappable staging buffers after each frame's passes, mapped
// asynchronously, and handed to `onData` as a Float32Array view over the mapped range. The staging buffers are made
// once; a frame whose every slot is still in flight skips its copy (never waits, never allocates a buffer). The only
// object a readback makes is the view over the mapped range (the browser's own ArrayBuffer for that mapping): the
// bytes land in the caller's persistent array through `set`, so the frame itself makes no garbage of its own.
//   const ring = createReadbackRing({ device, bytes, slots: 3, onData(view, meta) {…} });
//   ring.copy(encoder, srcBuffer, meta)   // in the frame, after the passes (graph.onBeforeSubmit)
//   ring.afterSubmit()                     // right after queue.submit (graph.onAfterSubmit)
//   await ring.drain()                     // a capture: every map in flight finished
const MAP_READ = 0x0001, COPY_DST = 0x0008;   // GPUBufferUsage (numbers, so the module loads in node for its test)

export function createReadbackRing({ device, bytes, slots = 3, onData, label = 'readback', mapMode = 1 }) {
  const ring = Array.from({ length: slots }, (_, i) => ({
    buf: device.createBuffer({ label: `${label}-${i}`, size: bytes, usage: MAP_READ | COPY_DST }),
    busy: false, pending: null, meta: null,
  }));
  let slot = 0, armed = null, reads = 0, skipped = 0;
  function finish(r) {
    try { onData(new Float32Array(r.buf.getMappedRange()), r.meta); } finally { r.buf.unmap(); }
    r.busy = false; r.pending = null; r.meta = null; reads++;
  }
  return {
    get reads() { return reads; },
    get skipped() { return skipped; },
    get slots() { return slots; },
    get bytes() { return bytes; },
    get inFlight() { return ring.filter((r) => r.busy).length; },
    get slot() { return slot; },   // the slot the next copy() takes (a consumer keeps its per-slot record in step)
    // record the copy into the free slot; `meta` is anything the consumer needs with the data (the window's origins, the sim time)
    copy(enc, src, meta = null) {
      const r = ring[slot];
      if (r.busy) { skipped++; armed = null; return false; }
      enc.copyBufferToBuffer(src, 0, r.buf, 0, bytes);
      r.meta = meta; armed = r;
      return true;
    },
    afterSubmit() {
      const r = armed; armed = null;
      if (!r) return;
      r.busy = true;
      r.pending = r.buf.mapAsync(mapMode).then(() => finish(r), () => { r.busy = false; r.pending = null; r.meta = null; });
      slot = (slot + 1) % slots;
    },
    async drain() { await Promise.all(ring.map((r) => r.pending).filter(Boolean)); },
    destroy() { for (const r of ring) r.buf.destroy(); },
  };
}
