// Sail's practice marks on v2 (U15, v1-vs-v2 audit): the enlarged chart's course tool (Lay windward-leeward, Lay triangle, Clear
// course), as v1's src/marks/scene.js gives it to the chart. The sim is the shared one (src/sim/marks: the floating marks, their
// rodes, the boat's hull against them, the course and its tracker); the picture is Regatta's props pipeline (render/raceProps.js:
// W a sphere, I a cylinder, the pin, the committee boat), filled while a course is laid and no race is on. A rounding, a touch
// and the finish are one quiet line in the hint row and the course log (localStorage, as v1's).
//   const C = createSailCourse({ B, windAt, depthAt, surface, note, time, props, raceOn });
//   C.chart        the chart's course tool (chartplotter.js course: kinds, lay, clear, laid, marks(), next, sequence, label, done)
//   C.update(dt)   each Sail frame: the tracker, the props
import { MarkField } from '../../src/sim/marks/field.js';
import { findRoom, CourseTracker, eventLine, COURSE_KINDS, NM } from '../../src/sim/marks/course.js';

export const COURSE_KEY = 'lakeshore.course.v1';   // v1's course log
const PROP_OF = { sphere: 'markW', tetra: 'markW', cylinder: 'markI', pin: 'pin', committee: 'committee' };   // the mark's type → the props' mesh

// B: v2/sim/boat.js (phys, sea); windAt(x, z, t) → { vx, vz }; depthAt(x, z) → m of water; surface: { heightAt(x, z, t) };
// note(text): the quiet hint line; time(): the sim's clock (s); props: render/raceProps.js, null, or a function returning either (the
// props come in their own chunk); wantProps(): asks for them, once a course is laid; raceOn(): a race has the props
export function createSailCourse({ B, windAt, depthAt, surface, note: say = () => {}, time = () => B?.t ?? 0, props: propsIn = null, wantProps = () => {}, raceOn = () => false, storage = null }) {
  const propsNow = () => (typeof propsIn === 'function' ? propsIn() : propsIn);
  const phys = B.phys;
  const log = [], events = [];
  let store = storage; if (store == null) { try { store = globalThis.localStorage ?? null; } catch { store = null; } }
  const field = new MarkField({ surface, windAt, depthAt, onTouch: (ev) => { events.push(ev); note(eventLine(ev)); } });
  let course = null, tracker = null, drawn = false;
  function note(text) {
    if (!text) return;
    log.push({ t: time(), text });
    try { store?.setItem(COURSE_KEY, JSON.stringify(log.slice(-60))); } catch { /* full or blocked */ }
    say(text);
  }
  // the marks step inside the boat's own tick (v1: seamanship's addPost), the same fixed clock; without the tackle, each frame
  const off = B.sea?.addPost ? B.sea.addPost((st, dt, t) => field.step(dt, st, t)) : null;

  function lay(kind = 'windward-leeward', opts = {}) {
    clear();
    const s = phys.state, t = time(), w0 = windAt(s.x, s.z, t), windFrom = Math.atan2(-w0.vx, w0.vz);   // the bearing the wind blows from
    const c = opts.course ?? findRoom({ depthAt, boat: s, windFrom, kind, lengthM: opts.lengthM ?? 0.5 * NM, rounding: opts.rounding ?? 'port' });
    if (!c) { note('no room for a course here'); return null; }
    course = c;
    for (const m of c.marks) field.add({ id: m.id, type: m.type, x: m.x, z: m.z, anchor: { x: m.x, z: m.z }, colour: m.colour, role: m.role });
    field.settle(opts.settleS ?? 150, t);   // the marks drift to where this wind and their rodes put them
    const P = () => Object.fromEntries(field.marks.map((mk) => [mk.id, { x: mk.body.p[0], z: mk.body.p[2] }]));
    tracker = new CourseTracker(c, { positions: P, onEvent: (ev) => { events.push(ev); note(eventLine(ev, c)); } });
    if (!opts.quiet) note(`${c.label}: ${c.marks.length} marks laid`);
    return c;
  }
  function clear() { field.clear(); course = null; tracker = null; }

  // the chart's course tool (v1's chartCourse)
  const chart = {
    kinds: Object.values(COURSE_KINDS).map((k) => ({ id: k.name, label: k.name === 'triangle' ? 'Triangle' : 'Windward-leeward' })),
    lay: (kind) => lay(kind), clear,
    get laid() { return !!course; },
    marks: () => field.marks.map((m) => ({ id: m.id, type: m.type, role: m.role, x: m.body.p[0], z: m.body.p[2] })),
    get next() { return tracker?.current ?? null; },
    get sequence() { return course?.sequence ?? []; },
    get label() { return course?.label ?? null; },
    get done() { return !!tracker?.done; },
  };

  function update(dt) {
    const t = time();
    if (!off && field.marks.length) field.step(dt, phys.state, t);
    if (tracker && !tracker.done) tracker.update(phys.state, t);
    const props = propsNow();
    if (!props && course) wantProps();   // the props' chunk on the first laid course (they draw once built)
    if (!props || raceOn()) return;   // a race owns the props (regatta/index.js frame; its leave turns them off)
    if (!course) { if (drawn) { props.setActive(false); drawn = false; } return; }
    props.setActive(true); drawn = true;
    props.begin();
    for (const m of field.marks) {
      const x = m.body.p[0], z = m.body.p[2], y = surface.heightAt(x, z, t);
      props.put(PROP_OF[m.type] ?? 'markW', x, y, z, m.type === 'committee' ? (course.windFrom ?? 0) : 0, 0, 0, m.type === 'committee' ? 0xfff4f0ec : 0xffffffff);
    }
    props.end();
  }
  function dispose() { off?.(); clear(); if (drawn && !raceOn()) propsNow()?.setActive(false); }

  return { field, chart, lay, clear, update, dispose, log, events, get course() { return course; }, get tracker() { return tracker; }, get drawn() { return drawn; } };
}
