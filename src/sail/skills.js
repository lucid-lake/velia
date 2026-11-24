// Day Sail's skill model: the game watches, it never asks. From the per-frame state
// and input streams it learns which skills the player has shown ("mastered", saved per browser) and which one they
// are struggling with now, so the quiet hints (src/ui/controlsHint.js) speak only to a player who is stuck on a skill
// they have not shown, the crew's net fades as the skill grows, and the logbook's seamanship page draws the skills.
// Pure JS, no DOM, no three.js: tests/skills.test.mjs drives it with scripted streams.
//
//   const sk = createSkills({ storage: localStorage });   // storage null: in memory only
//   sk.update(dt, sample);           // every frame; dt in real (play) seconds
//   sk.needs();                      // [{ skill, hint, why }] struggling and not mastered, in priority order; [] when muted
//   sk.mastered('trim'); sk.struggling('trim');   // true / false; the reason ('luff', 'stall', …) or null
//   sk.muted;                        // the pro was detected, or "I sail" is on: every newbie hint is silent
//   sk.netAfter;                     // s before the crew's net (12 → 25 → Infinity as the skill grows; or the player's)
//   sk.onChange((ev) => …);          // { type: 'mastered' | 'pro' | 'settings', id }
//
// sample: { twa (rad, signed), tws (m/s), awa (rad, signed), sog (m/s), heading (rad), heel (rad), mainFill 0–1,
//           mainStall 0–1, boomAngle (rad), surf 0–1, roundUp 0–1, groove 0–1 (the lock-in level; > 0 locked),
//           level 1–4 | null (the wind level), steer −1..1 (the player's helm input: keys or pad), pull −1..1 (the
//           player's sheet input), crew (bool: the crew's net is trimming), gust: { here, left, right } | null (the
//           wind field's gust factor at the boat and 150 m out at 45° either side of the bow), x, z (m, the world frame;
//           for "lost": circling far from anything) }
//
// All the times below are real (play) seconds, the hints' clock: Day Sail runs the world at 2×.
const DEG = Math.PI / 180, KN = 0.514444;
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const KEY = 'lakeshore.skills.v1';

// The skills, in the logbook's order. sil: the seamanship page's stroke drawing (viewBox 0 0 160 100, as the logbook's).
export const SKILLS = [
  { id: 'steering', name: 'steering', sil: 'M80 88 V58 M80 50 m-22 0 a22 22 0 1 0 44 0 a22 22 0 1 0 -44 0 M80 50 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M58 50 H75 M85 50 H102 M80 28 V45' },
  { id: 'trim', name: 'sail trim', sil: 'M60 86 V14 Q98 40 104 82 Z M60 86 H112 M104 82 L126 88 M120 84 l6 4 l-7 2' },
  { id: 'nogo', name: 'the no-go zone', sil: 'M80 82 L44 22 A70 70 0 0 1 116 22 Z M80 82 V96 M74 92 L80 98 L86 92 M80 14 V4 M76 8 L80 2 L84 8' },
  { id: 'tacking', name: 'tacking', sil: 'M40 88 L80 30 L120 88 M74 30 h12 M112 80 l8 8 l-10 0 M30 58 h20 M110 58 h20' },
  { id: 'gybing', name: 'gybing', sil: 'M40 18 L80 76 L120 18 M80 76 V90 M54 62 Q80 44 106 62 M100 56 l6 6 l-8 2' },
  { id: 'gusts', name: 'reading gusts', sil: 'M10 70 H150 M34 58 q18 -10 36 0 t36 0 M50 46 q14 -8 28 0 t28 0 M120 84 l8 -12 l8 12 Z' },
  { id: 'groove', name: 'the groove', sil: 'M14 60 q16 -24 32 0 t32 0 t32 0 t32 0 M14 74 H146 M70 30 V22 M80 32 V18 M90 30 V22' },
  { id: 'heavy', name: 'heavy air', sil: 'M20 84 H140 M56 84 L96 28 L104 84 M96 28 L64 80 M20 40 q20 -10 40 0 M28 54 q16 -8 32 0 M110 44 q14 -8 28 0' },
  { id: 'shifts', name: 'wind shifts', sil: 'M30 80 L80 26 L130 80 M80 26 V8 M66 14 L80 4 L94 14 M100 30 l14 -16 M108 12 l6 2 l-2 6' },
  { id: 'surfing', name: 'surfing', sil: 'M8 74 Q40 74 64 50 Q84 30 104 50 Q124 70 152 70 M70 46 L92 34 L100 44 Z M92 34 V20' },
];
export const SKILL_IDS = SKILLS.map((s) => s.id);

// The thresholds (the build's numbers, 2026-10-29).
export const RULES = {
  steering: { chosenDeg: 10, holdS: 20, holdDeg: 8, minSog: 1, minTwaDeg: 35,     // mastered: a course you turned onto, held ±8° for 20 s, sailing
    idleAfterTrimS: 8, idleS: 30,                                                // struggling: never steered, 8 s after the sails were set (30 s at the latest)
    zigzagN: 4, zigzagS: 20, zigzagSwingDeg: 15, zigzagSegS: 0.3,                // or 4 helm reversals in 20 s with ≥ 15° of heading swing
    circleDeg: 360, circleS: 60 },                                               // or a full circle inside 60 s
  trim: { windowS: 60, fullFrac: 0.7, fill: 0.8, luffFill: 0.5, stall: 0.6, stallAwaDeg: 80, ironsTwaDeg: 40,
    wrongS: 10,                                                                  // struggling: luffing or stalled > 10 s
    firstLuffS: 1.5 },                                                           // a hand that never touched a sheet: the first luff speaks after 1.5 s
  nogo: { closeDeg: [35, 52], holdS: 30, graceS: 2, fill: 0.8, minSog: 1.5,      // mastered: close-hauled 30 s, full and moving
    headDeg: 32, headS: 8 },                                                     // struggling: head to wind > 8 s
  tacking: { clean: 2, backS: 15, backFrac: 0.75, turnDeg: 60, newTwaDeg: 35,    // a clean tack: the turn ≥ 60°, the speed back to 75 % of before inside 15 s
    stuckDeg: 32, stuckSog: 0.8, stuckS: 3, approachS: 20, steerS: 2 },          // struggling: stopped head to wind mid-tack for 3 s
  gybing: { crashSwingDeg: 90, settleS: 2, minTwaDeg: 120, crashes: 2, showS: 20 },   // a crash: the boom swings > 90° (the sheet out); 2 → the hint
  gusts: { patchMin: 1.1, sideGain: 1.15, seenS: 3, steerS: 0.5, enterGain: 1.12, enterMin: 1.08, windowS: 40, goneS: 5, into: 3, missed: 3 },
  groove: { totalS: 30, neverS: 600, minSog: 1 },                               // mastered: 30 s locked in, in total (saved); struggling: never in 10 min
  heavy: { kn: 18, rise: 1.2,   // kn: only when the wind level is unknown
    baseS: 10, clearS: 15, roundUps: 2, showS: 20 },   // mastered: a level-4 gust and no round-up for 15 s; struggling: 2 round-ups
  shifts: { headerDeg: 4, refS: [70, 12], nowS: [12, 4], count: 3 },            // pro: a tack after the wind headed you ≥ 4°, three times
  surfing: { bursts: 3, on: 0.5, off: 0.25 },                                   // pro: three surf bursts
  // not a skill: a lost player (feat/chart's ask): over 2 min circling (≥ 360° of turn) inside 250 m of where it
  // was, ≥ 300 m sailed, ≥ 500 m from the island → "N the chart", once per browser
  lost: { windowS: 120, turnDeg: 360, radiusM: 250, pathM: 300, farM: 500, island: { x: -19.6, z: 17.3 } },
};
// The pro: steering mastered, the sails set early (≥ 70 % full over ≥ 20 s from a first sheet key inside 30 s) and a
// clean tack, all inside the first 60 s of a session → every newbie hint goes quiet (saved).
export const PRO = { withinS: 60, trimS: 20, trimFrac: 0.7, firstSheetS: 30, cleanTacks: 1 };
// The crew's net (sheets.js): 12 s, 25 s once trim is mastered, off once the groove is too; or the player's setting.
export const NET = { start: 12, trimmed: 25, auto: 'auto', steps: ['auto', 12, 25, 'off'] };
// The hint each struggle asks for (controlsHint.js's states), in priority order: the boat stuck first, the sails (the
// engine), heavy air, the gybe, the helm, then the subtle ones.
const ORDER = [['tacking', 'tack'], ['nogo', 'irons'], ['trim', null], ['heavy', 'heavy'], ['gybing', 'gybe'], ['steering', 'steer'], ['gusts', 'gusts'], ['groove', 'groove'], ['lost', 'chart']];

export function createSkills({ storage = null, now = () => new Date().toISOString(), rules = RULES } = {}) {
  const R = rules;
  // ---- the save ----
  let save = { v: 1, mastered: {}, grooveS: 0, pro: null, iSail: false, net: 'auto', pilot: null, once: {} };
  try { const raw = storage?.getItem(KEY); if (raw) { const j = JSON.parse(raw); if (j && j.v === 1) save = { ...save, ...j, mastered: { ...j.mastered }, once: { ...j.once } }; } } catch { /* corrupt or absent: start clean */ }
  const persist = () => { try { storage?.setItem(KEY, JSON.stringify(save)); } catch { /* full or private: keep it in memory */ } };
  const listeners = [];
  const emit = (ev) => { for (const f of listeners) try { f(ev); } catch { /* a listener's fault is its own */ } };
  const isMastered = (id) => !!save.mastered[id];
  function master(id) { if (isMastered(id)) return; save.mastered[id] = now(); persist(); emit({ type: 'mastered', id }); }

  // ---- the session ----
  let t = 0, last = null;
  const hist = [];                     // 4 Hz: { t, heading, sog, twa, tws, from }
  let histAt = -Infinity;
  const why = {};                      // the struggle now, per skill: a reason or null
  // steering
  let steeredEver = false, steerFrom = null, steerOff = 0, chosen = false, lastSteerSign = 0, segStart = 0, reversals = [];
  // trim
  let sheetFirstAt = null, trimSetAt = null, fullFor = 0, luffFor = 0, stallFor = 0, bin = null; const bins = [];
  let proGood = 0, proAll = 0;
  // no-go
  let closeFor = 0, closeBad = 0, headFor = 0;
  // tacking
  const tacks = []; let cleanTacks = 0, attemptAt = null, stuckFor = 0, steerAt = -Infinity;
  // gybing
  let boomSide = 0, sideMax = 0, gybe = null, crashes = 0, crashAt = -Infinity;
  // gusts
  let patch = null, seenSide = 0, seenFor = 0, intoN = 0, missedN = 0;
  // groove
  let sailingS = 0, grooveSaveAt = 0, wasLocked = false;
  // heavy air
  let heavyGust = null, roundUps = 0, roundAt = -Infinity, prevRound = 0;
  // shifts, surfing
  let headers = 0, surfOn = false, bursts = 0;

  const meanOf = (key, t0, t1) => { let s = 0, n = 0; for (const h of hist) if (h.t >= t0 && h.t < t1) { s += h[key]; n++; } return n ? s / n : null; };
  const circMean = (t0, t1) => { let sx = 0, sz = 0, n = 0; for (const h of hist) if (h.t >= t0 && h.t < t1) { sx += Math.sin(h.from); sz += Math.cos(h.from); n++; } return n ? Math.atan2(sx, sz) : null; };
  const at = (t0) => { let best = null; for (const h of hist) { if (h.t > t0) break; best = h; } return best ?? hist[0]; };

  function update(dt, S) {
    if (!S || !(dt > 0)) return;
    t += dt;
    const twa = S.twa ?? 0, atwa = Math.abs(twa), sog = S.sog ?? 0, heading = S.heading ?? 0;
    const steer = S.steer ?? 0, pull = S.pull ?? 0, fill = S.mainFill ?? 1;
    const awa = Math.abs(S.awa ?? twa), stall = awa < R.trim.stallAwaDeg * DEG ? (S.mainStall ?? 0) : 0;
    const from = wrap(heading + twa);
    const pushed = t - histAt >= 0.25 - 1e-9;
    if (pushed) {
      hist.push({ t, heading, sog, twa, tws: S.tws ?? 0, from, x: S.x ?? null, z: S.z ?? null }); histAt = t;
      while (hist.length && hist[0].t < t - 130) hist.shift();
    }

    // ---- steering ----
    const St = R.steering;
    if (steer !== 0) {
      if (!steeredEver) steeredEver = true;
      if (steerFrom == null) steerFrom = heading;
      steerOff = 0; steerAt = t;
      const sg = Math.sign(steer);
      if (lastSteerSign && sg !== lastSteerSign) { if (t - segStart >= St.zigzagSegS) reversals.push(t); segStart = t; }
      else if (!lastSteerSign) segStart = t;
      lastSteerSign = sg;
    } else if (steerFrom != null && (steerOff += dt) > 3) steerFrom = null;
    if (steerFrom != null && Math.abs(wrap(heading - steerFrom)) >= St.chosenDeg * DEG) chosen = true;
    while (reversals.length && reversals[0] < t - St.zigzagS) reversals.shift();
    if (pushed && !isMastered('steering') && chosen && hist.length && hist.at(-1).t - hist[0].t >= St.holdS) {
      const win = hist.filter((h) => h.t >= t - St.holdS);
      const ref = win.at(-1).heading;
      let ok = win[0].t <= t - St.holdS + 0.3;
      for (const h of win) if (Math.abs(wrap(h.heading - ref)) > St.holdDeg * DEG || h.sog < St.minSog || Math.abs(h.twa) < St.minTwaDeg * DEG) { ok = false; break; }
      if (ok) master('steering');
    }
    if (pushed) {
      let reason = null;
      const win = hist.filter((h) => h.t >= t - St.zigzagS);
      let lo = Infinity, hi = -Infinity, acc = 0;
      for (let i = 1; i < win.length; i++) { acc += wrap(win[i].heading - win[i - 1].heading); lo = Math.min(lo, acc); hi = Math.max(hi, acc); }
      if (reversals.length >= St.zigzagN && hi - lo >= St.zigzagSwingDeg * DEG) reason = 'zigzag';
      const cw = hist.filter((h) => h.t >= t - St.circleS); let turn = 0;
      for (let i = 1; i < cw.length; i++) turn += wrap(cw[i].heading - cw[i - 1].heading);
      if (Math.abs(turn) >= St.circleDeg * DEG && steeredEver) reason = 'circles';
      if (!steeredEver && ((trimSetAt != null && t >= St.idleAfterTrimS) || t >= St.idleS)) reason = 'idle';
      why.steering = reason;
    }

    // ---- sail trim ----
    const Tr = R.trim;
    const irons = atwa < Tr.ironsTwaDeg * DEG;
    const luff = !irons && fill < Tr.luffFill, stalled = !luff && stall > Tr.stall;
    const good = fill >= Tr.fill && stall <= Tr.stall;
    if (pull !== 0 && sheetFirstAt == null) sheetFirstAt = t;
    fullFor = fill >= Tr.fill ? fullFor + dt : 0;
    if (sheetFirstAt != null && trimSetAt == null && fullFor >= 2) trimSetAt = t;
    luffFor = luff ? luffFor + dt : 0; stallFor = stalled ? stallFor + dt : 0;
    if (S.crew) { luffFor = 0; stallFor = 0; }                     // the crew is trimming: not the player's struggle
    // 1 s bins over the last 60 s: the share of time full, any crew
    if (!bin || t - bin.t0 >= 1) { if (bin) bins.push(bin); while (bins.length > Tr.windowS) bins.shift(); bin = { t0: t, good: 0, all: 0, crew: false }; }
    bin.all += dt; if (good) bin.good += dt; if (S.crew) bin.crew = true;
    if (sheetFirstAt != null) { proAll += dt; if (good) proGood += dt; }
    if (!isMastered('trim') && sheetFirstAt != null && bins.length >= Tr.windowS && bins[0].t0 >= sheetFirstAt - 0.5) {
      let g = 0, a = 0, crew = false; for (const b of bins) { g += b.good; a += b.all; crew ||= b.crew; }
      if (!crew && g / a >= Tr.fullFrac) master('trim');
    }
    why.trim = luffFor > (sheetFirstAt == null ? Tr.firstLuffS : Tr.wrongS) ? 'luff' : stallFor > Tr.wrongS ? 'stall' : null;

    // ---- the no-go zone ----
    const Ng = R.nogo;
    const close = atwa >= Ng.closeDeg[0] * DEG && atwa <= Ng.closeDeg[1] * DEG && fill >= Ng.fill && stall <= Tr.stall && sog >= Ng.minSog;
    if (close) { closeFor += dt; closeBad = 0; } else if ((closeBad += dt) > Ng.graceS) closeFor = 0;
    if (closeFor >= Ng.holdS) master('nogo');
    headFor = atwa < Ng.headDeg * DEG ? headFor + dt : 0;
    why.nogo = headFor > Ng.headS ? 'head' : null;

    // ---- tacking ----
    const Tk = R.tacking;
    if (last && Math.sign(last.twa) !== Math.sign(twa) && Math.abs(last.twa) < Math.PI / 2 && atwa < Math.PI / 2 && twa !== 0 && last.twa !== 0) {
      const v0 = Math.max(0.8, meanOf('sog', t - 14, t - 4) ?? sog);
      const h0 = at(t - 8)?.heading ?? heading;
      tacks.push({ tc: t, v0, h0, turned: false });
      attemptAt = null; stuckFor = 0;
      // wind shifts: did the wind head the last leg? (its direction against the old heading, now vs before)
      const Sh = R.shifts, ref = circMean(t - Sh.refS[0], t - Sh.refS[1]), nw = circMean(t - Sh.nowS[0], t - Sh.nowS[1]);
      if (ref != null && nw != null && hist[0].t <= t - Sh.refS[0] + 30) {
        const header = Math.abs(wrap(ref - h0)) - Math.abs(wrap(nw - h0));
        if (header >= Sh.headerDeg * DEG && ++headers >= Sh.count) master('shifts');
      }
    }
    for (const k of tacks) {
      if (!k.turned && Math.abs(wrap(heading - k.h0)) >= Tk.turnDeg * DEG) k.turned = true;
      if (k.turned && t - k.tc <= Tk.backS && sog >= Tk.backFrac * k.v0 && atwa >= Tk.newTwaDeg * DEG) { k.done = true; cleanTacks++; if (cleanTacks >= Tk.clean) master('tacking'); }
      else if (t - k.tc > Tk.backS) k.done = true;
    }
    for (let i = tacks.length - 1; i >= 0; i--) if (tacks[i].done) tacks.splice(i, 1);
    // a tack attempt: the bow comes up inside the stuck angle with the helm in hand
    if (last && Math.abs(last.twa) >= Tk.stuckDeg * DEG && atwa < Tk.stuckDeg * DEG && t - steerAt <= Tk.steerS) attemptAt = t;
    if (attemptAt != null && (atwa > Tr.ironsTwaDeg * DEG || t - attemptAt > Tk.approachS)) { attemptAt = null; stuckFor = 0; }
    stuckFor = attemptAt != null && atwa < Tk.stuckDeg * DEG && sog < Tk.stuckSog ? stuckFor + dt : 0;
    why.tacking = stuckFor >= Tk.stuckS ? 'stuck' : null;

    // ---- gybing: the boom's swing across ----
    const Gy = R.gybing, boom = S.boomAngle ?? 0, side = Math.sign(boom);
    if (gybe) {
      gybe.max = Math.max(gybe.max, Math.abs(boom));
      if (t - gybe.t >= Gy.settleS) {
        const swing = (gybe.from + gybe.max) / DEG;
        if (swing > Gy.crashSwingDeg) { crashes++; crashAt = t; } else master('gybing');
        gybe = null;
      }
    }
    if (side && boomSide && side !== boomSide && atwa >= Gy.minTwaDeg * DEG && !gybe) gybe = { t, from: sideMax, max: Math.abs(boom) };
    if (side && side !== boomSide) sideMax = 0;
    if (side) { boomSide = side; sideMax = Math.max(sideMax * Math.exp(-dt / 5), Math.abs(boom)); }
    why.gybing = crashes >= Gy.crashes && t - crashAt < Gy.showS ? 'crash' : null;

    // ---- reading gusts: a dark patch to one side; steer for it ----
    const Gu = R.gusts, g = S.gust;
    if (g && g.here > 0) {
      const sideNow = (g.left ?? 0) >= Math.max(Gu.patchMin, g.here * Gu.sideGain) && (g.left ?? 0) >= (g.right ?? 0) ? -1
        : (g.right ?? 0) >= Math.max(Gu.patchMin, g.here * Gu.sideGain) ? 1 : 0;
      seenFor = sideNow && sideNow === seenSide ? seenFor + dt : 0; seenSide = sideNow;
      if (!patch && seenFor >= Gu.seenS) patch = { side: sideNow, t0: t, ref: g.here, steer: 0, steered: false, gone: 0 };
      if (patch) {
        if (Math.sign(steer) === patch.side) { patch.steer += dt; if (patch.steer >= Gu.steerS) patch.steered = true; }
        patch.gone = sideNow === patch.side ? 0 : patch.gone + dt;
        const entered = g.here >= Math.max(Gu.enterMin, patch.ref * Gu.enterGain);
        if (entered) { if (patch.steered && ++intoN >= Gu.into) master('gusts'); patch = null; seenFor = 0; }
        else if (!patch.steered && (patch.gone >= Gu.goneS || t - patch.t0 > Gu.windowS)) { missedN++; patch = null; seenFor = 0; }
        else if (t - patch.t0 > Gu.windowS) { patch = null; seenFor = 0; }
      }
    }
    why.gusts = missedN >= Gu.missed && !save.once.gusts ? 'missed' : null;

    // ---- the groove ----
    const Gr = R.groove;
    if (sog > Gr.minSog) sailingS += dt;
    const locked = (S.groove ?? 0) > 0;
    if (locked) {
      save.grooveS += dt;
      if (save.grooveS >= Gr.totalS) master('groove');
      else if (t - grooveSaveAt > 2) { grooveSaveAt = t; persist(); }
    } else if (wasLocked) persist();   // the total, saved as the lock ends
    wasLocked = locked;
    why.groove = save.grooveS === 0 && sailingS >= Gr.neverS && !save.once.groove ? 'never' : null;

    // ---- heavy air: a level-4 gust without a round-up ----
    const Hv = R.heavy, round = S.roundUp ?? 0;
    const onset = round > 0.5 && prevRound <= 0.5; prevRound = round;
    if (onset) { roundUps++; roundAt = t; if (heavyGust) heavyGust = null; }
    const strong = S.level != null ? S.level >= 4 : (S.tws ?? 0) >= Hv.kn * KN;   // level 4 (a level-3 gust can pass 18 kn: not heavy air)
    if (!heavyGust && strong && hist.length && hist[0].t <= t - Hv.baseS) {
      const w0 = meanOf('tws', t - Hv.baseS - 2, t - 2);
      // a fresh rise: over the mean now, and not yet 2 s ago (a steady blow after a gust is no new gust)
      if (w0 > 0.5 && (S.tws ?? 0) >= w0 * Hv.rise && (at(t - 2)?.tws ?? 0) < w0 * Hv.rise) heavyGust = { t };
    }
    if (heavyGust && t - heavyGust.t >= Hv.clearS) { master('heavy'); heavyGust = null; }
    why.heavy = roundUps >= Hv.roundUps && t - roundAt < Hv.showS ? 'roundup' : null;

    // ---- surfing ----
    const Sf = R.surfing, sf = S.surf ?? 0;
    if (!surfOn && sf >= Sf.on) { surfOn = true; if (++bursts >= Sf.bursts) master('surfing'); }
    else if (surfOn && sf < Sf.off) surfOn = false;
    why.shifts = null; why.surfing = null;

    // ---- lost (not a skill): circling far from anything for over 2 min ----
    const Lo = R.lost;
    if (pushed && S.x != null && !save.once.chart && hist[0].t <= t - Lo.windowS + 0.5) {
      const win = hist.filter((h) => h.t >= t - Lo.windowS && h.x != null);
      let turn = 0, path = 0, cx = 0, cz = 0;
      for (let i = 1; i < win.length; i++) { turn += Math.abs(wrap(win[i].heading - win[i - 1].heading)); path += Math.hypot(win[i].x - win[i - 1].x, win[i].z - win[i - 1].z); }
      for (const h of win) { cx += h.x / win.length; cz += h.z / win.length; }
      const radius = Math.max(...win.map((h) => Math.hypot(h.x - cx, h.z - cz)));
      why.lost = turn >= Lo.turnDeg * DEG && path >= Lo.pathM && radius <= Lo.radiusM && Math.hypot(S.x - Lo.island.x, S.z - Lo.island.z) >= Lo.farM ? 'circling' : null;
    } else if (save.once.chart) why.lost = null;   // no hints: the pod's trend arrow and the surf itself teach

    // ---- the pro: steering, trim and a tack inside the first minute ----
    if (!save.pro && t <= PRO.withinS && isMastered('steering') && cleanTacks >= PRO.cleanTacks
      && (isMastered('trim') || (sheetFirstAt != null && sheetFirstAt <= PRO.firstSheetS && proAll >= PRO.trimS && proGood / proAll >= PRO.trimFrac))) {
      save.pro = now(); persist(); emit({ type: 'pro' });
    }
    last = { twa, sog, heading };
  }

  function needs() {
    if (muted()) return [];
    const out = [];
    for (const [id, hint] of ORDER) {
      const w = why[id];
      if (!w || (id !== 'lost' && isMastered(id))) continue;
      out.push({ skill: id, hint: hint ?? (w === 'luff' ? 'pull' : 'ease'), why: w });
    }
    return out;
  }
  const muted = () => !!save.pro || !!save.iSail;
  // "reads the wind" (0–1), for the beginners' wind lines (src/air.js): spotting gusts and steering into them (the gusts
  // skill: 3 patches; part-way counts), and tacking on headers (the shifts skill: 3 headers). A pro, or "I sail", reads it
  // already. The gusts count for 0.65, the shifts 0.35 (a header is subtler, and a newcomer rarely meets one early).
  function windRead() {
    if (muted()) return 1;
    const part = (id, n, have) => (isMastered(id) ? 1 : Math.min(1, have / n));
    return Math.min(1, 0.65 * part('gusts', R.gusts.into, intoN) + 0.35 * part('shifts', R.shifts.count, headers));
  }
  function setISail(on = !save.iSail) { save.iSail = !!on; persist(); emit({ type: 'settings', id: 'iSail' }); return save.iSail; }
  // the crew's net: auto (12 → 25 → off with the skill) or the player's 12 / 25 / off
  function cycleNet() { const i = NET.steps.indexOf(save.net); save.net = NET.steps[(i + 1) % NET.steps.length]; persist(); emit({ type: 'settings', id: 'net' }); return save.net; }
  function setNet(v) { save.net = NET.steps.includes(v) ? v : 'auto'; persist(); emit({ type: 'settings', id: 'net' }); return save.net; }
  function netAuto() { return isMastered('trim') && isMastered('groove') ? Infinity : isMastered('trim') ? NET.trimmed : NET.start; }
  function setPilot(on) { save.pilot = on == null ? null : !!on; persist(); emit({ type: 'settings', id: 'pilot' }); return save.pilot; }
  function once(id) { save.once[id] = true; persist(); }   // a hint shown once per browser (gusts, groove)

  return {
    update, needs, windRead, setISail, cycleNet, setNet, setPilot, once,
    mastered: isMastered, struggling: (id) => why[id] ?? null,
    onChange: (f) => { listeners.push(f); return () => listeners.splice(listeners.indexOf(f), 1); },
    get muted() { return muted(); }, get pro() { return !!save.pro; },
    get proUnlocked() { return !!save.pro || isMastered('trim'); },   // the pro rows and the dock's pro button
    get iSail() { return !!save.iSail; },
    get net() { return save.net; }, get netAuto() { return save.net === 'auto'; },
    get netAfter() { return save.net === 'auto' ? netAuto() : save.net === 'off' ? Infinity : save.net; },
    get pilot() { return save.pilot; },
    get t() { return t; },
    get counts() { return { cleanTacks, crashes, intoN, missedN, roundUps, headers, bursts, grooveS: save.grooveS, sailingS, steeredEver, sheetFirstAt, reversals: reversals.length }; },
    get masteredAll() { return { ...save.mastered }; },
    reset() { save = { ...save, mastered: {}, grooveS: 0, pro: null, iSail: false, net: 'auto', pilot: null, once: {} }; persist(); },
  };
}
