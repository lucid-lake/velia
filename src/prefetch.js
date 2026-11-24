// Bytes fetched ahead and handed over once (perf/slow-loading): the loading screen asks for the boat's models
// while the world is built; the boat's assembly takes the very bytes, not a second request. (The files are not hashed,
// so Pages serves them with max-age=0, must-revalidate: a second fetch, even from the HTTP cache, is a round trip, and the
// assembly's hull-then-the-rest made two: ≈ 1.2 s on Slow 4G's 562 ms.)
//   prefetchBytes(url)           // start it (once per url; the gzip twin where the build has one); resolves an ArrayBuffer, or null on any failure
//   takeBytes(url)               // the promise, handed over once (then forgotten), or null if never asked
//   await loadGltf(loader, url)  // a GLTFLoader's parse of the prefetched bytes, else its own loadAsync
import { fetchBytes } from './fetchGz.js';
const got = new Map();
// fetchFn: a test's stub (a fetch()); absent, the gzip twin where the build has one (src/fetchGz.js)
export function prefetchBytes(url, fetchFn = null) {
  if (!got.has(url)) got.set(url, Promise.resolve().then(() => (fetchFn ? fetchFn(url).then((r) => (r.ok ? r.arrayBuffer() : null)) : fetchBytes(url))).catch(() => null));
  return got.get(url);
}
export function takeBytes(url) {
  const p = got.get(url);
  if (!p) return null;
  got.delete(url);
  return p;
}
export async function loadGltf(loader, url) {
  const p = takeBytes(url), ab = p ? await p : null;
  if (ab) return new Promise((res, rej) => loader.parse(ab, url.slice(0, url.lastIndexOf('/') + 1), res, rej));
  return loader.loadAsync(url);
}
