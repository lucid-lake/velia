// The sails' and lines' ceilings (main 8 k, jib 6 k triangles; whole boat ≈ 100 k, ≤ 25 draw
// calls, ≤ 1.5 ms GPU at 1280×720). Shared by tests/sails.test.mjs (the meshes in plain JS) and tests/pages/sails.page.mjs (retired 2026-11-18)
// (what the demo reports). As of 2026-10-29: main 5,120, jib 3,584, 25 lines in 1,636 ribbon triangles (the hero cockpit
// and rig, boat/hero-cockpit, took the lines from 10 to 25).
export const BUDGET = {
  mainTris: 8000,
  jibTris: 6000,
  lineTris: 3000,   // ≈ 1.8× today's 1,636; the ribbon buffer holds 1,536 points (≈ 3,000 triangles)
  minLines: 10,     // M7's own set: sheets, halyards, the furling line; fewer means a line went missing
};
