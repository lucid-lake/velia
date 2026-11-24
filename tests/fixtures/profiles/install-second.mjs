// node --import this: the process sails the test-only second lake and boat (tests/fixtures/profiles/second.mjs), as a
// page with ?waters= and ?vessel= would sail a second shipped one (src/waters/current.js, src/vessels/current.js read
// these globals in node before anything else).
import { MINI_LAKE, TEST_BOAT } from './second.mjs';
globalThis.__lakeshoreWaters = MINI_LAKE;
globalThis.__lakeshoreVessel = TEST_BOAT;
