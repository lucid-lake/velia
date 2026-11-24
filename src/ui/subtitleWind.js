// The subtitle's wind (owner, 2026-10-30): a skipper line arrives on the breeze and leaves on it. The line's letters drift in from upwind with a
// slight stagger, settle and sharpen (opacity 0 to 1, a 2 px blur to 0); on the way out they lift away downwind with a small upward curl and fade,
// like spray or leaves. The direction is the TRUE wind relative to the screen: in the follow view the camera looks along the bow, so a wind from
// starboard (trueWind.angle > 0, src/boat.js) blows toward screen-left, a wind from ahead blows toward the viewer (down, a little), a wind from
// astern lifts the letters up. The gust (the true wind's speed) scales the drift a little (0.8 to 1.3). Only transforms, opacity and a 2 px blur
// move, per letter span; the line keeps its words (each a nowrap box) so nothing reflows, and its text stays whole for screen readers (aria-label
// on the line, the letter spans aria-hidden). Reduced motion: a plain fade (tokens.css / controlsHint.js).
//
//   const w = windOnScreen(state.trueWind, view);          // { x, y, g }: the downwind unit vector on the screen (x right, y down), the gust factor
//   prepareLine(rowEl, w);                                  // wraps the .say's letters; sets --wx, --wy, --g on the row, --ld/--lx on each letter
// Pure parts: windOnScreen, letterPlan (tests/dashboard.test.mjs).

export const WIND_SUB = { inTotalS: 0.28, inPerLetterS: 0.025, outTotalS: 0.2, outPerLetterS: 0.018, gustMin: 0.8, gustMax: 1.3, gustRef: 5 };

// tw: { angle (rad, + = from starboard), speed (m/s) } or null; view: 'follow' (astern) or 'helm' (looking ahead from the cockpit: the same axes)
export function windOnScreen(tw, view = 'follow') {
  if (!tw || !Number.isFinite(tw.angle)) return { x: -1, y: 0.2, g: 1 };   // no boat: a breeze from the right, the way the lake mostly blows in the evening
  const x = -Math.sin(tw.angle), y = 0.35 * Math.cos(tw.angle);              // toward port for a starboard wind; toward the viewer (down) for a head wind
  const n = Math.hypot(x, y) || 1;
  const g = Math.min(WIND_SUB.gustMax, Math.max(WIND_SUB.gustMin, 0.8 + (tw.speed ?? WIND_SUB.gustRef) / WIND_SUB.gustRef * 0.2));
  return { x: x / n, y: y / n, g };
}

// The delay of each of n letters (s), in the order the breeze reaches them: from the upwind end of the line. dirX > 0 blows to the right, so the left end first.
export function letterPlan(n, dirX, { total = WIND_SUB.inTotalS, per = WIND_SUB.inPerLetterS } = {}) {
  const step = n > 1 ? Math.min(per, total / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => (dirX >= 0 ? i : n - 1 - i) * step);
}

const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };   // a fixed per-letter scatter: no Math.random in the UI either

// Wraps every letter of the line's text (inside .say, term glosses and all) in a span; words stay nowrap boxes. Idempotent.
export function prepareLine(row, wind) {
  const say = row.querySelector('.say');
  if (!say || say.dataset.wind) return 0;
  say.dataset.wind = '1';
  say.setAttribute('aria-label', say.textContent.replace(/\s+/g, ' ').trim());
  const nodes = []; const walk = (n) => { for (const c of [...n.childNodes]) { if (c.nodeType === 3) nodes.push(c); else walk(c); } }; walk(say);
  let k = 0; const letters = [];
  for (const tn of nodes) {
    const frag = document.createDocumentFragment();
    for (const part of tn.nodeValue.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
      const w = document.createElement('span'); w.className = 'wd'; w.setAttribute('aria-hidden', 'true');
      for (const ch of part) { const l = document.createElement('span'); l.className = 'lt'; l.textContent = ch; letters.push(l); w.appendChild(l); k++; }
      frag.appendChild(w);
    }
    tn.replaceWith(frag);
  }
  const din = letterPlan(letters.length, wind.x), dout = letterPlan(letters.length, wind.x, { total: WIND_SUB.outTotalS, per: WIND_SUB.outPerLetterS });
  letters.forEach((l, i) => { l.style.setProperty('--ld', `${din[i].toFixed(3)}s`); l.style.setProperty('--lo', `${dout[i].toFixed(3)}s`); l.style.setProperty('--r', hash(i).toFixed(2)); });
  row.style.setProperty('--wx', wind.x.toFixed(3)); row.style.setProperty('--wy', wind.y.toFixed(3)); row.style.setProperty('--g', wind.g.toFixed(2));
  return letters.length;
}
