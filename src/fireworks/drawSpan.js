// The stars' draw span (refactor round 2, B1): how many of the engine's slots the instanced draw must cover. A star draws
// nothing before its birth or after its end (born + delay + max(burn, kick) + three streak fades: the shader's `live` and
// `headOn` windows, src/fireworks/engine.js starMaterial), so the draw covers slots [0, n) where n is the highest slot
// end of any spawn still drawing. By day, and after a show, n is 0: no draw at all (the 65,536 instances were drawn every
// frame of the highlight day, 1.31 M triangles). Each spawn is kept until its own end, whatever later spawns overwrite in
// the ring, so the span can only be wider than needed, never narrower: the picture is exact.
//
//   const span = createDrawSpan()
//   span.add(start, end, until)   a spawn's slots [start, end), drawn until `until` (s, show time)
//   span.count(t)                 the instance count at show time t
//   span.reset()                  a seek's clear (every slot dead)
//   starEnd(star, born)           the last show time a star written at `born` draws anything
export const DRAW_PAD = 0.5;   // s after a spawn's last star ends (the float32 show time on the GPU: sub-ms steps)

export const starEnd = (s, born) => born + (s.delay ?? 0) + Math.max(s.burn, s.kickAge ?? 0) + 3 * s.tau;

export function createDrawSpan() {
  let spans = [];
  return {
    add(start, end, until) { spans.push({ start, end, until: until + DRAW_PAD }); },
    count(t) {
      if (spans.some((s) => s.until < t)) spans = spans.filter((s) => s.until >= t);
      let n = 0;
      for (const s of spans) if (s.end > n) n = s.end;
      return n;
    },
    reset() { spans = []; },
    get size() { return spans.length; },
  };
}
