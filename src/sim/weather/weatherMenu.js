// The weather the player chooses (owner, 2026-11-10: "we are able to select wind and time, why not also allow user select weather
// from top bar?"): one state behind the top bar's Weather menu, Setup's weather row and Cruise's Mood. Three rows:
//   Clear   blue sky, a few small clouds: the cloud deck's coverage eases down to WEATHER.clear (0.12; round 2, owner
//           2026-11-10: 0.3 still read as Fair at a glance)
//   Fair    the default sky (the deck's coverage as the page started it), unchanged
//   Storm   the afternoon thunderstorm (storm.js), one row for the whole of it, the rainbow included (owner: no row of its own).
//           It lands at arc second WEATHER.stormS0 = 97, 8 s ahead of the gust front (stormArc.js FRONT.atS = 105 s): the cell is
//           already tall out west and the light has flattened, the default seed's next strike is at 103.4 s (6.4 s after the tap;
//           two more at 108.2 and 108.6 s), the front crosses the boat at 8 s, the rain comes from about 15 s, the first scripted
//           ground bolt (HERO, 128 s) at 31 s, and the arc plays on at its real speed to the clearing and the rainbow (215 to
//           292 s: from 118 s after the tap, full at 138 s). Earlier would wait on a far cell; later would skip the front.
//           These are arc seconds, on the scene clock. Cruise's runs at 1x; Sail's runs at 2x (src/sail/controls.js timeScale),
//           as it always has for the storm, so in Sail the wall seconds are half: lightning about 3 s after the tap.
//           Cruise lands earlier in the arc (owner, 2026-11-10: the storm must not hit seconds after the pick there): it sets
//           sky.stormS0 = WEATHER.cruiseS0 = 70 while it runs: the cell builds out west in a quiet sky (the default seed's
//           next strike is at 94.2 s, 24 s after the tap), the gust front 35 s after the tap, the rain from about 50 s, the
//           rainbow from 145 s (full at 165 s). 60 would put a strike 2 s after the tap (62.2 s).
// Clear or Fair during a storm sends it away by the storm's own path (storm.choose('fair'): it clears, or fades out if its rain
// had not come yet) and the sky then eases to the pick. A storm that ends on its own leaves the sky that was chosen before it.
// Cruise's Mood adds Cloudy (the deck up to WEATHER.cloudy); it is not a row here. Nothing is saved: a page starts Fair.
// Plain JS, no DOM, no three.js.
//   const sky = weatherMenu({ storm, deck });   // deck: the cloud deck's coverage uniform ({ value }), src/core/world.js
//   sky.rows → [{ id, name }] (no Storm row when storm is null: a phone)   sky.current() → 'clear' | 'fair' | 'storm' (| 'cloudy')   sky.pick(id) → the id, or null
//   sky.update(t)                 // every frame (the storm's system): the deck eases to the chosen sky; t: the scene clock, s
//   sky.holdClear(on)             // the staged first visit's opening minute (R0): on puts the deck at Clear at once
//                                 // and holds it there whatever the choice; off lets it ease back to the choice (the clouds gather)
export const WEATHER_ROWS = Object.freeze([{ id: 'clear', name: 'Clear' }, { id: 'fair', name: 'Fair' }, { id: 'storm', name: 'Storm' }]);
export const WEATHER = {
  clear: 0.12,     // the deck's coverage under Clear (Fair is the page's own, 0.6 by default): a few small clouds, blue between
  cloudy: 0.85,    // Cruise's Cloudy
  rate: 0.05,      // coverage per second: Fair to Clear in about 10 s, the clouds thinning, never a cut
  stormS0: 97,     // the arc second Storm lands on (see above)
  cruiseS0: 70,    // Cruise's landing second: a build-up first (src/modes/chill/index.js sets sky.stormS0 while it runs)
  easeS: 1.5,      // the storm's light and cell ease in over this long (it starts mid-arc: no pop)
};

export function weatherMenu({ storm = null, deck = null, sky = true, W = WEATHER } = {}) {   // sky: false when no clouds are drawn (a phone)
  const cover0 = deck?.value ?? null;
  const target = { fair: cover0, clear: cover0 == null ? null : Math.min(cover0, W.clear), cloudy: cover0 == null ? null : Math.max(cover0, W.cloudy) };
  let choice = 'fair', clearing = false, lastT = null, s0 = W.stormS0, held = false;
  return {
    // no storm (a phone: src/core/features.js storm, owner 2026-11-18) → no Storm row: the menu offers Clear and Fair only
    // no clouds and no storm (a phone, owner 2026-11-21: "let user select weather on phone is a bug") → no rows: Clear and Fair would
    // look the same, so the top bar and the panel show no Weather at all
    rows: !sky && !storm ? [] : WEATHER_ROWS.filter(({ id }) => id !== 'storm' || storm).map(({ id, name }) => ({ id, name })),
    get choice() { return choice; },   // the sky under (or after) a storm
    get held() { return held; },
    holdClear(on) {
      held = !!on;
      if (held && deck && target.clear != null) deck.value = target.clear;   // the first frame is already clear: no ease
    },
    get stormS0() { return s0; },      // the arc second Storm lands on; a mode may move it (Cruise), null puts the default back
    set stormS0(v) { s0 = Number.isFinite(v) ? v : W.stormS0; },
    current() {
      const run = !!storm?.running;
      if (!run) clearing = false;
      return run && !clearing ? 'storm' : choice;
    },
    pick(id) {
      if (id === 'storm') {
        if (!storm) return null;
        if (!storm.running || clearing) { clearing = false; storm.start({ s0, easeS: W.easeS }); }
        return 'storm';
      }
      if (!(id in target)) return null;
      choice = id;
      if (storm?.running && !clearing) { storm.choose('fair'); clearing = true; }
      return id;
    },
    update(t) {
      const dt = lastT == null ? 0 : Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
      const to = held ? target.clear : target[choice];
      if (!deck || to == null || deck.value === to) return;
      const v = deck.value;
      deck.value = v < to ? Math.min(to, v + W.rate * dt) : Math.max(to, v - W.rate * dt);
    },
  };
}
