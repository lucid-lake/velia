// The instruments' palette ("night"): real captains turn their displays red at night to
// keep their night vision. After sunset the glass and the ink shift to the night-red set in src/ui/tokens.css
// (:root[data-lk-theme=night]); by day it is the cream-and-navy set. The setting is auto | day | night (settings.js
// `display`); auto follows the sun, with a 2° hysteresis so a cloud-grey dusk never flickers. "Larger text" is the same
// kind of switch: data-lk-text on <html>.
//
//   const theme = createTheme({ sunElev: () => core.sun.elevationDeg, setting: 'auto' });
//   theme.update(dt);           // every frame; it only looks twice a second
//   theme.set('night'); theme.night; theme.setLargeText(true); theme.dispose();

export const NIGHT = { below: -1, above: 1 };   // the sun's elevation (°): night starts under −1°, day returns over +1°

// Pure: is it night? (`was`: the answer a moment ago, for the hysteresis)
export function isNight(setting, sunElevDeg, was = false) {
  if (setting === 'night') return true;
  if (setting === 'day') return false;
  if (!Number.isFinite(sunElevDeg)) return was;
  return was ? sunElevDeg < NIGHT.above : sunElevDeg < NIGHT.below;
}

export function createTheme({ doc = globalThis.document, sunElev = () => 20, setting = 'auto', largeText = false } = {}) {
  let mode = setting, night = false, t = 0;
  const root = doc?.documentElement;
  const apply = () => { if (root) root.dataset.lkTheme = night ? 'night' : 'day'; };
  const look = () => { const n = isNight(mode, sunElev(), night); if (n !== night) { night = n; apply(); } };
  const setLargeText = (on) => { if (root) { if (on) root.dataset.lkText = 'large'; else delete root.dataset.lkText; } };
  look(); apply(); setLargeText(largeText);
  return {
    update(dt) { t += dt; if (t > 0.5) { t = 0; look(); } },
    set(m) { mode = m; look(); apply(); },
    setLargeText,
    get night() { return night; }, get setting() { return mode; },
    dispose() { if (root) { delete root.dataset.lkTheme; delete root.dataset.lkText; } },
  };
}
