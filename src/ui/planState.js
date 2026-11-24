// The home card's PLAN row as state: `plan` is what the player last picked, `running` the mode the shell has landed.
// The last pick wins: a mode that lands from an earlier pick (a switch takes ~1.2 s) must not undo a newer one, and Enter
// starts the plan, not whatever landed last. Pure; tests/pointerFix.test.mjs.
export function createPlan(current) {
  const s = { plan: current, running: current, picking: false };
  return {
    get plan() { return s.plan; }, get running() { return s.running; }, get picking() { return s.picking; },
    // a pick; true when it changed the plan (the caller then asks the shell for it)
    pick(m) { if (m === s.plan) return false; s.plan = m; s.picking = true; return true; },
    // the shell landed `m` (quiet: the attract's own switch, which never changes the plan)
    landed(m, quiet = false) { s.running = m; if (!quiet && !s.picking) s.plan = m; if (m === s.plan) s.picking = false; },
    reset() { s.plan = s.running; s.picking = false; },
    // the plan to start on Enter, or null when it is already running
    toStart() { return s.plan !== s.running ? s.plan : null; },
  };
}
