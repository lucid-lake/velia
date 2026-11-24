// The station registry (refactor round 2, Phase C step 9): the player's controls
// on screen, by craft. A craft's controller mounts its station through here, never by importing a station's files, so a
// paddle station is a new folder (src/stations/<craft>/) and a row below.
//   stationFor(craftId)  the craft's mount function; throws naming the craft when it has none (the message a new craft meets)
//   STATIONS             craft id → mount (the sloop's: src/stations/sloop/index.js mountSloopStation)
// Static imports: a dynamic import() of a station would delay the first HUD frame and the late warm-up (the chunk graph stays
// as it was before this registry).
import { mountSloopStation } from './sloop/index.js';

export const STATIONS = Object.freeze({ sloop: mountSloopStation });

export function stationFor(craftId) {
  const m = typeof craftId === 'string' && Object.hasOwn(STATIONS, craftId) ? STATIONS[craftId] : null;
  if (!m) throw new Error(`stations: no station for craft '${craftId}'`);
  return m;
}
