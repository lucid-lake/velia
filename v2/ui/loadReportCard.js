// The load report's card (its own chunk: fetched only when the report is opened): the numbers of this page's load
// (ui/loadReportData.js) on one navy card a phone can read. A waterfall of the stages, the slowest stages and files, the
// totals and the likely blocker; Copy report (the short text for a chat message), Share (the phone's share sheet, where it
// has one), Download JSON (the whole report), Record a fresh load (the page again with ?loadreport=1), Close.
// Opened by ?loadreport=1 after the load (ui/loading.js), a long press on the version line or the loading bar, or Setup ›
// Screen › loading report (ui/loadReportRow.js). Nothing is sent anywhere: the report leaves only by the visitor's own copy,
// share or download.
//   const card = openLoadReport({ rec });   card.report, card.text, card.close()
import { buildLoadReport, reportText, qualityWords, STAGES } from './loadReportData.js';
import { lmFacts } from '../engine/loadMarks.js';

const CSS = `
#lk-lr{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));background:rgb(8 18 38 / .55);font:15px/1.35 var(--lk-ui,system-ui,-apple-system,sans-serif);color:#f3ecdc;-webkit-text-size-adjust:100%}
#lk-lr .lr-card{box-sizing:border-box;width:min(980px,100%);max-height:100%;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:#12264a;border:1px solid rgb(243 236 220 / .35);border-radius:14px;box-shadow:0 10px 40px rgb(0 0 0 / .45);padding:14px 16px 0}
#lk-lr h2{margin:0 0 2px;font-size:19px;letter-spacing:.04em;font-weight:600}
#lk-lr .lr-sub{opacity:.85;font-size:14px}
#lk-lr .lr-total{display:flex;flex-wrap:wrap;gap:4px 18px;margin:10px 0 6px;font-variant-numeric:tabular-nums}
#lk-lr .lr-total b{font-size:22px;font-weight:600}
#lk-lr .lr-blocker{margin:6px 0 10px;padding:9px 12px;border-radius:10px;background:rgb(243 236 220 / .1);border-left:4px solid #e9b44c;font-size:16px}
#lk-lr .lr-blocker b{color:#e9b44c;font-weight:600}
#lk-lr h3{margin:12px 0 6px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.8;font-weight:600}
#lk-lr .lr-wf{display:grid;grid-template-columns:minmax(120px,34%) 1fr;gap:3px 10px;align-items:center;font-size:13.5px;font-variant-numeric:tabular-nums}
#lk-lr .lr-wf .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#lk-lr .lr-wf .n.c::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#f3ecdc;margin-right:6px;vertical-align:1px}
#lk-lr .lr-wf .t{position:relative;height:16px;border-radius:3px;background:rgb(243 236 220 / .06)}
#lk-lr .lr-wf .b{position:absolute;top:2px;bottom:2px;min-width:2px;border-radius:2px;background:rgb(243 236 220 / .45)}
#lk-lr .lr-wf .b.c{background:#f3ecdc}
#lk-lr .lr-wf .b.top{background:#e9b44c}
#lk-lr .lr-wf .b.o{background:repeating-linear-gradient(90deg,#e9b44c 0 6px,transparent 6px 10px)}
#lk-lr .lr-wf .d{position:absolute;right:4px;top:-1px;font-size:12px;padding:0 3px;border-radius:3px;background:rgb(18 38 74 / .8)}
#lk-lr .lr-axis{display:flex;justify-content:space-between;grid-column:2;font-size:11.5px;opacity:.7}
#lk-lr .lr-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}
:where(:root[data-screen~=narrow]) #lk-lr .lr-cols{grid-template-columns:1fr}
#lk-lr ol{margin:0;padding-left:1.4em;font-size:13.5px;font-variant-numeric:tabular-nums}
#lk-lr li{margin:2px 0;word-break:break-all}
#lk-lr .lr-facts{font-size:13px;opacity:.9;margin:4px 0 0}
#lk-lr .lr-bar{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:8px;margin:12px -16px 0;padding:10px 16px max(10px,env(safe-area-inset-bottom));background:#12264a;border-top:1px solid rgb(243 236 220 / .25)}
#lk-lr button{font:inherit;font-size:15px;min-height:44px;padding:0 14px;border-radius:22px;border:1.5px solid rgb(243 236 220 / .8);background:transparent;color:#f3ecdc;cursor:pointer}
#lk-lr button.go{background:#f3ecdc;color:#12264a;font-weight:600}
#lk-lr button:focus-visible{outline:2px solid #e9b44c;outline-offset:2px}
#lk-lr .lr-said{align-self:center;font-size:14px;color:#e9b44c;min-width:6em}
#lk-lr textarea{box-sizing:border-box;width:100%;height:9em;margin-top:6px;font:12px/1.3 ui-monospace,Menlo,monospace;background:#0c1b36;color:#f3ecdc;border:1px solid rgb(243 236 220 / .3);border-radius:8px}
#lk-lr details{margin-top:8px;font-size:13.5px}
`;

// what the page knows about its own load, as the report's raw input
function collectLoad({ rec = null, win = globalThis, doc = globalThis.document } = {}) {
  const perf = win.performance;
  const get = (t) => { try { return perf.getEntriesByType(t) ?? []; } catch { return []; } };
  const nav = get('navigation')[0] ?? null;
  const n = win.navigator ?? {};
  const c = n.connection ?? null;
  const ver = doc?.querySelector?.('#lk-load .lk-ver')?.firstChild?.textContent?.trim() ?? '';
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return {
    at: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    version: ver, page: win.location?.pathname ?? '/', params: [...new URLSearchParams(win.location?.search ?? '').keys()],
    nav: nav && { responseStart: nav.responseStart, responseEnd: nav.responseEnd, domInteractive: nav.domInteractive, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, transferSize: nav.transferSize, nextHopProtocol: nav.nextHopProtocol, type: nav.type },
    paint: get('paint').map((e) => ({ name: e.name, startTime: e.startTime })),
    marks: get('mark').map((e) => ({ name: e.name, startTime: e.startTime })),
    resources: get('resource'),
    rec: rec?.data?.() ?? null,
    heap: perf.memory ? { usedMB: perf.memory.usedJSHeapSize / 1048576, limitMB: perf.memory.jsHeapSizeLimit / 1048576 } : null,
    facts: lmFacts(),
    device: {
      ua: n.userAgent ?? '', touch: n.maxTouchPoints ?? 0, cores: n.hardwareConcurrency ?? null, memGB: n.deviceMemory ?? null,
      screen: win.screen ? { w: win.screen.width, h: win.screen.height } : null, viewport: { w: win.innerWidth, h: win.innerHeight }, dpr: win.devicePixelRatio ?? 1,
      conn: c ? { effectiveType: c.effectiveType, downlink: c.downlink, rtt: c.rtt, saveData: c.saveData } : null,
      standalone: !!(n.standalone || win.matchMedia?.('(display-mode: standalone)')?.matches),
    },
    origin: win.location?.origin ?? '',
    errors: win.__velia?.errors ?? [],
    now: perf.now(),
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const sec = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)} s`);

function cardHtml(rep, text) {
  const t = rep.totals, d = rep.device;
  const end = Math.max(1, t.card ?? 0, t.firstFrame ?? 0, ...rep.stages.map((s) => s.end), t.done ? 0 : t.at);
  const pc = (ms) => `${Math.max(0, Math.min(100, (100 * ms) / end)).toFixed(2)}%`;
  const rows = rep.stages.map((s) => `<span class="n${s.crit ? ' c' : ''}" title="${esc(s.label)}">${esc(s.label)}</span><span class="t"><i class="b${s.crit ? ' c' : ''}${s.name === rep.blocker.name ? ' top' : ''}${s.open ? ' o' : ''}" style="left:${pc(s.start)};width:${pc(s.dur)}"></i><span class="d">${sec(s.dur)}</span></span>`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${(end * f / 1000).toFixed(1)}</span>`).join('');
  const conn = d.conn ? [d.conn.type, d.conn.downlink != null ? `${d.conn.downlink} Mbps` : '', d.conn.rtt != null ? `${d.conn.rtt} ms` : ''].filter(Boolean).join(' ') : 'not told';
  const gpu = d.gpu ? [d.gpu.vendor, d.gpu.architecture, d.gpu.description].filter(Boolean).join(' ') || 'not told' : 'not told';
  const main = rep.main.source === 'none' ? 'not recorded on this load (Record a fresh load)' : `${rep.main.count} ${rep.main.source === 'longtask' ? 'long tasks' : 'stalls'}, ${sec(rep.main.totalMs)} held`;
  return `<div class="lr-card" role="dialog" aria-modal="true" aria-labelledby="lr-h">
  <h2 id="lr-h">Loading report</h2>
  <div class="lr-sub">${esc(d.ua)} · ${esc(d.viewport)}${d.dpr ? ` @${+(+d.dpr).toFixed(2)}` : ''} · ${esc(rep.at)}</div>
  <div class="lr-total">${t.done ? `<span>Ready to play <b>${sec(t.card ?? t.firstFrame)}</b></span><span>First frame <b>${sec(t.firstFrame)}</b></span>${t.modes != null ? `<span>Modes ready <b>${sec(t.modes)}</b></span>` : ''}` : `<span>Not ready after <b>${sec(t.at)}</b></span>`}<span>First paint <b>${sec(t.firstPaint)}</b></span></div>
  <div class="lr-blocker">Likely blocker: <b>${esc(rep.blocker.text)}</b></div>
  <h3>Timeline</h3>
  <div class="lr-wf">${rows}<span></span><span class="lr-axis">${ticks}</span></div>
  <div class="lr-cols">
    <div><h3>Slowest stages</h3><ol>${rep.slowStages.map((s) => `<li>${esc(s.label)} <b>${sec(s.dur)}</b></li>`).join('')}</ol></div>
    <div><h3>Slowest files</h3><ol>${rep.slowFiles.map((r) => `<li>${esc(r.path)} <b>${sec(r.dur)}</b> · ${r.sentKB} kB${r.cache === 'hit' ? ' · cache' : ''}</li>`).join('') || '<li>none recorded</li>'}</ol></div>
  </div>
  <h3>This device</h3>
  <p class="lr-facts">Network ${esc(conn)} · ${d.cores ?? '?'} cores${d.memGB ? ` · ${d.memGB} GB` : ''} · ${d.standalone ? 'Home Screen app' : 'browser tab'}<br />GPU ${esc(gpu)}${d.quality ? ` · quality ${esc(qualityWords(d.quality))}` : ''}<br />Main thread: ${esc(main)} · ${t.requests} files, ${(t.sentKB / 1024).toFixed(1)} MB downloaded, ${t.cached} from cache${rep.heap ? ` · heap ${Math.round(rep.heap.usedMB)} MB` : ''}${rep.pipes ? `<br />Shaders: ${rep.pipes.n} before the first frame, ${sec(rep.pipes.ms)}${rep.pipes.slowest ? ` (${esc(rep.pipes.slowest)})` : ''} · ${rep.pipes.late ? `${rep.pipes.late.n} after the card, ${sec(rep.pipes.late.ms)}` : `${rep.pipes.deferred} after the card`}${rep.pipes.build ? `<br />This phone built all ${rep.pipes.build.built} of ${rep.pipes.build.n} shaders before the modes lit, ${sec(rep.pipes.build.ms)} after the first frame` : ''}` : ''}</p>
  <details><summary>The text that Copy sends</summary><textarea readonly data-lr="text">${esc(text)}</textarea></details>
  <div class="lr-bar">
    <button class="go" type="button" data-lr="copy">Copy report</button>
    <button type="button" data-lr="share">Share</button>
    <button type="button" data-lr="json">Download JSON</button>
    <button type="button" data-lr="again">Record a fresh load</button>
    <button type="button" data-lr="close">Close</button>
    <span class="lr-said" role="status" aria-live="polite" data-lr="said"></span>
  </div>
</div>`;
}

// the page's URL with ?loadreport=1 (the other flags kept)
function recordUrl(href) {
  const u = new URL(href);
  u.searchParams.set('loadreport', '1');
  return u.href;
}

async function copyText(text, doc) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* not allowed here: the textarea's way */ }
  try {
    const ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    doc.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = doc.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export function openLoadReport({ rec = null, doc = globalThis.document, win = globalThis } = {}) {
  doc.getElementById('lk-lr')?.remove();
  if (!doc.getElementById('lk-lr-css')) { const s = doc.createElement('style'); s.id = 'lk-lr-css'; s.textContent = CSS; doc.head.appendChild(s); }
  const report = buildLoadReport(collectLoad({ rec, win, doc }));
  const text = reportText(report);
  const root = doc.createElement('div');
  root.id = 'lk-lr';
  root.innerHTML = cardHtml(report, text);
  doc.body.appendChild(root);
  win.__veliaLoadReport = { report, text };   // the page tests read it
  const said = root.querySelector('[data-lr=said]');
  const say = (s) => { said.textContent = s; };
  const share = root.querySelector('[data-lr=share]');
  if (typeof win.navigator?.share !== 'function') share.hidden = true;
  const stop = (e) => e.stopPropagation();   // the card's taps and keys never reach the game or the home card
  for (const ev of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'keydown', 'wheel']) root.addEventListener(ev, stop);
  const close = () => { root.remove(); };
  root.addEventListener('click', async (e) => {
    if (e.target === root) { close(); return; }
    const b = e.target.closest?.('[data-lr]'); if (!b) return;
    const k = b.dataset.lr;
    if (k === 'copy') say((await copyText(text, doc)) ? 'Copied' : 'Select the text below');
    else if (k === 'share') { try { await win.navigator.share({ title: 'Velia loading report', text }); say('Shared'); } catch (err) { if (err?.name !== 'AbortError') say('Share failed: use Copy'); } }
    else if (k === 'json') {
      const blob = new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' });
      const a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `velia-load-${report.at.replace(/[^0-9]/g, '').slice(0, 12)}.json`;
      doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); say('Downloaded');
    } else if (k === 'again') win.location.href = recordUrl(win.location.href);
    else if (k === 'close') close();
    if (k === 'copy' && !said.textContent.startsWith('Copied')) { const d = root.querySelector('details'); d.open = true; root.querySelector('textarea').select(); }
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  root.querySelector('[data-lr=copy]').focus({ preventScroll: true });
  return { root, report, text, close };
}

export { STAGES };
