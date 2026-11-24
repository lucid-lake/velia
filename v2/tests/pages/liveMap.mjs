// The live map's path for the page tests (Phase 2b; the water's card): the old top bar's Chart and its
// enlarged chart are gone from the player's path (the Chart button gives way to the Sail ⇄ Cruise switch), so a test that sets a target
// on a chart goes the player's way now: the card's mode, the in-game menu (Menu, Esc, N) is the live map, a tap on the water opens its
// card, and the card's words set the target (Set as target), a waypoint (Add waypoint), the course (Set course), or clear them.
// Every point is in the page's layout frame (an upright phone's page is turned on its side; the caller's tap() maps it to the finger).
//   await enterFromCard(page, 'sail' | 'cruise', { place: { x, z, headingDeg } })   the shell's card → play (a fresh page with the shell)
//   await openMap(page); await closeMap(page)
//   const p = await mapSpot(page, x, z)            → { x, y } in the layout frame, the world point centred in the map's free area
//   const r = await waterAct(page, tap, x, z, 'waterTarget' | 'waypoint' | 'setCourse' | 'clearRoute' | 'clearTarget')
//                                                  → { card: the card's state before the press, say: a refusal's words, or '' }

import { pickMode } from './pick.mjs';
export const live = (page) => page.evaluate(() => { const c = window.__velia?.m4?.ui?.services?.get('liveChart'); return c ? { ...c.state, shown: c.shown } : null; });

export async function enterFromCard(page, mode = 'sail', { place = null } = {}) {
  // the card (home), or straight into play (a link's ?mode= with ?once=0 on some devices skips the card: 'gone')
  await page.waitForFunction(() => ['home', 'gone'].includes(window.__veliaLoading?.state) && window.__velia?.m4?.ui?.services?.get('mapScreen'), null, { timeout: 240000 });
  await page.waitForFunction(() => document.getElementById('lk-load').dataset.build !== 'wait', null, { timeout: 240000 });
  await page.waitForTimeout(500);
  if (await page.evaluate(() => window.__veliaLoading.state === 'home')) await pickMode(page, mode);
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  await page.waitForFunction((m) => window.__velia?.ready && window.__velia.beacon && window.__velia.boat?.sim?.t > 1 && (m !== 'cruise' || window.__velia.cruise?.c?.on), mode, { timeout: 120000 });
  if (place) await page.evaluate((p) => window.__velia.boat.sim.place({ x: p.x, z: p.z, headingDeg: p.headingDeg ?? 0, speed: p.speed ?? 2 }), place);   // 2 m/s: under way, as a ?start= page begins
  await page.waitForTimeout(1200);
}

export async function openMap(page) {
  await page.evaluate(() => window.__velia.m4.ui.services.get('menu')?.open?.());
  await page.waitForFunction(() => { const c = window.__velia.m4.ui.services.get('liveChart'); return c?.shown && c.state.mode === 'play' && c.state.ground !== 'none'; }, null, { timeout: 30000 });
  await page.waitForTimeout(700);
}
export async function closeMap(page) {
  await page.evaluate(() => window.__velia.m4.ui.services.get('menu')?.close?.());
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

// the world point in the middle of what the panel leaves, at mpp (a far point: the whole bay's zoom); its layout spot
export function mapSpot(page, x, z, mpp = null) {
  return page.evaluate(([x, z, mpp]) => {
    const c = window.__velia.m4.ui.services.get('liveChart'), st = c.state, m = mpp ?? st.view.mpp, l = st.insets.left ?? 0;
    c.setView({ center: { x: x - (l / 2) * m, z }, mpp: m, animate: false });
    return c.toClient(x, z);
  }, [x, z, mpp]);
}

// a tap on the water at (x, z), then the card's word for act (its pill or its quiet words); waits for the card to close or refuse
export async function waterAct(page, tap, x, z, act, { mpp = null } = {}) {
  const st0 = await live(page);
  if (st0?.card) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  const p = await mapSpot(page, x, z, mpp);
  await page.waitForTimeout(250);
  await tap(p.x, p.y);
  await page.waitForFunction(() => !!window.__velia.m4.ui.services.get('liveChart').state.card, null, { timeout: 3000 }).catch(() => {});
  const st = await live(page);
  const at = await page.evaluate((a) => { const b = document.querySelector(`.lk-livechart .lkc-card [data-act=${a}]`); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, act);
  if (!at) return { card: st?.card ?? null, water: st?.water ?? null, say: 'no such action', pressed: false };
  await tap(at.x, at.y);
  await page.waitForFunction(() => { const c = window.__velia.m4.ui.services.get('liveChart').state.card; return !c || (c.say && c.say !== 'One moment…'); }, null, { timeout: 30000 }).catch(() => {});
  const after = await live(page);
  return { card: st?.card ?? null, water: st?.water ?? null, say: after?.card?.say ?? '', pressed: true };
}
