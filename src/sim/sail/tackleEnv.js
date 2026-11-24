// The ground tackle on a physics env (moved from src/sim/sail/simulation.js, a pure seam: v2 imports it without the craft
// registry; simulation.js re-exports it, so v1's callers are unchanged).
// the ground tackle's forces on a world env (src/boat/tackle.js): the anchor, a mooring, the lines and the piers, with the
// bottom's (src/boat/ground.js) when the boat is free; posts: more hooks after each tick (the racing marks). Seamanship and
// the Simulation both build the env with it.
export function tackleEnv(e, tk, posts = null) {
  const gx = e.ext, gp = e.post, free = () => tk.mode !== 'moored' && tk.mode !== 'docked';
  e.ext = gx ? (s, dt, t, b) => { const a = tk.ext(s, dt, t, b); if (!free()) return a; const c = gx(s, dt, t, b); return { X: a.X + c.X, Y: a.Y + c.Y, N: a.N + c.N, K: c.K }; } : tk.ext;
  const rest = posts?.length ? (st, dt, t) => { tk.post(st, dt, t); for (const f of posts) f(st, dt, t); } : tk.post;
  e.post = gp ? (s, dt, t, b) => { if (free()) gp(s, dt, t, b); rest(s, dt, t, b); } : rest;
  return e;
}
