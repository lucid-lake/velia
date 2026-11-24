// The played seam (refactor round 3, Phase C step C3): one `player` object, made once by boot(), that answers "what is the player,
// where is it, who has the keys and the camera". The boat is the default; a played thing (Tessie today: living/lakePlugins.js TESSIE) adds
// itself and the readers (main.js, the busy lake, the kayaks' launch, the Calm HUD, Sail's dash) ask `player`, never a creature by name.
// The UI reads it as the service 'played' (the service 'player' is the boat's sim); the page hook is window.__velia.played.
//
//   const player = createPlayer({ boat: () => B?.state ?? null })
//   player.add(id, thing)   a played thing: { active, swap(entry, at), back(opts), camera(dt, c, orbit), step(dt), pose(), threat(),
//                           bubbles(dt), dives, view() } (every member optional but `active`); its id is what `as` reads while it is played
//   player.as               'boat' | the played thing's id          player.played   as !== 'boat'
//   player.view()           the played thing's own view state (its camera's stats), or null on the boat
//   player.drive()          who has the keys: the played thing's id, or 'boat'
//   player.camera(dt, c, o) every played thing's camera, in the order they were added (a swap's glide runs either way); last in placeCamera
//   player.pose()           { x, z } of the played thing (its own pose, else the boat's), the boat's state on the boat
//   player.swap(to, entry, at) / player.back(opts)   into a played thing (its own rules: { ok, why }) and back to the boat
//   player.step(dt)         each played thing's step (its hands, its hits, its HUD); after the living clock
//   player.threat()         the played thing as a threat the lake's boats keep clear of (null: none seen)
//   player.bubbles(dt)      the played thing's bubble sources this step (null: none); every thing is asked (each clears its own state)
//   player.dives            some played thing can take the eye under the water (the eye's medium is drawn only then)
//   player.get(id)          the thing itself (tests and the page hooks)
export function createPlayer({ boat = () => null } = {}) {
  const things = new Map();
  const current = () => { for (const [id, t] of things) if (t.active) return [id, t]; return null; };
  const player = {
    add(id, thing) { if (id === 'boat' || things.has(id)) throw new Error(`player: ${id} taken`); things.set(id, thing); return thing; },
    get: (id) => things.get(id) ?? null,
    get ids() { return ['boat', ...things.keys()]; },
    get as() { return current()?.[0] ?? 'boat'; },
    get played() { return !!current(); },
    get dives() { for (const t of things.values()) if (t.dives) return true; return false; },
    view() { const c = current(); return c ? (c[1].view?.() ?? null) : null; },
    drive() { return player.as; },
    camera(dt, c, orbit = null) { for (const t of things.values()) if (t.camera) c = t.camera(dt, c, orbit); return c; },
    pose() { const c = current(); return (c && c[1].pose?.()) ?? boat(); },
    swap(to, entry = 'swap', at = null) {
      const t = things.get(to);
      if (!t) return { ok: false, why: to === 'boat' ? 'already' : 'unknown' };
      return t.swap(entry, at);
    },
    back(opts) { const c = current(); return c ? c[1].back(opts) : false; },
    step(dt) { for (const t of things.values()) t.step?.(dt); },
    threat() { const c = current(); return c ? (c[1].threat?.() ?? null) : null; },
    bubbles(dt) { let out = null; for (const t of things.values()) { const b = t.bubbles?.(dt) ?? null; if (b && !out) out = b; } return out; },
  };
  return player;
}
