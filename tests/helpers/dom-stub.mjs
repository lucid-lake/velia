// A tiny DOM for the node tests of the DOM overlays (controlsHint.js): elements with innerHTML, classList, style,
// dataset and children; window listeners recorded so a test can dispatch keys. Not a browser: no layout, no CSS.
// install() sets globalThis.document / addEventListener / requestAnimationFrame; key(code, down) dispatches.
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = { setProperty() {} }; this.dataset = {}; this._html = ''; this.id = ''; this.className = ''; this.textContent = '';
    const set = new Set(); this.classList = { add: (c) => set.add(c), remove: (...c) => c.forEach((x) => set.delete(x)), toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) }; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  set innerHTML(h) { this._html = h; if (h === '') this.children = []; }
  get innerHTML() { return this._html + this.children.map((c) => c.innerHTML).join(''); }
  querySelectorAll(sel) { const out = []; const walk = (e) => { for (const c of e.children) { if (sel === '.row' && /\brow\b/.test(c.className)) out.push(c); walk(c); } }; walk(this); return out; }
  prepend(c) { this.children.unshift(c); c.parent = this; return c; }
  querySelector() { return null; }
  // element listeners and attributes (a line that is its own tap target: controlsHint note's onTap); fire(type) calls them
  addEventListener(type, f) { ((this._on ??= {})[type] ??= []).push(f); }
  fire(type, e = {}) { for (const f of this._on?.[type] ?? []) f({ preventDefault() {}, stopPropagation() {}, ...e }); }
  setAttribute(k, v) { (this._attr ??= {})[k] = String(v); }
  getAttribute(k) { return this._attr?.[k] ?? null; }
}
const listeners = new Map();
export function install() {
  const head = new El('head'), body = new El('body');
  globalThis.document = { head, body, createElement: (t) => new El(t), getElementById: (id) => head.children.find((c) => c.id === id) ?? null };
  globalThis.addEventListener = (type, f) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(f); };
  globalThis.removeEventListener = (type, f) => listeners.get(type)?.delete(f);
  globalThis.requestAnimationFrame = (f) => { f(0); return 0; };
  listeners.clear();
  return { head, body };
}
export function key(code, down = true, extra = {}) { for (const f of listeners.get(down ? 'keydown' : 'keyup') ?? []) f({ code, repeat: false, ...extra }); }
