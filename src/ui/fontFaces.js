// One @font-face per family, style and weight on a page (owner 2026-11-17: "the duplicate font fetches fixed").
// The page's head declares Jost (v2/index.html, src/ui/loading-shell.html); the modules that inject their own sheets later (the
// logbook, the skipper's line, the home card's pages) carried their own copies with other descriptors (font-display swap vs block),
// and the browser loads each rule as its own face: jost-latin.woff2 three times, jost-italic-latin.woff2 twice on a phone's load.
// uniqueFaces(css) drops each @font-face whose family, style and weight the page already has (document.fonts holds the faces of every sheet)
// or that an earlier rule in the same text declares; every other rule passes as it was.
const norm = (v, d) => String(v || d).replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const key = (family, style, weight) => `${norm(family, '')}|${norm(style, 'normal')}|${norm(weight, '400').replace(/^normal$/, '400').replace(/^bold$/, '700')}`;
export function uniqueFaces(css, fonts = globalThis.document?.fonts) {
  const have = new Set();
  try { if (fonts) for (const f of fonts) have.add(key(f.family, f.style, f.weight)); } catch { /* no font set: keep every rule */ }
  return css.replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
    const fam = /font-family\s*:\s*([^;}]+)/.exec(rule)?.[1], style = /font-style\s*:\s*([^;}]+)/.exec(rule)?.[1], weight = /font-weight\s*:\s*([^;}]+)/.exec(rule)?.[1];
    if (!fam) return rule;
    const k = key(fam, style, weight);
    if (have.has(k)) return '';
    have.add(k);
    return rule;
  });
}
