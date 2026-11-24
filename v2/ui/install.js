// The Home Screen launch, first-class (owner 2026-11-16). A browser tab on a phone loses about a fifth of its
// height to the bars; from the Home Screen Velia gets the whole screen (index.html: the manifest, the iPhone's tags).
//   - Android (and any browser that sends beforeinstallprompt): the browser's own install dialog, kept for our "Install" button.
//   - iPhone (Apple has no install prompt): a small card with a picture of the steps, pointing at the player's own browser's
//     Share button: "For full screen: tap Share, then Add to Home Screen."
//   - when the card asks (cardDue): never on the first visit; once on a later visit, CARD.firstS into sailing; once more on a
//     visit after that, after CARD.againS (a few minutes) of sailing; never more than CARD.max times; always "Not now"; never
//     when launched from the Home Screen; only on a phone, only while sailing (Sail or Cruise, the controls showing: no page,
//     no race).
//   - the Menu card's foot keeps an "Add to Home Screen" row on a phone (not in the Home Screen app): Android's dialog, else
//     the card.
// The record: localStorage 'velia.install.v1' { visits, lastAt, shown, shownVisit } (a visit: a load CARD.visitGapMin after the
// last; a private window keeps nothing and never asks). ?install=ios|android shows that card at once (page tests, stills);
// ?install=0 never asks. A test reads window.__veliaInstall.
import { profileFor } from '../../src/core/profile.js';
export const CARD = Object.freeze({ firstS: 20, againS: 180, max: 2, visitGapMin: 30, key: 'velia.install.v1' });
const IOS_LINE = 'For full screen: tap Share, then Add to Home Screen.';
const ANDROID_LINE = 'Install Velia for full screen, from your Home Screen.';
const OTHER_LINE = 'For full screen: open your browser’s menu, then Add to Home Screen.';
const ROW_WORD = 'Add to Home Screen';

// the record (pure): a stored text → a clean record
export function readRecord(text) {
  let o = null;
  try { o = JSON.parse(text ?? 'null'); } catch { o = null; }
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { visits: n(o?.visits), lastAt: Number.isFinite(o?.lastAt) ? o.lastAt : 0, shown: n(o?.shown), shownVisit: n(o?.shownVisit) };
}
// a page load (pure): a new visit when CARD.visitGapMin has passed since the last time the page was open
export function onLoad(rec, now) {
  const gap = CARD.visitGapMin * 60e3;
  const visits = !rec.visits || now - rec.lastAt > gap ? rec.visits + 1 : rec.visits;
  return { ...rec, visits, lastAt: now };
}
// is the card due now (pure)? sailedS: this page's seconds of sailing
export function cardDue({ rec, sailedS = 0, standalone = false, platform = null }) {
  if (standalone || !platform) return false;
  if (rec.shown >= CARD.max) return false;
  if (rec.visits < 2) return false;                            // never on the first visit
  if (rec.shown > 0 && rec.shownVisit >= rec.visits) return false;   // once a visit at most
  return sailedS >= (rec.shown === 0 ? CARD.firstS : CARD.againS);
}
export const onShown = (rec) => ({ ...rec, shown: rec.shown + 1, shownVisit: rec.visits });
// which card (pure): 'android' with the browser's dialog in hand, 'ios' on an iPhone, 'other' on another phone, null elsewhere
export function platformOf({ ua = '', phone = false, standalone = false, prompt = false }) {
  if (standalone || !phone) return null;
  if (prompt) return 'android';
  if (/iPhone|iPod/.test(ua)) return 'ios';
  return 'other';
}
// where the player's browser keeps its Share button, in the page's own (layout) frame (pure): 'top' (Safari or Chrome sideways:
// the top bar's right end), 'right' (Safari upright: its bottom toolbar is the turned page's right edge), 'left' (Chrome on an
// upright iPhone: its top bar is the turned page's left edge)
export function shareSpot({ ua = '', rotated = false }) {
  if (!rotated) return 'top';
  return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'left' : 'right';
}

// the picture: the Share button, then the Add to Home Screen row (cream line icons on the navy glass)
const SHARE = '<path d="M12 3v11M8 7l4-4 4 4"/><path d="M7 10H5.5v10h13V10H17"/>';
const PLUS = '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>';
const ico = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const PIC_IOS = `<div class="steps" aria-hidden="true"><span class="st"><span class="key">${ico(SHARE)}</span><span>Share</span></span><span class="to">›</span>`
  + `<span class="st"><span class="row">${ico(PLUS)}<span>Add to Home Screen</span></span></span></div>`;

const CSS = `
.lk-a2hs-card{position:fixed;z-index:2147482600;box-sizing:border-box;width:min(330px,calc(100vw - 32px));padding:14px 16px 12px;border-radius:18px;
  background:rgb(var(--lk-brand-navy,28 35 64) / .94);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);border:var(--lk-line,1px) solid var(--lk-glass-edge,rgb(239 230 210 / .3));
  box-shadow:0 8px 28px rgb(0 0 0 / .45);color:var(--lk-ink,#EFE6D2);font:var(--lk-regular,400) 15px/1.35 var(--lk-ui,system-ui);letter-spacing:var(--lk-track,.04em);
  -webkit-font-smoothing:antialiased;pointer-events:auto;touch-action:manipulation;opacity:0;transform:translateY(-6px);transition:opacity .3s ease,transform .3s ease}
.lk-a2hs-card.on{opacity:1;transform:none}
.lk-a2hs-card[data-spot=top]{top:calc(var(--lk-cap-top,62px) + 10px);right:max(16px,var(--lk-sar,0px))}
.lk-a2hs-card[data-spot=right]{top:calc(50% - 90px);right:max(16px,var(--lk-sar,0px))}
.lk-a2hs-card[data-spot=left]{top:calc(50% - 90px);left:max(16px,var(--lk-sal,0px))}
.lk-a2hs-card .pt{position:absolute;width:14px;height:14px;background:inherit;border:inherit;border-width:var(--lk-line,1px) 0 0 var(--lk-line,1px);transform:rotate(45deg)}
.lk-a2hs-card[data-spot=top] .pt{top:-8px;right:34px}
.lk-a2hs-card[data-spot=right] .pt{right:-8px;top:40px;transform:rotate(135deg)}
.lk-a2hs-card[data-spot=left] .pt{left:-8px;top:40px;transform:rotate(-45deg)}
.lk-a2hs-card h3{margin:0 0 8px;font:var(--lk-medium,500) 12px/1.2 var(--lk-ui,system-ui);letter-spacing:.16em;text-transform:uppercase;opacity:.75}
.lk-a2hs-card p{margin:8px 0 10px}
.lk-a2hs-card .steps{display:flex;align-items:center;gap:8px;white-space:nowrap}
.lk-a2hs-card .st{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:13px;opacity:.95}
.lk-a2hs-card .key{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:rgb(var(--lk-cream,239 230 210) / .12);box-shadow:inset 0 0 0 1px rgb(var(--lk-cream,239 230 210) / .35)}
.lk-a2hs-card .row{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border-radius:10px;background:rgb(var(--lk-cream,239 230 210) / .12);box-shadow:inset 0 0 0 1px rgb(var(--lk-cream,239 230 210) / .35);font-size:14px}
.lk-a2hs-card .to{font-size:20px;opacity:.6;margin-bottom:16px}
.lk-a2hs-card svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.lk-a2hs-card .bs{display:flex;justify-content:flex-end;gap:8px}
.lk-a2hs-card button{all:unset;box-sizing:border-box;min-width:44px;height:44px;padding:0 16px;border-radius:22px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:inset 0 0 0 var(--lk-line,1px) var(--lk-glass-edge,rgb(239 230 210 / .3));font:var(--lk-medium,500) 15px/1 var(--lk-ui,system-ui);letter-spacing:var(--lk-track,.04em);color:inherit;-webkit-tap-highlight-color:transparent}
.lk-a2hs-card button.go{background:rgb(var(--lk-cream,239 230 210) / .92);color:rgb(var(--lk-brand-navy,28 35 64))}
.lk-a2hs-card button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
#lk-load .lk-foot .lk-a2hs{display:none!important}
html[data-screen~=compact]:not(.lk-standalone) #lk-load[data-state=menu] .lk-foot .lk-a2hs{all:unset;box-sizing:border-box;display:inline-flex!important;align-items:center;gap:.4em;min-height:44px;padding:0 .3em;cursor:pointer;
  color:inherit;font:inherit;letter-spacing:inherit;-webkit-tap-highlight-color:transparent;white-space:nowrap}
html[data-screen~=compact]:not(.lk-standalone) #lk-load[data-state=menu] .lk-foot .lk-a2hs svg{width:1.25em;height:1.25em;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
@media (prefers-reduced-motion:reduce){.lk-a2hs-card{transition:none;transform:none}}
`;

let installed = null;

export function installHomeScreen({ win = globalThis, doc = globalThis.document, flag = null, now = () => Date.now() } = {}) {
  if (installed) return installed;
  if (!doc?.documentElement || !win) return null;
  const H = doc.documentElement;
  let deferred = null, card = null, sailedS = 0, ticks = 0, timer = null;
  const store = (() => { try { return win.localStorage ?? null; } catch { return null; } })();
  const read = () => { try { return readRecord(store?.getItem(CARD.key)); } catch { return readRecord(null); } };
  const write = (r) => { try { store?.setItem(CARD.key, JSON.stringify(r)); } catch { /* private window: nothing kept */ } };
  const standalone = () => !!win.__veliaScreen?.standalone?.() || (() => { try { return win.navigator?.standalone === true || !!win.matchMedia?.('(display-mode: standalone)')?.matches || !!win.matchMedia?.('(display-mode: fullscreen)')?.matches; } catch { return false; } })();
  const phone = () => { const p = profileFor(win); return p.form === 'phone' || p.screen !== 'full'; };   // the device profile (src/core/profile.js): a phone, or a phone-sized layout
  const ua = () => win.navigator?.userAgent ?? '';
  const platform = () => platformOf({ ua: ua(), phone: phone(), standalone: standalone(), prompt: !!deferred });

  // the visit: counted once per load (a private window has no record and so never a later visit)
  let rec = store ? onLoad(read(), now()) : readRecord(null);
  if (store) write(rec);

  win.addEventListener?.('beforeinstallprompt', (e) => { e.preventDefault?.(); deferred = e; });
  win.addEventListener?.('appinstalled', () => { deferred = null; hide(); });

  function hide() { if (!card) return; const c = card; card = null; c.classList.remove('on'); setTimeout(() => c.remove(), 320); }
  function show(kind, { counted = true } = {}) {
    if (card || !kind) return false;
    if (!doc.getElementById('lk-a2hs-css')) { const st = doc.createElement('style'); st.id = 'lk-a2hs-css'; st.textContent = CSS; doc.head.appendChild(st); }
    card = doc.createElement('div');
    card.className = 'lk-a2hs-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Full screen');
    card.dataset.kind = kind;
    card.dataset.spot = kind === 'ios' ? shareSpot({ ua: ua(), rotated: !!win.__veliaTurn?.rotated?.() }) : 'top';
    const line = kind === 'ios' ? IOS_LINE : kind === 'android' ? ANDROID_LINE : OTHER_LINE;
    card.innerHTML = `${kind === 'ios' ? '<i class="pt" aria-hidden="true"></i>' : ''}<h3>Full screen</h3>${kind === 'ios' ? PIC_IOS : ''}<p>${line}</p>`
      + `<div class="bs"><button type="button" class="no">Not now</button>${kind === 'android' ? '<button type="button" class="go">Install</button>' : ''}</div>`;
    card.querySelector('.no').addEventListener('click', hide);
    card.querySelector('.go')?.addEventListener('click', async () => {
      const d = deferred; hide();
      if (!d) return;
      try { await d.prompt(); await d.userChoice; } catch { /* refused */ }
      deferred = null;
    });
    // a press on the card never reaches the water or the controls under it
    for (const ev of ['pointerdown', 'touchstart']) card.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    (doc.body ?? H).appendChild(card);
    requestAnimationFrame?.(() => card?.classList.add('on'));
    if (counted && store) { rec = onShown(rec); write(rec); }
    return true;
  }

  // sailing: Sail or Cruise, the phone's controls showing (no page, no menu), the page in view
  const sailing = () => {
    if (doc.visibilityState && doc.visibilityState !== 'visible') return false;
    const v = win.__velia, m = v?.mode?.now?.();
    if (m !== 'sail' && m !== 'cruise') return false;
    const fl = v?.m4?.ui?.flat;
    if (fl?.on) return fl.shown;
    const root = doc.getElementById('lk-load');
    return !root || root.dataset.state === 'gone';
  };
  const tick = () => {
    if (card) return;
    if (sailing()) sailedS += 1;
    if (store && ++ticks % 60 === 0) { rec = { ...rec, lastAt: now() }; write(rec); }   // a long sail stays one visit
    const p = platform();
    if (p && cardDue({ rec, sailedS, standalone: standalone(), platform: p })) show(p);
  };
  const forced = flag === 'ios' || flag === 'android' || flag === 'other' ? flag : null;
  if (flag !== '0' && !forced && store && phone() && !standalone()) timer = setInterval(tick, 1000);   // a desktop or the Home Screen app: no timer
  if (forced) {
    const go = () => { if (forced === 'android' && !deferred) deferred = { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) }; show(forced, { counted: false }); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', go, { once: true }); else go();
  }

  // the Menu card's row (the foot, beside What's new): a phone, not in the Home Screen app (the CSS shows it by html[data-screen~=compact])
  const addRow = () => {
    const foot = doc.querySelector('#lk-load .lk-foot');
    if (!foot || foot.querySelector('.lk-a2hs')) return;
    if (!doc.getElementById('lk-a2hs-css')) { const st = doc.createElement('style'); st.id = 'lk-a2hs-css'; st.textContent = CSS; doc.head.appendChild(st); }
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'lk-a2hs';
    b.innerHTML = `${ico(PLUS)}<span>${ROW_WORD}</span>`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = platform() ?? (/iPhone|iPod/.test(ua()) ? 'ios' : 'other');
      if (p === 'android' && deferred) { const d = deferred; d.prompt?.()?.catch?.(() => {}); deferred = null; return; }
      win.__velia?.m4?.front?.home?.close?.();   // the Menu card goes (a press on the card would be a press outside it), then the card
      show(p, { counted: false });
    });
    const news = foot.querySelector('.lk-news');
    if (news) foot.insertBefore(b, news); else foot.appendChild(b);
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', addRow, { once: true }); else addRow();

  installed = {
    get record() { return { ...rec }; },
    get sailedS() { return sailedS; },
    get card() { return card ? { kind: card.dataset.kind, spot: card.dataset.spot } : null; },
    get prompt() { return !!deferred; },
    platform, show: (k) => show(k ?? platform(), { counted: false }), hide,
    tick,   // the tests step it (one call: one second)
    dispose() { clearInterval(timer); hide(); installed = null; },
  };
  win.__veliaInstall = installed;
  return installed;
}
