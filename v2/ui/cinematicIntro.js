// The cinematic intro (owner, 2026-11-18: "When the user opens or reloads the page and enters Sail or Cruise — only once — make
// it like a movie, as AAA games do: black bars at the top and bottom narrow the scene, with a film/lens look; after several
// seconds the bars retract, our top bar shows, and our cockpit rises and shows. In the movie moment we must still see the full
// boat." Desktop only (owner, the same day): src/core/features.js 'cinematicIntro'; the survey).
//
// Once a page load, on the first entry into Sail or Cruise from the home card (main.js 'lakeshore:entered'): never Regatta, a
// later mode switch, Start again or a birthplace move; a reload plays it again. The timeline (seconds from the entry; the
// home card's fade-out runs under its first 1.6 s):
//   0       the letterbox in place (2.39:1: each bar (h − w / 2.39) / 2, at most 22 % of the height), the HUD held (the top bar,
//           the cockpit folded down, the edge pair, the hints, the calm mark), the lens look on; the camera keeps the view's own
//           framing, its lens widened just enough that the whole boat (truck to waterline and the wake's start) sits inside the
//           band with a margin, plus a slow 5 % push-in that ends with the retract (no shake, no cut)
//   4.8     the bars retract (top up, bottom down) over 1.0 s, a quintic ease-in-out; the lens look and the camera's widening go
//           with them, so she settles into the normal frame as the bars leave
//   4.95    the top bar fades in with an 8 px drop (0.5 s)
//   5.0     the cockpit rises (the fold's own 0.4 s glide: station.js cockpitTarget through a held calm view; the fold API untouched),
//           its 2D pieces fading in (0.5 s)
//   5.2     the edge pair, the hints and the calm mark fade in (0.5 s)
//   5.8     the normal game frame
// Every fade is stepped here (filter: opacity() on the piece, so its own hidden state stays hidden), not a CSS animation: a film on
// the film clock and a slow frame keep the same beat.
// Skip: any key, click or tap after the first 0.25 s: the end state with a 0.4 s ease from wherever it is (the input still
// reaches the game). Reduced motion (the OS's Reduce Motion): no bars, no lens, no camera change; the HUD fades in over 0.4 s.
// The skipper's first line waits for the end (m4.js: the first-sail guide sees the card as not gone while the intro holds); the
// other skipper's lines are hushed while it plays; the stage clock (Tessie, the kayaks) runs on.
//
//   const intro = createIntro({ enabled, reduced: () => bool });
//   intro.start(mode)          → true if it plays (once)
//   intro.step(dt)             each frame (wall seconds)
//   intro.camera(c, fit)       the view's pose → the intro's pose (fit(c) → the boat's largest |ndc y| in c)
//   intro.lens                 { amount, fx } for the composite (render/bloom.js Post.c)
//   intro.cockpitHeld, intro.hudHeld, intro.playing, intro.state
const smootherstep = (x) => x * x * x * (x * (6 * x - 15) + 10);   // quintic: zero speed and acceleration at both ends

export const INTRO = Object.freeze({
  aspect: 2.39,        // the band (cinemascope)
  maxBar: 0.22,        // a bar's largest share of the height (a 4:3 window)
  holdS: 4.8,          // the bars' hold, from the entry
  outS: 1.0,           // the retract (bars, lens, the lens's widening)
  barLagS: 0.15,       // the top bar after the retract starts
  cockpitLagS: 0.2,    // the cockpit after the retract starts (the owner's stagger)
  restLagS: 0.4,       // the edge pair, the hints, the calm mark
  revealS: 0.5,        // the HUD's own fade-in
  skipS: 0.4,          // a skip's ease to the end
  armS: 0.25,          // inputs before this are the entry's own (the tap that entered)
  reducedS: 0.4,       // reduced motion: the HUD's fade-in, nothing else
  drift: 0.05,         // the slow push-in: the lens 5 % wider at the entry, back to 0 by the retract's end
  margin: 0.1,         // the boat's margin inside the band (a share of the band's half-height)
});

// a bar's height in px for a w × h frame (each of the two)
export function barPx(w, h, aspect = INTRO.aspect, maxBar = INTRO.maxBar) {
  if (!(w > 0) || !(h > 0)) return 0;
  return Math.max(0, Math.min(maxBar * h, (h - w / aspect) / 2));
}
// the band's share of the height (1: no bars)
export const bandShare = (w, h) => (h > 0 ? 1 - 2 * barPx(w, h) / h : 1);

const ease = (x) => smootherstep(Math.min(1, Math.max(0, x)));

// the timeline at t s (pure): cover 0..1 the bars in, lens 0..1, fit 0..1 the widening's weight, drift the push-in's extra lens
// share; hud.{bar, cockpit, rest} shown; a.{bar, cockpit, rest} each piece's fade-in 0..1 (eased; driven here, frame by frame, so a
// film on the film clock and a slow frame see the same beat); done once the bars are out and every piece is in
export function introAt(t, { reduced = false, skipAt = null } = {}) {
  const I = INTRO, end = I.holdS + I.outS;
  const fade = (at, len) => (t < at ? 0 : t - at >= len - 1e-9 ? 1 : ease((t - at) / len));
  if (reduced) {
    const a = fade(0, I.reducedS);
    return { cover: 0, lens: 0, fit: 0, drift: 0, hud: { bar: true, cockpit: true, rest: true }, a: { bar: a, cockpit: a, rest: a }, done: t >= I.reducedS };
  }
  const base = (u) => {
    const k = 1 - ease((u - I.holdS) / I.outS);   // 1 in the hold, eased to 0 over the retract
    return { cover: k, lens: k, fit: k, drift: I.drift * (1 - ease(u / end)) };
  };
  const at0 = { bar: I.holdS + I.barLagS, cockpit: I.holdS + I.cockpitLagS, rest: I.holdS + I.restLagS };
  if (skipAt != null && skipAt < end) {
    const s = base(Math.min(t, skipAt));
    const g = t <= skipAt ? 1 : 1 - ease((t - skipAt) / I.skipS);
    const at = { bar: Math.min(at0.bar, skipAt), cockpit: Math.min(at0.cockpit, skipAt), rest: Math.min(at0.rest, skipAt) };
    const len = (k) => (at0[k] < skipAt ? I.revealS : I.skipS);
    const a = { bar: fade(at.bar, len('bar')), cockpit: fade(at.cockpit, len('cockpit')), rest: fade(at.rest, len('rest')) };
    return { cover: s.cover * g, lens: s.lens * g, fit: s.fit * g, drift: s.drift * g,
      hud: { bar: t >= at.bar, cockpit: t >= at.cockpit, rest: t >= at.rest }, a,
      done: t >= skipAt + I.skipS && a.bar >= 1 && a.cockpit >= 1 && a.rest >= 1 };
  }
  const a = { bar: fade(at0.bar, I.revealS), cockpit: fade(at0.cockpit, I.revealS), rest: fade(at0.rest, I.revealS) };
  return { ...base(t), hud: { bar: t >= at0.bar, cockpit: t >= at0.cockpit, rest: t >= at0.rest }, a, done: t >= end && a.bar >= 1 && a.cockpit >= 1 && a.rest >= 1 };
}

// the lens's widening: the factor on tan(fov / 2) that brings the boat's largest |ndc y| (yMax) inside the band with its margin
export function fitScale(yMax, band, margin = INTRO.margin) {
  const room = band * (1 - margin);
  return Number.isFinite(yMax) && room > 0 ? Math.max(1, yMax / room) : 1;
}

// what the intro hides while it holds (each piece fades back on its own beat): the top bar; the 2D cockpit's pieces (the 3D one
// sinks through station.js); the edge pair, the hints and lines, the calm mark and the pucks, the fold tab
const BAR = '.lk-view';
const COCKPIT = '.lk-helm,.lk-tackb,.lk-cp,.lk-cpx,.lk-dock,.lk-tp,.lk-pro,.lk-cv,.lk-chart,.lk-thr,.lk-ftab,.lk-puck';
const REST = '.lk-edgepair,.lk-hint,.lk-guide,.lk-calm-mark,.lk-chill';
const GROUPS = Object.freeze({ bar: BAR, ck: COCKPIT, rest: REST });
const GONE = 'opacity:0!important;visibility:hidden!important;pointer-events:none!important;transition:none!important';
// a piece fading in: filter: opacity() multiplies its own opacity (a hidden hint row stays hidden), the top bar drops 8 px as it comes
const CSS = `
.lk-ibar{position:fixed;left:0;right:0;z-index:13;height:var(--lk-ibar,0px);background:#000;pointer-events:none;will-change:transform}
.lk-ibar.t{top:0}.lk-ibar.b{bottom:0}
${Object.entries(GROUPS).map(([k, sel]) => `html.lk-intro-${k} :is(${sel}){${GONE}}`).join('\n')}
${Object.entries(GROUPS).map(([k, sel]) => `html.lk-intro-rv-${k} :is(${sel}){filter:opacity(var(--lk-intro-a-${k},1))}`).join('\n')}
html.lk-intro-rv-bar ${BAR}{translate:0 calc((1 - var(--lk-intro-a-bar,1)) * -8px)}
`;

export function createIntro({ enabled = false, reduced = () => false, doc = globalThis.document, win = globalThis, hint = () => null, calm = () => null } = {}) {
  let phase = enabled ? 'idle' : 'off', t = 0, skipAt = null, red = false, mode = null, s = null, hushed = false;
  let top = null, bot = null, offInput = null;
  const H = doc?.documentElement;
  const cls = (k, on) => H?.classList.toggle(k, !!on);
  const css = () => { if (doc?.head && !doc.getElementById('lk-intro-css')) { const st = doc.createElement('style'); st.id = 'lk-intro-css'; st.textContent = CSS; doc.head.appendChild(st); } };
  const mount = () => {
    if (!doc || !H) return;
    top = doc.createElement('div'); top.className = 'lk-ibar t'; top.setAttribute('aria-hidden', 'true');
    bot = doc.createElement('div'); bot.className = 'lk-ibar b'; bot.setAttribute('aria-hidden', 'true');
    doc.body.append(top, bot);
  };
  const size = () => { if (H) H.style.setProperty('--lk-ibar', `${barPx(win.innerWidth ?? 0, win.innerHeight ?? 0).toFixed(1)}px`); };
  const skip = () => { if (phase !== 'playing' || t < INTRO.armS || skipAt != null || red) return false; skipAt = t; return true; };
  const listen = () => {
    if (!win?.addEventListener) return;
    const ac = new AbortController(), o = { capture: true, passive: true, signal: ac.signal };
    const on = () => { skip(); };
    win.addEventListener('keydown', on, o); win.addEventListener('pointerdown', on, o); win.addEventListener('touchstart', on, o);
    win.addEventListener('resize', size, { passive: true, signal: ac.signal });
    offInput = () => ac.abort();
  };
  const apply = () => {
    if (top) { const y = ((1 - s.cover) * 100).toFixed(2); top.style.transform = `translateY(-${y}%)`; bot.style.transform = `translateY(${y}%)`; top.style.display = bot.style.display = s.cover > 0.001 ? '' : 'none'; }
    for (const [k, g] of [['bar', 'bar'], ['ck', 'cockpit'], ['rest', 'rest']]) {
      const a = s.a[g], fading = s.hud[g] && a < 1;
      cls(`lk-intro-${k}`, !s.hud[g]); cls(`lk-intro-rv-${k}`, fading);
      if (fading) H?.style.setProperty(`--lk-intro-a-${k}`, a.toFixed(3));
    }
  };
  const finish = () => {
    phase = 'done'; offInput?.(); offInput = null;
    top?.remove(); bot?.remove(); top = bot = null;
    for (const k of Object.keys(GROUPS)) { cls(`lk-intro-${k}`, false); cls(`lk-intro-rv-${k}`, false); H?.style.removeProperty(`--lk-intro-a-${k}`); }
    if (hushed) { try { hint()?.hush?.(false); } catch { /* the UI stepped aside */ } hushed = false; }
    try { calm()?.wake?.('all'); } catch { /* none */ }   // the Calm HUD's idle starts from the end, so the bar and the cockpit stay up its 5 s
  };
  const api = {
    get enabled() { return phase !== 'off'; },
    get playing() { return phase === 'playing'; },
    get played() { return phase === 'playing' || phase === 'done'; },
    get hudHeld() { return phase === 'playing' && !!s && !s.hud.rest; },   // the skipper's first line waits for this
    get cockpitHeld() { return phase === 'playing' && !!s && !s.hud.cockpit; },
    get lens() { return phase === 'playing' && s ? { amount: s.lens, fx: s.lens } : { amount: 0, fx: 0 }; },
    get state() { return { phase, t: +t.toFixed(3), mode, reduced: red, skipped: skipAt != null, cover: s ? +s.cover.toFixed(4) : 0, lens: s ? +s.lens.toFixed(4) : 0, fit: s ? +s.fit.toFixed(4) : 0, hud: s ? { ...s.hud } : null, bar: barPx(win.innerWidth ?? 0, win.innerHeight ?? 0) }; },
    start(m) {
      if (phase !== 'idle' || (m !== 'sail' && m !== 'cruise')) { if (phase === 'idle' && m) phase = 'done'; return false; }   // a first entry into Regatta spends it: later Sail is a mode switch
      phase = 'playing'; mode = m; t = 0; skipAt = null; red = !!reduced();
      s = introAt(0, { reduced: red });
      css(); if (!red) { mount(); size(); }
      listen();
      try { const h = hint(); if (h?.hush && !h.hushed) { h.hush(true); hushed = true; } } catch { /* none */ }
      apply();
      return true;
    },
    skip,
    step(dt) {
      if (phase !== 'playing') return;
      t += Math.min(Math.max(dt, 0), 0.1);
      if (!hushed) try { const h = hint(); if (h?.hush && !h.hushed) { h.hush(true); hushed = true; } } catch { /* the UI not in yet */ }
      try { calm()?.wake?.('all'); } catch { /* none */ }   // nothing fades inside Calm while the intro holds (its own classes stay off)
      s = introAt(t, { reduced: red, skipAt });
      apply();
      if (s.done) finish();
    },
    // the pose: the lens widened by the fit (the whole boat in the band) and the push-in, both eased out with the bars; the eye,
    // the aim and the horizon are the view's own
    camera(c, fit, band) {
      if (phase !== 'playing' || !s || red || !c || !(s.fit > 0 || s.drift > 0)) return c;
      const k = fitScale(fit(c), band);
      const S = (1 + (k - 1) * s.fit) * (1 + s.drift);
      if (!(S > 1.0001)) return c;
      const half = Math.atan(Math.tan(c.fov * Math.PI / 360) * S);
      return { ...c, fov: half * 360 / Math.PI };
    },
    dispose() { offInput?.(); top?.remove(); bot?.remove(); for (const k of Object.keys(GROUPS)) { cls(`lk-intro-${k}`, false); cls(`lk-intro-rv-${k}`, false); } },
  };
  return api;
}

// the boat's largest |ndc y| from the camera c ({ pos, target, up, fov }) over world points pts ([[x, y, z] …])
export function ndcYMax(c, pts) {
  const f = [c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1; f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const u0 = c.up ?? [0, 1, 0];
  // r = f × u0, u = r × f (the screen's up)
  let r = [f[1] * u0[2] - f[2] * u0[1], f[2] * u0[0] - f[0] * u0[2], f[0] * u0[1] - f[1] * u0[0]];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1; r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const th = Math.tan(c.fov * Math.PI / 360);
  let m = 0;
  for (const p of pts) {
    const d = [p[0] - c.pos[0], p[1] - c.pos[1], p[2] - c.pos[2]];
    const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; if (!(z > 0.1)) continue;
    const y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    m = Math.max(m, Math.abs(y / (z * th)));
  }
  return m;
}
