// The player service (refactor round 2, Phase C step 2): what the player
// drives, as everything outside the craft's own code sees it. The craft's assembly provides it (the sloop:
// src/sail/assemble.js); the shell, the HUD, the watchdog, the birds, the fireworks and the kayak fleet read it, never the
// 'boat' service (the sloop's parts: sails, ride, instruments …), so a kayak can be the player without editing them.
//   const player = createPlayer({ craft: 'halcyon', kind: 'sail', phys, follow, group, addPost, cue });
//   services.provide('player', player);
//   player.view()          → { x, z, heading, speed, heel, t } or null: the one read for a pose (m, rad, m/s, s)
//   player.phys            the stepped physics ({ state, t, … }): the craft's own state, for readers that need more
//   player.follow          the follow camera (lookBias, fovBias, look, update(dt, state)), or null
//   player.group           the craft's scene group (an Object3D: a light or a prop can ride on it)
//   player.addPost(fn)     fn(state, dt, t) inside the craft's physics tick (solid props); returns an off(), or null
//   player.cue(name, o)    a one-shot sound on the craft (a bump: 'thud')
export const PLAYER_KINDS = ['sail', 'paddle'];

export function createPlayer({ craft, kind, phys, follow = null, group = null, addPost = null, cue = null } = {}) {
  if (typeof craft !== 'string' || !craft) throw new Error('player: craft must be the craft\'s id');
  if (!PLAYER_KINDS.includes(kind)) throw new Error(`player: kind '${kind}' is not one of ${PLAYER_KINDS.join(', ')}`);
  if (!phys || typeof phys !== 'object' || !('state' in phys)) throw new Error('player: phys must have a state');
  if (addPost != null && typeof addPost !== 'function') throw new Error('player: addPost must be a function');
  if (cue != null && typeof cue !== 'function') throw new Error('player: cue must be a function');
  return {
    craft, kind, phys, follow, group,
    addPost: (fn) => addPost?.(fn) ?? null,
    cue: (name, o) => cue?.(name, o),
    view() {
      const s = phys.state;
      if (!s) return null;
      return { x: s.x, z: s.z, heading: s.heading, speed: s.sog, heel: s.heel, t: phys.t };
    },
  };
}
