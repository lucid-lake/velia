// The turn's boot (ui/landscape.js): index.html's first module (ui/loading.js) imports this first, so the turned frame is in place
// before any other module is evaluated or measures the page. The screen's real space comes next (ui/screenFit.js: the visible
// frame, its tier, the safe areas' fallback), on the turned frame.
import { installLandscape } from './landscape.js';
import { installScreenFit } from './screenFit.js';
import { parseV2Flags } from '../engine/flags.js';

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const f = parseV2Flags(location.search);
  installLandscape({ portrait: f.portrait === '1' });   // ?portrait=1: the upright layouts, for one release
  installScreenFit({ fit: f.fit === 'cover' || f.fit === 'bars' ? f.fit : null });
}
