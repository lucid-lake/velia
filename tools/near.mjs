// Compare two baked or simulated results across machines: the same shape, the same strings, booleans and nulls, and every
// number within a small tolerance. Why not the bytes: V8's Math functions (Math.sin, Math.cos, Math.log, Math.atan2 …)
// may differ in the last bit between platforms (a Mac's arm64 build against CI's Linux x64 build, the same Node version),
// so a bake or a 20 s simulation agrees to within about 1e-10 of each number across machines, never bit for bit. A real
// change (a rule, a constant, a step) moves the numbers by far more than the tolerance and still fails.
//   nearDiff(actual, expected, { rel = 1e-8 })   → null when they agree, else the first mismatch as a string (path: why)
// A number agrees when |a − e| ≤ rel × max(1, |e|): absolute near zero (metres, radians, unit vectors), relative above 1
// (1e-8: 10 µm at 1 km). Typed arrays compare as arrays; non-finite numbers must match exactly.
export function nearDiff(actual, expected, { rel = 1e-8 } = {}) {
  const walk = (a, e, path) => {
    if (typeof e === 'number' || typeof a === 'number') {
      if (typeof a !== 'number' || typeof e !== 'number') return `${path}: ${a} vs ${e}`;
      if (!Number.isFinite(e) || !Number.isFinite(a)) return Object.is(a, e) ? null : `${path}: ${a} vs ${e}`;
      return Math.abs(a - e) <= rel * Math.max(1, Math.abs(e)) ? null : `${path}: ${a} vs ${e} (off by ${Math.abs(a - e)})`;
    }
    if (ArrayBuffer.isView(e) && ArrayBuffer.isView(a)) return walk(Array.from(a), Array.from(e), path);
    if (Array.isArray(e) || Array.isArray(a)) {
      if (!Array.isArray(a) || !Array.isArray(e)) return `${path}: an array vs not`;
      if (a.length !== e.length) return `${path}: ${a.length} items vs ${e.length}`;
      for (let i = 0; i < e.length; i++) { const d = walk(a[i], e[i], `${path}[${i}]`); if (d) return d; }
      return null;
    }
    if (e && typeof e === 'object' && a && typeof a === 'object') {
      const ka = Object.keys(a).sort(), ke = Object.keys(e).sort();
      if (ka.join() !== ke.join()) return `${path}: keys ${ka.join(',')} vs ${ke.join(',')}`;
      for (const k of ke) { const d = walk(a[k], e[k], `${path}.${k}`); if (d) return d; }
      return null;
    }
    return Object.is(a, e) ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(e)}`;
  };
  return walk(actual, expected, '$');
}
