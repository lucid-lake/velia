// Are the kayaks on? (feat/kayaks-default-on, owner 2026-11-08: on by default). One read for every place
// that asks (Sail, Cruise, the fireworks' spectators, the logbook, Settings' row). Plain JS, no imports: the home card
// (src/ui/home.js) reads it in the game's first bundle, before src/kayaks/fleet.js is fetched.
//   kayaksOn(flags.kayaks)   true unless ?kayaks=0 (or =off); ?kayaks=bench (the cost check) counts as on
// The modes that have them: Sail and Cruise. Regatta has none (its course runs over the kayakers' crossings and the
// rival's AI does not see them); School has no mode yet; Fly is a dev mode.
export const kayaksOn = (v) => v !== '0' && v !== 'off';
