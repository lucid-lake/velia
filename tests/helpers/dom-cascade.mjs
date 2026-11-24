// A small DOM for the fast suite's UI tests (touchUx, viewSwitch, fullscreen, throttle, keysContent): enough of a
// browser to mount the overlays (createViewSwitch, createControlPanel, createThrottleColumn, createDashboard,
// createHelmStation's CSS) and read what they built: an HTML parser, elements with attributes, classList, dataset, style,
// events that bubble, and a selector engine (tag, #id, .class, [attr], [attr=v], descendant and child combinators, lists).
// No layout (every box is 0 × 0) and no cascade: the injected CSS is read as rules (cssRules) and checked as data.
//
//   const dom = installDom();             // globalThis.document, window listeners, KeyboardEvent, localStorage …
//   … mount, then dom.styles() / document.querySelector(…) …
//   dom.uninstall();                       // restores the globals
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// the tree's version: any change of a child list or an attribute's value moves it on; a query's answer is kept until then
// (the controls ask for the same few nodes every frame)
let version = 0;
class Target {
  constructor() { this._ls = new Map(); }
  addEventListener(t, f, o) { if (!f) return; if (!this._ls.has(t)) this._ls.set(t, []); const sig = o && typeof o === 'object' ? o.signal : null; if (sig?.aborted) return; this._ls.get(t).push(f); sig?.addEventListener?.('abort', () => this.removeEventListener(t, f)); }
  removeEventListener(t, f) { const a = this._ls.get(t); if (a) this._ls.set(t, a.filter((g) => g !== f)); }
  _fire(e) { for (const f of [...(this._ls.get(e.type) ?? [])]) { Object.defineProperty(e, 'currentTarget', { value: this, configurable: true }); typeof f === 'function' ? f.call(this, e) : f.handleEvent(e); if (e._stopNow) break; } }
}

export class Text { constructor(t) { this.nodeType = 3; this.data = t; this.parentNode = null; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } get outerHTML() { return esc(this.data); } }

export class Element extends Target {
  constructor(tag, doc) {
    super(); this.nodeType = 1; this.tagName = tag.toUpperCase(); this.localName = tag.toLowerCase(); this.ownerDocument = doc; this.attrs = new Map(); this.childNodes = []; this.parentNode = null;
    const self = this, styleProps = {};
    this.style = new Proxy(styleProps, { get(o, k) {
      if (k === 'setProperty') return (n, v) => { o[n] = String(v); };
      if (k === 'getPropertyValue') return (n) => o[n] ?? '';
      if (k === 'removeProperty') return (n) => { delete o[n]; };
      if (k === 'cssText') return Object.entries(o).map(([a, b]) => `${a.startsWith('--') ? a : kebab(a)}:${b}`).join(';');
      return o[k] ?? '';
    }, set(o, k, v) { if (k === 'cssText') { for (const d of String(v).split(';')) { const i = d.indexOf(':'); if (i > 0) o[camel(d.slice(0, i).trim())] = d.slice(i + 1).trim(); } } else o[k] = v; return true; } });
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? self.getAttribute('data-' + kebab(k)) ?? undefined : undefined),
      set: (_, k, v) => { self.setAttribute('data-' + kebab(k), v); return true; },
      deleteProperty: (_, k) => { self.removeAttribute('data-' + kebab(k)); return true; },
      has: (_, k) => self.hasAttribute('data-' + kebab(k)),
      ownKeys: () => [...self.attrs.keys()].filter((a) => a.startsWith('data-')).map((a) => camel(a.slice(5))),
      getOwnPropertyDescriptor: (_, k) => (self.hasAttribute('data-' + kebab(k)) ? { enumerable: true, configurable: true, value: self.getAttribute('data-' + kebab(k)) } : undefined),
    });
    this.classList = {
      _get: () => { const str = self.getAttribute('class') ?? ''; if (self._clsStr !== str) { self._clsStr = str; self._cls = str.split(/\s+/).filter(Boolean); } return self._cls; },
      _set: (a) => self.setAttribute('class', a.join(' ')),
      add: (...c) => { const a = [...self.classList._get()]; for (const x of c) if (!a.includes(x)) a.push(x); self.classList._set(a); },
      remove: (...c) => self.classList._set(self.classList._get().filter((x) => !c.includes(x))),
      toggle: (c, on) => { const has = self.classList.contains(c), want = on === undefined ? !has : !!on; if (want !== has) (want ? self.classList.add(c) : self.classList.remove(c)); return want; },
      contains: (c) => self.classList._get().includes(c),
      get length() { return self.classList._get().length; },
      [Symbol.iterator]: () => self.classList._get()[Symbol.iterator](),
    };
  }
  // attributes
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { const x = String(v); if (this.attrs.get(n) !== x) { this.attrs.set(n, x); version++; } }
  hasAttribute(n) { return this.attrs.has(n); }
  removeAttribute(n) { if (this.attrs.delete(n)) version++; }
  toggleAttribute(n, on) { const w = on === undefined ? !this.attrs.has(n) : !!on; if (w) this.setAttribute(n, this.attrs.get(n) ?? ''); else this.removeAttribute(n); return w; }
  get id() { return this.getAttribute('id') ?? ''; } set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') ?? ''; } set className(v) { this.setAttribute('class', v); }
  get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { this.toggleAttribute('hidden', !!v); }
  get disabled() { return this.hasAttribute('disabled'); } set disabled(v) { this.toggleAttribute('disabled', !!v); }
  get title() { return this.getAttribute('title') ?? ''; } set title(v) { this.setAttribute('title', v); }
  get type() { return this.getAttribute('type') ?? ''; } set type(v) { this.setAttribute('type', v); }
  get rel() { return this.getAttribute('rel') ?? ''; } set rel(v) { this.setAttribute('rel', v); }
  get href() { return this.getAttribute('href') ?? ''; } set href(v) { this.setAttribute('href', v); }
  get tabIndex() { return +(this.getAttribute('tabindex') ?? -1); } set tabIndex(v) { this.setAttribute('tabindex', v); }
  get value() { return this._value ?? this.getAttribute('value') ?? ''; } set value(v) { this._value = String(v); }
  get checked() { return !!this._checked; } set checked(v) { this._checked = !!v; }
  // tree
  get children() { return (this._kids ??= this.childNodes.filter((c) => c.nodeType === 1)); }   // cached until the next change
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument?.documentElement; }
  _adopt(c) { if (typeof c === 'string') c = new Text(c); if (c.nodeType === 1 && c.contains(this)) throw new Error('HierarchyRequestError: a node into its own subtree'); c.parentNode?.removeChild?.(c); c.parentNode = this; this._kids = null; version++; return c; }
  appendChild(c) { c = this._adopt(c); this.childNodes.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  prepend(...cs) { for (const c of cs.reverse()) { const n = this._adopt(c); this.childNodes.unshift(n); } }
  insertBefore(c, ref) { c = this._adopt(c); const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); return c; }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; this._kids = null; version++; return c; }
  remove() { this.parentNode?.removeChild(this); }
  after(...cs) { const p = this.parentNode; if (!p) return; let i = p.childNodes.indexOf(this) + 1; for (const c of cs) { const n = p._adopt(c); p.childNodes.splice(i++, 0, n); } }
  before(...cs) { const p = this.parentNode; if (!p) return; let i = p.childNodes.indexOf(this); for (const c of cs) { const n = p._adopt(c); p.childNodes.splice(i++, 0, n); } }
  replaceChildren(...cs) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this._kids = null; version++; this.append(...cs); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  closest(sel) { for (let x = this; x instanceof Element; x = x.parentNode) if (x.matches(sel)) return x; return null; }
  matches(sel) { return parseSel(sel).some((cx) => matchComplex(this, cx)); }
  _find(sel, first) {
    const memo = (this._q ??= new Map()), k = (first ? '1' : '*') + sel, hit = memo.get(k);
    if (hit && hit.v === version) return hit.out.slice();
    const out = this._find1(sel, first); memo.set(k, { v: version, out }); return out.slice();
  }
  _find1(sel, first) {
    const cxs = parseSel(sel), out = [];
    const walk = (e) => { for (const c of e.children) { if (cxs.some((cx) => matchComplex(c, cx, this))) { out.push(c); if (first) return true; } if (walk(c)) return true; } return false; };
    walk(this); return out;
  }
  querySelectorAll(sel) { return this._find(sel, false); }
  querySelector(sel) { return this._find(sel, true)[0] ?? null; }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
  // content
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { const one = this.childNodes.length === 1 && this.childNodes[0].nodeType === 3; if (one && this.childNodes[0].data === String(v ?? '')) return; this.replaceChildren(); if (v !== '' && v != null) this.appendChild(new Text(String(v))); }
  get innerText() { return this.textContent; } set innerText(v) { this.textContent = v; }
  get innerHTML() { return this.childNodes.map((c) => c.outerHTML).join(''); }
  set innerHTML(h) { this.replaceChildren(); for (const n of parseHtml(String(h), this.ownerDocument)) this.appendChild(n); }
  get outerHTML() {
    const a = [...this.attrs].map(([k, v]) => (v === '' && k !== 'value' ? ` ${k}` : ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)).join('');
    return VOID.has(this.localName) ? `<${this.localName}${a}>` : `<${this.localName}${a}>${this.localName === 'style' || this.localName === 'script' ? this.textContent : this.innerHTML}</${this.localName}>`;
  }
  insertAdjacentHTML(pos, h) {
    const ns = parseHtml(String(h), this.ownerDocument);
    if (pos === 'beforeend') for (const n of ns) this.appendChild(n);
    else if (pos === 'afterbegin') this.prepend(...ns);
    else if (pos === 'beforebegin' || pos === 'afterend') { const p = this.parentNode, i = p.childNodes.indexOf(this) + (pos === 'afterend' ? 1 : 0); for (const [k, n] of ns.entries()) { p._adopt(n); p.childNodes.splice(i + k, 0, n); } }
  }
  // events
  dispatchEvent(e) {
    if (!e.target) Object.defineProperty(e, 'target', { value: this, configurable: true });
    const path = []; for (let x = this; x; x = x.parentNode) if (x instanceof Target) path.push(x);
    const win = this.ownerDocument?.defaultView; if (win && this.isConnected) path.push(win);
    for (const n of path) { n._fire(e); if (e._stop || e._stopNow || !e.bubbles) break; }
    return !e.defaultPrevented;
  }
  click() { this.dispatchEvent(mkEvent('click', { bubbles: true, detail: 1 })); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  // no layout
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
  get offsetWidth() { return 0; } get offsetHeight() { return 0; } get scrollWidth() { return 0; } get scrollHeight() { return 0; }
  get clientWidth() { return this.ownerDocument?._w ?? 0; } get clientHeight() { return this.ownerDocument?._h ?? 0; }
  setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; }
  // a canvas: a 2D context that draws nothing (every call a no-op, measureText 0 wide, getImageData blank)
  getContext(type) { return this.localName === 'canvas' && type === '2d' ? (this._ctx ??= ctx2d(this)) : null; }
  get width() { return +(this.getAttribute('width') ?? 300); } set width(v) { this.setAttribute('width', v); }
  get height() { return +(this.getAttribute('height') ?? 150); } set height(v) { this.setAttribute('height', v); }
}
function ctx2d(canvas) {
  const o = { canvas, measureText: (t) => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0, text: t }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createConicGradient: () => ({ addColorStop() {} }), createPattern: () => ({}),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), isPointInPath: () => false, getLineDash: () => [] };
  return new Proxy(o, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? () => {} : undefined), set: (t, k, v) => { t[k] = v; return true; } });
}

function mkEvent(type, init = {}) {
  const e = { type, bubbles: !!init.bubbles, detail: init.detail ?? 0, defaultPrevented: false, target: null, ...init };
  e.preventDefault = () => { e.defaultPrevented = true; }; e.stopPropagation = () => { e._stop = true; }; e.stopImmediatePropagation = () => { e._stopNow = true; e._stop = true; };
  return e;
}

// ---- HTML ----
export function parseHtml(html, doc) {
  const root = { nodes: [] }, stack = [];
  const top = () => stack.at(-1);
  const add = (n) => { if (top()) top().appendChild(n); else root.nodes.push(n); };
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
  let m;
  while ((m = re.exec(html))) {
    const [s, close, open, attrs, selfClose] = m;
    if (s.startsWith('<!--')) continue;
    if (close) { const t = close.toLowerCase(); const i = stack.map((e) => e.localName).lastIndexOf(t); if (i >= 0) stack.length = i; continue; }
    if (open) {
      const el = new Element(open, doc);
      const ar = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
      while ((a = ar.exec(attrs ?? ''))) el.setAttribute(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ''));
      add(el);
      const t = open.toLowerCase();
      if (t === 'style' || t === 'script') { const end = html.indexOf(`</${t}`, re.lastIndex); const body = html.slice(re.lastIndex, end < 0 ? undefined : end); if (body) el.appendChild(new Text(body)); re.lastIndex = end < 0 ? html.length : html.indexOf('>', end) + 1; continue; }
      if (!selfClose && !VOID.has(t)) stack.push(el);
      continue;
    }
    add(new Text(decode(s)));
  }
  return root.nodes;
}

// ---- selectors ----
const selCache = new Map();
function parseSel(sel) {
  if (selCache.has(sel)) return selCache.get(sel);
  const out = [];
  for (const part of splitTop(sel, ',')) {
    const toks = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+(?![^[]*\])/).filter(Boolean);
    const cx = []; let comb = ' ';
    for (const t of toks) { if (t === '>') { comb = '>'; continue; } cx.push({ comb, c: parseCompound(t) }); comb = ' '; }
    out.push(cx);
  }
  selCache.set(sel, out);
  return out;
}
function splitTop(s, ch) { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '[' || c === '(') d++; if (c === ']' || c === ')') d--; if (c === ch && !d) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }
function parseCompound(t0) {
  const c = { tag: null, id: null, cls: [], attrs: [], not: [], pseudo: [], any: [] };
  // the functional pseudo-classes with a selector list, by balanced parentheses: :not(), :is(), :where() (the device
  // profile's rules: src/core/profile.js data-screen tokens in :where(), zero specificity)
  let t = '', i = 0;
  while (i < t0.length) {
    const f = /^:(not|is|where)\(/.exec(t0.slice(i));
    if (!f) { t += t0[i++]; continue; }
    let d = 1, j = i + f[0].length; while (j < t0.length && d) { if (t0[j] === '(') d++; else if (t0[j] === ')') d--; j++; }
    const inner = t0.slice(i + f[0].length, j - 1);
    if (f[1] === 'not') c.not.push(inner); else c.any.push({ list: inner, zero: f[1] === 'where' });
    i = j;
  }
  const re = /^(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|:([\w-]+)/g; let m;
  while ((m = re.exec(t))) {
    if (m[1]) c.tag = m[1] === '*' ? null : m[1].toLowerCase();
    else if (m[2]) c.id = m[2]; else if (m[3]) c.cls.push(m[3]);
    else if (m[4]) c.attrs.push({ n: m[4], op: m[5], v: m[6] ?? m[7] ?? m[8] });
    else if (m[9]) c.pseudo.push(m[9]);
  }
  return c;
}
// pseudo-classes: :root only; every other state (:hover, :focus-visible, ::after …) never matches (nothing is hovered or
// focused here, and a pseudo-element is not the element)
function matchCompound(e, c) {
  if (c.tag && e.localName !== c.tag) return false;
  for (const p of c.pseudo) if (p !== 'root' || e !== e.ownerDocument?.documentElement) return false;
  if (c.id && e.id !== c.id) return false;
  for (const k of c.cls) if (!e.classList.contains(k)) return false;
  for (const a of c.attrs) {
    const v = e.getAttribute(a.n); if (v == null) return false;
    if (a.op === '=' && v !== a.v) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.v)) return false;
    if (a.op === '^=' && !v.startsWith(a.v)) return false;
    if (a.op === '*=' && !v.includes(a.v)) return false;
  }
  for (const n of c.not) if (e.matches(n)) return false;
  for (const a of c.any) if (!e.matches(a.list)) return false;
  return true;
}
function matchComplex(e, cx, scope = null, i = cx.length - 1) {
  if (!matchCompound(e, cx[i].c)) return false;
  if (i === 0) return true;
  const up = (x) => (x.parentNode instanceof Element && x.parentNode !== scope ? x.parentNode : null);
  if (cx[i].comb === '>') { const p = up(e); return !!p && matchComplex(p, cx, scope, i - 1); }
  for (let p = up(e); p; p = up(p)) if (matchComplex(p, cx, scope, i - 1)) return true;
  return false;
}

// ---- CSS as data ----
// cssRules(text) → [{ media: '(max-width:640px)' | null, sel: ['.a .b', …], decl: { prop: value } }]
export function cssRules(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, ''), out = [];
  const walk = (s, media) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i); if (open < 0) break;
      const head = s.slice(i, open).trim();
      let d = 1, j = open + 1; while (j < s.length && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head.slice(6).trim());
      else if (!head.startsWith('@')) {
        const decl = {};
        for (const p of splitTop(body, ';')) { const k = p.indexOf(':'); if (k > 0) decl[p.slice(0, k).trim()] = p.slice(k + 1).trim(); }
        out.push({ media, sel: splitTop(head, ',').map((x) => x.trim().replace(/\s+/g, ' ')), decl });
      }
      i = j;
    }
  };
  walk(src, null);
  return out;
}
// the declarations of every rule whose selector list holds `sel` (in `media`, or outside any @media when media is null), merged in order
// does a media query hold for env { w, h, coarse, reducedMotion }? (width, pointer, hover and reduced motion; a comma is or)
export function mediaMatches(media, env = {}) {
  if (!media) return true;
  const { w = 1280, h = 720, coarse = false, reducedMotion = false } = env;
  return splitTop(media, ',').some((q) => [...q.matchAll(/\(([^)]*)\)/g)].every(([, f]) => {
    const [k, v = ''] = f.split(':').map((x) => x.trim());
    if (k === 'max-width') return w <= parseFloat(v);
    if (k === 'min-width') return w >= parseFloat(v);
    if (k === 'max-height') return h <= parseFloat(v);
    if (k === 'min-height') return h >= parseFloat(v);
    if (k === 'pointer' || k === 'any-pointer') return (v === 'coarse') === coarse;
    if (k === 'hover' || k === 'any-hover') return (v === 'none') === coarse;
    if (k === 'prefers-reduced-motion') return (v === 'reduce') === reducedMotion;
    if (k === 'orientation') return (v === 'portrait') === h > w;
    return false;
  }));
}
const ruleCache = new Map(), rulesOf = (t) => { let r = ruleCache.get(t); if (!r) ruleCache.set(t, r = cssRules(t)); return r; };
const specificity = (cx) => cx.reduce((n, { c }) => n + (c.id ? 10000 : 0) + 100 * (c.cls.length + c.attrs.length + c.pseudo.length) + (c.tag ? 1 : 0)
  + c.not.reduce((m, x) => m + specificity(parseSel(x)[0] ?? []), 0)
  + c.any.reduce((m, a) => m + (a.zero ? 0 : Math.max(0, ...parseSel(a.list).map(specificity))), 0), 0);
// The cascade of the page's injected stylesheets (every <style> in the document; the tokens' <link> is not read) on one
// element: the declarations of every rule that matches it under env's media, by !important, specificity and order. No
// inheritance and no var(): the values come back as written.
export function computed(el, env = {}) {
  const doc = el.ownerDocument, out = {}, rank = {};
  let order = 0;
  for (const st of doc.querySelectorAll('style')) for (const r of rulesOf(st.textContent)) {
    order++;
    if (!mediaMatches(r.media, env)) continue;
    let sp = -1;
    for (const sel of r.sel) { const cx = parseSel(sel)[0]; if (cx && matchComplex(el, cx)) sp = Math.max(sp, specificity(cx)); }
    if (sp < 0) continue;
    for (const [k, v0] of Object.entries(r.decl)) {
      const imp = /!important$/.test(v0), v = v0.replace(/\s*!important$/, ''), key = [imp ? 1 : 0, sp, order];
      const was = rank[k];
      if (!was || key[0] > was[0] || (key[0] === was[0] && (key[1] > was[1] || (key[1] === was[1] && key[2] >= was[2])))) { out[k] = v; rank[k] = key; }
    }
  }
  return out;
}
// is the element laid out (no display:none on it or an ancestor)? A [hidden] element is display:none unless an author rule
// sets its display (the browser's own sheet: [hidden]{display:none})
export function displayed(el, env = {}) {
  for (let x = el; x && x.nodeType === 1; x = x.parentNode) { const d = computed(x, env).display ?? (x.hidden ? 'none' : ''); if (d === 'none') return false; }
  return true;
}

// ---- the document and the window ----
// coarse: a finger's device (matchMedia('(pointer: coarse)') and '(hover: none)' match, '(any-pointer: fine)' does not);
// fullscreen: the Fullscreen API on the document (false: an iPhone's Safari, which has none); search: location.search
export function installDom({ w = 1280, h = 720, coarse = false, search = '', fullscreen = true } = {}) {
  const saved = {}, G = globalThis;
  const doc = new Target();
  const mk = (t) => new Element(t, doc);
  doc.nodeType = 9; doc._w = w; doc._h = h;
  doc.documentElement = mk('html'); doc.head = mk('head'); doc.body = mk('body');
  doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body; doc.visibilityState = 'visible'; doc.fullscreenElement = null;
  if (fullscreen) {
    const changed = () => doc.dispatchEvent(mkEvent('fullscreenchange'));
    doc.documentElement.requestFullscreen = function () { doc.fullscreenElement = this; changed(); return Promise.resolve(); };
    doc.exitFullscreen = () => { doc.fullscreenElement = null; changed(); return Promise.resolve(); };
  }
  doc.createElement = mk; doc.createElementNS = (_, t) => mk(t); doc.createTextNode = (t) => new Text(t);
  doc.getElementById = (id) => doc.documentElement.querySelector(`#${id}`);
  doc.querySelector = (s) => doc.documentElement.matches(s) ? doc.documentElement : doc.documentElement.querySelector(s);
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  doc.dispatchEvent = (e) => { if (!e.target) Object.defineProperty(e, 'target', { value: doc, configurable: true }); doc._fire(e); return !e.defaultPrevented; };
  const win = new Target(); doc.defaultView = win;
  const store = new Map();
  const raf = new Map(); let rafId = 0, rafT = 0;
  const timers = new Set(), realSetInterval = G.setInterval, realSetTimeout = G.setTimeout;
  const g = {
    document: doc, window: G,
    addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win),
    dispatchEvent: (e) => { if (!e.target) Object.defineProperty(e, 'target', { value: win, configurable: true }); win._fire(e); return !e.defaultPrevented; },
    // frames run only when the test asks (dom.frame()): a render loop never runs away
    requestAnimationFrame: (f) => { raf.set(++rafId, f); return rafId; }, cancelAnimationFrame: (id) => raf.delete(id),
    innerWidth: w, innerHeight: h, devicePixelRatio: 1,
    location: { search, hash: '', pathname: '/', href: `http://lakeshore.test/${search}`, origin: 'http://lakeshore.test', host: 'lakeshore.test' },
    matchMedia: (q) => ({ matches: /pointer:\s*coarse|hover:\s*none/.test(q) ? coarse : /any-pointer:\s*fine|hover:\s*hover|pointer:\s*fine/.test(q) ? !coarse : false, media: q, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
    KeyboardEvent: class KeyboardEvent { constructor(type, init = {}) { Object.assign(this, mkEvent(type, init)); } },
    PointerEvent: class PointerEvent { constructor(type, init = {}) { Object.assign(this, mkEvent(type, init)); } },
    Event: class Ev { constructor(type, init = {}) { Object.assign(this, mkEvent(type, init)); } },
    CustomEvent: class CustomEv { constructor(type, init = {}) { Object.assign(this, mkEvent(type, init)); } },
    HTMLElement: Element, Element,
    // timers never hold the test process open, and uninstall() clears the intervals
    setInterval: (f, ms, ...a) => { const id = realSetInterval(f, ms, ...a); id.unref?.(); timers.add(id); return id; },
    setTimeout: (f, ms, ...a) => { const id = realSetTimeout(f, ms, ...a); id.unref?.(); return id; },
  };
  for (const k of Object.keys(g)) { saved[k] = Object.getOwnPropertyDescriptor(G, k); Object.defineProperty(G, k, { value: g[k], configurable: true, writable: true }); }
  const lk = G.__lakeshore; G.__lakeshore = {};
  return {
    doc, win,
    // the stylesheets the code injected: { id: text }
    styles: () => Object.fromEntries(doc.querySelectorAll('style').map((s) => [s.id, s.textContent])),
    rules: (id) => cssRules(doc.getElementById(id)?.textContent ?? ''),
    frame(n = 1, ms = 16) { for (let i = 0; i < n; i++) { rafT += ms; const fs = [...raf.values()]; raf.clear(); for (const f of fs) f(rafT); } },
    key: (type, code, extra = {}) => g.dispatchEvent(new g.KeyboardEvent(type, { code, key: code.replace(/^Key|^Digit/, ''), ...extra })),
    uninstall() {
      for (const id of timers) clearInterval(id);
      for (const k of Object.keys(g)) { if (saved[k]) Object.defineProperty(G, k, saved[k]); else delete G[k]; }
      if (lk === undefined) delete G.__lakeshore; else G.__lakeshore = lk;
    },
  };
}
