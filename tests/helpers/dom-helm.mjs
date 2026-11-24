// A small but real DOM for the fast suite's UI behaviour tests (dashboard, panelTrim, quietLabels): elements built
// from innerHTML (a forgiving HTML parser), attributes, classList, dataset, style, text nodes and fragments, querySelector(All)
// with compound selectors (tag, #id, .class, [attr], [attr=v], [attr^=v], :not(), descendant and child combinators, lists),
// closest/matches, events that bubble (click(), dispatchEvent, stopPropagation), and window-level listeners on globalThis.
// Not a browser: no layout (every box is 0), no CSS cascade. A canvas's 2d context records the text it is asked to draw.
//   const dom = installDom({ search: '?subfont=c' });   // sets globalThis.document, window, addEventListener, KeyboardEvent, …
//   dom.text(el) · dom.styles() (every injected <style>'s text) · dom.key('Digit1') · dom.uninstall()

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', times: '×', deg: '°', hellip: '…', mdash: '—', ndash: '–', larr: '←', rarr: '→', uarr: '↑', darr: '↓', bull: '•', copy: '©' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// ---- events ----
const LISTEN = Symbol('listeners');
function addL(t, type, f, o) { if (!f) return; const m = (t[LISTEN] ??= new Map()); if (!m.has(type)) m.set(type, []); const capture = typeof o === 'boolean' ? o : !!o?.capture; const l = m.get(type); if (!l.some((x) => x.f === f && x.capture === capture)) l.push({ f, capture, once: !!o?.once }); o?.signal?.addEventListener?.('abort', () => removeL(t, type, f, o)); }
function removeL(t, type, f, o) { const l = t[LISTEN]?.get(type); if (!l) return; const capture = typeof o === 'boolean' ? o : !!o?.capture; const i = l.findIndex((x) => x.f === f && x.capture === capture); if (i >= 0) l.splice(i, 1); }
function fire(t, e, phase) {
  const l = t[LISTEN]?.get(e.type); if (!l) return;
  for (const x of [...l]) {
    if (phase === 'capture' && !x.capture) continue; if (phase === 'bubble' && x.capture) continue;
    Object.defineProperty(e, 'currentTarget', { value: t, configurable: true });
    if (x.once) removeL(t, e.type, x.f, x.capture);
    x.f.call(t, e);
    if (e.__stopNow) break;
  }
}
function dispatch(target, e) {
  Object.defineProperty(e, 'target', { value: target, configurable: true });
  const stop = e.stopPropagation, stopNow = e.stopImmediatePropagation, prevent = e.preventDefault;
  e.stopPropagation = function () { this.__stop = true; stop?.call(this); };
  e.stopImmediatePropagation = function () { this.__stop = true; this.__stopNow = true; stopNow?.call(this); };
  e.preventDefault = function () { this.__prevented = true; prevent?.call(this); };
  const path = []; for (let n = target; n; n = n.parentNode) path.push(n);
  if (target.isConnected !== false && target !== globalThis && !path.includes(globalThis)) path.push(globalThis);   // window last
  const up = e.bubbles !== false && e.__bubbles !== false;
  for (const n of [...path].reverse()) { if (e.__stop) break; if (n !== target) fire(n, e, 'capture'); }
  if (!e.__stop) { fire(target, e, 'capture'); if (!e.__stopNow) fire(target, e, 'bubble'); }
  if (up) for (const n of path.slice(1)) { if (e.__stop) break; fire(n, e, 'bubble'); }
  return !e.__prevented;
}
const evInit = (e, init) => { for (const [k, v] of Object.entries(init ?? {})) if (!(k in Event.prototype) || k === 'detail') { try { Object.defineProperty(e, k, { value: v, configurable: true, writable: true }); } catch { /* read-only */ } } return e; };
class UiEvent extends Event { constructor(type, init = {}) { super(type, init); evInit(this, init); this.__bubbles = !!init.bubbles; } }
class KeyboardEvent extends UiEvent { constructor(t, i = {}) { super(t, { key: '', code: '', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...i }); } }
class MouseEvent extends UiEvent { constructor(t, i = {}) { super(t, { clientX: 0, clientY: 0, button: 0, detail: 0, movementX: 0, movementY: 0, ...i }); } }
class PointerEvent extends MouseEvent { constructor(t, i = {}) { super(t, { pointerId: 1, pointerType: 'mouse', isPrimary: true, ...i }); } }
class WheelEvent extends MouseEvent { constructor(t, i = {}) { super(t, { deltaX: 0, deltaY: 0, deltaMode: 0, ...i }); } }

// ---- nodes ----
class Node {
  constructor() { this.parentNode = null; this.childNodes = []; }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === DOC.current; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] ?? null : null; }
  get previousSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) - 1] ?? null : null; }
  remove() { const p = this.parentNode; if (p) { p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; } }
  replaceWith(...ns) { const p = this.parentNode; if (!p) return; for (const n of ns) p.insertBefore(typeof n === 'string' ? new Text(n) : n, this); this.remove(); }
  before(...ns) { const p = this.parentNode; for (const n of ns) p?.insertBefore(typeof n === 'string' ? new Text(n) : n, this); }
  after(...ns) { const p = this.parentNode; if (!p) return; const nx = this.nextSibling; for (const n of ns) p.insertBefore(typeof n === 'string' ? new Text(n) : n, nx); }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  addEventListener(t, f, o) { addL(this, t, f, o); }
  removeEventListener(t, f, o) { removeL(this, t, f, o); }
  dispatchEvent(e) { return dispatch(this, e); }
  // tree edits (also on fragments)
  _adopt(n) { if (n.nodeType === 11) { const kids = [...n.childNodes]; n.childNodes = []; for (const k of kids) k.parentNode = null; return kids; } n.remove(); return [n]; }
  appendChild(n) { for (const k of this._adopt(n)) { k.parentNode = this; this.childNodes.push(k); } return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new Text(n) : n); }
  prepend(...ns) { const f = this.firstChild; for (const n of ns) this.insertBefore(typeof n === 'string' ? new Text(n) : n, f); }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); const kids = this._adopt(n); const i = this.childNodes.indexOf(ref); for (const k of kids) k.parentNode = this; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, ...kids); return n; }
  removeChild(n) { n.remove(); return n; }
  replaceChild(n, old) { this.insertBefore(n, old); old.remove(); return old; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; if (v !== '' && v != null) this.appendChild(new Text(String(v))); }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  querySelectorAll(sel) { const out = []; const want = parseSelector(sel); const walk = (n) => { for (const c of n.childNodes) if (c.nodeType === 1) { if (want.some((cx) => matchComplex(c, cx, this))) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  getElementById(id) { return this.querySelector(`#${id}`); }
}
class Text extends Node {
  constructor(v = '') { super(); this.nodeType = 3; this.nodeName = '#text'; this.data = String(v); }
  get nodeValue() { return this.data; } set nodeValue(v) { this.data = String(v); }
  get textContent() { return this.data; } set textContent(v) { this.data = String(v); }
}
class Comment extends Node { constructor(v = '') { super(); this.nodeType = 8; this.data = v; } get textContent() { return ''; } }
class Fragment extends Node { constructor() { super(); this.nodeType = 11; this.nodeName = '#document-fragment'; } }

function styleDecl() {
  const props = new Map();
  const api = {
    setProperty(k, v) { if (v == null || v === '') props.delete(k); else props.set(k, String(v)); },
    getPropertyValue(k) { return props.get(k) ?? ''; },
    removeProperty(k) { const v = props.get(k) ?? ''; props.delete(k); return v; },
    get cssText() { return [...props].map(([k, v]) => `${k}:${v}`).join(';'); },
    set cssText(s) { props.clear(); for (const d of String(s).split(';')) { const i = d.indexOf(':'); if (i > 0) props.set(d.slice(0, i).trim(), d.slice(i + 1).trim()); } },
  };
  return new Proxy(api, {
    get(t, k) { if (k in t || typeof k === 'symbol') return t[k]; return props.get(kebab(k)) ?? ''; },
    set(t, k, v) { if (k === 'cssText') { t.cssText = v; return true; } if (v == null || v === '') props.delete(kebab(k)); else props.set(kebab(k), String(v)); return true; },
  });
}

function recorder2d(canvas) {
  const texts = (canvas.drawnText ??= []);
  // drawnAt: each text with its anchor and alignment; drawnArcs / drawnTranslates: the arcs' centres and radii and the
  // translations (where a glyph is drawn), for the layout tests (fixed width: 6 px a character)
  const at = (canvas.drawnAt ??= []), arcs = (canvas.drawnArcs ??= []), moves = (canvas.drawnTranslates ??= []);
  const base = { canvas, fillText: (s, x, y) => { texts.push(String(s)); at.push({ s: String(s), x, y, align: base.textAlign ?? 'start' }); }, strokeText: (s) => texts.push(String(s)),
    arc: (x, y, r) => { arcs.push([x, y, r]); }, translate: (x, y) => { moves.push([x, y]); }, measureText: (s) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createConicGradient: () => ({ addColorStop() {} }), createPattern: () => ({}),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), isPointInPath: () => false, getLineDash: () => [] };
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; return () => {}; }, set(t, k, v) { t[k] = v; return true; } });
}

class Element extends Node {
  constructor(tag, ns = null) {
    super(); this.nodeType = 1; this.localName = ns ? tag : tag.toLowerCase(); this.tagName = ns ? tag : tag.toUpperCase(); this.nodeName = this.tagName; this.namespaceURI = ns;
    this.attrs = new Map(); this.style = styleDecl(); this.scrollTop = 0; this.scrollLeft = 0;
    if (this.localName === 'canvas') { this.width = 300; this.height = 150; }
    const el = this;
    this.classList = {
      _get: () => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
      _set: (l) => el.setAttribute('class', l.join(' ')),
      add(...c) { const l = this._get(); for (const x of c) if (!l.includes(x)) l.push(x); this._set(l); },
      remove(...c) { this._set(this._get().filter((x) => !c.includes(x))); },
      toggle(c, on) { const has = this._get().includes(c), want = on === undefined ? !has : !!on; if (want) this.add(c); else this.remove(c); return want; },
      contains(c) { return this._get().includes(c); },
      replace(a, b) { if (!this.contains(a)) return false; this._set(this._get().map((x) => (x === a ? b : x))); return true; },
      get length() { return this._get().length; }, [Symbol.iterator]() { return this._get()[Symbol.iterator](); }, toString() { return this._get().join(' '); },
    };
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? el.getAttribute(`data-${kebab(k)}`) ?? undefined : undefined),
      set: (_, k, v) => { el.setAttribute(`data-${kebab(k)}`, String(v)); return true; },
      deleteProperty: (_, k) => { el.removeAttribute(`data-${kebab(k)}`); return true; },
      has: (_, k) => el.hasAttribute(`data-${kebab(k)}`),
      ownKeys: () => [...el.attrs.keys()].filter((a) => a.startsWith('data-')).map((a) => camel(a.slice(5))),
      getOwnPropertyDescriptor: (_, k) => (el.hasAttribute(`data-${kebab(k)}`) ? { value: el.getAttribute(`data-${kebab(k)}`), enumerable: true, configurable: true } : undefined),
    });
  }
  getAttribute(k) { return this.attrs.has(k.toLowerCase()) ? this.attrs.get(k.toLowerCase()) : null; }
  setAttribute(k, v) { this.attrs.set(k.toLowerCase(), String(v)); }
  removeAttribute(k) { this.attrs.delete(k.toLowerCase()); }
  hasAttribute(k) { return this.attrs.has(k.toLowerCase()); }
  toggleAttribute(k, on) { const want = on === undefined ? !this.hasAttribute(k) : !!on; if (want) this.setAttribute(k, ''); else this.removeAttribute(k); return want; }
  getAttributeNames() { return [...this.attrs.keys()]; }
  setAttributeNS(_, k, v) { this.setAttribute(k, v); }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  get id() { return this.getAttribute('id') ?? ''; } set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') ?? ''; } set className(v) { this.setAttribute('class', v); }
  get title() { return this.getAttribute('title') ?? ''; } set title(v) { this.setAttribute('title', v); }
  get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { this.toggleAttribute('hidden', !!v); }
  get disabled() { return this.hasAttribute('disabled'); } set disabled(v) { this.toggleAttribute('disabled', !!v); }
  get type() { return this.getAttribute('type') ?? ''; } set type(v) { this.setAttribute('type', v); }
  get tabIndex() { const v = this.getAttribute('tabindex'); return v == null ? -1 : +v; } set tabIndex(v) { this.setAttribute('tabindex', String(v)); }
  get href() { return this.getAttribute('href') ?? ''; } set href(v) { this.setAttribute('href', v); }
  get value() { return this._value ?? this.getAttribute('value') ?? ''; } set value(v) { this._value = String(v); }
  get checked() { return this._checked ?? this.hasAttribute('checked'); } set checked(v) { this._checked = !!v; }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(h) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; parseInto(this, String(h ?? '')); }
  get outerHTML() { return serialize(this); }
  get innerText() { return this.textContent; } set innerText(v) { this.textContent = v; }
  insertAdjacentHTML(pos, h) { const f = new Fragment(); parseInto(f, h); if (pos === 'beforeend') this.appendChild(f); else if (pos === 'afterbegin') this.insertBefore(f, this.firstChild); else if (pos === 'beforebegin') this.parentNode?.insertBefore(f, this); else if (pos === 'afterend') this.parentNode?.insertBefore(f, this.nextSibling); }
  insertAdjacentElement(pos, e) { if (pos === 'beforeend') this.appendChild(e); else if (pos === 'afterbegin') this.insertBefore(e, this.firstChild); else if (pos === 'beforebegin') this.parentNode?.insertBefore(e, this); else this.parentNode?.insertBefore(e, this.nextSibling); return e; }
  matches(sel) { return parseSelector(sel).some((cx) => matchComplex(this, cx, null)); }
  closest(sel) { const want = parseSelector(sel); for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (want.some((cx) => matchComplex(n, cx, null))) return n; return null; }
  click() { if (this.disabled) return; this.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); }
  focus() { DOC.active = this; } blur() { if (DOC.active === this) DOC.active = null; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return []; }
  get offsetWidth() { return 0; } get offsetHeight() { return 0; } get clientWidth() { return 0; } get clientHeight() { return 0; } get scrollWidth() { return 0; } get scrollHeight() { return 0; }
  get offsetParent() { return this.parentElement; }
  setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; } scrollIntoView() {} animate() { return { finished: Promise.resolve(), cancel() {} }; }
  getContext(kind) { return kind === '2d' ? (this._ctx ??= recorder2d(this)) : null; }
  toDataURL() { return 'data:,'; }
  play() { return Promise.resolve(); } pause() {} load() {}
}

// ---- HTML ----
function parseInto(root, html) {
  const stack = [root]; const top = () => stack.at(-1);
  let i = 0;
  const pushText = (s) => { if (s) top().appendChild(new Text(decode(s))); };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { pushText(html.slice(i)); break; }
    pushText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? html.length : e + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const e = html.indexOf('>', lt); i = e < 0 ? html.length : e + 1; continue; }
    if (html[lt + 1] === '/') {
      const e = html.indexOf('>', lt); const name = html.slice(lt + 2, e).trim().toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].localName.toLowerCase() === name) { stack.length = k; break; }
      i = e < 0 ? html.length : e + 1; continue;
    }
    if (!/[a-zA-Z]/.test(html[lt + 1] ?? '')) { pushText('<'); i = lt + 1; continue; }
    // a start tag: name, then attributes (quoted values may hold '>')
    let j = lt + 1; while (j < html.length && /[^\s/>]/.test(html[j])) j++;
    const name = html.slice(lt + 1, j);
    const inSvg = stack.some((n) => n.localName === 'svg') || name.toLowerCase() === 'svg';
    const el = new Element(inSvg ? name : name.toLowerCase(), inSvg ? 'http://www.w3.org/2000/svg' : null);
    let selfClose = false;
    for (;;) {
      while (j < html.length && /\s/.test(html[j])) j++;
      if (j >= html.length) break;
      if (html[j] === '>') { j++; break; }
      if (html[j] === '/' && html[j + 1] === '>') { selfClose = true; j += 2; break; }
      if (html[j] === '/') { j++; continue; }
      let k = j; while (k < html.length && /[^\s=/>]/.test(html[k])) k++;
      const an = html.slice(j, k); j = k;
      while (j < html.length && /\s/.test(html[j])) j++;
      let av = '';
      if (html[j] === '=') {
        j++; while (j < html.length && /\s/.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") { const e = html.indexOf(q, j + 1); av = html.slice(j + 1, e < 0 ? html.length : e); j = e < 0 ? html.length : e + 1; }
        else { let e = j; while (e < html.length && /[^\s>]/.test(html[e])) e++; av = html.slice(j, e); j = e; }
      }
      if (an) el.attrs.set(an.toLowerCase(), decode(av));
    }
    top().appendChild(el);
    i = j;
    const ln = el.localName.toLowerCase();
    if (RAW.has(ln) && !selfClose) {
      const e = html.toLowerCase().indexOf(`</${ln}`, i);
      const raw = html.slice(i, e < 0 ? html.length : e);
      if (raw) el.appendChild(new Text(ln === 'textarea' || ln === 'title' ? decode(raw) : raw));
      const close = e < 0 ? html.length : html.indexOf('>', e);
      i = close < 0 ? html.length : close + 1; continue;
    }
    if (!selfClose && !VOID.has(ln)) stack.push(el);
  }
}
function serialize(n) {
  if (n.nodeType === 3) return n.parentNode && RAW.has(n.parentNode.localName?.toLowerCase()) ? n.data : escText(n.data);
  if (n.nodeType === 8) return `<!--${n.data}-->`;
  if (n.nodeType === 11) return n.childNodes.map(serialize).join('');
  const a = [...n.attrs].map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  if (VOID.has(n.localName)) return `<${n.localName}${a}>`;
  return `<${n.localName}${a}>${n.childNodes.map(serialize).join('')}</${n.localName}>`;
}

// ---- selectors ----
function splitTop(s, sep) {   // split on sep outside () and []
  const out = []; let d = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') d--;
    if (d === 0 && sep(ch)) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur); return out;
}
const CACHE = new Map();
function parseSelector(sel) {
  if (CACHE.has(sel)) return CACHE.get(sel);
  const list = splitTop(sel, (c) => c === ',').map((s) => s.trim()).filter(Boolean).map((cx) => {
    // tokens: compounds and combinators
    const parts = []; let cur = '', d = 0, q = null;
    const flush = () => { if (cur.trim()) parts.push({ c: parseCompound(cur.trim()) }); cur = ''; };
    for (const ch of cx) {
      if (q) { cur += ch; if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') d--;
      if (d === 0 && (ch === '>' || ch === '+' || ch === '~')) { flush(); parts.push({ comb: ch }); continue; }
      if (d === 0 && /\s/.test(ch)) { flush(); continue; }
      cur += ch;
    }
    flush();
    // normalise: between two compounds with no combinator, a descendant one
    const seq = []; for (const p of parts) { if (p.c && seq.length && seq.at(-1).c) seq.push({ comb: ' ' }); seq.push(p); }
    return seq;
  });
  CACHE.set(sel, list); return list;
}
function parseCompound(s) {
  const c = { tag: null, id: null, cls: [], attrs: [], not: [], scope: false };
  let i = 0;
  const ident = () => { let j = i; while (j < s.length && /[\w-]/.test(s[j])) j++; const v = s.slice(i, j); i = j; return v; };
  if (s[0] === '*') i = 1; else if (/[a-zA-Z]/.test(s[0])) c.tag = ident().toLowerCase();
  while (i < s.length) {
    const ch = s[i];
    if (ch === '#') { i++; c.id = ident(); }
    else if (ch === '.') { i++; c.cls.push(ident()); }
    else if (ch === '[') {
      const e = s.indexOf(']', i); const body = s.slice(i + 1, e); i = e + 1;
      const m = body.match(/^\s*([\w-]+)\s*(?:([\^$*~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?\s*$/);
      if (m) c.attrs.push({ name: m[1].toLowerCase(), op: m[2] ?? null, v: m[3] ?? m[4] ?? m[5] ?? '' });
    } else if (ch === ':') {
      i++; const name = ident();
      if (s[i] === '(') { let d = 1, j = i + 1; while (j < s.length && d) { if (s[j] === '(') d++; else if (s[j] === ')') d--; j++; } const arg = s.slice(i + 1, j - 1); i = j; if (name === 'not') c.not.push(parseSelector(arg)); }
      else if (name === 'scope') c.scope = true;
    } else i++;
  }
  return c;
}
function matchCompound(el, c, scope) {
  if (c.scope) return el === scope;
  if (c.tag && el.localName.toLowerCase() !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  if (c.cls.length) { const l = el.classList._get(); if (!c.cls.every((x) => l.includes(x))) return false; }
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name); if (v == null) return false;
    if (a.op === '=' && v !== a.v) return false;
    if (a.op === '^=' && !v.startsWith(a.v)) return false;
    if (a.op === '$=' && !v.endsWith(a.v)) return false;
    if (a.op === '*=' && !v.includes(a.v)) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.v)) return false;
  }
  for (const n of c.not) if (n.some((cx) => matchComplex(el, cx, scope))) return false;
  return true;
}
function matchComplex(el, seq, scope, k = seq.length - 1) {
  if (!matchCompound(el, seq[k].c, scope)) return false;
  if (k === 0) return true;
  const comb = seq[k - 1].comb;
  if (comb === '>') { const p = el.parentNode; return !!p && p.nodeType === 1 && matchComplex(p, seq, scope, k - 2); }
  if (comb === '+') { let p = el.previousSibling; while (p && p.nodeType !== 1) p = p.previousSibling; return !!p && matchComplex(p, seq, scope, k - 2); }
  if (comb === '~') { for (let p = el.previousSibling; p; p = p.previousSibling) if (p.nodeType === 1 && matchComplex(p, seq, scope, k - 2)) return true; return false; }
  for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) if (matchComplex(p, seq, scope, k - 2)) return true;
  return false;
}

// ---- the document and the window ----
const DOC = { current: null, active: null };
class Document extends Node {
  constructor() {
    super(); this.nodeType = 9;
    this.documentElement = new Element('html'); this.appendChild(this.documentElement);
    this.head = new Element('head'); this.body = new Element('body');
    this.documentElement.appendChild(this.head); this.documentElement.appendChild(this.body);
    this.fonts = { ready: Promise.resolve(), load: () => Promise.resolve([]), check: () => true, addEventListener() {} };
    this.visibilityState = 'visible'; this.hidden = false;
  }
  get activeElement() { return DOC.active ?? this.body; }
  get fullscreenElement() { return null; }
  createElement(t) { return new Element(t); }
  createElementNS(ns, t) { return new Element(t, ns); }
  createTextNode(v) { return new Text(v); }
  createComment(v) { return new Comment(v); }
  createDocumentFragment() { return new Fragment(); }
  elementFromPoint() { return null; }
}

const GLOBALS = ['document', 'window', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'WheelEvent',
  'getComputedStyle', 'matchMedia', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'location', 'HTMLElement', 'Element', 'Node', 'OffscreenCanvas', 'ResizeObserver', 'localStorage', 'sessionStorage', '__lakeshore'];

// installDom(): a fresh document on globalThis (every call starts clean: no <style>, no listeners); returns the helpers
export function installDom({ search = '', width = 1280, height = 720, lakeshore = {} } = {}) {
  const saved = {}; for (const k of GLOBALS) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const doc = new Document(); DOC.current = doc; DOC.active = null;
  Object.defineProperty(doc.documentElement, 'clientWidth', { get: () => width }); Object.defineProperty(doc.documentElement, 'clientHeight', { get: () => height });
  globalThis[LISTEN] = new Map();
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true, enumerable: true });
  def('document', doc); def('window', globalThis);
  def('addEventListener', (t, f, o) => addL(globalThis, t, f, o)); def('removeEventListener', (t, f, o) => removeL(globalThis, t, f, o)); def('dispatchEvent', (e) => dispatch(globalThis, e));
  def('requestAnimationFrame', (f) => { f(0); return 0; }); def('cancelAnimationFrame', () => {});
  def('KeyboardEvent', KeyboardEvent); def('MouseEvent', MouseEvent); def('PointerEvent', PointerEvent); def('WheelEvent', WheelEvent);
  def('getComputedStyle', (el) => (el?.style ? new Proxy({}, { get: (_, k) => (k === 'getPropertyValue' ? (p) => el.style.getPropertyValue(p) : el.style[k] ?? '') }) : { getPropertyValue: () => '' }));
  def('matchMedia', (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  def('innerWidth', width); def('innerHeight', height); def('devicePixelRatio', 1);
  def('location', { search, href: `http://lakeshore.test/${search}`, pathname: '/', hash: '', host: 'lakeshore.test', origin: 'http://lakeshore.test' });
  def('HTMLElement', Element); def('Element', Element); def('Node', Node); def('OffscreenCanvas', undefined); def('ResizeObserver', undefined);
  def('localStorage', undefined); def('sessionStorage', undefined);
  def('__lakeshore', lakeshore);
  return {
    doc,
    // every injected stylesheet's text (the module's own CSS: what the page would apply)
    styles: () => doc.querySelectorAll('style').map((s) => s.textContent).join('\n'),
    style: (id) => doc.getElementById(id)?.textContent ?? '',
    // the words a reader sees (tags gone, entities decoded, spaces collapsed)
    text: (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    key: (code, down = true, extra = {}) => dispatch(globalThis, new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code.replace(/^Key|^Digit/, ''), ...extra })),
    uninstall() { for (const k of GLOBALS) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; } DOC.current = null; },
  };
}
// a Map-backed Storage
export const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), m }; };
