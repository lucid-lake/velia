// The quality tier at boot and in play (split from src/core/index.js boot, refactor Phase 2 step 3):
// the pick (?quality= wins, then the saved setting; 'auto' reads the device and runs a 2–3 s warm-up behind the loading
// card), the render ratio, the Settings row (setQuality, resetAuto) and, on live pages, the slow governor and the strong
// start's after-ready check, fed every frame by the loop (src/core/loop.js).
//
//   const q = await pickQuality({ renderer, D, touch, flags, stage });
//   q.quality      the live state: { setting, name, tier, build, factor, retinaMax, ratio, px, aa, governor, steps … };
//                  build: the tier the world is built with (src/quality/apply.js tierFor: the table plus a phone's cuts)
//   q.onLive(fn)   fn(tier) when the live knobs move (the governor, Settings): the stream's radii, the terrain's split
//   q.safe         the boot guard's level (phones: a load that never reached its first frame starts on Low)
//   q.feed = q.startGovernor(prevMs)   live pages: the per-frame (dt, nowMs, { readyAt, lastGpuMs }) step
import { tierOf, resolveTier, warmupDecides, Governor, budgetMs, governorSlack, AfterReady, readCap, recordStepDown, clearCap, migrateCap, QUALITY_CHOICES } from '../quality/tiers.js';
import { gatherSignals, runWarmup } from '../quality/device.js';
import { tierFor, ratioFor } from '../quality/apply.js';
import { createSettings } from '../../../src/ui/settings.js';
import { bootGuard } from '../ui/diag.js';

export async function pickQuality({ renderer, D, touch, flags, stage }) {
  // Captures (?headless) are High unless the URL says otherwise, so the goldens never depend on the machine. The tier
  // is fixed before the world is built (the build knobs).
  const headlessPage0 = flags.headless != null;
  const storage = globalThis.localStorage;
  const settings = createSettings();
  const urlQ = flags.quality;
  // crash safety (fix/ios-start; phones and tablets only): iOS ends a page's process near its memory limit without an
  // error and reloads it. A load that never reached its first frame leaves its mark; the next load starts on Low (and
  // after two, with the classic water too), and ?diag=1 says so.
  const safe = touch && !headlessPage0 ? bootGuard(storage) : { level: 0 };
  if (safe.level) D.safeMode = safe.level >= 2 ? `${safe.fails} loads did not finish: Low, classic water` : 'the last load did not finish: Low';
  const wanted = QUALITY_CHOICES.includes(urlQ) ? urlQ : headlessPage0 ? 'high' : safe.level && settings.get('quality') === 'auto' ? 'low' : settings.get('quality');
  const screenNow = () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
  const quality = { setting: wanted, name: 'high', signals: null, warmupMs: null, pick: null, factor: 1, retinaMax: Infinity, governor: null, steps: [] };
  migrateCap(storage);   // one time: the old 14-day cap goes
  const session = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;   // this page load, for the cap's 2-sessions rule
  if (wanted === 'auto') {
    quality.signals = await gatherSignals(renderer);
    stage('gpu', 0.03);
    // perf/phone-load: a device whose facts already cap it at the lowest tier (a phone, a software adapter) gets Low with or
    // without the warm-up, so it skips the 1.2–2.6 s of GPU work it would take (pickTier: no warm-up, the ceiling)
    quality.warmupMs = warmupDecides(quality.signals) ? await runWarmup(renderer) : null;
    quality.pick = resolveTier('auto', quality.signals, quality.warmupMs, { cap: readCap(storage) });
    quality.name = quality.pick.tier;
  } else quality.name = wanted;
  quality.tier = tierOf(quality.name);
  // the tier the world is built with, passed into each create* (src/quality/apply.js): on a phone or tablet's live page
  // its own cuts too (the wind's and the terrain's caches, the bark; on Low the phone texture set)
  quality.build = tierFor(quality.name, { phone: touch && !headlessPage0 });
  // the live knobs (the stream's radii, the terrain's split): the core hands them on once the world is built
  let live = () => {};
  const applyLive = (name) => live(tierOf(name));
  const applyRatio = () => {
    // ?pixelratio= (film UI captures only: the film runner draws the canvas at the screenshot's density)
    const r = flags.pixelratio && flags.filmui ? parseFloat(flags.pixelratio) : ratioFor(quality.name, screenNow(), quality.factor, quality.retinaMax);
    if (Math.abs(renderer.getPixelRatio() - r) > 1e-3) renderer.setPixelRatio(r);
    renderer.setSize(window.innerWidth, window.innerHeight);
    quality.ratio = r; quality.px = [Math.round(window.innerWidth * r), Math.round(window.innerHeight * r)];   // Settings shows what is drawn
  };
  applyRatio();
  let gov = null;
  // 'reset auto' (Settings): forget any saved cap and go back to what auto picked at start, at full render ratio
  function resetAuto() {
    clearCap(storage);
    quality.steps.length = 0;
    if (urlQ) return quality.name;
    quality.setting = 'auto';
    const name = quality.pick?.tier ?? quality.name;
    if (name !== quality.name || quality.factor !== 1 || quality.retinaMax !== Infinity) {
      quality.name = name; quality.tier = tierOf(name); quality.factor = 1; quality.retinaMax = Infinity; if (gov) gov.retina = Math.max(1, ratioFor(name, screenNow()));
      applyLive(name); applyRatio();
    }
    if (gov) { gov.tier = quality.name; gov.factor = 1; gov.samples = []; gov.from = performance.now() / 1000; }
    return quality.name;
  }
  // the Settings row, live: render scale and the live knobs now; the build knobs (water bands, clouds, forest, atlas)
  // follow at the next start. A page opened with ?quality= stays as asked.
  function setQuality(setting) {
    if (!QUALITY_CHOICES.includes(setting) || urlQ || setting === quality.setting) return quality.name;
    quality.setting = setting;
    const name = setting === 'auto' ? (quality.pick?.tier ?? quality.name) : setting;
    if (name !== quality.name || quality.factor !== 1 || quality.retinaMax !== Infinity) {
      quality.name = name; quality.tier = tierOf(name); quality.factor = 1; quality.retinaMax = Infinity; if (gov) gov.retina = Math.max(1, ratioFor(name, screenNow()));
      applyLive(name); applyRatio();
      if (gov) { gov.tier = name; gov.factor = 1; gov.samples = []; gov.from = performance.now() / 1000; }
    }
    return name;
  }

  // Live pages: the slow governor (tiers.js) steps the tier DOWN if the frame time stays over budget for 10 s; never up.
  // prevMs: the loop's start (performance.now()). Returns the per-frame step the loop calls before the mode's update.
  function startGovernor(prevMs) {
    gov = quality.governor = new Governor({ tier: quality.name, budget: budgetMs(quality.signals ?? { mobile: /iPhone|Android.+Mobile/i.test(navigator.userAgent) }), slack: governorSlack(quality.signals), now: prevMs / 1000, retina: Math.max(1, ratioFor(quality.name, screenNow(), 1, quality.retinaMax)) });
    const govOn = flags.governor && flags.quality == null;   // a forced tier stays (?quality=…, the bench)
    const afterReady = quality.pick?.strong && quality.setting === 'auto' && !urlQ ? new AfterReady({ retina: ratioFor(quality.name, screenNow(), 1, quality.retinaMax), start: Infinity }) : null;
    quality.afterReadySteps = afterReady?.steps ?? null;
    return (dt, now, { readyAt, lastGpuMs }) => {
      if (govOn && quality.setting === 'auto' && document.visibilityState === 'visible') {
        const step = gov.feed(dt, now / 1000);
        if (step) {
          quality.name = step.tier; quality.tier = tierOf(step.tier); quality.factor = step.factor; if (step.retina != null) quality.retinaMax = step.retina; quality.steps.push(step);
          applyLive(step.tier); applyRatio(); recordStepDown(storage, step.tier, session);   // a cap only after 2 sessions (tiers.js)
          quality.onStepDown?.(step);
        }
      }
      // a strong start (tiers.js AfterReady): 3 s of real frames at High once the page is live; the ratio steps down if slow
      if (afterReady && !afterReady.done && readyAt != null && quality.setting === 'auto' && document.visibilityState === 'visible') {
        const r = afterReady.feed(now / 1000, { gpuMs: lastGpuMs, dt });
        if (r && r !== 'done') { quality.retinaMax = r.retina; if (gov) gov.retina = r.retina; applyRatio(); }
        if (r === 'done') quality.afterReady = afterReady.result ?? null;
      }
    };
  }

  return { quality, safe, storage, urlQ, applyRatio, setQuality, resetAuto, startGovernor, onLive: (fn) => { live = fn; } };
}
