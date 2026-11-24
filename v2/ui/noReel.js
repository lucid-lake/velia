// v2 has no attract reel (owner, 2026-11-13: "merge front door, no reel"; v1 keeps its own). This stands in for
// src/ui/attractReel.js's api in v1's loading screen (installLoading({ reel })): no video element, no film fetch, no Skip, no
// sound chip, no caption, no loop. What stays is v1's first paint: the Lucid Lake mark on navy over the golden still (the
// shell's own image), the mark thinning onto that still in the first fraction of a second so the screen is never blank, then
// the live lake: the card stands over the live lake (v1's data-reel-end=live cross-fade, as when v1's film ends), for a first
// visit as for a returning one (v2 has no staged first minute, owner 2026-11-13, so no data-first dissolve).
//   installNoReel({ root }) → v1's reel api (stage, skip, play, sound, gone, on, mode 'none', …), all quiet
export const NO_REEL = Object.freeze({ logoAtMs: 150 });   // the mark starts thinning this soon after the module runs (its CSS fade: 0.6 s, v2's style)

export function installNoReel({ root, win = globalThis, clock = (f, ms) => setTimeout(f, ms) } = {}) {
  if (!root) return null;
  root.dataset.reel = 'none';
  // the film's own controls and caption are not on a page without a film
  for (const el of root.querySelectorAll('.lk-corner, .lk-fcap, video')) el.remove();
  const company = root.querySelector('.lk-company');
  let logoDone = false, disposed = false;
  const logoOut = () => { if (logoDone || disposed) return; logoDone = true; company?.classList.add('off'); root.dataset.logo = 'off'; };
  clock(logoOut, NO_REEL.logoAtMs);
  // the card goes live: the still and its navy ground fade into the live lake behind it (v1's CSS for a film that has ended)
  const live = () => { if (!disposed && root.dataset.state === 'home') { logoOut(); root.dataset.reelEnd = 'live'; } };
  win.addEventListener?.('lakeshore:home', live);
  const noop = () => {};
  return {
    stage: noop, skip: noop, play: noop, sound: noop, on: () => noop,
    gone() { disposed = true; win.removeEventListener?.('lakeshore:home', live); },
    mode: 'none', video: null, playing: false, ended: false, first: false,
    get logoDone() { return logoDone; }, get live() { return root.dataset.reelEnd === 'live'; }, soundWanted: false, decision: { mode: 'none', startAt: null, why: 'v2' },
  };
}
