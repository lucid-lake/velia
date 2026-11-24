// BACKLOG-v2 #34: Escape with the binoculars up lowers them and leaves the Menu card down (v1's shell: home.js escFirst names the
// raised glasses); with them down, Escape opens the Menu. v1's home card (src/ui/home.js) with front.js's links (logLinks) and the
// real captain (ui/captain.js, its window key listener), as on the page. The browser half: v2/tests/pages/captain.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHome } from '../../tests/helpers/home-mount.mjs';
import { logLinks } from '../ui/front.js';
import { createCaptain } from '../ui/captain.js';
import { createServices } from '../../src/sim/core/services.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';
import { heightAt } from './helpers/ground.mjs';

const DEG = Math.PI / 180;

test('#34: Escape lowers the raised binoculars first; the Menu opens only when they are down', async (t) => {
  const ui = { services: createServices() };
  const c = await mountHome({ state: 'gone', clock: t, ...logLinks(() => ui) });   // in play (the card gone)
  const B = { t: 0, vessel: CURRENT_VESSEL, pose: { x: 1200, z: -1050, heading: 251 * DEG, heel: 0, pitch: 0, heave: 0 }, state: { x: 1200, z: -1050, trueWind: { speed: 4 } } };
  const windField = { hourAt: () => 15, day: null };
  const cap = createCaptain({ B, windField, terrain: { field: { height: heightAt } }, services: ui.services, live: true, auto: false, dom: false, makeRadio: () => null });
  try {
    assert.equal(ui.services.get('captainTools'), cap, 'the captain is Sail\'s captainTools');
    cap.setLatch(true);
    c.D.key('Escape');
    assert.equal(cap.latched, false, 'Escape lowers the glasses');
    assert.equal(c.home.isOpen, false, 'and the Menu card stays down');
    c.D.key('Escape');
    assert.equal(c.home.isOpen, true, 'with the glasses down, Escape opens the Menu');
  } finally { cap.dispose(); }
});
