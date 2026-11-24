// Cruise's live path (the navigator and the AI skipper on the page's helm, 120 s) and the pure Simulation on its inputs
// both reproduce main's run tick for tick (tests/helpers/cases-sim.mjs).
import { runCruise, replayCruise } from './helpers/sim-cruise.mjs';
import { liveCase, pureCase } from './helpers/cases-sim.mjs';

liveCase('cruise', 1, runCruise);
pureCase('cruise', 1, runCruise, replayCruise);
