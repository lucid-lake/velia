// perf(v2) phone: the diag sweep (?diag=2). One screenshot from the phone should say where its GPU time goes, and what each
// phone-path lever saves there, so the page measures it on the phone itself: after the level settles it takes each case in
// turn (a scene draw dropped, a compute pass skipped, a lever flipped) and prints the differences. A part's number is what
// it costs; a lever's is what the phone path saves against the full path (positive: the phone path is cheaper).
//
// Round 2 (2026-11-13 night, the owner's iPhone in Low Power Mode: half the numbers were noise, some negative): a long
// block with and a long block without could not separate a case from the drift of a pinned 30 Hz display and a GPU whose
// clock moves. Now each case alternates short blocks, with and without, `pairs` times (the order flips every pair: ABBA),
// and every frame carries a tag through the GPU's timestamps (the frame graph's setTag), so each busy span is booked to
// the block whose state drew it, never to the frame that read it back. A block's first frame is dropped (a state
// change's own frame), its median kept (one terrain-shadow redraw in a block does not move it); a case is the median of
// its pairs' differences, with the spread (half the interquartile range) and the count printed beside it.
//   const sw = createSweep({ cases: [{ name, kind: 'part' | 'pass' | 'lever', phoneOn?, flip(on) }] });
// fix(v2) governor (the owner's iPhone, 2026-11-14: every part ±1.2–4.1 ms, some negative): the page feeds the GPU's work
// (the passes' own shares, no idle gaps) instead of the busy span, whose idle moved with the display's pacing, not with
// the case; and a case whose spread is not smaller than its value is printed as "unclear", never as a number.
//   before each render: graph.setTag(sw.next());   once per resolved GPU frame: sw.feed(tag, workMs)
//   sw.lines(now) → the panel's lines;  sw.results() → [{ name, kind, ms, spread, n, clear }];  sw.running, sw.done
export const SWEEP = Object.freeze({ pairs: 8, blockFrames: 4, dropFrames: 1, tailFrames: 12 });

const median = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// a case is clear when its spread is smaller than its value (a single pair has no spread: clear only when non-zero)
export const isClear = (ms, spread) => Number.isFinite(ms) && ms !== 0 && (Number.isFinite(spread) ? spread < Math.abs(ms) : true);
const quantile = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };

export function createSweep({ cases, pairs = SWEEP.pairs, blockFrames = SWEEP.blockFrames, dropFrames = SWEEP.dropFrames, tailFrames = SWEEP.tailFrames, onStart = () => {}, onEnd = () => {} }) {
  // the schedule: for each case, `pairs` pairs of blocks; pair p is (base, flip) when p is even, (flip, base) when odd
  const blocks = [];
  cases.forEach((c, i) => { for (let p = 0; p < pairs; p++) for (const flip of p % 2 ? [true, false] : [false, true]) blocks.push({ i, p, flip, spans: [] }); });
  const F = blockFrames, total = blocks.length * F;
  let frame = -1, state = null, running = false, done = false, tail = 0, t0 = null, tLast = null;
  const setState = (i, on) => {   // flip the case's state only on a change; a case is always restored before the next starts
    if (state && state.i === i && state.on === on) return;
    if (state && state.on && (state.i !== i || !on)) cases[state.i].flip(false);
    if (on) cases[i].flip(true);
    state = { i, on };
  };
  function finish() {
    if (state?.on) cases[state.i].flip(false);
    state = null; running = false; done = true; onEnd();
  }
  return {
    get running() { return running; },
    get done() { return done; },
    get frames() { return total; },
    start(now = 0) { if (running || done) return; running = true; t0 = now; onStart(); },
    // the tag for the frame about to render (its case's state applied); 0 once the schedule is drawn (the tail waits for
    // the last frames' timestamps)
    next(now = null) {
      if (!running) return 0;
      if (now != null) tLast = now;
      frame++;
      if (frame >= total) { if (state) { if (state.on) cases[state.i].flip(false); state = { i: -1, on: false }; } if (++tail > tailFrames) finish(); return 0; }
      const k = (frame / F) | 0, b = blocks[k];
      setState(b.i, b.flip);
      return 1 + k * 16 + (frame % F);   // 0 means "not the sweep's"
    },
    feed(tag, ms) {
      if (!(tag > 0) || !(ms >= 0)) return;
      const t = tag - 1, k = t >> 4, f = t & 15;
      if (f < dropFrames || !blocks[k]) return;
      blocks[k].spans.push(ms);
    },
    // the results: [{ name, kind, ms, spread, n }] (part / pass: its cost; lever: what the phone path saves); ms the median of
    // the pairs' differences, spread half their interquartile range, n the pairs with samples on both sides
    results() {
      return cases.map((c, i) => {
        const d = [];
        for (let p = 0; p < pairs; p++) {
          const base = blocks.find((b) => b.i === i && b.p === p && !b.flip), flip = blocks.find((b) => b.i === i && b.p === p && b.flip);
          if (!base?.spans.length || !flip?.spans.length) continue;
          const mb = median(base.spans), mf = median(flip.spans);
          d.push(c.kind === 'lever' ? (c.phoneOn ? mf - mb : mb - mf) : mb - mf);
        }
        const ms = median(d), spread = d.length > 1 ? (quantile(d, 0.75) - quantile(d, 0.25)) / 2 : NaN;
        return { name: c.name, kind: c.kind, ms, spread, n: d.length, clear: isClear(ms, spread) };
      });
    },
    lines(now = null) {
      if (!running && !done) return [];
      if (running) {
        const at = Math.max(0, frame), k = Math.min(blocks.length - 1, (at / F) | 0), c = cases[blocks[k].i];
        const per = at > 10 && t0 != null && (now ?? tLast) != null ? ((now ?? tLast) - t0) / at : 1000 / 30;   // the frames' own pace so far
        const left = Math.ceil(((total - at) * per) / 1000);
        return [`sweep ${blocks[k].i + 1}/${cases.length}: ${c.name} (pair ${blocks[k].p + 1}/${pairs}) · ${left} s left`];
      }
      const r = this.results(), f = (x) => `${x.name} ${x.ms >= 0 ? '' : '−'}${Math.abs(x.ms).toFixed(2)}${Number.isFinite(x.spread) ? ` ±${x.spread.toFixed(2)}` : ''}`;
      const by = (kind) => r.filter((x) => x.kind === kind && x.clear).sort((a, b) => b.ms - a.ms);
      const out = [];
      const chunk = (title, a) => { for (let j = 0; j < a.length; j += 3) out.push(`${j ? '  ' : title}${a.slice(j, j + 3).map(f).join(' · ')}`); };
      const n = Math.min(...r.map((x) => x.n));
      out.push(`sweep (GPU work, ${pairs} ABBA pairs a case, ${blockFrames - dropFrames} frames a block; median ± half IQR${n < pairs ? `; ≥ ${n} pairs` : ''})`);
      chunk('parts ms: ', by('part'));
      chunk('passes ms: ', by('pass'));
      chunk('phone path saves ms: ', by('lever'));
      const unclear = r.filter((x) => !x.clear).map((x) => x.name);
      for (let j = 0; j < unclear.length; j += 5) out.push(`${j ? '  ' : 'unclear (spread ≥ value): '}${unclear.slice(j, j + 5).join(', ')}`);
      return out;
    },
  };
}
