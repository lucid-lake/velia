// KTX2 (Basis Universal) textures, the plain-JS side (no three.js, no DOM): which textures a tier loads compressed, where
// the file sits, and the one fallback rule. src/ktx2.js holds the loader; tools/ktx2_pack.py writes the files from
// tools/ktx2_manifest.json (has the per-texture decisions).
//
//   ktx2On('naip', flags, tier.ktx2)    // the tier's choice ({ naip, ground, boat }; none: KTX2, all plain), `?ktx2=0|1` overrides
//   await loadWithFallback(url, { loadCompressed, loadPlain })   // → { kind: 'ktx2' | 'plain', value }
import { toFlags } from '../../src/sim/core/flags.js';
export const KTX2 = Object.freeze({ naip: false, ground: false, boat: false });

// ?ktx2=0 forces the plain files (the fallback path, and the A/B for a look check); ?ktx2=1 forces compressed on every tier
function ktx2Param(flags) {
  const v = toFlags(flags || '').ktx2;   // a flags object (or a query string: the tests)
  return v === '0' ? false : v === '1' ? true : null;
}
export const ktx2On = (group, flags = '', k = KTX2) => {
  const p = ktx2Param(flags);
  return p === null ? !!(k ?? KTX2)[group] : p;
};
// the compressed twin of a plain texture file: same folder, same name, .ktx2
const ktx2Url = (url) => url.replace(/\.(webp|png|jpe?g)$/i, '.ktx2');

// Try the compressed file first; any failure (no support, a 404, a transcoder error) falls back to the plain file, so a
// page never loses a texture because of KTX2. Both loaders are passed in (node tests drive this with stubs).
// The timeout is a stall timeout (perf/slow-loading): loadCompressed(url, alive) calls alive() as its bytes arrive, and each
// call re-arms the clock, so a big file on a slow link is never dropped mid-download for its plain twin (on Slow 4G the
// 8 MB region photo took 255 s: at a flat 20 s the page fetched both, ≈ 10 MB more on the desktop before ready). A loader
// that never answers and never reports bytes (a transcoder that failed to start) still falls back after timeoutMs.
const KTX2_TIMEOUT_MS = 20000;
const withStall = (start, ms, what) => new Promise((ok, no) => {
  let t = null;
  const arm = () => { clearTimeout(t); t = setTimeout(() => no(new Error(`${what} timed out`)), ms); };
  arm();
  Promise.resolve().then(() => start(arm)).then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); no(e); });
});
export async function loadWithFallback(url, { loadCompressed, loadPlain, enabled = true, warn = () => {}, timeoutMs = KTX2_TIMEOUT_MS }) {
  if (enabled && loadCompressed) {
    try {
      const value = await withStall((alive) => loadCompressed(ktx2Url(url), alive), timeoutMs, ktx2Url(url));
      if (value) return { kind: 'ktx2', value };
    } catch (e) { warn(`ktx2: ${ktx2Url(url)}: ${e?.message ?? e}; using ${url}`); }
  }
  return { kind: 'plain', value: await loadPlain(url) };
}
