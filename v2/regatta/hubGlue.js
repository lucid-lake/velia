// Regatta's hub glue (refactor round 3 C4: cut out of index.js createRegatta; one shared state R).
// The front door: dealing hands (dealNow, deal, dealSel), select then go (select, go, racePlace, cupSail, cupGo, explore),
// Custom (custom, raceCustom, dealForMe), the dials and levels (adjust, setLevel, heard), the hub's open (openHub) and its
// camera behind the hub (hubBlend, hubPose; hubSm eases a new selection's frame, reset on each open).
import { cupAt, isPlace, listCups, placeHand, raceInfo } from '../sim/racePlaces.js';
import { PLACE_CUP, newPlaceCup, placeCupState, savePlaceCup } from './placeCup.js';
import { HUNTS, huntCounts, loadHunts } from './hunts.js';
import { FLEET } from './session.js';
import { LEVELS, aidsFor, saveLevel } from '../sim/raceLevels.js';
import { loadTrial, pursuitOrder, trialKey } from './events.js';
import { cupHand, cupState, cupWords, newCup, saveCup } from './cup.js';
import { PRESETS, clampCustom, customHand, dayOf, dealHand, describeHand, handKey, handSeed, hourCut, saveSetup, windNow, withPreset } from './setup.js';
import { createHub } from './hub.js';
import { easeK } from '../sim/ease.js';
import { HUB_CAM } from './tuning.js';

/** @param {object} R the Regatta's shared state (index.js createRegatta) */
export function installHub(R) {
  const { B, NAMES, canvas, clock, flags, hasF, hubUi, live, memTrial, onLeave, persist, pic, reduced, sky, stats, store, windField } = R;
  // the aids in force: the hand's (its aids dial with the rivals' skill dial apart) or the stored level's (the URL's race)
  const aidsNow = () => (R.hand ? { ...aidsFor(R.hand.aids, { laylines: R.hand.laylines }), tier: R.hand.tier, pace: R.hand.pace } : aidsFor(R.level, { laylines: R.laylinesOpt }));
  // a new hand: dealt from the day and the hands dealt so far (?handseed= pins the day for a test), never the last one twice running
  const seedFor = (n) => handSeed(flags.handseed != null && flags.handseed !== '' ? `seed:${flags.handseed}` : dayOf(), n);
  // the URL's place race: ?handseed= or else ?seed= pins the deal (a capture or a test never reads the calendar); no seed: the player's daily deal
  const urlSeedFor = (n) => (flags.handseed == null || flags.handseed === '') && Number.isFinite(parseInt(flags.seed, 10)) ? handSeed(`seed:${parseInt(flags.seed, 10)}`, n) : seedFor(n);
  function dealNow(given = null) {
    R.hand = given ?? (R.setup.useCustom ? customHand(R.setup, seedFor(R.setup.dealt)) : dealHand(seedFor(R.setup.dealt), R.setup, { last: R.hand ? handKey(R.hand) : R.setup.last }));
    R.level = R.hand.aids; R.laylinesOpt = R.hand.laylines; R.aids = aidsNow(); stats.level = R.level;
    stats.hand = { ...R.hand };
    // the page's conditions to the hand: the wind's level at once over the lake, the clock cut forward to its hour, the sky
    windNow(windField, R.hand.wind, { t: B.t, at: { x: B.phys.state.x, z: B.phys.state.z } });
    hourCut(clock, R.hand.hour);
    try { sky?.(R.hand.sky); } catch { /* the weather menu is not up */ }
  }
  function hubModel() {
    return { hand: R.hand, desc: describeHand(R.hand), course: R.course, windDeg: windField.base?.dirDeg ?? R.course?.designWindFrom ?? 0, setup: R.setup, fleet: FLEET.slice(0, R.hand.rivals).map((f) => ({ name: f.name, sail: f.sail, hull: f.hull })), custom: !!R.hand.custom,
      event: R.hand.event ?? 'fleet', pursuit: R.S?.slots ? pursuitOrder(R.S.slots, NAMES) : null, trialBest: R.hand.event === 'trial' ? (persist ? loadTrial(store, trialKey(R.hand)) : memTrial.get(trialKey(R.hand)) ?? null)?.t ?? null : null,
      cup: cupWords(R.cup, NAMES), cupState: cupState(R.cup, NAMES),
      cups: listCups({ store: persist ? store : null, has: hasF, hunts: huntCounts(persist ? loadHunts(store) : {}) }),   //: the hub's cups; a race this device cannot run is flagged unavailable; each cup's hunt count
      selected: R.sel, cupNow: cupAt(B.phys.state.x, B.phys.state.z), placeCup: placeCupState(R.placeCup, NAMES) };   // phase 2: the hub opens on the cup of the area the boat is in
  }
  // select, then go (owner 2026-11-20,'s hub: select, then go): the hub's selected place race is the hand in force, so the
  // lake behind the hub lays its start area, marks and lines; the hub opens on the first race of the area's cup (or the race just sailed)
  // the selection is a place race ('tea-house-run'), the cup's series ('cup:emerald-bay': preview the first race, To the line sails the three)
  // or the cup's hunt ('hunt:chart-the-bay': the water frames its area with the corners as hints, the button says Explore)
  const raceOk = (id) => isPlace(id) && !!raceInfo(id, { has: hasF })?.available;
  const firstOf = (cupId) => listCups({ has: hasF }).find((x) => x.id === cupId)?.races.find((r) => r.available)?.id ?? null;
  const selOk = (id) => { if (typeof id !== 'string') return false; const [k, v] = id.split(':'); return k === 'cup' ? !!firstOf(v) : k === 'hunt' ? HUNTS.some((h) => h.id === v && firstOf(h.cup)) : raceOk(id); };
  const previewRace = (id) => { const [k, v] = (id ?? '').split(':'); return k === 'cup' ? firstOf(v) : k === 'hunt' ? firstOf(HUNTS.find((h) => h.id === v)?.cup) : id; };
  const huntSel = () => (R.sel?.startsWith('hunt:') ? HUNTS.find((h) => `hunt:${h.id}` === R.sel) ?? null : null);
  function startSel() {
    if (raceOk(R.hand?.place)) return R.hand.place;
    const cups = listCups({ has: hasF }), c = cups.find((x) => x.id === cupAt(B.phys.state.x, B.phys.state.z) && x.races.some((r) => r.available)) ?? cups.find((x) => x.races.some((r) => r.available));
    return c?.races.find((r) => r.available)?.id ?? null;
  }
  function dealSel(id) {
    R.sel = selOk(id) ? id : null;
    dealNow(R.sel ? placeHand(previewRace(R.sel), R.setup, { seed: seedFor(R.setup.dealt), levels: LEVELS }) : null);
  }
  function select(id) {
    if (!R.hubOpen || !selOk(id)) return R.api;
    if (id !== R.sel || R.hand?.place !== previewRace(id)) { const was = R.hand?.place; R.sel = id; if (was !== previewRace(id)) { dealSel(id); R.relay(); } }
    R.hub?.paint(hubModel());
    return R.api;
  }
  // Explore (the hunt's row): free sailing with the hunt on (the corners are found by sailing there in Sail, and show on the chart)
  function explore() { if (!R.hubOpen) return R.api; try { onLeave(); } catch (e) { console.error(e); } return R.api; }
  function openHub() {
    if (!R.on || !R.door.hub) return R.api;
    if (R.hubOpen) return R.api;
    R.ui?.dispose(); R.ui = null;
    R.hubOpen = true; stats.hub = true; R.hubT = 0; R.hubSm = null;   // the eased frame starts from this hub's own (a stale one drifted from the old bay)
    dealSel(startSel()); R.relay();
    if (hubUi) { R.hub ??= makeHub(); R.hub.show(hubModel()); }
    return R.api;
  }
  const makeHub = () => createHub({ onGo: () => go(), onAdjust: (s) => adjust(s), onLeave: () => onLeave(), onCustom: (p) => custom(p), onRaceCustom: () => raceCustom(), onDealForMe: () => dealForMe(), onRace: (id) => racePlace(id), onSelect: (id) => select(id), onExplore: (id) => explore(id), onCupSail: (id) => cupSail(id) });
  // the Emerald Cup: the Cup in progress, or a new one (none yet, or the last one done); its next race's hand, sailed at once
  function ensureCup(fresh = false) {
    const st = cupState(R.cup, NAMES);
    if (fresh || st.none || st.done) { R.cup = newCup(seedFor(`cup${R.setup.dealt}`), R.setup); if (persist) R.cup = saveCup(store, R.cup) ?? R.cup; }
    return R.cup;
  }
  function cupGo() {
    if (!R.hubOpen) return R.api;
    ensureCup();
    dealNow(cupHand(R.cup, R.setup)); R.relay();
    R.hub?.paint(hubModel());
    return go();
  }
  // a race straight from the results card (the Cup's Next race ›, Start a new Cup): no hub, the conditions set, the course flown if new
  function raceHand(h) {
    if (!R.on || R.hubOpen || !h) return R.api;
    R.ui?.results(null);
    R.setup.dealt++; R.setup.raced++; R.setup.last = handKey(h); if (persist) R.setup = saveSetup(store, R.setup);
    dealNow(h); R.relay();
    R.paintClock(); R.maybeFly();
    return R.api;
  }
  function cupNext() { if (R.hand?.placeCup) return cupSail(R.hand.placeCup.cup, { fresh: false }); if (!R.cup || cupState(R.cup, NAMES).done) return cupNew(); return raceHand(cupHand(R.cup, R.setup)); }
  function cupNew() { if (R.hand?.placeCup) return cupSail(R.hand.placeCup.cup, { fresh: true }); ensureCup(true); return raceHand(cupHand(R.cup, R.setup)); }
  // Another hand: the next hand, the conditions and the box laid again; the hub repaints
  function deal() {
    if (!R.hubOpen) return R.api;
    R.setup.dealt++; R.setup.useCustom = false; if (persist) R.setup = saveSetup(store, R.setup);
    R.sel = null; dealNow(); R.relay();
    R.hub?.paint(hubModel());
    return R.api;
  }
  // Custom race: a pick stored (clamped); the sheet repaints from the setup (the box behind is laid again only at Race ›)
  function custom(patch = {}) {
    const c = clampCustom({ ...R.setup.custom, ...patch });
    if (patch.course && patch.laps == null && patch.course !== R.setup.custom.course) c.laps = clampCustom({ course: c.course }).laps;   // a course brings its own laps
    R.setup = { ...R.setup, custom: c };
    if (persist) R.setup = saveSetup(store, R.setup);
    if (R.hubOpen) R.hub?.paint(hubModel());
    return R.api;
  }
  // Race ›: the Custom race remembered as the player's race, its conditions on the page, the box laid, and in the box at once
  function raceCustom() {
    if (!R.hubOpen) return R.api;
    R.setup = { ...R.setup, useCustom: true }; if (persist) R.setup = saveSetup(store, R.setup);
    dealNow(); R.relay();
    R.hub?.paint(hubModel());
    return go();
  }
  // a place race (places.js): its hand (the hour, the rivals), the conditions on the page, the box laid, and in the box at once (from the
  // hub or from a race; the URL's ?course=<id> enters it straight)
  function racePlace(id, { series = null } = {}) {
    if (!R.on || !isPlace(id)) return R.api;
    R.ui?.results(null);
    if (R.hubOpen) { R.hubOpen = false; stats.hub = false; R.hub?.hide(); }
    const h = placeHand(id, R.setup, { seed: seedFor(R.setup.dealt), levels: LEVELS, rivals: series ? PLACE_CUP.rivals : null });
    if (series) h.placeCup = series;   // Sail the cup: this race's place in the series ({ cup, i, of })
    dealNow(h);
    R.setup.dealt++; R.setup.raced++; if (persist) R.setup = saveSetup(store, R.setup);
    R.relay(); R.startUi(); R.ui?.watch && R.paintClock(); R.maybeFly();
    return R.api;
  }
  // Sail the cup (phase 2): the cup's races this device can run, back to back, one series (a new one each time it is asked for from the
  // hub); the first race at once, the results card's Next race › the next (cupNext), Start a new Cup the series again (cupNew)
  function cupSail(cupId, { fresh = true } = {}) {
    if (!R.on) return R.api;
    const c = listCups({ has: hasF }).find((x) => x.id === cupId), ids = (c?.races ?? []).filter((r) => r.available).map((r) => r.id);
    if (!ids.length) return R.api;
    if (fresh || !R.placeCup || R.placeCup.cup !== cupId || placeCupState(R.placeCup).done) { R.placeCup = newPlaceCup(cupId, ids, R.setup.dealt + 1); if (persist) R.placeCup = savePlaceCup(store, R.placeCup) ?? R.placeCup; }
    const st = placeCupState(R.placeCup);
    stats.placeCup = { cup: R.placeCup.cup, sailed: st.sailed, of: st.of };
    return racePlace(st.next, { series: { cup: R.placeCup.cup, i: st.sailed, of: st.of } });
  }
  // Deal for me: back to dealt hands (a new hand on the hub)
  function dealForMe() {
    if (!R.hubOpen) return R.api;
    R.setup = { ...R.setup, useCustom: false }; if (persist) R.setup = saveSetup(store, R.setup);
    R.hub?.custom?.(false);
    dealSel(startSel()); R.relay(); R.hub?.paint(hubModel());   // the hub's choosing card has no dealt hands: back to a race
    return R.api;
  }
  // the two dials (or a preset over both): stored; the hand keeps its conditions and takes the new rivals and aids
  function adjust(s = {}) {
    R.setup = { ...R.setup, skill: s.skill ?? R.setup.skill, aids: s.aids ?? R.setup.aids, laylines: s.aids && s.aids !== 'pro' ? false : !!(s.laylines ?? R.setup.laylines) };
    if (persist) { R.setup = saveSetup(store, R.setup); R.level = R.setup.aids; R.laylinesOpt = R.setup.laylines; saveLevel(store, { level: R.setup.aids, laylines: R.setup.laylines }); }
    if (R.hand) {
      const L = LEVELS[R.setup.aids];
      R.hand = { ...R.hand, skill: R.setup.skill, tier: R.setup.skill, aids: R.setup.aids, laylines: R.setup.aids === 'pro' ? R.setup.laylines : L.laylines === true, helper: L.helper, forgiving: L.forgiving, pace: R.hand.custom ? R.hand.pace : L.pace, prestartS: R.hand.custom || R.setup.aids === 'pro' ? R.hand.prestartS : 0 };
      stats.hand = { ...R.hand };
    }
    R.level = R.hand?.aids ?? R.setup.aids; R.laylinesOpt = R.hand?.laylines ?? R.setup.laylines; R.aids = aidsNow(); stats.level = R.level;
    if (R.S) { if (B.driven) B.drive(null); R.build(); }
    if (R.hubOpen) R.hub?.paint(hubModel());
    return R.api;
  }
  // In the box: the hub goes, the race from −0:45 with the hand's settings (a fresh session at this moment)
  function go() {
    if (!R.hubOpen) return R.api;
    R.hubOpen = false; stats.hub = false;
    R.hub?.hide();
    R.setup.dealt++; R.setup.raced++; R.setup.last = handKey(R.hand); if (persist) R.setup = saveSetup(store, R.setup);
    R.startUi();
    if (B.driven) B.drive(null);
    R.build();
    R.ui?.watch && R.paintClock();
    R.maybeFly();
    return R.api;
  }
  function setLevel(id, ll = false) {
    if (!LEVELS[id]) return;
    const same = id === R.level && (!R.hand || (R.hand.skill === PRESETS[id].skill));
    R.level = id; R.laylinesOpt = !!ll;
    if (R.hand || R.door.deal) {   // the front door's race: a level is a preset over both dials, kept in the setup
      R.setup = { ...withPreset(R.setup, id), laylines: id === 'pro' && !!ll };
      if (persist) R.setup = saveSetup(store, R.setup);
      if (R.hand) { const L = LEVELS[id]; R.hand = { ...R.hand, skill: R.setup.skill, tier: R.setup.skill, aids: id, laylines: id === 'pro' ? !!ll : L.laylines === true, helper: L.helper, forgiving: L.forgiving, pace: R.hand.custom ? R.hand.pace : L.pace, prestartS: R.hand.custom || id === 'pro' ? R.hand.prestartS : 0 }; stats.hand = { ...R.hand }; }
    }
    R.aids = aidsNow(); stats.level = R.level;
    if (live) saveLevel(store, { level: R.level, laylines: R.laylinesOpt });
    if (R.hubOpen) { if (B.driven) B.drive(null); R.build(); R.hub?.paint(hubModel()); return; }
    if (!R.S) return;
    if (same) { pic.aids = R.aids; R.lastKey = ''; R.ui?.level(R.aids); return; }   // the same level (Pro's laylines on or off): the race goes on
    if (B.driven) B.drive(null);
    R.build();   // a new session: the helper, the rivals' tier, the penalties of this level; back in the box at −0:45
  }
  // a level saved elsewhere (Setup's row; the picker's own save comes back here too and is the level in force already)
  function heard(e) { const d = e?.detail; if (d && LEVELS[d.level] && (d.level !== R.level || !!d.laylines !== R.laylinesOpt)) setLevel(d.level, d.laylines); }

  // step D1: behind the hub the camera shows the course, not only the boat: the start area and mark 1 from
  // behind the line, high enough for both, drifting slowly about their middle (HUB_CAM: ±0.22 rad, a breath at 0.12 rad/s, a little
  // rise and fall); the frame's subject sits right of the hub's column on a wide screen (the aim led left). hubK eases it in and out
  // (rates per second, compounded: sim/ease.js), so hub → race and race → hub are one smooth move, never a cut
  function hubBlend(dt, portrait, cam) {
    R.hubK += ((R.hubOpen ? 1 : 0) - R.hubK) * easeK(HUB_CAM.inRate, dt);
    if (R.hubOpen) R.hubT += dt;
    if (R.hubK > 1e-3) {
      const h = hubPose(portrait), w = R.hubK * R.hubK * (3 - 2 * R.hubK), lerp = (a, b) => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
      // select, then go: a new selection lays a new course, so the hub's frame glides to it (HUB_CAM.selRate, compounded) and never snaps;
      // Reduce Motion (and the hub's first frame) cut
      if (!R.hubSm || reduced()) R.hubSm = { pos: [...h.pos], target: [...h.target], fov: h.fov };
      else { const k = easeK(HUB_CAM.selRate, dt); for (const q of ['pos', 'target']) for (let i = 0; i < 3; i++) R.hubSm[q][i] += (h[q][i] - R.hubSm[q][i]) * k; R.hubSm.fov += (h.fov - R.hubSm.fov) * k; }
      cam.pos = lerp(cam.pos, R.hubSm.pos); cam.target = lerp(cam.target, R.hubSm.target); cam.fov += (R.hubSm.fov - cam.fov) * w;
      stats.hubCam = { k: +R.hubK.toFixed(3), d: +h.d.toFixed(1), at: [+R.hubSm.target[0].toFixed(0), +R.hubSm.target[2].toFixed(0)], lag: +Math.hypot(h.target[0] - R.hubSm.target[0], h.target[2] - R.hubSm.target[2]).toFixed(1) };
    } else R.hubSm = null;
    return cam;
  }
  // step D1: the hub's camera: from behind the start line (its centre) looking up the course to mark 1; the eye's distance and height
  // from the leg's length (mark 1 and the line both in the frame at the hub's lens), the drift about the middle of the two
  function hubPose(portrait = false) {
    const hunt = R.hubOpen ? huntSel() : null;
    if (hunt) {   // the hunt's area from high above its corners' middle (the corners are hints on the water: frame())
      const P = hunt.corners.map((c) => c.at), cx = P.reduce((a, q) => a + q[0], 0) / P.length, cz = P.reduce((a, q) => a + q[1], 0) / P.length, sp = Math.max(...P.map((q) => Math.hypot(q[0] - cx, q[1] - cz))), d = Math.max(300, sp * 1.1);
      const a = HUB_CAM.yaw0 + HUB_CAM.yaw * Math.sin(R.hubT * HUB_CAM.rate), rad = d * 1.2 + 80, fx = -Math.sin(a), fz = -Math.cos(a), cw = canvas?.clientWidth ?? 0;
      const wide = portrait || !cw ? 0 : cw >= 1000 ? HUB_CAM.lead : HUB_CAM.leadTight;
      return { pos: [cx - fx * rad, 60 + d * 0.8, cz - fz * rad], target: [cx + fz * wide * d, 0, cz - fx * wide * d], fov: portrait ? 60 : HUB_CAM.fov, d };
    }
    const L = R.course.line, m1 = R.course.byId?.[R.course.markIds?.[0]]?.at ?? [L.centre[0] + L.up[0] * 200, L.centre[1] + L.up[1] * 200];
    const ux = m1[0] - L.centre[0], uz = m1[1] - L.centre[1], d = Math.max(60, Math.hypot(ux, uz)), fx = ux / d, fz = uz / d;
    const mx = L.centre[0] + fx * d * HUB_CAM.mid, mz = L.centre[1] + fz * d * HUB_CAM.mid;
    const side = Math.sign((L.committee[0] - L.centre[0]) * fz - (L.committee[1] - L.centre[1]) * fx) || 1;   // the committee boat's side of the leg
    const a = HUB_CAM.yaw0 * side + HUB_CAM.yaw * Math.sin(R.hubT * HUB_CAM.rate), c = Math.cos(a), sn = Math.sin(a);
    const back = HUB_CAM.back0 + d * HUB_CAM.backK, up = HUB_CAM.up0 + d * HUB_CAM.upK + HUB_CAM.bob * Math.sin(R.hubT * HUB_CAM.rate * 0.7 + 1.3);
    const ex = -fx * (back + d * HUB_CAM.mid), ez = -fz * (back + d * HUB_CAM.mid);   // the eye from the middle, behind the line
    const pos = [mx + ex * c - ez * sn, up, mz + ex * sn + ez * c];
    // the aim led to the left of the middle on a wide screen (the subject right of the column), level on an upright or phone screen
    const cw = canvas?.clientWidth ?? 0, wide = portrait || !cw ? 0 : cw >= 1000 ? HUB_CAM.lead : HUB_CAM.leadTight, lx = -fz, lz = fx;
    const lead = -wide * d;
    return { pos, target: [mx + lx * lead, 0, mz + lz * lead], fov: portrait ? 60 : HUB_CAM.fov, d };
  }
  Object.assign(R, { urlSeedFor, dealNow, hubModel, huntSel, startSel, dealSel, select, explore, openHub, makeHub, cupGo, cupNext, cupNew,
    deal, custom, raceCustom, racePlace, cupSail, dealForMe, adjust, go, setLevel, heard, hubBlend });
}
