// The atmosphere's blue noise, self-hosted (perf/slow-loading-2). @takram/three-geospatial's STBN texture node
// (spatio-temporal blue noise, 128 × 128 × 64 bytes, MIT; ATTRIBUTION.md) fetched it from media.githubusercontent.com
// the moment the first frame's shaders were built: 1 MB from a third-party host on the start's critical path (a phone on
// Slow 4G: 7.7 s inside the 'mode' step). The same file now ships with the build under a hashed name (a year's cache),
// every STBN node loads it, and the bake's idle link fetches it ahead (src/prebake.js). The bytes are the library's own
// file: the same noise, the same pixels.
//   pointStbn()      // once, before the first render (src/core/sky.js)
// The library's nodes exist before this runs (its sampled node is a clone made when its module loads, each with the
// class's URL as its own property), so the class's setup is wrapped: each node takes our URL as it builds its texture.
import { STBNTextureNode } from '@takram/three-geospatial/webgpu';
import { STBN_URL } from './stbnUrl.js';
export { STBN_URL };

let done = false;
export function pointStbn(Node = STBNTextureNode, url = STBN_URL) {
  if (done) return true;
  try {
    const setup = Node.prototype.setup;
    Node.prototype.setup = function (builder) { this.url = url; return setup.call(this, builder); };
    done = true;
    return true;
  } catch { return false; }   // a class that refuses: the library's own host, as before
}
