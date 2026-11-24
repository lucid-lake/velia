// The loading bar as the visitor sees it (fix/v2-loading-feel): a phone-like page (touch, 390 × 844 @2, CPU and network
// throttled through the DevTools protocol) and the browser's own screencast, which takes the composited frames even while
// the page's main thread is busy (a rAF sampler inside the page freezes with it). Each frame's sailed length is read off
// the pixels of the line's row. Shared by v2/tests/pages/loadingFeel.page.mjs and tools/v2_load_timeline.mjs.
import { PNG } from 'pngjs';

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });   // a person: the card waits for ENTER
export const RETURNING = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true })); } catch {} };

// a measuring page: the still, the mark, the film's text, the watermark and the sloop hidden, so the line's row is the line
// alone on the navy (the bar's own geometry and motion are untouched)
export const CLEAN = () => {
  const s = document.createElement('style');
  s.textContent = '#lk-load .lk-bg,#lk-load .lk-company,#lk-load .lk-film,#lk-load .lk-psloop,#lk-load .lk-psay,#lk-sea{visibility:hidden!important}';
  const put = () => { const h = document.head ?? document.documentElement; if (!h) return false; h.append(s); return true; };
  if (!put()) new MutationObserver((_, o) => { if (put()) o.disconnect(); }).observe(document, { childList: true, subtree: true });   // an init script runs before <html> exists
};

// throttle like a mid phone on a fair link: CPU 4× slower, 10 Mbps down, 40 ms RTT, no cache (a first visit)
export async function throttle(cdp, { cpu = 4, mbps = 10, rtt = 40 } = {}) {
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: (mbps * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
}

// the screencast: every composited frame with its wall time (s since the epoch); keep: 'png' buffers for the strips
export async function startScreencast(cdp, { width = 780, height = 1688 } = {}) {
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ wall: f.metadata.timestamp, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  // stop() leaves the frames in capture order: the screencast can deliver a frame after a later one (2026-11-16: the 16581 ms frame
  // came after the 16614 ms one, and loadingFeel read the bar's 498 → 488 px as a 10 px step back; by capture time it never went back)
  return { frames, stop: async () => { await cdp.send('Page.stopScreencast').catch(() => {}); frames.sort((a, b) => a.wall - b.wall); } };
}

// the line's box on the screen (CSS px) for page.waitForFunction: an upright phone shows the landscape page turned on its side
// (phones are landscape-only, 2026-11-15; v2/ui/landscape.js), so there the line runs down the screen, its sailed end lower;
// the box is the screen's own (the native rect, __veliaTurn.screenRect once the turn's module is in), len its length
export const LINE_RECT = () => {
  const el = document.querySelector('#lk-load .lk-line'); if (!el) return null;
  const r = window.__veliaTurn ? window.__veliaTurn.screenRect(el) : el.getBoundingClientRect();
  const turned = document.documentElement.classList.contains('lk-rot'), len = turned ? r.height : r.width;
  return len > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height, len, turned } : null;
};

// the sailed length in CSS px on one frame: the bright run along the line (its screen box from LINE_RECT, CSS px; a turned
// line is read down its middle column, an unturned one along its middle row)
export function sailedPx(png, line, cssW) {
  const img = PNG.sync.read(Buffer.from(png, 'base64'));
  const k = img.width / cssW;
  const lum = (x, y) => { const i = (y * img.width + x) * 4; return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]; };
  let bright = 0, seen = 0, n = 0;
  if (line.turned) {
    const x0 = Math.round((line.x + line.w / 2) * k), y0 = Math.round(line.y * k), y1 = Math.round((line.y + line.h) * k);
    n = y1 - y0;
    for (const x of [x0 - 1, x0]) for (let y = y0; y < y1; y++) { const l = lum(x, y); if (l > 60) seen++; if (l > 165) bright++; }
  } else {
    const y0 = Math.round((line.y + line.h / 2) * k), x0 = Math.round(line.x * k), x1 = Math.round((line.x + line.w) * k);
    n = x1 - x0;
    for (const y of [y0 - 1, y0]) for (let x = x0; x < x1; x++) { const l = lum(x, y); if (l > 60) seen++; if (l > 165) bright++; }
  }
  // seen: the line at all (the unsailed part is cream at 30 % on the navy); bright: the sailed part (cream at 92 %)
  return { px: bright / 2 / k, line: seen > n * 0.5 };
}
