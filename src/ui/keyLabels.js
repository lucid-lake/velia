// Key caps that follow the player's keyboard. The game binds by event.code (the physical key), so ` (autopilot) and
// + / - (throttle) work on every layout; but a cap that says "`" or "+" can name a key that is somewhere else, or says
// something else, on a German or French board. Where the browser can tell (navigator.keyboard.getLayoutMap: Chromium),
// the three caps are relabelled with what that key prints; elsewhere they keep the US names.
// Safe to call on any element, any number of times; it never throws.
const BY_TOKEN = { '`': 'Backquote', '+': 'Equal', '−': 'Minus' };
let map = null, asked = null;

export function layoutLabel(code, fallback) {
  const v = map?.get?.(code);
  if (!v || v === fallback || v.length > 2 || v.charCodeAt(0) < 33) return fallback;   // a dead key or a long name: keep the US cap
  return v === '-' ? '−' : v;
}

export function relabelCaps(root) {
  try {
    const apply = () => {
      for (const el of root?.querySelectorAll?.('.cap[data-k]') ?? []) {
        const code = BY_TOKEN[el.dataset.k]; if (!code) continue;
        const t = layoutLabel(code, el.dataset.k); if (t !== el.textContent) el.textContent = t;
      }
    };
    if (map) { apply(); return; }
    asked ??= navigator.keyboard?.getLayoutMap?.().then((m) => { map = m; }, () => {});
    asked?.then(apply);
  } catch { /* the US caps stay */ }
}
