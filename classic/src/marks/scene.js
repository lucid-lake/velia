// The racing marks in Sail (feat/marks): the field of floating marks (field.js) with their models (models.js), wired to
// the boat's physics tick, the chart's course tool, the quiet hint and a soft thump.
//
//   const marks = attachMarks(core, sail, { controls });        // src/modes/daysail/index.js
//   marks.lay('windward-leeward' | 'triangle')   // from the chart's tool: marks set to the wind, found room in deep water
//   marks.clear()                                // the chart's Clear, or the settings
//   the 'marks' service = { field, course, tracker, lay, clear, log }   // the probes (window.__lakeshore.marks) and the chart
//
// The marks step inside the boat's own 60 Hz tick (seamanship's env.post), the same fixed clock, so a collision is
// resolved in the tick it happens. Rounding is read each frame from the boat and the live marks' positions; a rounding
// is one quiet line in the hint row and the course log (kept in memory and in localStorage).
import * as THREE from 'three/webgpu';
import { MarkField } from '../../../src/sim/marks/field.js';
import { buildMark, applyPose, setDaylight } from './models.js';
import { layCourse, findRoom, CourseTracker, eventLine, COURSE_KINDS, NM } from '../../../src/sim/marks/course.js';

const KEY = 'lakeshore.course.v1';
const FAR_DRAW_M = 3500;

// a soft rubbery thump: a damped low sine falling in pitch and a filtered noise puff, louder with the impulse
function createThump({ audio }) {
  let ctx = null, out = null, noise = null;
  audio?.attach?.(({ ctx: c, master }) => {
    ctx = c; out = new GainNode(c, { gain: 0.55 }); out.connect(master);
    noise = new AudioBuffer({ length: Math.round(c.sampleRate * 0.4), sampleRate: c.sampleRate, numberOfChannels: 1 });
    const d = noise.getChannelData(0); let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2 ** 31 - 1; }
  });
  return {
    play(impulse = 100, dist = 5) {
      if (!ctx || ctx.state === 'closed') return false;
      const k = Math.min(1, Math.max(0.12, impulse / 600)) * Math.min(1, 14 / Math.max(4, dist)), t = ctx.currentTime + 0.005;
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: 120 * (0.85 + 0.3 * k) }), g = new GainNode(ctx, { gain: 0 });
      o.frequency.exponentialRampToValueAtTime(48, t + 0.22);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * k, t + 0.006); g.gain.setTargetAtTime(0, t + 0.012, 0.07);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.5);
      const n = new AudioBufferSourceNode(ctx, { buffer: noise }), bp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 420 + 500 * k, Q: 0.7 }), ng = new GainNode(ctx, { gain: 0 });
      ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.5 * k, t + 0.003); ng.gain.setTargetAtTime(0, t + 0.006, 0.035);
      n.connect(bp).connect(ng).connect(out); n.start(t, 0, 0.3);
      return true;
    },
  };
}

export function attachMarks(core, sail, { controls = null } = {}) {
  const { scene, camera, terrain, water, headless, services } = core;
  const { phys } = sail;
  const boatSvc = services.get('boat');   // the 'boat' service (assembleBoat): its env is the wind the marks feel
  const surface = { heightAt: (...a) => water.surface.heightAt(...a) };
  const windAt = (x, z, t) => boatSvc.env(t).windAt(x, z, t);
  const depthAt = (x, z) => -terrain.heightAt(x, z);
  const hint = controls?.hint ?? null;
  const thump = headless ? null : createThump({ audio: core.audio });
  const log = [];
  let store = null; try { store = globalThis.localStorage ?? null; } catch { store = null; }
  const events = [];
  const field = new MarkField({
    surface, windAt, depthAt,
    onTouch: (ev) => {
      events.push(ev);
      const d = Math.hypot(ev.x - phys.state.x, ev.z - phys.state.z);
      thump?.play(ev.impulse, d);
      note(eventLine(ev));
    },
  });
  const group = new THREE.Group(); group.name = 'marks'; scene.add(group);
  const views = new Map();   // id → { lod, flag }
  let course = null, tracker = null;

  // the key argument of hint.note is a keyboard key (it draws a cap): these lines have none (a tag like 'marks.laid' leaked as a chip)
  function note(text) {
    if (!text) return;
    log.push({ t: core.time, text });
    try { store?.setItem(KEY, JSON.stringify(log.slice(-60))); } catch { /* full or blocked */ }
    hint?.note?.(text);
  }

  function addView(m) {
    const lod = buildMark(m.type, { colour: m.colour === 'white' ? 'white' : m.colour });
    group.add(lod);
    const pennants = []; for (const lv of lod.levels) lv.object.traverse((o) => { if (o.name === 'flagPivot') pennants.push(o); });
    views.set(m.id, { lod, flags: pennants });
  }
  function dropViews() { for (const v of views.values()) group.remove(v.lod); views.clear(); }

  function lay(kind = 'windward-leeward', opts = {}) {
    clear();
    const s = phys.state, w0 = windAt(s.x, s.z, core.time), windFrom = Math.atan2(-w0.vx, w0.vz);   // the bearing the wind blows from
    const c = opts.course ?? findRoom({ depthAt, boat: s, windFrom, kind, lengthM: opts.lengthM ?? 0.5 * NM, rounding: opts.rounding ?? 'port' });
    if (!c) { note('no room for a course here'); return null; }
    course = c;
    for (const m of c.marks) {
      const mk = field.add({ id: m.id, type: m.type, x: m.x, z: m.z, anchor: { x: m.x, z: m.z }, colour: m.colour, role: m.role });
      addView(mk);
    }
    // the marks drift to where this wind and their rodes put them; the sea is read at the scene time
    field.settle(opts.settleS ?? 150, core.time);
    const P = () => Object.fromEntries(field.marks.map((mk) => [mk.id, { x: mk.body.p[0], z: mk.body.p[2] }]));
    tracker = new CourseTracker(c, { positions: P, onEvent: (ev) => { events.push(ev); note(eventLine(ev, c)); } });
    publish();
    if (!opts.quiet) note(`${c.label}: ${c.marks.length} marks laid`);   // a race's briefing shows the course itself
    return c;
  }
  function clear() {
    field.clear(); dropViews(); course = null; tracker = null; publish();
  }
  function publish() {
    services.provide('marks', api);
  }

  // the chart reads this
  const chartCourse = {
    kinds: Object.values(COURSE_KINDS).map((k) => ({ id: k.name, label: k.name === 'triangle' ? 'Triangle' : 'Windward-leeward' })),
    lay: (kind) => lay(kind), clear,
    get laid() { return !!course; },
    marks: () => field.marks.map((m) => ({ id: m.id, type: m.type, role: m.role, x: m.body.p[0], z: m.body.p[2] })),
    get next() { return tracker?.current ?? null; },
    get sequence() { return course?.sequence ?? []; },
    get label() { return course?.label ?? null; },
    get done() { return !!tracker?.done; },
  };

  const _c = [0, 0, 0];
  function update(dt) {
    const s = phys.state;
    setDaylight(core.sun?.elevationDeg ?? 20);
    for (const mk of field.marks) {
      const v = views.get(mk.id); if (!v) continue;
      const b = mk.body, d = Math.hypot(b.p[0] - s.x, b.p[2] - s.z);
      v.lod.visible = d < FAR_DRAW_M;
      if (!v.lod.visible) continue;
      applyPose(v.lod, b.centre(_c), b.R);
      v.lod.update(camera);
      if (v.flags.length) {   // the flag streams downwind (relative to the mark's own yaw) and flutters
        const w = windAt(b.p[0], b.p[2], core.time), sp = Math.hypot(w.vx, w.vz) || 1, yaw = Math.atan2(-b.R[6], b.R[0]);
        const th = Math.atan2(-w.vz / sp, w.vx / sp) - yaw;
        for (const f of v.flags) { f.rotation.y = th; f.rotation.z = Math.sin(core.time * 7 + b.p[0]) * 0.05 * Math.min(1, sp / 4); }
      }
    }
    if (tracker && !tracker.done) tracker.update(s, core.time);
  }

  const api = { field, group, views, get course() { return course; }, get tracker() { return tracker; }, lay, clear, log, events, chart: chartCourse, update, step: (dt, st, t) => field.step(dt, st, t), THREE };
  publish();

  // the marks step inside the boat's tick (the dock's env.post hook in seamanship)
  const off = services.get('seamanship')?.addPost?.((st, dt, t) => field.step(dt, st, t));

  function dispose() {
    off?.();
    scene.remove(group); dropViews(); field.clear();
    services.remove('marks', api);
  }
  return { ...api, dispose };
}
