// The traffic on the water. None ships today: the owner deleted the low-poly craft (2026-11-05: the paddlewheeler, the
// kayaks and boards, the AI sloops were not good enough and had no collision; the code is in
// git history). The empty schedule keeps its readers as they were: the chart (src/sail/chart.js), the logbook
// and Cruise's navigator (src/modes/chill/).
//
//   import { createTraffic } from './traffic.js';
//   const traffic = createTraffic();   // { paddlewheeler: null, paddlers: [], sailboats: [], agents(t) → [] }
export function createTraffic() {
  return { paddlewheeler: null, paddlers: [], sailboats: [], agents: () => [] };
}
