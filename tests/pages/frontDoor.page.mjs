// The front door with no WebGPU (the front-door review, 2026-11-04; tests/frontDoor.test.mjs): src/core/index.js boot() on the
// real page in a browser whose navigator.gpu is gone. With a WebGL2 context it goes on and asks for the WebGL2 backend; with
// neither, the plain "can't run Velia" card (the loading card's fail state) instead of an error. Needs no GPU: the WebGL2
// that boot() finds is a stand-in on the probe canvas only (the renderer's own canvas gets none, so it stops right after).
// Needs the private Vite (bare imports): npm run test:pages -- A-frontDoor, or
//   LAKESHORE_BASE=http://127.0.0.1:<port> node tests/pages/frontDoor.page.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.LAKESHORE_BASE;
const skip = (!BASE && 'no LAKESHORE_BASE (run through npm run test:pages)') || (!existsSync(CHROME) && 'no Chrome');

// before any page script: no navigator.gpu; getContext('webgl2') gives a stand-in on a canvas that is not on the page (the
// boot's probe) when gl2 is true, else null everywhere
const NO_GPU = (gl2) => {
  Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
  const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    if (kind === 'webgl2' || kind === 'webgpu') return gl2 && kind === 'webgl2' && !this.isConnected ? { stand: 'in' } : null;
    return real.call(this, kind, ...rest);
  };
};

test('no WebGPU: WebGL2 is used when it exists; the hard-stop card only when neither works', { skip, timeout: 180000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const run = async (gl2) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(NO_GPU, gl2);
    await page.goto(`${BASE}/?mode=sail&hour=12&gate=0&attract=0&welcome=0&first=0&metrics=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window.__veliaLoading?.log ?? []).some((r) => /^fail|^gpu$/.test(r[0])) && (window.__lakeshore?.diag?.backendWanted || window.__veliaLoading.state === 'fail'), null, { timeout: 120000 });
    const r = await page.evaluate(() => ({ log: window.__veliaLoading.log.map((x) => x[0]), state: window.__veliaLoading.state, wanted: window.__lakeshore?.diag?.backendWanted ?? null }));
    await page.close();
    return r;
  };
  await t.test('WebGL2 there: no fail card first; the gpu stage runs and the WebGL2 backend is asked for', async () => {
    const r = await run(true);
    assert.ok(r.log.includes('gpu'), `the gpu stage ran (${r.log})`);
    assert.ok(r.log.indexOf('gpu') < (r.log.findIndex((s) => s.startsWith('fail')) + 1 || Infinity), 'no fail before it: a missing navigator.gpu alone never fails');
    assert.equal(r.wanted, 'webgl2', 'forceWebGL: no navigator.gpu means the WebGL2 backend');
  });
  await t.test('neither: the hard-stop card, before any GPU stage', async () => {
    const r = await run(false);
    assert.equal(r.state, 'fail'); assert.ok(r.log.includes('fail:nowebgpu'), `${r.log}`);
    assert.equal(r.log.includes('gpu'), false, 'it stops before the renderer');
    assert.equal(r.wanted, null);
  });
  await browser.close();
});
