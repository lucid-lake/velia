// The streaming world's numbers, in one place. Plain JS: node tests read it.
//
// Speed headroom (owner, 2026-10-29: "give a buffer in case we increase the boat speed"): nothing here assumes
// today's top speed (≈ 3.6 m/s through the water, ≈ 7 m/s at the 2× game speed). The prefetch and the near radius
// scale with the camera's OBSERVED ground speed, and the design point is 4× today's worst case: 30 m/s, with the
// near band resident before the camera arrives. Past that (fly mode's glide at altitude, Shift ×4) the near band may
// come late; the middle band always shows under it, so a late tile is a missing detail, never a hole.
export const STREAM = {
  tile: 500,                       // m, the grid's cell (tile ids: src/stream/grid.js)
  bands: {
    near: 1200,                    // m from the camera at rest: full detail (trees' meshes and cards, props, entities)
    mid: 5000,                     // m: impostors, simple buildings
    // past mid: the far level (the coarse, always-resident layer: today the rim's stand cards; later the panorama)
  },
  speed: {
    design: 30,                    // m/s camera ground speed the stream must keep up with (4× today's 7 m/s, rounded up)
    tau: 0.5,                      // s, the smoothing of the observed velocity (an exponential moving average)
    jump: 400,                     // m in one frame: a cut or a teleport, not a speed (the velocity resets)
    nearCap: 2500,                 // m, the most the near radius grows with speed
  },
  lead: {
    safety: 2.5,                   // × the measured time from request to resident (the owner's "2 or more")
    minS: 4,                       // s, the least lead time, whatever the measurement says
    buildS: 0.25,                  // s, the starting guess for request → resident before anything was measured
    pathStep: 50,                  // m between the predicted path's samples (under the finest terrain leaf's split reach, 64 m)
  },
  upload: {
    budgetMs: 2,                   // ms of main-thread upload work per frame (the "no hitch over ≈ 2 ms" rule)
    maxBudgetMs: 4,                // ms when the queue falls behind (a tile due within the lead time is not resident)
    builds: 3,                     // concurrent builds (workers or async jobs) per system
  },
  hysteresis: 250,                 // m past a band's radius before a tile is dropped (no thrash on a band edge)
};

// a manager's own copy of STREAM with a quality tier's radii and upload budget (src/quality/tiers.js stream: { near,
// mid, nearCap, uploadMs }); none: STREAM's own (High's). setStreamTier moves them in play (the governor).
export function streamConfig(tier = null) {
  const c = structuredClone(STREAM);
  if (tier?.stream) setStreamTier(c, tier.stream);
  return c;
}
export function setStreamTier(cfg, s) {
  cfg.bands.near = s.near; cfg.bands.mid = s.mid; cfg.speed.nearCap = s.nearCap;
  cfg.upload.budgetMs = s.uploadMs; cfg.upload.maxBudgetMs = s.uploadMs * 2;
  return cfg;
}

// the near radius at a ground speed v (m/s) and a lead time (s): the rest radius plus the distance covered in the
// lead time, capped
export function nearRadius(v, leadS, cfg = STREAM) {
  return Math.min(cfg.speed.nearCap, cfg.bands.near + Math.max(0, v) * leadS);
}

// the lead time (s) from the measured request → resident time (s)
export function leadTime(measuredS, cfg = STREAM) {
  return Math.max(cfg.lead.minS, cfg.lead.safety * Math.max(measuredS, cfg.lead.buildS));
}
