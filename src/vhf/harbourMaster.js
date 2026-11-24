// The harbour master on 16: the weather and the big moments as short VHF calls, in the
// forecast's own local-Kokoro voice, through the same radio (src/vhf/radio.js). Each call is ONE clip of the sprite
// (HM_VOCAB; tools/vhf_voice.py renders them with the forecast's), once per session, never over a forecast, at least
// MIN_GAP_S apart. Plain JS, no DOM: tests/harbourMaster.test.mjs.
//
//   const hm = createHarbourMaster();
//   const call = hm.step(dtReal, { anchored, tws, advisory, busy });  // tws: true wind m/s; busy: the radio is talking
//   if (call) radio.play(radio.plan(call.tokens));                    // call: { id, text, tokens }
//   hm.ask('hm_storm')                                                  // a call the game asks for (it still waits its turn)
export const HM_VOCAB = {
  hm_anchor:   'Harbour master to the sailing vessel. Your anchor is holding. Welcome in, skipper.',
  hm_gust:     'Harbour master to all vessels. Gusts are building on the lake. Reef early, and keep a hand on the sheet.',
  hm_advisory: 'Harbour master to all vessels. A lake wind advisory is now in effect. Take care out there.',
  // the staged first visit's storm (src/ui/firstStage.js): the advisory before the afternoon storm arc (src/weather/)
  hm_storm:    'Harbour master to all vessels. Thunderstorm building over the west ridge. Strong gusts and lightning soon. Reef early.',
};
const SHOW = { hm_anchor: 'Anchor holding. Welcome in.', hm_gust: 'Gusts building. Reef early.', hm_advisory: 'Lake wind advisory in effect.', hm_storm: 'Thunderstorm building over the west ridge.' };
export const HM = {
  warmS: 40,          // the mean needs this long before a gust can be called
  meanS: 30,          // the slow mean's time constant
  gustRatio: 1.3,     // a gust: the wind over this times its slow mean ...
  gustMinKn: 12,      // ... and over this many knots
  advisoryS: 8,       // an advisory day held this long
  minGapS: 60,        // between two calls
};
const KT = 0.514444;
export const call = (id) => ({ id, text: SHOW[id], tokens: [{ id, say: HM_VOCAB[id], show: SHOW[id] }] });

export function createHarbourMaster({ R = HM } = {}) {
  let t = 0, mean = null, anchoredPrev = null, advFor = 0, lastAt = -Infinity;
  const done = new Set(), queue = [], urgent = new Set();
  const want = (id) => { if (!done.has(id) && !queue.includes(id)) queue.push(id); };
  function step(dt, { anchored = false, tws = 0, advisory = false, busy = false } = {}) {
    t += dt;
    // the slow mean of the true wind; a gust is the wind well over it
    mean = mean == null ? tws : mean + (tws - mean) * (1 - Math.exp(-dt / R.meanS));
    if (t > R.warmS && tws >= R.gustRatio * mean && tws / KT >= R.gustMinKn) want('hm_gust');
    // the anchor: down and holding after a time under way (not a start at anchor)
    if (anchoredPrev === false && anchored) want('hm_anchor');
    anchoredPrev = anchored;
    advFor = advisory ? advFor + dt : 0;
    if (advFor > R.advisoryS) want('hm_advisory');
    if (!queue.length || busy || (t - lastAt < R.minGapS && !urgent.has(queue[0]))) return null;
    const id = queue.shift(); done.add(id); lastAt = t;
    return call(id);
  }
  // ask(id): a call the game itself wants made (the staged first visit's storm advisory): first in line, no gap after
  // the last call; it still waits for a quiet radio, and is still once per session
  const ask = (id) => { if (!(id in HM_VOCAB)) return false; urgent.add(id); want(id); const i = queue.indexOf(id); if (i > 0) { queue.splice(i, 1); queue.unshift(id); } return true; };   // first in line, no gap
  return { step, ask, get done() { return [...done]; }, get queued() { return [...queue]; } };
}
