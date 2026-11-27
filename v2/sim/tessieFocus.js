// After a wreck, as Tessie: she turns to the boat she knocked over and the eye eases round to keep it in view for a few seconds, so a
// player sees what she did (and its bounty on the existing surfaces) without a big turn to find it. Pure: no DOM, no GPU, no
// Math.random, no wall clock (the caller's clock). The player's input always wins at once: a look drag, a key pressed after the hit
// (keys held through the hit do not count: she keeps swimming her way while the eye holds the wreck), a stick pushed, a press of a
// skill or the bite ends it. A pinned pose (the evidence's) never ends it by its own hands.
//   const F = createWreckFocus()
//   F.start(boat { id, kind, x, z }, t, heldKeys)   a wreck now (heldKeys: the key codes held at the hit)
//   F.input({ keys, stick, press, pinned }, t)       this step's hands: keys (codes held now), stick (pushed past its dead zone), press (a
//                                                   bite, a dash, ▲/▼ from a tap or a click: none of them a held key)
//   F.track({ x, z } | null, t)                      the wreck where it is now (null: kept where it was last seen); ends it after FOCUS.holdS
//   F.cancel(why)                                    ends it (the look's drag calls it at once)
//   F.face, F.view                                   { x, z, heading, L, B } while on (the controller's turn to it, the camera's look), else null
//   F.on, F.id, F.stats()
export const FOCUS = Object.freeze({ holdS: 4.5 });

export function createWreckFocus(K = FOCUS) {
  const st = { on: false, id: null, kind: null, x: 0, z: 0, at: -Infinity, until: -Infinity, why: null, starts: 0 };
  let held = new Set(), stickWas = false;
  const pt = { x: 0, z: 0 };
  const self = {
    K,
    get on() { return st.on; }, get id() { return st.id; },
    get face() { return st.on ? pt : null; },
    get view() { return st.on ? pt : null; },
    start(b, t, heldKeys = [], stick = false) {
      if (!b || !Number.isFinite(b.x)) return false;
      Object.assign(st, { on: true, id: b.id ?? null, kind: b.kind ?? null, x: b.x, z: b.z, at: t, until: t + K.holdS, why: null }); st.starts++;
      pt.x = b.x; pt.z = b.z; pt.heading = Number.isFinite(b.heading) ? b.heading : undefined; pt.L = b.L ?? 8.5; pt.B = b.B ?? 3;
      held = new Set(heldKeys); stickWas = !!stick;
      return true;
    },
    cancel(why = 'input') { if (!st.on) return false; st.on = false; st.why = why; return true; },
    input({ keys = [], stick = false, press = false, pinned = false } = {}, t = 0) {
      if (!st.on || pinned) return st.on;
      const now = new Set(keys);
      for (const k of held) if (!now.has(k)) held.delete(k);   // a key let go: pressed again, it counts
      for (const k of now) if (!held.has(k)) return self.cancel('keys');
      if (stick && !stickWas) return self.cancel('stick');
      stickWas = stick;
      if (press) return self.cancel('press');
      return st.on;
    },
    track(p, t = 0) {
      if (!st.on) return false;
      if (p && Number.isFinite(p.x)) { st.x = p.x; st.z = p.z; pt.x = p.x; pt.z = p.z; if (Number.isFinite(p.heading)) pt.heading = p.heading; }
      if (t >= st.until) self.cancel('time');
      return st.on;
    },
    stats() { return { on: st.on, id: st.id, kind: st.kind, x: +st.x.toFixed(1), z: +st.z.toFixed(1), at: Number.isFinite(st.at) ? +st.at.toFixed(2) : null, until: Number.isFinite(st.until) ? +st.until.toFixed(2) : null, why: st.why, starts: st.starts }; },
  };
  return self;
}
