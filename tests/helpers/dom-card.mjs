// A small DOM for the node tests of the cards (home.js, loading.js): enough HTML to parse the loading shell and the
// pages, CSS selectors (tag, #id, .class, [attr], [attr=v|^=|$=|*=], :not(), descendant and child), events with a
// capture and a bubble phase through the parents to document and window, MutationObserver on attributes, focus.
// Not a browser: no layout (every box is 10 x 10 at 0,0), no CSS cascade.
//   const D = installDom({ body: '<div id="x">…</div>' });   // sets document, window (= globalThis), the window listeners
//   D.fire(el, 'click'); D.key('Escape'); D.press(el);       // events; each returns the event (stopped, prevented)
//   await D.settle();                                         // microtasks (observers) and one event-loop turn
import { readFileSync } from 'node:fs';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// ---- events ----
export function makeEvent(type, props = {}) {
  const ev = { type, bubbles: true, stopped: false, immediate: false, prevented: false, ...props };
  ev.stopPropagation = () => { ev.stopped = true; };
  ev.stopImmediatePropagation = () => { ev.stopped = true; ev.immediate = true; };
  ev.preventDefault = () => { ev.prevented = true; };
  Object.defineProperty(ev, 'defaultPrevented', { get: () => ev.prevented });
  return ev;
}
class Target {
  constructor() { this._ls = []; }
  addEventListener(type, fn, o) { if (!fn) return; const capture = typeof o === 'boolean' ? o : !!o?.capture; if (this._ls.some((l) => l.type === type && l.fn === fn && l.capture === capture)) return; this._ls.push({ type, fn, capture, once: !!o?.once }); }
  removeEventListener(type, fn, o) { const capture = typeof o === 'boolean' ? o : !!o?.capture; this._ls = this._ls.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture)); }
  dispatchEvent(ev) { return dispatch(this, ev); }
}
function adopt(ev) {   // a native Event (new Event / CustomEvent from the code under test): give it our flags
  if ('immediate' in ev) return ev;
  const flags = { stopped: false, immediate: false, prevented: false };
  Object.defineProperties(ev, {
    stopped: { get: () => flags.stopped, configurable: true }, immediate: { get: () => flags.immediate, configurable: true }, prevented: { get: () => flags.prevented, configurable: true },
    stopPropagation: { value: () => { flags.stopped = true; }, configurable: true },
    stopImmediatePropagation: { value: () => { flags.stopped = flags.immediate = true; }, configurable: true },
    preventDefault: { value: () => { flags.prevented = true; }, configurable: true },
  });
  return ev;
}
function run(node, ev, phase) {
  for (const l of [...node._ls]) {
    if (l.type !== ev.type) continue;
    if (phase === 'capture' && !l.capture) continue;
    if (phase === 'bubble' && l.capture) continue;
    if (!node._ls.includes(l)) continue;
    if (l.once) node.removeEventListener(l.type, l.fn, l.capture);
    Object.defineProperty(ev, 'currentTarget', { value: node, configurable: true });
    l.fn.call(node, ev);
    if (ev.immediate) return;
  }
}
function dispatch(target, ev) {
  ev = adopt(ev);
  const given = Object.prototype.hasOwnProperty.call(ev, 'target') ? ev.target : null;   // a test may name the target of a window event
  Object.defineProperty(ev, 'target', { value: given ?? target, configurable: true, writable: true });
  const path = [];
  if (target === D?.window) path.push(target);
  else if (target === D?.document) path.push(target, D.window);
  else {
    for (let n = target; n; n = n.parentNode) path.push(n);
    if (path.at(-1) === D?.document.documentElement) path.push(D.document, D.window);   // attached: up to window; a detached tree stops at its root
  }
  for (let i = path.length - 1; i > 0; i--) { run(path[i], ev, 'capture'); if (ev.stopped) return !ev.prevented; }
  run(path[0], ev, 'target'); if (ev.stopped) return !ev.prevented;
  if (ev.bubbles !== false) for (let i = 1; i < path.length; i++) { run(path[i], ev, 'bubble'); if (ev.stopped) break; }
  return !ev.prevented;
}

// ---- nodes ----
class Text { constructor(t) { this.nodeType = 3; this.data = t; this.parentNode = null; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } remove() { this.parentNode?._drop(this); } }
let observers = [];
class Element extends Target {
  constructor(tag, doc) {
    super(); this.nodeType = 1; this.localName = tag.toLowerCase(); this.tagName = tag.toUpperCase(); this._doc = doc; this.parentNode = null; this.childNodes = []; this._attrs = new Map();
    this.style = makeStyle(); this._value = null; this._checked = null;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? this.getAttribute('data-' + kebab(k)) ?? undefined : undefined),
      set: (_, k, v) => { this.setAttribute('data-' + kebab(k), String(v)); return true; },
      deleteProperty: (_, k) => { this.removeAttribute('data-' + kebab(k)); return true; },
      has: (_, k) => this.hasAttribute('data-' + kebab(k)),
      ownKeys: () => [...this._attrs.keys()].filter((a) => a.startsWith('data-')).map((a) => camel(a.slice(5))),
      getOwnPropertyDescriptor: (_, k) => (this.hasAttribute('data-' + kebab(k)) ? { value: this.getAttribute('data-' + kebab(k)), enumerable: true, configurable: true } : undefined),
    });
    const el = this;
    let clsStr = null, clsList = [];
    this.classList = {
      get _l() { const c = el._attrs.get('class') ?? ''; if (c !== clsStr) { clsStr = c; clsList = c.split(/\s+/).filter(Boolean); } return clsList; },
      add(...c) { el.setAttribute('class', [...new Set([...this._l, ...c])].join(' ')); },
      remove(...c) { el.setAttribute('class', this._l.filter((x) => !c.includes(x)).join(' ')); },
      toggle(c, on) { const has = this._l.includes(c); const want = on ?? !has; if (want) this.add(c); else this.remove(c); return want; },
      contains(c) { return this._l.includes(c); },
      [Symbol.iterator]() { return this._l[Symbol.iterator](); },
    };
  }
  get ownerDocument() { return this._doc; }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] ?? null; }
  getAttribute(a) { return this._attrs.has(a) ? this._attrs.get(a) : null; }
  hasAttribute(a) { return this._attrs.has(a); }
  setAttribute(a, v) { const old = this.getAttribute(a); this._attrs.set(a, String(v)); notify(this, a, old); }
  removeAttribute(a) { if (!this._attrs.has(a)) return; const old = this.getAttribute(a); this._attrs.delete(a); notify(this, a, old); }
  toggleAttribute(a, on) { const want = on ?? !this.hasAttribute(a); if (want) this.setAttribute(a, ''); else this.removeAttribute(a); return want; }
  getAttributeNames() { return [...this._attrs.keys()]; }
  get id() { return this.getAttribute('id') ?? ''; } set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') ?? ''; } set className(v) { this.setAttribute('class', v); }
  get title() { return this.getAttribute('title') ?? ''; } set title(v) { this.setAttribute('title', v); }
  get type() { return this.getAttribute('type') ?? ''; } set type(v) { this.setAttribute('type', v); }
  get href() { return this.getAttribute('href') ?? ''; } set href(v) { this.setAttribute('href', v); }
  get name() { return this.getAttribute('name') ?? ''; } set name(v) { this.setAttribute('name', v); }
  get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { this.toggleAttribute('hidden', !!v); }
  get disabled() { return this.hasAttribute('disabled'); } set disabled(v) { this.toggleAttribute('disabled', !!v); }
  get inert() { return this.hasAttribute('inert'); } set inert(v) { this.toggleAttribute('inert', !!v); }
  get value() { return this._value ?? (this.localName === 'textarea' ? this.textContent : this.getAttribute('value') ?? ''); } set value(v) { this._value = String(v); }
  get checked() { return this._checked ?? this.hasAttribute('checked'); } set checked(v) { this._checked = !!v; }
  get textContent() { return this.childNodes.map((n) => (n.nodeType === 3 ? n.data : n.textContent)).join(''); }
  set textContent(v) { this._clear(); if (v !== '' && v != null) this._add(new Text(String(v))); }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(h) { this._clear(); for (const n of parse(String(h), this._doc)) this._add(n); }
  get outerHTML() { return serialize(this); }
  _clear() { for (const n of this.childNodes) n.parentNode = null; this.childNodes = []; }
  _add(n, at = this.childNodes.length) { if (typeof n === 'string') n = new Text(n); n.parentNode?._drop(n); n.parentNode = this; this.childNodes.splice(at, 0, n); return n; }
  _drop(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; }
  appendChild(n) { return this._add(n); }
  append(...ns) { for (const n of ns) this._add(n); }
  prepend(...ns) { ns.reverse().forEach((n) => this._add(n, 0)); }
  insertBefore(n, ref) { const i = ref ? this.childNodes.indexOf(ref) : -1; return this._add(n, i < 0 ? this.childNodes.length : i); }
  removeChild(n) { this._drop(n); return n; }
  remove() { this.parentNode?._drop(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  matches(sel) { return compile(sel)(this); }
  closest(sel) { const m = compile(sel); for (let x = this; x?.nodeType === 1; x = x.parentNode) if (m(x)) return x; return null; }
  querySelectorAll(sel) { const m = compile(sel), out = []; const walk = (e) => { for (const c of e.childNodes) { if (c.nodeType !== 1) continue; if (m(c)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10, x: 0, y: 0 }; }
  focus() { this._doc._active = this; }
  blur() { if (this._doc._active === this) this._doc._active = null; }
  click() { return dispatch(this, makeEvent('click')); }
}
function makeStyle() {
  const props = {};
  return new Proxy(props, { get: (o, k) => (k === 'setProperty' ? (n, v) => { o[n] = String(v); } : k === 'getPropertyValue' ? (n) => o[n] ?? '' : k === 'removeProperty' ? (n) => { delete o[n]; } : o[k] ?? ''), set: (o, k, v) => { o[k] = String(v); return true; } });
}
function notify(el, name, oldValue) {
  for (const o of observers) {
    if (o.target !== el || !o.opts.attributes) continue;
    if (o.opts.attributeFilter && !o.opts.attributeFilter.includes(name)) continue;
    o.records.push({ type: 'attributes', target: el, attributeName: name, oldValue });
    if (!o.queued) { o.queued = true; queueMicrotask(() => { o.queued = false; const r = o.records; o.records = []; if (r.length && observers.includes(o)) o.fn(r, o.self); }); }
  }
}
class MutationObserverStub {
  constructor(fn) { this.fn = fn; }
  observe(target, opts = {}) { observers.push({ self: this, fn: this.fn, target, opts, records: [], queued: false }); }
  disconnect() { observers = observers.filter((o) => o.self !== this); }
  takeRecords() { return []; }
}

// ---- parse and serialize ----
const TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
export function parse(html, doc) {
  const top = []; const stack = [];
  const add = (n) => { if (stack.length) stack.at(-1)._add(n); else top.push(n); };
  TOKEN.lastIndex = 0; let m;
  while ((m = TOKEN.exec(html))) {
    const [tok, close, open, attrs, selfClose] = m;
    if (tok.startsWith('<!')) continue;
    if (close) { const t = close.toLowerCase(); const i = stack.map((e) => e.localName).lastIndexOf(t); if (i >= 0) stack.length = i; continue; }
    if (open) {
      const el = new Element(open, doc);
      for (const a of (attrs ?? '').matchAll(ATTR)) el._attrs.set(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
      add(el);
      const t = el.localName;
      if (RAW.has(t)) {
        const end = html.toLowerCase().indexOf(`</${t}`, TOKEN.lastIndex);
        const body = html.slice(TOKEN.lastIndex, end < 0 ? html.length : end);
        if (body) el._add(new Text(t === 'textarea' || t === 'title' ? decode(body) : body));
        TOKEN.lastIndex = end < 0 ? html.length : html.indexOf('>', end) + 1;
        continue;
      }
      if (!selfClose && !VOID.has(t)) stack.push(el);
      continue;
    }
    add(new Text(decode(tok)));
  }
  return top;
}
function serialize(n) {
  if (n.nodeType === 3) return n.parentNode && RAW.has(n.parentNode.localName) ? n.data : escText(n.data);
  const attrs = [...n._attrs].map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escAttr(v)}"`)).join('');
  if (VOID.has(n.localName)) return `<${n.localName}${attrs}>`;
  return `<${n.localName}${attrs}>${n.childNodes.map(serialize).join('')}</${n.localName}>`;
}

// ---- selectors ----
const cache = new Map();
function splitTop(s, sep) {   // split on sep outside brackets and parens
  const out = []; let depth = 0, q = null, cur = '';
  for (const c of s) {
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '(') depth++;
    if (c === ']' || c === ')') depth--;
    if (c === sep && !depth) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out.map((x) => x.trim()).filter(Boolean);
}
const SIMPLE = /^(?:(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]|:not\(((?:[^()]|\([^()]*\))*)\))/;
function compound(s) {
  const tests = [];
  while (s.length) {
    const m = s.match(SIMPLE); if (!m) throw new Error(`A-dom: selector not supported: ${s}`);
    s = s.slice(m[0].length);
    if (m[1] && m[1] !== '*') { const t = m[1].toLowerCase(); tests.push((e) => e.localName === t); }
    else if (m[2]) { const id = m[2]; tests.push((e) => e.getAttribute('id') === id); }
    else if (m[3]) { const c = m[3]; tests.push((e) => e.classList.contains(c)); }
    else if (m[4]) {
      const a = m[4], op = m[5], v = m[6] ?? m[7] ?? m[8];
      tests.push((e) => {
        const x = e.getAttribute(a); if (x == null) return false; if (!op) return true;
        return op === '=' ? x === v : op === '^=' ? x.startsWith(v) : op === '$=' ? x.endsWith(v) : op === '*=' ? x.includes(v) : op === '~=' ? x.split(/\s+/).includes(v) : x === v || x.startsWith(v + '-');
      });
    } else if (m[9] != null) { const inner = compile(m[9]); tests.push((e) => !inner(e)); }
  }
  return (e) => tests.every((t) => t(e));
}
function complex(s) {
  const parts = s.replace(/\s*>\s*/g, ' > ').split(/\s+/);
  const seq = [];   // [matcher, combinator to the left]
  for (let i = parts.length - 1; i >= 0; i--) { if (parts[i] === '>') continue; seq.push({ m: compound(parts[i]), comb: parts[i - 1] === '>' ? '>' : ' ' }); }
  const match = (e, k) => {
    if (!seq[k].m(e)) return false;
    if (k === seq.length - 1) return true;
    if (seq[k].comb === '>') { const p = e.parentElement; return !!p && match(p, k + 1); }
    for (let p = e.parentElement; p; p = p.parentElement) if (match(p, k + 1)) return true;
    return false;
  };
  return (e) => match(e, 0);
}
export function compile(sel) {
  let f = cache.get(sel);
  if (!f) { const list = splitTop(sel, ',').map(complex); f = (e) => list.some((m) => m(e)); cache.set(sel, f); }
  return f;
}

// ---- the document and the window ----
let D = null;
class Doc extends Target {
  constructor() {
    super(); this.nodeType = 9; this._active = null;
    this.documentElement = new Element('html', this); this.head = new Element('head', this); this.body = new Element('body', this);
    this.documentElement._add(this.head); this.documentElement._add(this.body);
    this.fullscreenElement = null; this.visibilityState = 'visible';
  }
  get parentNode() { return null; }
  get activeElement() { return this._active ?? this.body; }
  createElement(t) { return new Element(t, this); }
  createTextNode(t) { return new Text(t); }
  getElementById(id) { return this.documentElement.querySelector(`#${id}`); }
  querySelector(s) { return this.documentElement.querySelector(s); }
  querySelectorAll(s) { return this.documentElement.querySelectorAll(s); }
  contains(n) { return this.documentElement.contains(n); }
}

// The loading shell's body block from index.html (the card markup as the page ships it)
export function shellBody(root = new URL('../../', import.meta.url)) {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  return html.match(/<!-- lk-load:body -->([\s\S]*?)<!-- lk-load:body:end -->/)[1];
}

export function installDom({ body = '', search = '', htmlClass = '' } = {}) {
  observers = [];
  const document = new Doc();
  const window = new Target();
  D = { document, window };
  const g = globalThis;
  g.window = g; g.document = document;
  g.addEventListener = window.addEventListener.bind(window); g.removeEventListener = window.removeEventListener.bind(window); g.dispatchEvent = (ev) => dispatch(window, ev);
  g.MutationObserver = MutationObserverStub;
  g.getComputedStyle = (el) => ({ visibility: 'visible', display: 'block', getPropertyValue: (k) => el.style.getPropertyValue(k) });
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.location = { search, pathname: '/', hash: '', hostname: 'localhost' };
  const frames = [];
  g.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
  g.cancelAnimationFrame = (id) => { if (frames[id - 1]) frames[id - 1] = null; };
  if (htmlClass) document.documentElement.setAttribute('class', htmlClass);
  document.body.innerHTML = body;
  const keyEv = (code, extra = {}) => makeEvent(extra.type ?? 'keydown', { code, key: extra.key ?? code, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
  return {
    document, window,
    fire: (target, type, props = {}) => { const ev = makeEvent(type, props); dispatch(target, ev); return ev; },
    // a key on the focused element (or the body), as the browser sends it: keydown then keyup
    key: (code, extra = {}) => { const t = extra.target ?? document.activeElement; const ev = keyEv(code, extra); dispatch(t, ev); return ev; },
    // a press: pointerdown, mousedown, pointerup, mouseup, click on one element; returns the events
    press: (el) => ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].map((t) => { const ev = makeEvent(t); dispatch(el, ev); return ev; }),
    // run the animation frames queued so far (at time t, ms)
    frame: (t = 0) => { const fs = frames.splice(0); for (const f of fs) f?.(t); return fs.length; },
    settle: (ms = 0) => new Promise((r) => (ms ? setTimeout(r, ms) : setImmediate(r))),   // 0: the microtasks (observers) and one turn
  };
}
