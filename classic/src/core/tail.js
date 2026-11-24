// A per-frame record that keeps only its tail (refactor round 2, A2): the frame's ms, draw calls and GPU ms were plain
// arrays that grew by one entry a frame forever (≈ 216 k entries an hour at 60 fps; Cruise runs for hours).
//
//   const a = tail(600);   a.push(v); a.length (every entry ever pushed); a.slice(from[, to]) (indices count from the
//   first push, as on an array; entries older than the kept tail are gone); [...a]; a.clear()
//
// It keeps at least `keep` entries and at most twice that (trimmed in one splice, so a push stays cheap). length and
// slice() keep an array's meaning, so a tool that reads `const g0 = a.length; … a.slice(g0)` over fewer than `keep`
// frames gets the same entries as before (tools/probe_bino.mjs, cockpit_phone.mjs, cockpit_shots.mjs).
export function tail(keep = 600) {
  let buf = [], dropped = 0;
  const abs = (i, n) => (i < 0 ? Math.max(0, n + i) : Math.min(i, n));
  return {
    push(v) {
      buf.push(v);
      if (buf.length > 2 * keep) { const cut = buf.length - keep; buf.splice(0, cut); dropped += cut; }
      return dropped + buf.length;
    },
    get length() { return dropped + buf.length; },
    get kept() { return buf.length; },
    slice(from = 0, to = dropped + buf.length) {
      const n = dropped + buf.length;
      return buf.slice(Math.max(0, abs(from, n) - dropped), Math.max(0, abs(to, n) - dropped));
    },
    clear() { buf = []; dropped = 0; },
    [Symbol.iterator]() { return buf[Symbol.iterator](); },
  };
}
