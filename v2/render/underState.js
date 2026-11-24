// Play as Tessie, phase 2a: the one switch every draw reads. main.js sets it each frame from the eye's depth under the
// local surface; a draw with an under-water twin picks it (its pipeline '<name>-under', built in the deferred 'under' group where
// src/core/features.js tessieUnder is on) only while the eye is under, so every frame above the water draws the pipelines it always drew.
export const UNDER_STATE = { on: false, tier: 'none', split: false };   // split: the other side's drawing at the waterline (main.js 'under-split')
// the pipeline a draw uses: its under-water twin while the eye is under and the twin is built, else its own
export const underPipe = (reg, name) => (UNDER_STATE.on && reg.has?.(`${name}-under`) ? `${name}-under` : name);
