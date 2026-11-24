// Cruise's camera order on v2 (owner, 2026-11-15: "that Cinematic looks very bad, lower its priority to the end"). v1's
// cameras (src/modes/chill/cameras.js) stay as they are (v1 is frozen: Cinematic first and its default); v2 keeps its own
// order: Cruise opens in the Boat view (astern, the follow camera, as Sail's Boat view) and Cinematic comes last, in C's
// cycle, the gamepad's, the top bar's view menu and ?cruisecam='s fallback. The night's stars camera keeps its place after
// Island (on C's cycle only on a dark night); Cinematic follows it. ?cruisecam=cinematic still opens on it (captures).
//   CAMERAS            the five, in the order a player sees and steps them
//   NIGHT_CAMERAS      the five plus 'stars' (after Island, before Cinematic)
//   START_CAMERA       the view Cruise opens in
//   nextCamera(cur, dir, { night })   C (dir 1) and Shift+C (dir −1), v1's rules on v2's order
export const CAMERAS = Object.freeze(['astern', 'above', 'helm', 'island', 'cinematic']);
export const NIGHT_CAMERAS = Object.freeze(['astern', 'above', 'helm', 'island', 'stars', 'cinematic']);
export const START_CAMERA = 'astern';

export function nextCamera(cur, dir = 1, { night = false } = {}) {
  const back = dir < 0;
  if (!night && cur === 'stars') {   // the night ended on the stars camera: step to its neighbour among the five
    const i = NIGHT_CAMERAS.indexOf('stars');
    return NIGHT_CAMERAS[back ? i - 1 : i + 1];
  }
  const L = night ? NIGHT_CAMERAS : CAMERAS, i = L.indexOf(cur), n = L.length;
  return i < 0 ? L[0] : L[(i + (back ? -1 : 1) + n) % n];
}
