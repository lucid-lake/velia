// Regatta's picture (refactor round 3 C4: cut out of index.js createRegatta; one shared state R).
// frame: the props every frame (marks, committee boats, the fleet in its detail bands), the race lines at 10 Hz or on a
// change; paint: the watch, the ladder, the card's line (through the lean skipper) and the tags; lights: a night race's lit marks.
import { BOAT_LENGTH_M } from '../../src/sim/race/course.js';
import { edgeMarker } from '../../src/sim/race/newbie.js';
import { polarKn, polarTargets } from '../../src/sim/ai/skipper.js';
import { KN } from '../../src/sim/boat.js';
import { laneGhost } from './helper.js';
import { ZONE_M, laylineAhead, laylines, lineReadout, tackAngle } from './geometry.js';
import { buildRaceLines, laylinesShown } from './lines.js';
import { LOD_BANDS, fleetLod } from './lod.js';
import { ladderGap } from './ui.js';
import { legKind } from './coach.js';
import { raceLine } from '../../src/ui/phoneQuiet.js';
import { mmss1 } from './review.js';
import { ghostAt, matchChip } from './events.js';
import { GATE, legLine, legMark } from './marks.js';
import { markPose } from '../sim/channelMarks.js';
import { raceLights } from './nightMarks.js';
import { CARD, DEG, LINES_HZ, TAG_MAX_M, compass } from './tuning.js';

/** @param {object} R the Regatta's shared state (index.js createRegatta) */
export function installPicture(R) {
  const { B, W, artOf, boat, canvas, floats, gate, gpuLite, hullRgba, hullTint, lean, lines, lodN, lodOut, lodPts, lodSt, markProbe,
    nearPoses, pic, props, sit, stats, water, windFromAt, zone } = R;
  // the picture: the props every frame (they move), the lines at 10 Hz or when the race's state changes, the tags
  function frame(vp, w, h, dt = 1 / 60, eye = null) {
    if (!R.on) return;
    { const hu = R.hubOpen && !!R.huntSel(); if (hu !== R.huntBare) { R.huntBare = hu; lines.setActive(!hu); props.setActive(!hu); } }   // Explore selected: the area's open water, no race marks or lines (the corners are on the chart)
    R.realT += dt;
    const r = R.S.race, v = r.view('me'), s = B.phys.state, L = R.course.line;
    const windFrom = windFromAt(L.centre[0], L.centre[1]);
    // the props
    props.begin();
    const y = (x, z) => (water?.heightAt ? water.heightAt(x, z) : 0);
    const flagYaw = Math.atan2(Math.cos(windFrom), -Math.sin(windFrom)), tilt = (x, z) => markPose(markProbe(x, z), y);
    const FL = R.course.finish ?? L;   // a place race: the finish line's own boat and pin (its committee end flies the flag)
    props.put('committee', L.committee[0], y(L.committee[0], L.committee[1]), L.committee[1], windFrom, 0, 0, 0xfff4f0ec);
    if (R.course.finish) { props.put('committee', FL.committee[0], y(FL.committee[0], FL.committee[1]), FL.committee[1], windFrom, 0, 0, 0xfff4f0ec); const pf = tilt(FL.pin[0], FL.pin[1]); props.put('pin', FL.pin[0], pf.y, FL.pin[1], flagYaw, pf.heel * Math.cos(pf.yaw), pf.heel * Math.sin(pf.yaw), 0xffffffff, 0, 0.37); }
    if (v.status === 'racing' && v.leg >= R.course.legs.length - 1) props.put('finishFlag', FL.committee[0], y(FL.committee[0], FL.committee[1]), FL.committee[1], windFrom, 0, 0, 0xfff4f0ec);   // the finish's flag (the last leg)
    // the marks ride the waves (channelMarks.js markPose: the sea's slope at the mark), each numbered on its band (+ 100 left to
    // starboard: the band red), the pin's dan buoy flag streaming downwind (the face yaw the wind's way: local +x downwind)
    { const p = tilt(L.pin[0], L.pin[1]); props.put('pin', L.pin[0], p.y, L.pin[1], flagYaw, p.heel * Math.cos(p.yaw), p.heel * Math.sin(p.yaw), 0xffffffff, 0, 0.37); }
    for (const m of R.course.marks) {
      if (m.kind === 'gate') continue;   // a gate is the channel's own two buoys (render/navAids.js): no race buoy on them
      const p = tilt(m.at[0], m.at[1]), k = R.course.legs.findIndex((g) => g.toId === m.id), num = k >= 0 ? legMark(R.course, k).num : 0;
      props.put(m.kind === 'cylinder' ? 'markI' : 'markW', m.at[0], p.y, m.at[1], 0.6, p.heel * Math.cos(p.yaw), p.heel * Math.sin(p.yaw), 0xffffffff, (Number(num) || 0) + (m.rounding === 'starboard' ? 100 : 0), 0.2);
    }
    // R4: each rival in its band from the eye (the boat's position when no eye is given): near on the boat's slots, mid the lite boat,
    // far the silhouette; the arrays are reused
    const E = eye ?? [s.x, 0, s.z];
    lodPts.length = R.S.rivals.length; for (let i = 0; i < R.S.rivals.length; i++) lodPts[i] = R.S.rivals[i].phys.state;
    fleetLod(E, lodPts, gpuLite() ? LOD_BANDS.lite : LOD_BANDS.mac, lodOut, lodSt);   // gpuLite: a phone or a tablet, L2-L3, the race ladder's lite fleet (main.js; features.js fleetDetail); lodSt: a band changes only past 150 m
    let nn = 0; lodN.near = lodN.mid = lodN.far = 0;
    // each rival's float on the boat's sim clock since the last frame (the player's float: once a frame on B.step's simDt)
    const bt = B.t ?? R.realT, fdt = R.floatT == null ? 0 : bt - R.floatT; R.floatT = bt;
    for (let i = 0; i < R.S.rivals.length; i++) {
      const b = R.S.rivals[i], q = b.phys.state, band = boat ? lodOut[i] : (lodOut[i] === 'near' ? 'mid' : lodOut[i]);
      const f = floats.step(b.id, q, bt, fdt);   // heave, pitch and the waves' roll, as the player's pose (src/sim/boat/ride.js)
      lodN[band]++;
      if (band === 'near' && nn < nearPoses.length) {
        const o = nearPoses[nn++];
        o.x = q.x; o.z = q.z; o.heave = f.heave; o.heading = q.heading; o.heel = (q.heel ?? 0) + f.roll; o.pitch = f.pitch; o.boomAngle = q.boomAngle ?? 0; o.jibAngle = q.jibAngle ?? 0;
        o.mainFill = q.mainFill ?? 1; o.jibFill = q.jibFill ?? 1; o.mainDraft = q.mainDraft ?? 1; o.jibDraft = q.jibDraft ?? 1; o.jibBacked = q.jibBacked; o.rudderAngle = q.rudderAngle ?? 0; o.tint = hullTint.get(b.id) ?? 0; o.art = artOf.get(b.id) ?? 0; o.key = b.id;   // key: her own slot (boat.js), her colour with her
      } else props.put(band === 'far' ? 'far' : 'sloop', q.x, f.heave, q.z, q.heading, (q.heel ?? 0) + f.roll, q.boomAngle ?? 0, hullRgba.get(b.id) ?? 0xff2a3a6a, artOf.get(b.id) ?? 0, 0, f.pitch);   // label: her print (raceProps.setArt)
    }
    boat?.setRivals(nn, nearPoses);
    props.end();
    // the lines
    const next = v.target, beat = next && R.course.legs[v.leg]?.toId === R.course.markIds[0] && v.status !== 'finished' && !(R.course.place && sit.legKind !== 'beat');   // a place race: laylines only on a real beat
    const key = `${r.clock < 0 ? 'pre' : r.clock < pic.gunLitS ? 'gun' : 'race'}|${v.ocs}|${v.status}|${v.leg}|${zone.inside}|${R.S.helper}|${sit.cue}|${R.realT < R.legLitUntil}|${R.trial ? Math.floor(r.clock * 2) : ''}`;   // a time trial: its ghost moves
    R.linesT += dt;
    if (key !== R.lastKey || R.linesT >= 1 / LINES_HZ) {
      R.linesT = 0; R.lastKey = key;
      pic.clock = r.clock; pic.ocs = !!v.ocs || v.status === 'ocs'; pic.leg = Math.min(v.leg, R.course.legs.length - 1);
      pic.path = r.clock < 0 ? [s.x, s.z] : null;
      pic.boat[0] = s.x; pic.boat[1] = s.z; pic.march = R.realT; pic.thenLit = R.realT < R.thenUntil; pic.legLit = R.realT < R.legLitUntil; pic.compactScreen = !!R.ui?.compactScreen;
      pic.markM = next?.at ? Math.hypot(s.x - next.at.x, s.z - next.at.z) : Infinity;
      if (r.clock < 0 && R.S.helper) {   // the ghost on the helper's lane, eased (a wind shift moves it gently)
        const g = laneGhost(L, s, tackAngle(s.trueWind?.speed ?? 5, B.phys.vessel?.polar), BOAT_LENGTH_M);
        if (g) { R.S.ghost[0] += (g.x - R.S.ghost[0]) * 0.25; R.S.ghost[1] += (g.z - R.S.ghost[1]) * 0.25; pic.ghostHeading = g.heading; }
      }
      pic.finish = v.status === 'racing' && v.leg >= R.course.legs.length - 1;
      pic.trail = R.trial?.draw?.length > 1 ? R.trial.draw : null; pic.trailBoat = R.trial?.pts?.length ? ghostAt(R.trial.pts, r.clock) : null;   // a time trial: the best run and its ghost
      const nearMark = next?.at && Math.hypot(s.x - next.at.x, s.z - next.at.z) < ZONE_M * 1.6;   // in the zone the turn takes the picture
      if (beat && !nearMark && (v.status === 'racing' || r.clock >= 0)) { const m = next.at ? [next.at.x, next.at.z] : R.course.byId[R.course.markIds[0]].at, al = tackAngle(s.trueWind?.speed ?? 5, B.phys.vessel?.polar); pic.laylines = laylines(m, windFromAt(m[0], m[1]), al, layLen(m, al)); }
      else pic.laylines = null;
      { const a = pic.laylines ? laylineAhead(pic.laylines, s.x, s.z, s.heading) : null; pic.layTarget = a?.side ?? null; pic.layTargetM = a?.m ?? Infinity; }   // the one to tack on (lines.js: lit amber near it)
      // a place race: the gate's line between its buoys (cream; it is the target), the finish line of its own (Tessie's ring is never drawn)
      pic.gateLine = next?.gate && v.status === 'racing' ? R.course.byId[next.mark] : null;
      pic.finishLine = R.course.finish ?? null;
      if (next?.at && v.status === 'racing' && R.aids.zone && !next.gate) {
        zone.at[0] = next.at.x; zone.at[1] = next.at.z; zone.rounding = next.rounding ?? 'port';
        zone.inside = Math.hypot(s.x - zone.at[0], s.z - zone.at[1]) < ZONE_M;
        zone.a0 = Math.atan2(s.z - zone.at[1], s.x - zone.at[0]);
        pic.zone = zone;
        // the rounding gate (owner 2026-11-16): on the side of the mark she must not pass, read from her bearing to the mark, frozen once
        // she is within GATE.freezeK zones (it must not swing round with her), gone inside the zone (the turn arrow and the amber ring)
        if (R.gateLeg !== v.leg) { R.gateLeg = v.leg; R.gateA = null; }
        if (R.gateA == null || pic.markM > GATE.freezeK * ZONE_M) R.gateA = zone.a0;
        gate.at[0] = zone.at[0]; gate.at[1] = zone.at[1]; gate.rounding = zone.rounding; gate.a = R.gateA;
        // near the mark and not counted yet (Beginner, Club; owner 2026-11-17) the gate stays up, inside the zone too, and brightens
        gate.hot = sit.cue;
        pic.gate = zone.inside && !gate.hot ? null : gate;
      } else { pic.zone = null; pic.gate = null; }
      const n = buildRaceLines(W, pic);
      lines.write(W.f32, n); stats.rebuilds++; stats.segments = n;
    }
    if (R.ui) paint(vp, w, h, r, v, s, windFrom, R.linesT === 0, dt);
  }
  // R3: the laylines run from the mark back past the start line (R2's 420 m ended ahead of a boat starting the beat, far off on the
  // horizon); long, they pass beside her and read as mock 3's
  function layLen(m, alpha) { const L = R.course.line.centre; return Math.max(420, (1.25 * Math.hypot(m[0] - L[0], m[1] - L[1])) / Math.max(0.3, Math.cos(alpha))); }

  // the race chip's words by race type (owner 2026-11-17): a match race's gap ("Ahead 12 m" / "Behind 8 m"), a time trial's last split
  // or its best, a pursuit's "Start in 14 s" before her start; a fleet race the ladder's own (null)
  function chipWords(r, v) {
    const ev = R.hand?.event ?? 'fleet';
    let w = null;
    if (ev === 'match') {
      const rid = R.S.rivals[0]?.id, rv = rid ? r.view(rid) : null;
      w = r.clock < 0 || !rv || v.status === 'finished' || rv.status === 'finished' || (v.status !== 'racing' && rv.status !== 'racing') ? (v.status === 'finished' ? (v.place === 1 ? 'Match won' : 'Match lost') : matchChip(null)) : matchChip((v.progressM ?? 0) - (rv.progressM ?? 0));
    } else if (ev === 'trial') {
      const ls = R.trial?.lastSplit;
      w = ls && R.realT < ls.until ? (ls.d == null ? `Mark ${ls.n} \u00b7 first run` : `Mark ${ls.n} \u00b7 ${ls.d > 0 ? '+' : '\u2212'}${Math.abs(ls.d).toFixed(1)} s`) : R.trial?.best ? `Best ${mmss1(R.trial.best.t)}` : 'Time trial';
    } else if (ev === 'pursuit') {
      const sl = R.S.slots?.me ?? 0;
      if (v.status !== 'racing' && v.status !== 'finished' && sl - r.clock > 0.5) w = `Start in ${Math.ceil(sl - r.clock)} s`;
    }
    R.chip = w; stats.chip = w;
    return w;
  }
  // the lean skipper on the card (owner 2026-11-17; v2/ui/leanSkipper.js): each new line is asked once, by its kind (race.<step>,
  // officer.<call>, moment.<id>); a MUST shows at once, a teaching step once ever, the rest never. No lean (a test, a capture): as is
  let leanKey = '', leanOk = true;
  function leanLine(l) {
    const L = lean();
    if (!L || !l) { leanKey = ''; return l; }
    const key = `${l.kind}|${l.id}|${l.call ?? ''}|${l.text}`;
    if (key !== leanKey) { leanKey = key; leanOk = L.gate(l.kind === 'officer' ? `officer.${l.call}` : l.kind === 'coach' ? `race.${l.id}` : `moment.${l.id}`); }
    return leanOk ? l : null;
  }
  // the watch, the fleet, the card's line and the tags (DOM, at projected points)
  const proj = (vp, x, y, z, w, h, o) => { const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]; o.w = cw; o.x = cx / (cw || 1e-6); o.y = cy / (cw || 1e-6); o.px = (o.x * 0.5 + 0.5) * w; o.py = (0.5 - o.y * 0.5) * h; o.vis = cw > 0.1 && Math.abs(o.x) < 1.05 && Math.abs(o.y) < 1.05; return o; };
  const P0 = {}, P1 = {}, ladder = [];
  function paint(vp, w, h, r, v, s, windFrom, full, dt = 0) {
    const L = R.course.line, cw = canvas.clientWidth, ch = canvas.clientHeight;
    const tws = s.trueWind?.speed ?? 5, tg = polarTargets(tws, B.phys.vessel?.polar), vUp = polarKn(tws, tg.up.twa, B.phys.vessel?.polar) * KN * Math.cos(tg.up.twa * DEG);
    const slotMe = R.S.slots?.me ?? 0, rd = lineReadout(L, s, r.clock - slotMe, vUp);   // a pursuit: her own start is her gun
    lean()?.hold('rounding', !!sit.inZone);   // a mark rounding: only a MUST line takes the card (the lean skipper, owner 2026-11-17)
    R.ui.line(leanLine(raceLine(R.coach.line)));
    if (R.ui.pickerOpen && r.clock >= 0) R.ui.picker(false);   // the first race's picker goes at the gun
    // the watch: line 1 the leg (marks.js legLine); line 2's tack cue only while its line is on the water (lines.js laylinesShown)
    if (full) R.ui.watch({ clock: r.clock, status: v.status, ocs: !!v.ocs || v.status === 'ocs', line: rd, slotIn: slotMe > 0 && v.status !== 'racing' && v.status !== 'finished' ? slotMe - r.clock : null, wind: { from: compass(windFrom / DEG), kn: Math.round(tws / KN) },
      next: v.status === 'racing' ? { text: legLine(R.course, v.leg, R.ui.compactScreen) } : null,
      flash: R.realT < R.flashUntil ? R.flash : null, cue: sit.cue && v.status === 'racing' ? `Round mark ${legMark(R.course, v.leg).text} \u2192` : null,
      layline: R.aids.laylines && laylinesShown(pic).includes(pic.layTarget) ? laylineAhead(pic.laylines, s.x, s.z, s.heading) : null, helper: R.S.helper, finish: v.status === 'finished' ? v.finishedAt : null });
    if (full) {   // R4: the ladder with the gaps (metres on a beat, seconds after a mark), the chips
      const order = r.order(); ladder.length = order.length;
      for (let i = 0; i < order.length; i++) {
        const id = order[i], b = R.boatById.get(id), row = ladder[i] ?? (ladder[i] = {});
        row.id = id; row.name = id === 'me' ? 'You' : b?.name ?? id; row.sail = b?.sail ?? null; row.hull = b?.hull ?? null;
        if (r.clock < 0 || i === 0) row.gap = '';
        else { const vb = r.view(id), lg = R.course.legs[Math.min(vb.leg, R.course.legs.length - 1)]; row.gap = vb.status === 'finished' ? '' : ladderGap(r.liveGap(id), !!lg && legKind(lg.from, lg.to, windFrom) === 'beat'); }
      }
      R.ui.fleet(ladder, r.clock, chipWords(r, v));
    }
    const tag = (id, x, y, z, text, sub, amber = false) => { proj(vp, x, y, z, cw, ch, P0); R.ui.tag(id, P0.vis ? P0.px : null, P0.py, text, sub, amber, null, amber ? 3 : 2); };
    if (r.clock < 0) {
      tag('pin', L.pin[0], 8, L.pin[1], 'Pin', 'start end');
      tag('committee', L.committee[0], 8, L.committee[1], 'Committee boat', 'start end');
      if (R.aids.ghost) tag('ghost', R.S.ghost[0], 2.5, R.S.ghost[1], 'Be here at 0:00', null, true); else R.ui.tag('ghost', null);
    } else { R.ui.tag('pin', null); R.ui.tag('committee', null); R.ui.tag('ghost', null); }
    // R4: the rivals' tags: the name and the colour chip only (owner 2026-11-16, one voice per fact: the ladder has the gaps)
    for (const b of R.S.rivals) {
      const q = b.phys.state, d = Math.hypot(q.x - s.x, q.z - s.z);
      if (d > TAG_MAX_M) { R.ui.tag(b.id, null); continue; }
      proj(vp, q.x, ch > cw ? 7 : 13, q.z, cw, ch, P0); R.ui.tag(b.id, P0.vis ? P0.px : null, P0.py, b.name, null, false, b.hull, 1 + 1 / (1 + d));   // names only (owner 2026-11-16)
    }
    // the next mark: a tag on it ("1 · 296 m"; the last leg "FINISH · 120 m" over the committee boat), or an edge tag pointing to it when
    // it is off the screen (the number, the arrow, the metres); no side line (the watch says the side, the gate shows it)
    const lastLeg = v.status === 'racing' && v.leg >= R.course.legs.length - 1;
    if (v.status === 'racing' && (v.target || lastLeg)) {
      const FT = R.course.finish ?? L, k = legMark(R.course, v.leg), at = lastLeg ? { x: FT.committee[0], z: FT.committee[1] } : v.target.at, to = lastLeg ? { x: FT.centre[0], z: FT.centre[1] } : at;
      const d = Math.hypot(to.x - s.x, to.z - s.z), text = `${k.text} \u00b7 ${Math.round(d)} m`;
      proj(vp, at.x, lastLeg ? 9 : 4, at.z, cw, ch, P1);
      if (P1.vis) { R.ui.tag('mark', P1.px, P1.py, text, null, zone.inside && !lastLeg, null, 4); R.ui.edge(null); }
      else { R.ui.tag('mark', null); const e = edgeMarker({ x: P1.x, y: P1.y, w: P1.w }, { width: cw, height: ch, margin: 64 }); R.ui.edge(e.offscreen ? { x: e.x, y: e.y, angleDeg: e.angleDeg, text, sub: null } : null); }
    } else { R.ui.tag('mark', null); R.ui.edge(null); }
    // the marks' number plates on their buoys (none on the last leg: the finish only)
    for (const m of R.course.marks) {
      const d = Math.hypot(m.at[0] - s.x, m.at[1] - s.z);
      if (m.kind === 'gate' && d < CARD.plateMaxM && !lastLeg && v.status !== 'finished') {   // a gate: its number between the buoys
        proj(vp, m.at[0], 3.2, m.at[1], cw, ch, P0); R.ui.plate(m.id, P0.vis ? P0.px : null, P0.py, String(legMark(R.course, R.course.legs.findIndex((g) => g.toId === m.id)).num)); continue;
      }
      if (lastLeg || v.status === 'finished' || d > CARD.plateMaxM) { R.ui.plate(m.id, null); continue; }
      proj(vp, m.at[0], m.kind === 'cylinder' ? 2.8 : 2.4, m.at[1], cw, ch, P0);
      R.ui.plate(m.id, P0.vis ? P0.px : null, P0.py, String(legMark(R.course, R.course.legs.findIndex((g) => g.toId === m.id)).num));
    }
    // the course card: open for the pre-start's first CARD.openS (after the fly-over), folded after; Show course only before the gun
    if (R.cardAuto && !R.fly) { if (R.cardT === 0 && r.clock < 0 && !R.ui.cardOpen) R.ui.card(undefined, { open: true }); if (r.clock < 0) R.cardT += dt; if (R.cardT >= CARD.openS || r.clock >= 0) { R.cardAuto = false; R.ui.card(undefined, { open: false }); } }
    if (R.fly && R.ui.cardOpen) R.ui.card(undefined, { open: false });
    R.ui.card(undefined, { show: r.clock < 0 });
    R.ui.place();
  }

  // step D: the course's lights for this frame (nightMarks.js; 0 by day, outside a race and behind the hub's box laid for a day hand)
  function lights(out, sunElevDeg) {
    if (!R.on || !R.S || !R.course) return 0;
    const v = R.S.race.view('me'), L = R.course.line, y = (x, z) => (water?.heightAt ? water.heightAt(x, z) : 0);
    stats.lit = raceLights(out, { course: R.course, heightAt: y, windFrom: windFromAt(L.centre[0], L.centre[1]), sunElevDeg, finish: v.status === 'racing' && v.leg >= R.course.legs.length - 1 });
    return stats.lit;
  }
  Object.assign(R, { frame, layLen, lights });
}
