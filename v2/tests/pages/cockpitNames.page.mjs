// v2 port of tests/pages/cockpitNames.page.mjs: the cockpit's names on the v2 page (v1's cockpit baked into v2/assets/cockpit/*.ckb.gz,
// drawn by v2/render/cockpit.js, moved by v2/render/cockpit/rig.js; the DOM hit layer from v2/ui/station.js). Look C3: JIB, TACK and
// MAIN are cut flat into the teak cap beside their parts; no band and no hover tag.
//   Desktop: each name drawn, beside its own part, on screen, over no other control's target and apart from the others; no tag on
//            hover or focus, the focus outline kept, no control's box moves on hover; PRO's toggle drawn ≥ 9.5 px; PRO's targets ≥ 44 px;
//            a clear gap (≥ 8 px) between the switch panel and VHF's button (owner 2026-11-17).
//   Phone:   no cockpit since: the flat controls' words (Auto, Tack, In, Ease) each on its own control; no tag on a press.
// Map: v1 read the names' three.js meshes through the cockpit's three camera; v2 reads the same words from the baked asset (each label's
// node, its mesh's vertices from the CKB1 file, the node's matrix in rig.world) through the rig's own view-projection (rig.vp), the
// projection the station's hit layer uses. __lakeshore.station → __velia.m4.ui.station.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/cockpitNames.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const Q = 'mode=sail&hour=15&seed=1&noload=1&hud=full&pro=1&mute=1';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
async function open(ctx, query) {
  await ctx.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch {} }, SEEN);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.boat?.sim?.t > 1 && !!window.__velia.m4?.ui?.station?.rects?.jib && !!window.__velia.m4.ui.station.cockpit?.parts?.pro, null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  return { page, errors };
}
// any name tag (a winch group's or TACK's ::after): none must show
const TAGS = () => [...document.querySelectorAll('.lk-helm .grp[data-w], .lk-tackb')].map((e) => { const cs = getComputedStyle(e, '::after'); return cs.content !== 'none' && cs.content !== 'normal' && cs.content !== '""' && cs.display !== 'none'; }).some(Boolean);
// every control's box (the pads, the instruments, the fold tab, the PRO cells, TACK)
const BOXES = () => [...document.querySelectorAll('.lk-helm .pad, .lk-helm .grp, .lk-helm button.lk-inst, .lk-helm button.lk-fold, .lk-pro .c, .lk-tackb')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(','); }).join(' | ');
// the baked asset's vertices (the file the page drew: the desktop or the phone asset, told apart by its vertex count), the rig and a
// projector to css px through the rig's view-projection (rig.js toScreen)
async function CKV() {
  const rig = window.__velia.m4.cockpit.rig, n = rig.json.layout.vertexCount;
  if (!window.__ckPos || window.__ckPos.n !== n) {
    const { parseCockpit } = await import('/render/cockpit/asset.js');
    for (const f of ['desktop', 'phone']) {
      const a = await parseCockpit(new Uint8Array(await (await fetch(`/assets/cockpit/${f}.ckb.gz`)).arrayBuffer()));
      if (a.json.layout.vertexCount === n) { window.__ckPos = { n, pos: a.streams.position, file: f }; break; }
    }
  }
  rig.compose();
  const vp = rig.vp, W = innerWidth, H = innerHeight;
  const px = (x, y, z) => { const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]; return { x: (cx / cw + 1) / 2 * W, y: (1 - cy / cw) / 2 * H }; };
  const at = (node, p) => { const m = rig.world, o = 16 * node; return [m[o] * p[0] + m[o + 4] * p[1] + m[o + 8] * p[2] + m[o + 12], m[o + 1] * p[0] + m[o + 5] * p[1] + m[o + 9] * p[2] + m[o + 13], m[o + 2] * p[0] + m[o + 6] * p[1] + m[o + 10] * p[2] + m[o + 14]]; };
  return { rig, pos: window.__ckPos?.pos ?? null, file: window.__ckPos?.file ?? null, px, at };
}
// PRO as drawn, its width on screen, px: its toggle's hex nut (the 0.034 m radius from the bat's pivot), as v1's look C3 check
const DRAWN = async (CKVs) => { const { rig, px, at } = await eval(`(${CKVs})()`), T = rig.json.roles.pro?.toggle, out = {};
  if (T) { const p = at(T.pivot, [0, 0, 0]), q = at(T.pivot, [0.034, 0, 0]), a = px(...p), c = px(...q); out.pro = 2 * Math.hypot(c.x - a.x, c.y - a.y); }
  return out; };
// the engraved names: each word's centre and its screen box (its mesh's vertices through the rig's camera); a label's `mesh` is its node
const NAMES = async (CKVs) => { const { rig, pos, file, px, at } = await eval(`(${CKVs})()`), out = {};
  for (const L of rig.json.roles.labels) {
    if (!['JIB', 'MAIN', 'TACK', 'GYBE'].includes(L.text)) continue;
    const node = L.mesh, ms = rig.json.meshes.filter((m) => m.node === node), xs = [], ys = [];
    if (pos) for (const m of ms) for (let i = m.vfirst; i < m.vfirst + m.vcount; i++) { const q = px(...at(node, [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]])); xs.push(q.x); ys.push(q.y); }
    const box = xs.length ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } : null;
    out[L.text] = { c: box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : px(...at(node, [0, 0, 0])), shown: !!rig.visible[node], cap: !!L.cap, box, meshes: ms.length };
  }
  const st = window.__velia.m4.ui.station;
  return { names: out, file, rects: { jib: st.rects.jib, main: st.rects.main, tack: st.rects.tack }, vw: innerWidth, vh: innerHeight };
};
// VHF's breathing room (owner, 2026-11-17: "The black panel can move left a little, giving some white space on the left of VHF"): the
// switch panel's right edge as seen (the recess's opening: the first column of the gelcoat face right of REEF's knob, its vertices at
// the face's lean line y0 = 0.095 m, which crosses the recess) and VHF's button's left edge (its ring's vertices), through the rig's
// camera, css px. (The powder plate runs on behind the face, so its own vertices overstate the panel.)
const VHF_GAP = async (CKVs) => { const { rig, pos, px, at } = await eval(`(${CKVs})()`), J = rig.json;
  const reef = px(...at(J.roles.toggles.reef.pivot, [0, 0, 0])), vhf = px(...at(J.anchors.vhf, [0, 0, 0]));
  const gm = J.materials.findIndex((m) => m.name === 'ck_gelcoat'), out = (pred, keep) => { const r = []; for (const m of J.meshes.filter(pred)) for (let i = m.vfirst; i < m.vfirst + m.vcount; i++) { if (keep && !keep(pos[3 * i + 1])) continue; r.push(px(...at(m.node, [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]))); } return r; };
  const face = out((m) => m.mat === gm, (y) => Math.abs(y - 0.095) < 1e-4).filter((q) => q.x > reef.x && q.x < vhf.x).map((q) => q.x);
  const ring = out((m) => m.node === J.roles.tools.radio.ring).map((q) => q.x);
  return { panelRight: Math.min(...face), vhfLeft: Math.min(...ring), n: [face.length, ring.length] }; };
const hit = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
// every control's target but a name's own part (a winch's group, TACK). The PRO recess's top row (TRAVELLER, JIB LEAD) is marked
// `cap`: two ≥ 44 px rows from the screen's foot reach up over the cap on a short screen, so a name cut into the cap may lie under it
const TARGETS = () => [...document.querySelectorAll('.lk-helm .grp, .lk-helm button.lk-inst, .lk-helm button.lk-fold, .lk-cp .c, .lk-thr .lv, .lk-tackb, .lk-pro .c')]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden && getComputedStyle(e).display !== 'none'; })
  .map((e) => { const r = e.getBoundingClientRect(); return { own: e.classList.contains('grp') ? e.dataset.w : e.classList.contains('lk-tackb') ? 'tack' : null, cap: /^(traveller|jibLead)$/.test(e.dataset.id ?? ''), n: e.getAttribute('aria-label') || e.dataset.id || e.className, x: r.left, y: r.top, w: r.width, h: r.height }; });

// the names on a page: drawn, cut into the cap, beside their own parts, on screen, apart, over no other control's target
async function names(page, where) {
  const r = await page.evaluate(async (a) => (await eval(`(${a[0]})`))(a[1]), [String(NAMES), String(CKV)]);
  const T = await page.evaluate(TARGETS);
  const N = r.names, shown = ['JIB', 'MAIN'];   // TACK is the pilot head's key since 2026-11-16 (owner): no TACK or GYBE on the cap
  check(shown.every((k) => N[k]?.box) && !!r.file, `${where}: the names' meshes read from the ${r.file} asset (${shown.map((k) => `${k} ${N[k]?.meshes ?? 0}`).join(', ')})`);
  check(shown.every((k) => N[k]?.shown && N[k].cap) && !N.TACK && !N.GYBE, `${where}: JIB and MAIN cut into the cap, no TACK or GYBE there (${JSON.stringify(Object.fromEntries(Object.entries(N).map(([k, v]) => [k, [v.shown, v.cap]])))})`);
  if (!shown.every((k) => N[k]?.box)) return N;
  const near = { JIB: r.rects.jib, MAIN: r.rects.main }, far = shown.filter((k) => { const R = near[k]; return Math.abs(N[k].c.x - (R.x + R.w / 2)) > Math.max(60, R.w); });
  check(!far.length, `${where}: each name beside its own part (${shown.map((k) => `${k} ${Math.round(N[k].c.x - (near[k].x + near[k].w / 2))} px`).join(', ')})`);
  check(shown.every((k) => N[k].box.x >= 0 && N[k].box.y >= 0 && N[k].box.x + N[k].box.w <= r.vw && N[k].box.y + N[k].box.h <= r.vh), `${where}: every name on screen (${shown.map((k) => `${k} ${Object.values(N[k].box).map(Math.round).join(',')}`).join('; ')})`);
  const pairs = []; for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) if (hit(N[shown[i]].box, N[shown[j]].box)) pairs.push(`${shown[i]}/${shown[j]}`);
  const over = shown.flatMap((k) => T.filter((t) => t.own !== k.toLowerCase() && !t.cap && hit(N[k].box, t)).map((t) => `${k} over ${String(t.n).slice(0, 20)}`));
  check(!pairs.length && !over.length, `${where}: the names apart and over no other control's target (${[...pairs, ...over].join(', ') || 'clear'})`);
  return N;
}

try {
  // ---------------- desktop ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const { page, errors } = await open(ctx, Q);
    await page.mouse.move(640, 300); await page.waitForTimeout(600);
    await names(page, 'desktop 1280 x 720');
    check(!(await page.evaluate(TAGS)), 'at rest no name tag');
    const boxes0 = await page.evaluate(BOXES);
    for (const side of ['jib', 'main']) {
      const r = await page.evaluate((k) => window.__velia.m4.ui.station.rects[k], side);
      await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2, { steps: 6 }); await page.waitForTimeout(300);
      check(!(await page.evaluate(TAGS)), `the pointer on the ${side} winch: no tag (the name is on the hardware)`);
      const b1 = await page.evaluate(BOXES);
      check(b1 === boxes0, `the pointer on the ${side} winch moves no control's box${b1 === boxes0 ? '' : ` (before ${boxes0} | after ${b1})`}`);
    }
    await page.mouse.move(640, 300, { steps: 4 }); await page.waitForTimeout(250);
    // the keyboard's focus: the outline stays, no tag
    await page.keyboard.press('Shift');
    const foc = await page.evaluate((T) => { const pad = document.querySelector('.pad.winch[data-w=main]'); pad.focus({ focusVisible: true });
      const out = { fv: pad.matches(':focus-visible'), ring: getComputedStyle(pad).boxShadow, label: pad.getAttribute('aria-label') };
      const tb = document.querySelector('.lk-tackb'); tb.classList.add('in'); tb.focus({ focusVisible: true }); out.tag = eval(T)(); out.tack = tb.getAttribute('aria-label'); tb.blur(); return out; }, `(${TAGS})`);
    check(foc.fv && foc.ring && foc.ring !== 'none' && !foc.tag && foc.label === 'Mainsheet winch' && /^(Tack|Gybe)$/.test(foc.tack), `the focus keeps its outline and the aria-labels, no tag (${JSON.stringify(foc)})`);
    const widths = await page.evaluate(async (a) => (await eval(`(${a[0]})`))(a[1]), [String(DRAWN), String(CKV)]);
    const cells = await page.evaluate(() => [...document.querySelectorAll('.lk-pro .c')].map((e) => { const r = e.getBoundingClientRect(); return { n: e.getAttribute('aria-label') || e.dataset.id, w: r.width, h: r.height }; }).filter((c) => c.w > 0));
    const small = cells.filter((c) => c.w < 43.5 || c.h < 43.5);
    // look C3: PRO, BINOS, VHF and the four trim controls
    check(cells.length >= 7 && !small.length, `PRO's ${cells.length} targets ≥ 44 px (${small.map((c) => `${c.n} ${c.w.toFixed(0)}x${c.h.toFixed(0)}`).join(', ') || 'all'})`);
    // dropped: the second page with ?cockpitlabels=a and the "≥ 1.3 x the old band's push button" ratio: v2 bakes one cockpit (look
    // C3), with no old band to compare against; the absolute floor stays
    check(widths.pro != null && widths.pro >= 9.5, `PRO is drawn ${widths.pro?.toFixed(1)} px wide at 1280 x 720 (≥ 9.5 px)`);
    const gap = await page.evaluate(async (a) => (await eval(`(${a[0]})`))(a[1]), [String(VHF_GAP), String(CKV)]);
    check(gap.n[0] > 0 && gap.n[1] > 0 && gap.vhfLeft - gap.panelRight >= 8, `a clear gap between the switch panel and VHF at 1280 x 720: ${(gap.vhfLeft - gap.panelRight).toFixed(1)} px (≥ 8; panel ends ${gap.panelRight.toFixed(1)}, VHF from ${gap.vhfLeft.toFixed(1)})`);
    const ve = await page.evaluate(() => window.__velia.errors.slice());
    check(!errors.length && !ve.length, `no page error (${[...errors, ...ve].join('; ').slice(0, 200) || 'none'})`);
    await ctx.close();
  }

  // ---------------- a phone held sideways ----------------
  // Since (owner, 2026-11-16) a phone has no 3D cockpit, so no engraved names or winch steps there. The flat controls'
  // words take their place: each sits inside its own control, none over another control, and a press shows no tag.
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: UA });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch { /* blocked */ } });
    await page.goto(`${BASE}/?${Q}&touch=1&attract=0&fv=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.boat?.sim?.t > 1 && window.__velia.m4?.ui?.flat?.shown, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const w = await page.evaluate(() => {
      const el = window.__velia.m4.ui.flat.el, out = [];
      const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      for (const [word, sel] of [['Auto', '.auto .w'], ['Tack', '.tack .w']]) { const e = el.querySelector(sel); out.push({ word, own: !!e && document.elementFromPoint(box(e).x + box(e).w / 2, box(e).y + box(e).h / 2)?.closest('.qd') === e.closest('.qd'), text: e?.textContent }); }
      for (const t of el.querySelectorAll('.side text')) { const b = box(t); if (!b.w || !t.textContent) continue; const hit = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2); out.push({ word: t.textContent, own: !!hit?.classList?.contains('ring') && hit.closest('.side') === t.closest('.side') }); }
      return out;
    });
    check(w.length >= 4 && w.every((x) => x.own), `phone: each flat control's word sits on its own control (${w.map((x) => `${x.word}${x.own ? '' : ' ✗'}`).join(', ')})`);
    const L = await page.evaluate(() => window.__velia.m4.ui.flat.layout);
    await page.touchscreen.tap(L.pr.x - L.q * 0.35, L.pr.y - L.q * 0.35); await page.waitForTimeout(400);
    check(!(await page.evaluate(TAGS)), 'phone: a press on Tack shows no tag');
    const ve = await page.evaluate(() => window.__velia.errors.slice());
    check(!errors.length && !ve.length, `phone: no page error (${[...errors, ...ve].join('; ').slice(0, 200) || 'none'})`);
    await ctx.close();
  }
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
