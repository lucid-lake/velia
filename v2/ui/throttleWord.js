// The throttle's lit word on v2 (owner, 2026-11-14: "This ugly FULL AHEAD yellow text should not always be on; the moment it is
// touched is enough"). v1's throttle column (src/stations/sloop/throttleLever.js, frozen) keeps its one word (SLOW AHEAD … FULL
// ASTERN, NEUTRAL) lit beside the knob for as long as the engine runs; v2 shows it only when the player touches the lever: the + − and
// 0 keys (held: for as long as they are held), a drag, a tap, a scroll or an arrow key on the lever. It holds THR_WORD.holdS after the
// last touch, then fades out in THR_WORD.fadeMs. Nothing else wakes it: Cruise's driver, the anchor or the auto-start and auto-stop
// moving the engine leave it dark while the lever is still. The word itself (its text, its colour) is v1's, untouched.
//   const word = createThrottleWord({ el: throttle.el });   word.wake()   word.hold(bool)   word.update(dt)   word.shown
// The clock is pure (ThrottleWordClock: v2/tests/throttleWord.test.mjs); the page check is v2/tests/pages/throttleWord.page.mjs.
export const THR_WORD = { holdS: 1.5, fadeMs: 400, inMs: 120 };

export class ThrottleWordClock {
  constructor({ holdS = THR_WORD.holdS } = {}) { this.holdS = holdS; this.t = 0; this.at = -Infinity; this.held = false; }
  wake() { this.at = this.t; }
  hold(on) { this.held = !!on; if (on) this.at = this.t; }
  tick(dt) { this.t += dt; if (this.held) this.at = this.t; return this.on; }
  get on() { return this.t - this.at < this.holdS; }
}

const CSS = `
.lk-thr .lit{opacity:0;transition:opacity ${THR_WORD.fadeMs}ms var(--lk-ease-out,ease-out),top .12s var(--lk-ease)}
.lk-thr.lk-thr-awake .lit{opacity:1;transition:opacity ${THR_WORD.inMs}ms var(--lk-ease),top .12s var(--lk-ease)}
.lk-thr.drag .lit{transition:opacity ${THR_WORD.inMs}ms var(--lk-ease)}
@media (prefers-reduced-motion:reduce){.lk-thr .lit,.lk-thr.lk-thr-awake .lit{transition:none}}
`;

export function createThrottleWord({ el, doc = globalThis.document } = {}) {
  if (doc && !doc.getElementById('lk-thr-word-css')) { const st = doc.createElement('style'); st.id = 'lk-thr-word-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const clock = new ThrottleWordClock();
  let shown = null;
  function update(dt) {
    const on = clock.tick(dt);
    if (on !== shown) { shown = on; el?.classList.toggle('lk-thr-awake', on); }
  }
  update(0);
  return { clock, wake: () => { clock.wake(); update(0); }, hold: (on) => { clock.hold(on); update(0); }, update, get shown() { return !!shown; } };
}
