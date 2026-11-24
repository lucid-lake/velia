// Sail (public name; was Day Sail; the folder keeps the old word) (?mode=sail): the boat, its physics and sound, the follow camera, the controls and their quiet hints, the
// logbook (L), the chartplotter (N).
// The mode interface: src/modes/README.md.
import { arriveOnEntry } from '../../../../src/audio.js';
import { assembleBoat } from '../../sail/assemble.js';
import { attachControls } from '../../sail/controls.js';
import { attachLogbook } from '../../../../src/sail/logbook.js';
import { attachChart } from '../../../../src/sail/chart.js';
import { sailCoreOptions, startPose } from '../../sail/options.js';
import { attachFeatures, prefetchFeatures } from '../../features/index.js';

// the start, the first gust, the day clock and the options live in src/sail/options.js (Regatta and Cruise's hand-over read them too)
export { START, startPose, FIRST_GUST, daySchedule } from '../../sail/options.js';
export const coreOptions = sailCoreOptions;

export async function start(core) {
  // the features' code (the marks; the kayaks' ≈ 30 KB gzipped) fetched while the boat is assembled, not after it (a slow
  // network: 12 s at Slow 4G)
  prefetchFeatures(core, { scope: 'mode', mode: 'sail' });
  const sail = await assembleBoat(core, startPose(core.flags, core.waters));
  const controls = core.headless ? null : attachControls(core, sail);
  // D4: the logbook (live pages only: ?headless never builds it, so captures are unchanged)
  const logbook = core.headless ? null : attachLogbook(core, sail, controls);
  // the chartplotter (N), live pages only too
  // Sail's features (src/features/index.js), in one loop: the racing marks (floating inflatable marks, practice courses laid
  // from the chart), the kayak demo stage (?kayak=) and the
  // kayaks on the lake (?kayaks=0 loads nothing; the paddler figures never hold the start on a live page)
  const features = await attachFeatures(core, core.services.get('player'), { scope: 'mode', mode: 'sail', ctx: { sail, controls } });
  const chart = core.headless ? null : attachChart(core, sail, controls, logbook, { marks: features.get('marks'), plan: true });   // the passage plan
  // the music starts on the gesture that enters Sail (fix/regressions, 2026-10-30): Enter on the home card, or the first
  // key or click of a ?mode=sail page. Before, the first piece waited for 90 s of a scene clock that runs from the page's
  // load, so minutes on the home card used it up (a silent cue, then 4 to 8 min of gap, or 30 min for the same piece).
  const offArrive = core.headless || !core.audio?.arrive ? null : arriveOnEntry(core.audio, { cardUp: () => ['company', 'home', 'menu', 'attract'].includes(document.getElementById('lk-load')?.dataset.state) });
  return {
    update(dt) { controls?.update(dt); features.update(dt); logbook?.update(); chart?.update(dt); },   // the kayaks paddle on the wall clock, as on 2026-11-08 (a stroke a second each side); on the sim's 2× clock (round A) they paddled at twice a real kayaker's rate and read as robots (owner 2026-11-09)
    dispose() { offArrive?.(); chart?.dispose(); features.dispose(); logbook?.dispose(); controls?.dispose(); sail.dispose(); },
  };
}
