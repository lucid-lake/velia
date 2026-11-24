// The big binary files' gzip twins (perf/slow-loading): Pages compresses text, never a model or a data file, yet
// the boat's models gzip to 26–38 % (3.0 MB → 1.0 MB) and the treetops to 58 % (5.5 MB → 3.2 MB). The build writes
// `<file>.gz` beside each (vite.config.js gzipTwins); a production page fetches the twin and inflates it with the browser's
// DecompressionStream (the terrain grids already need it): the same bytes as the plain file. Any failure (an old browser,
// a 404, the SPA fallback's index.html, the dev server, which has no twins) fetches the plain file, as before: only bytes
// that start with gzip's magic are taken from the twin.
//   const ab = await fetchBytes('/models/boat/hull.glb', opts)   // an ArrayBuffer; throws on the plain file's HTTP error
import { fetchRetry } from './sim/fetchRetry.js';

const GZ_TWINS = Object.freeze([/^\/models\/boat\/[^/]+\.glb$/, /^\/terrain\/forest\/[^/]+\.tps$/]);
const prod = (() => { try { return !!import.meta.env?.PROD; } catch { return false; } })();
export const hasTwin = (url, { production = prod, ds = typeof DecompressionStream === 'function' } = {}) => production && ds && GZ_TWINS.some((re) => re.test(String(url).split('?')[0]));
const isGzip = (u8) => u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;

export async function gunzip(u8) {
  return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

export async function fetchBytes(url, opts, { fetchFn = fetchRetry, twin = hasTwin(url) } = {}) {
  if (twin) {
    try {
      const r = await fetchFn(`${url}.gz`, opts);
      if (r.ok) { const u8 = new Uint8Array(await r.arrayBuffer()); if (isGzip(u8)) return await gunzip(u8); }   // anything else (Pages' SPA fallback answers a missing file with index.html and 200): the plain file
    } catch { /* the plain file below */ }
  }
  const r = await fetchFn(url, opts);
  if (!r.ok) { const e = new Error(`${url}: ${r.status}`); e.status = r.status; throw e; }
  return r.arrayBuffer();
}
