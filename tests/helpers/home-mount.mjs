// The home card (src/ui/home.js) mounted on the A-dom stub with the real loading-shell markup from index.html, the way
// src/shell.js wires it: a settings object on memory storage, an onMode that lands the switch (setMode, as the shell does
// after core.switchMode), a loading stub that records say() and enter(). For tests/home, cardEnter and cardClose.
//   const c = await mountHome({ state: 'home', clock: t });   // c.home, c.root, c.q(sel), c.log { mode, entered, said, entering, waters, vessel }
import { installDom, shellBody } from './dom-card.mjs';
import { createHome } from '../../src/ui/home.js';
import { createSettings } from '../../src/ui/settings.js';

export function memStorage() {
  const mem = new Map();
  return { mem, getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
}

export async function mountHome({ state = 'company', welcomed = true, current = 'sail', search = '', htmlClass = '', idleS = 5, land = true, clock = null, ...opts } = {}) {
  const D = installDom({ body: shellBody(), search, htmlClass });
  // clock: a node:test context; the card's timers (focus, the 480 ms fade) then run on its mocked clock (t.mock.timers.tick),
  // so no real timer keeps the process alive after the test (D.settle() uses setImmediate, which stays real)
  if (clock) { clock.mock.timers.reset(); clock.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); }   // a second mount in one test starts a fresh clock
  const storage = memStorage();
  const settings = createSettings({ storage });
  if (welcomed) settings.set('welcomed', true);
  const log = { mode: [], entered: 0, said: [], entering: 0, waters: [], vessel: [], opened: 0, closed: 0 };
  // the loading card's enter(): the card dissolves (src/ui/loading.js out(): 'out', then 'gone')
  window.__veliaLoading = { say: (t) => log.said.push(t), enter: () => { log.entering++; document.getElementById('lk-load').dataset.state = 'out'; } };
  addEventListener('lakeshore:entered', () => { log.entered++; });
  let home = null;
  home = createHome({
    current, settings,
    // the shell's switchTo: async, then it tells the card what landed (shell.js menu.setMode)
    onMode: async (m) => { log.mode.push(m); await null; if (land) home.setMode(m); },
    onWaters: (id) => log.waters.push(id), onVessel: (id) => log.vessel.push(id),
    onOpen: () => { log.opened++; }, onClose: () => { log.closed++; },
    attract: { on: false, idleS },
    ...opts,
  });
  const root = document.getElementById('lk-load');
  // 'home': the loading card's hand-off (src/ui/loading.js): the state, the plan rows live, the lakeshore:home event
  if (state === 'home') { root.dataset.state = 'home'; for (const n of root.querySelectorAll('[inert]')) n.removeAttribute('inert'); dispatchEvent(new Event('lakeshore:home')); }
  else if (state !== 'company') root.dataset.state = state;
  await D.settle();
  const q = (s) => root.querySelector(s);
  return { D, home, root, card: q('.lk-card'), q, log, settings, storage };
}
