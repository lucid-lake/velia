// A small DOM for node tests of modules that build their UI by injecting a <style> and setting innerHTML (no parser:
// innerHTML is kept as text, querySelector finds nothing). Elements record attributes, classes, children and their
// listeners; the document finds head children by id. Not a browser: no layout, no CSS cascade (tests/pages/ for those).
//   const { doc, restore } = installDom();   // sets globalThis.document (and window listeners); restore() puts back the old ones
export function el(tag) {
  const cls = new Set();
  const e = {
    tagName: tag, children: [], style: { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] ?? ''; } }, attrs: {}, dataset: {}, listeners: {},
    id: '', textContent: '', hidden: false, _html: '',
    get className() { return [...cls].join(' '); }, set className(v) { cls.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) cls.add(c); },
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), toggle: (c, on) => ((on ?? !cls.has(c)) ? (cls.add(c), true) : (cls.delete(c), false)), contains: (c) => cls.has(c) },
    set innerHTML(h) { this._html = String(h); this.children = []; }, get innerHTML() { return this._html + this.children.map((c) => c.outerHTML).join(''); },
    get outerHTML() { return `<${tag} class="${this.className}">${this.innerHTML}</${tag}>`; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, hasAttribute(k) { return k in this.attrs; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, append(...cs) { for (const c of cs) this.appendChild(c); },
    prepend(c) { this.children.unshift(c); c.parentNode = this; return c; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); },
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], contains(x) { return x === this; }, getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };
  return e;
}

export function installDom() {
  const g = globalThis, saved = { document: g.document, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener };
  const head = el('head'), body = el('body'), documentElement = el('html');
  const doc = { head, body, documentElement, createElement: el, getElementById: (id) => head.children.find((c) => c.id === id) ?? body.children.find((c) => c.id === id) ?? null,
    querySelector: () => null, querySelectorAll: () => [] };
  const target = new EventTarget();
  g.document = doc;
  g.addEventListener = (...a) => target.addEventListener(...a);
  g.removeEventListener = (...a) => target.removeEventListener(...a);
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v; } };
  return { doc, head, body, H: documentElement, target, restore };
}
