// The adapter and device. v2 is WebGPU only: without it the page shows the launch gate (#nogpu in v2/index.html, with
// the link to the classic Velia) and stops; nothing else runs. The gate (v2/start.js, engine/gpuCheck.js) asks
// for the adapter before main.js loads and hands it over here (globalThis.__veliaGate), so the page asks once. Features asked for only when present: timestamp-query
// (the GPU timer, when the page wants timing). The device's loss is reported, never hidden.
//   const gpu = await createDevice({ canvas, timing, errors });   null when the browser cannot draw
//   gpu.device, gpu.adapter, gpu.format, gpu.context, gpu.hasTimestamps, gpu.info
export async function createDevice({ canvas, timing = false, errors = [], onLost = null } = {}) {
  const fail = (why) => { errors.push(`webgpu: ${why}`); showNoGpu(why); return null; };
  if (!('gpu' in navigator)) return fail('navigator.gpu is missing (no WebGPU in this browser)');
  let adapter = null;
  const gate = globalThis.__veliaGate; if (gate) delete globalThis.__veliaGate;   // the gate's adapter, used once (an adapter makes one device)
  try { adapter = gate?.adapter ?? await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch (e) { return fail(`requestAdapter threw: ${e?.message ?? e}`); }
  if (!adapter) return fail('requestAdapter returned null');
  const hasTimestamps = timing && adapter.features.has('timestamp-query');
  const requiredFeatures = hasTimestamps ? ['timestamp-query'] : [];
  let device;
  try { device = await adapter.requestDevice({ requiredFeatures, label: 'velia-v2' }); } catch (e) { return fail(`requestDevice threw: ${e?.message ?? e}`); }
  const mem = tallyMemory(device);   // the phone pass: the bytes v2 asked the GPU for (iOS kills a tab under memory pressure)
  device.lost.then((info) => { errors.push(`device lost: ${info.reason}: ${info.message}`); onLost?.(info); });
  device.onuncapturederror = (e) => { errors.push(`gpu error: ${e.error?.message ?? e.error}`); };
  const context = canvas.getContext('webgpu');
  if (!context) return fail('canvas.getContext("webgpu") returned null');
  const format = navigator.gpu.getPreferredCanvasFormat();
  const info = adapter.info ?? {};
  const fallback = !!(adapter.isFallbackAdapter ?? info.isFallbackAdapter);
  return { adapter, device, context, format, hasTimestamps, mem, info: { vendor: info.vendor ?? '', architecture: info.architecture ?? '', description: info.description ?? '', fallback } };
}

// The launch gate's page (#nogpu in v2/index.html): navy, cream, the front door's type, the link to the classic
// Velia (/classic/: v1, which runs on WebGL2), chosen by the visitor (no automatic fallback: BACKLOG-v2's binding ruling).
// Never a black screen: 'nogpu' when the browser or device has no WebGPU (no API, no adapter, no answer), 'failed' when it has
// but v2 could not start (a pipeline Safari refused, a device lost at load); `why` is the small print (the diag panel has more).
export const CLASSIC_URL = '/classic/';
export const GATE_TEXT = Object.freeze({
  nogpu: Object.freeze({ head: 'This browser can’t draw the lake', msg: 'Velia draws the lake with WebGPU, the web’s new graphics engine. This browser doesn’t have it yet.' }),
  failed: Object.freeze({ head: 'Velia couldn’t start here', msg: 'Velia could not start its graphics on this device. The classic version may run better.' }),
});
export function showNoGpu(why, kind = 'nogpu') {
  const el = typeof document !== 'undefined' ? document.getElementById('nogpu') : null;
  const t = GATE_TEXT[kind] ?? GATE_TEXT.nogpu;
  if (el) {
    el.hidden = false; el.dataset.kind = GATE_TEXT[kind] ? kind : 'nogpu';
    const w = el.querySelector('[data-why]'); if (w) w.textContent = String(why ?? '').split('\n')[0].slice(0, 200);
    const h = el.querySelector('[data-head]'); if (h) h.textContent = t.head;
    const m = el.querySelector('[data-msg]'); if (m) m.textContent = t.msg;
    const a = el.querySelector('[data-classic]'); if (a) a.setAttribute('href', CLASSIC_URL);
  }
  document?.getElementById?.('veil')?.remove();
  if (typeof document !== 'undefined' && kind !== 'failed') document.title = 'Velia · needs a WebGPU browser';
}

// The GPU memory v2 asked for: every createBuffer's size and every createTexture's texels × bytes × samples (+ ⅓ with
// mips), tallied as they are made (load-time calls, never the frame). An estimate: the driver's padding and the swap chain
// are not in it. Safari shows no memory API, so this is the one memory number a phone's diag panel can carry.
const BPT = { r8unorm: 1, r8uint: 1, r16uint: 2, r16float: 2, rg8unorm: 2, r32float: 4, r32uint: 4, rg16float: 4, rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4, rgb10a2unorm: 4, rg11b10ufloat: 4,
  depth24plus: 4, depth32float: 4, 'depth24plus-stencil8': 4, rg32float: 8, rgba16float: 8, rgba16uint: 8, rgba32float: 16, rgba32uint: 16 };
export function textureBytes(d) {
  const sz = Array.isArray(d.size) ? d.size : [d.size?.width ?? 1, d.size?.height ?? 1, d.size?.depthOrArrayLayers ?? 1];
  const [w, h = 1, l = 1] = sz, b = BPT[d.format] ?? 4, mips = (d.mipLevelCount ?? 1) > 1 ? 4 / 3 : 1;
  return Math.round(w * h * l * b * (d.sampleCount ?? 1) * mips);
}
function tallyMemory(device) {
  const m = { buffers: 0, textures: 0, nBuffers: 0, nTextures: 0, get mb() { return (m.buffers + m.textures) / 1048576; } };
  const cb = device.createBuffer.bind(device), ct = device.createTexture.bind(device);
  const onDestroy = (o, key, bytes) => { const d0 = o.destroy.bind(o); let done = false; o.destroy = () => { if (!done) { done = true; m[key] -= bytes; } return d0(); }; return o; };
  device.createBuffer = (d) => { const b = d?.size ?? 0; m.buffers += b; m.nBuffers++; return onDestroy(cb(d), 'buffers', b); };
  device.createTexture = (d) => { let b = 0; try { b = textureBytes(d); } catch { /* an odd descriptor: not counted */ } m.textures += b; m.nTextures++; return onDestroy(ct(d), 'textures', b); };
  return m;
}
