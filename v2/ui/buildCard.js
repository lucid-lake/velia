// The phone's home card while the shaders build (owner, 2026-11-17: "For phones, the best experience is to build the shaders, then
// present … while loading show more info on the phone to hold the user"; engine/buildGate.js, src/core/features.js buildAllFirst).
// On the card, in the chart's gap between the mode row and the page links, three calm lines, no game-style bar:
//   the stage     what the phone is doing now (Filling the lake, Raising the forest, Rigging the boat, Setting the sails, Ready)
//                 and one honest percentage (every pipeline and the first view's assets, one item each)
//   the line      a slim 2 px line, the built part in the card's cream ink; it glides on the compositor between the real steps
//                 (ui/lineGlide.js: one transform animation a step, toward the next pipeline, never past it), so it keeps moving
//                 while a compile holds the main thread
//   the fact      a short true line about the bay or a tip for the phone's controls, a new one every FACT_MS (ui/loadFacts.js)
// Sail, Cruise and Regatta stay on the card, quietly dimmed (never hidden) until the gate opens; a tap meanwhile is remembered (the
// mode lights, home.js queues it) and the mode starts the moment the build is done (front.js: home.released()). Reduced motion:
// no transitions, the lines just swap. Only on the first card (data-state home), never on the in-play Menu card.
//   const c = mountBuildCard(root, buildGate, { onReady });   c.dispose()
import { LINES } from './loadFacts.js';
import { createLineGlide } from './lineGlide.js';
import { ASSETS } from '../engine/buildGate.js';

export const FACT_MS = 5000;

// the progress line's one entry point (0..1): a plain slim line today; the shared loading bar (the engraved boat with Tessie's
// humps, design/v2-chart-tessie) can take its place at merge behind this same call
export function setLineProgress(line, p) {
  const v = Math.max(0, Math.min(1, +p || 0));
  line?.querySelector?.('i')?.style.setProperty('--p', String(v));
  line?.setAttribute?.('aria-valuenow', String(Math.round(v * 100)));
  return v;
}
// the line's real step and the next one it may glide toward (0..1): every pipeline and each first-view asset one item, as the
// percentage counts them; before the first frame (no total yet) a short way only; never 1 before the gate opens
export const NEXT_MAX = 0.99;
export function lineSteps(s) {
  if (s?.ready) return [1, 1];
  const n = (s?.total ?? 0) + ASSETS.length, done = (s?.built ?? 0) + ASSETS.filter((k) => !!s?.assets?.[k]).length;
  if (!(s?.total > 0)) return [Math.min(0.02, done / 100), 0.02];
  const p = Math.min(NEXT_MAX, done / n);
  return [p, Math.min(NEXT_MAX, Math.max(p, (done + 1) / n))];
}
export const FACTS_KEY = 'velia.facts.v1';   // where the next load's first line starts (so a return visit reads new lines)

const CSS = `#lk-load .lk-bld{position:absolute;z-index:3;left:1.6em;right:1.6em;display:none;flex-direction:column;justify-content:center;gap:5px;padding:6px 10px 7px;box-sizing:border-box;
  background:rgb(var(--pan) / .96);border-radius:.3em;color:var(--navy);font-family:var(--lk-ui);pointer-events:none}
#lk-load[data-state=home]:not([data-pg]) .lk-bld{display:flex}
#lk-load .lk-bld.cp{gap:2px;padding:0 10px}
#lk-load .lk-bld.cp .lk-bld-top{line-height:1.05}
#lk-load .lk-bld-tag .lk-bld-fx{opacity:.92}
#lk-load .lk-bld-tag .lk-bld-fx.off{opacity:0}
#lk-load .lk-bld-tag{position:absolute;z-index:3;display:none;align-items:center;box-sizing:border-box;background:rgb(var(--pan) / .96);color:var(--navy);font-family:var(--lk-ui);pointer-events:none}
#lk-load[data-state=home]:not([data-pg]) .lk-bld-tag.on{display:flex}
#lk-load .lk-bld-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:max(1em,15px);line-height:1.2;letter-spacing:.03em}
#lk-load .lk-bld-st{font-weight:var(--lk-medium)}
#lk-load .lk-bld-pc{font-variant-numeric:tabular-nums;opacity:.84}
#lk-load .lk-bld-ln{position:relative;height:2px;background:rgb(var(--ink3) / .3);border-radius:1px;overflow:hidden}
#lk-load .lk-bld-ln > i{position:absolute;left:0;top:0;bottom:0;width:100%;background:var(--navy);opacity:.92;transform-origin:0 50%;transform:scaleX(var(--p,0));transition:transform .6s var(--lk-ease);will-change:transform}
#lk-load .lk-bld-fx{margin:0;font-size:max(.94em,15px);line-height:1.25;font-style:italic;opacity:.84;transition:opacity .4s var(--lk-ease);min-height:1.25em}
#lk-load .lk-bld-fx.off{opacity:0}
#lk-load[data-build=wait] .lk-card .lk-pick:not([aria-checked=true]){opacity:.5}
#lk-load .lk-card .lk-pick{transition:opacity .4s var(--lk-ease),background-color .2s,color .2s}
@media (prefers-reduced-motion: reduce){#lk-load .lk-bld-ln > i,#lk-load .lk-bld-fx,#lk-load .lk-card .lk-pick{transition:none}}`;

// the first line this load shows (the one after where the last load stopped), and where the next load starts
export function firstLine(storage, n = LINES.length) {
  let i = 0;
  try { const v = parseInt(storage?.getItem?.(FACTS_KEY) ?? '0', 10); i = Number.isFinite(v) ? ((v % n) + n) % n : 0; } catch { /* blocked */ }
  return i;
}
function saveLine(storage, i) { try { storage?.setItem?.(FACTS_KEY, String(i)); } catch { /* blocked */ } }

// below this gap (px: a browser tab's 844 × 340 frame) the fact takes the hero line's place while the build runs (the stage and
// the line keep the gap); the hero line comes back once the modes are ready
const COMPACT_GAP = 58;
// the block's place: the chart's gap between the mode row and the page links (the card's own layout decides both), in the card's
// own CSS px (offsets, never the screen's rects: the landscape-only page may draw the card turned)
const offIn = (n, card) => { let y = 0; for (let e = n; e && e !== card; e = e.offsetParent) y += e.offsetTop; return y; };
function place(card, el, tag, fx) {
  const plan = card.querySelector('.lk-row.plan') ?? card.querySelector('.lk-plan');
  const links = card.querySelector('.lk-links');
  if (!plan || !links || !plan.offsetHeight || !links.offsetHeight) return;
  const top = offIn(plan, card) + plan.offsetHeight, bottom = offIn(links, card);
  const gap = Math.max(0, bottom - top), pad = Math.round(Math.min(10, gap * 0.08));
  el.style.top = `${top + pad}px`;
  el.style.height = `${Math.max(0, gap - 2 * pad)}px`;
  const sub = card.querySelector('.lk-sub');
  const compact = gap < COMPACT_GAP && !!sub?.offsetHeight;
  el.classList.toggle('cp', compact); tag.classList.toggle('on', compact);
  if (compact) {
    let x = 0; for (let e = sub; e && e !== card; e = e.offsetParent) x += e.offsetLeft;
    Object.assign(tag.style, { top: `${offIn(sub, card)}px`, left: `${x}px`, width: `${sub.offsetWidth}px`, height: `${sub.offsetHeight}px` });
    if (fx.parentNode !== tag) tag.appendChild(fx);
  } else if (fx.parentNode !== el) el.appendChild(fx);
}

export function mountBuildCard(root, gate, { doc = globalThis.document, storage = (() => { try { return globalThis.localStorage; } catch { return null; } })(), onReady = null, factMs = FACT_MS } = {}) {
  const card = root?.querySelector?.('.lk-card');
  if (!card || !gate?.enabled || card.querySelector('.lk-bld')) return null;
  if (!doc.getElementById('lk-build-css')) { const s = doc.createElement('style'); s.id = 'lk-build-css'; s.textContent = CSS; doc.head.appendChild(s); }
  const el = doc.createElement('div');
  el.className = 'lk-bld';
  el.innerHTML = '<div class="lk-bld-top"><span class="lk-bld-st" role="status" aria-live="polite"></span><span class="lk-bld-pc"></span></div>'
    + '<div class="lk-bld-ln" role="progressbar" aria-label="Getting the boat ready" aria-valuemin="0" aria-valuemax="100"><i></i></div><p class="lk-bld-fx"></p>';
  const tag = doc.createElement('div'); tag.className = 'lk-bld-tag';   // the fact's place in a short frame (over the hero line)
  card.append(el, tag);
  const st = el.querySelector('.lk-bld-st'), pc = el.querySelector('.lk-bld-pc'), ln = el.querySelector('.lk-bld-ln'), fx = el.querySelector('.lk-bld-fx');
  const win = doc.defaultView ?? globalThis;
  const reduced = () => { try { return !!win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; } };
  // the fact: a new line every factMs (a fade, or a plain swap under reduced motion)
  let li = firstLine(storage), swap = 0;
  const showLine = () => { fx.textContent = LINES[li % LINES.length]; fx.classList.remove('off'); };
  showLine(); saveLine(storage, li + 1);
  const next = () => {
    li = (li + 1) % LINES.length; saveLine(storage, li + 1);
    if (reduced()) { showLine(); return; }
    fx.classList.add('off'); clearTimeout(swap); swap = setTimeout(showLine, 400);
  };
  const timer = setInterval(next, factMs);
  // the stage and the percentage from the gate; the line's fill glides between the steps (none under reduced motion: the plain
  // --p line, no transition)
  let readyDone = false;
  const glide = reduced() ? null : createLineGlide(ln.querySelector('i'));
  const paint = (s = gate.state()) => {
    st.textContent = s.words; pc.textContent = `${s.percent} %`;
    setLineProgress(ln, s.percent / 100);
    if (glide) { if (s.ready) glide.done(); else { const [p, next] = lineSteps(s); glide.step(p, next); } }
    root.dataset.build = s.ready ? 'ready' : 'wait';
    if (s.ready && !readyDone) { readyDone = true; onReady?.(); }
  };
  const off = gate.on((s) => paint(s));
  const relayout = () => place(card, el, tag, fx);
  const RO = win.ResizeObserver;
  const ro = RO ? new RO(relayout) : null;
  ro?.observe(card);
  win.addEventListener?.('resize', relayout);
  relayout(); paint();
  return {
    el, get line() { return fx.textContent; }, next, relayout, setProgress: (v) => setLineProgress(ln, v), progressEl: ln,
    glide,
    dispose() { glide?.stop(); clearInterval(timer); clearTimeout(swap); off(); ro?.disconnect(); win.removeEventListener?.('resize', relayout); el.remove(); tag.remove(); delete root.dataset.build; },
  };
}
