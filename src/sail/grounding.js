// Sail's bottom (feat/grounding): what the player meets of src/boat/ground.js. The physics runs in every mode
// (assemble.js puts it in the env); this adds, in Sail,
//   - the shallow-water assist (src/boat/shoalAssist.js): bears the boat away from a shoal, rocks or the shore it would hit within
//     a few seconds, while the Settings switch is on (on by default: a newcomer has it; off is a visible choice there, or ?shoal=0).
//     Pro mode, a Cruise hand-over and the skill model's "not a newbie" detector do not turn it off (fix/regressions, 2026-10-30:
//     Pro had turned it off without a word, so a hand-over from Cruise left the boat free to hit the shore). Steering always wins;
//   - the depth sounder's alarm (src/boat/sounder.js): the DPT readout turns amber under 3 m below the keel, a soft beep;
//   - R.'s words (src/ui/skipper.js NOTES) for shoaling, rocks, the assist, aground, kedging and floating again;
//   - the sounds (a thud on impact, the keel's scrape on sand or rock), the kedge, the quiet logbook entry.
// Plain call from controls.js each frame; ?shoal=0 turns the assist off at the start of a page (Settings: shallow-water assist).
import { predict } from '../sim/boat/ground.js';
import { ShoalAssist } from '../sim/boat/shoalAssist.js';
import { Sounder, GroundTalk } from '../sim/boat/sounder.js';
import { NOTES } from '../ui/skipper.js';

// What decides the shallow-water assist: the Settings switch, and nothing hidden. It stands down only while the boat is made
// fast or coming alongside (held); the player's own steering wins inside ShoalAssist. Pro is not an input here.
export const assistEnabled = ({ on = true, held = false } = {}) => !!on && !held;

export function attachGrounding(core, sail, { hint = null, sea = null, sfx = null, flags = core.flags } = {}) {
  const { phys, ground, groundTerrain: GT } = sail;
  const assist = new ShoalAssist({ depthAt: GT.depthAt, predict: (d, s, o) => predict(d, s, { ...o, rockAt: GT.rockAt }) });
  const sounder = new Sounder(), talk = new GroundTalk();
  let on = flags.shoal !== '0', t = 0, agroundPending = false, lastLevel = 0, state = { engaged: false, heading: null, level: 0 };
  const say = (id, key = 'A') => { const n = NOTES[id]; return n ? hint?.note?.(n.text, key, n.speak, { kind: `sea.${id}` }) : false; };   // kind: a phone's quiet skipper keeps 'sea.aground' (src/ui/phoneQuiet.js)
  // the assist stands down while the boat is made fast (anchor, mooring, pier) and while she is coming alongside a pier or picking up a ball
  // (under 1.6 m/s within 15 m of one): those approaches are deliberate. Passing a pier at speed is not.
  const held = () => !!sea?.held || ((phys.state.sog ?? 0) < 1.6 && ((sea?.tackle?.state.pierGap ?? 99) < 15 || (sea?.tackle?.nearestBall?.(phys.state)?.d ?? 99) < 15));

  // dt: s (the real frame); steering: the player's hand on the helm now; pro: Pro mode (no longer gates the assist); windFrom: rad
  function update(dt, { steering = false, windFrom = 0 } = {}) {
    t += dt;
    const s = phys.state, g = ground.state, h = held();
    // 1. the bottom's events: the thud, the grounding, the refloat
    for (const ev of ground.take()) {
      if (ev.type === 'thud') sfx?.cue('thud', { v: ev.v, mat: ev.mat });
      else if (ev.type === 'aground') { agroundPending = true; say('aground', 'I'); }
      else if (ev.type === 'refloat') say('floating', 'I');
    }
    sfx?.scrape(g.mode === 'afloat' ? 0 : g.scrape, g.mat);
    // 2. the sounder
    const r = sounder.update(dt, { under: g.under, depth: g.depth, sog: s.sog ?? 0, held: h, mode: g.mode }, t);
    if (r.beep) sfx?.cue('beep', { level: r.beep });
    s.sounderLevel = r.level; s.under = g.under; s.depthM = g.depth;   // the chart's DPT reads these (the sounder's own reading: the terrain under the boat, not the chart's 8 m grid)
    // 3. the assist and the warnings (the lookahead runs always; it engages only in assisted play)
    const enabled = assistEnabled({ on, held: h });
    const out = assist.update(s, dt, { enabled, steering, windFrom });
    if (out.event === 'engage') {
      if (!out.trapped) say(`${out.reason}Auto`); else say('boxed', 'S');
    } else if (out.warn && !out.engaged && !h) {
      const id = talk.warn(t, { reason: out.warn.reason, assisting: false });
      if (id) say(id);
    }
    state = { engaged: out.engaged, heading: out.engaged ? out.heading : null, release: out.event === 'release', level: r.level, warn: out.warn ?? null, trapped: out.trapped };
    return state;
  }
  function kedge() {
    const k = ground.kedge(phys.state);
    if (k.ok) say('kedge', 'J'); else if (k.why === 'shallow') say('noKedge', 'J');
    return k;
  }
  return {
    update, kedge, assist, sounder,
    get on() { return on; }, setAssist(v) { on = !!v; if (!on) assist.reset(); return on; },
    get state() { return state; },
    consumeAground() { const v = agroundPending; agroundPending = false; return v; },
  };
}
