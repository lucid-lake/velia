// Day Sail's live controls: the deck (src/deck/index.js: the keys, the mouse, the dock, the views, the bar) and the sloop's
// sail controller on it (src/controllers/sail.js: the helm, the sheets, pro, the hints, the station, the physics tick).
// A shim through refactor round 2's Phase C: Sail, Regatta, Cruise's hand-over
// and the tests attach through it unchanged; Phase D moves them and deletes it.
//   const api = attachControls(core, sail, { handover, helmPick, helmCam, view });
import { attachDeck, STEADY, CAM_RIDE, CAM_RIDE_TAU } from '../deck/index.js';
import { attachSailController, KN } from '../controllers/sail.js';
import { createPlayer } from '../../../src/sim/core/player.js';
import { KEY } from '../../../src/sail/keys.js';

// sail: the assembled boat (src/sail/assemble.js); handover: Cruise's trim; helmPick, helmCam: the passenger's own (the
// helm view's parts and look carry over); view: 'helm' | 'follow' starts in that view
export function attachControls(core, sail, { handover = null, helmPick = null, helmCam = null, view = null } = {}) {
  // the player this page drives (src/core/player.js); a page without the service (the tests' mount) gets one from the boat
  const svc = core.services.get('player');
  const player = svc?.phys === sail.phys ? svc : createPlayer({ craft: sail.phys.vessel?.id ?? 'boat', kind: 'sail', phys: sail.phys, follow: sail.follow, group: sail.boat, cue: sail.sfx ? (name, o) => sail.sfx.cue?.(name, o) : null });
  const deck = attachDeck(core, player, { helmCam, view, cruiseKey: KEY.cruise });
  return attachSailController(core, sail, deck, { handover, helmPick });
}
export { STEADY, CAM_RIDE, CAM_RIDE_TAU, KN };
