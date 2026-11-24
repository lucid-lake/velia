// The play watchdog (fix/first-load, 2026-10-31): a safety net, not the fix. While the page is visible and in play:
//   * the picture: the loop's frames advance but no render has started for DRAW_S (the owner's iPhone: frames 1526,
//     renders 67, the boat frozen on screen while the sim sailed on);
//   * the sim: neither the boat's sim clock nor its position has advanced for STUCK_S after Enter. While the boat is held on
//     purpose (held: Regatta's briefing, the rival's intro and the help card set the sim's rate to 0), the loop's frames
//     stand in for the sim: a still boat is fine, a still loop is not (fix/regatta-watchdog-vhf: the briefing reloaded).
// Either one: first a restart (core.kick(): the animation loop set again, a render stuck in flight let go); if that does
// not bring it back within KICK_S, one reload of the page (a sessionStorage guard: never a loop). Each step is logged in
// the diag (D.watchdog, the ?diag=1 readout). The player is never asked to refresh.
//   const wd = createWatchdog({ read, kick, reload, storage });   wd.tick(nowS, visible)  (pure: tests/watchdog.test.mjs)
//   attachWatchdog({ services, core, D })                                  // the live layer: polls twice a second
import { isPlayMode } from '../modes/registry.js';   // the modes that sail a boat

const WATCHDOG = { stuckS: 8, drawS: 3, kickS: 4, pollMs: 500, key: 'lakeshore.watchdog.v1' };

// read(): { armed, held, simT, x, z, frames, renders } — armed: in play (the card gone, a boat sailing); held: the boat is
// still on purpose (the sim's rate is 0); simT: the boat's sim clock (s); frames: the loop's frames; renders: the renders it
// started (src/ui/diag.js)
export function createWatchdog({ read, kick, reload, storage = null, log = [], S = WATCHDOG } = {}) {
  let last = null, simSince = null, drawSince = null, kickedAt = null, done = false;
  const note = (what, t, extra = {}) => { const e = { what, t: +t.toFixed(1), ...extra }; log.push(e); if (log.length > 12) log.shift(); return e; };
  const reloadedBefore = () => { try { return !!storage?.getItem(S.key); } catch { return true; } };   // no storage: never risk a loop
  function tick(t, visible = true) {
    if (done) return 'done';
    const r = read();
    if (!r?.armed || !visible) { last = null; return 'idle'; }   // hidden or not in play: the clocks start again on return
    if (!last) { last = { ...r }; simSince = t; drawSince = t; return 'ok'; }
    const simMoved = r.held ? (r.frames == null || r.frames !== last.frames)   // held: the loop's liveness, not the boat's
      : r.simT !== last.simT || Math.abs(r.x - last.x) > 1e-4 || Math.abs(r.z - last.z) > 1e-4;
    const drew = r.renders == null || r.renders !== last.renders || r.frames === last.frames;   // no frames at all is the sim's watch, not the picture's
    if (simMoved) simSince = t;
    if (drew) drawSince = t;
    last = { ...r };
    if (simMoved && drew) {
      if (kickedAt != null) { note('recovered', t, { after: 'kick' }); kickedAt = null; }
      return 'ok';
    }
    const why = t - drawSince >= S.drawS ? 'no renders' : t - simSince >= S.stuckS ? (r.held ? 'loop still' : 'sim still') : null;
    if (kickedAt == null && why) { kickedAt = t; note('kick', t, { why }); try { kick?.(why); } catch (e) { note('kick failed', t, { err: String(e?.message ?? e).slice(0, 80) }); } return 'kick'; }
    if (kickedAt != null && t - kickedAt >= S.kickS && why) {
      done = true;
      if (reloadedBefore()) { note('stuck, reloaded once already', t, { why }); return 'gave-up'; }
      try { storage?.setItem(S.key, JSON.stringify({ at: Date.now(), why, log })); } catch { /* no storage: guarded above */ }
      note('reload', t, { why }); reload?.(why); return 'reload';
    }
    return 'waiting';
  }
  return { tick, log, get kicked() { return kickedAt != null; } };
}

export function attachWatchdog({ services, core, D, g = globalThis } = {}) {
  const storage = (() => { try { return g.sessionStorage; } catch { return null; } })();
  // the last page's reload, carried into this page's diag
  try { const prev = JSON.parse(storage?.getItem(WATCHDOG.key) ?? 'null'); if (prev) D.watchdogReloaded = prev; } catch { /* none */ }
  const log = (D.watchdog = []);
  const read = () => {
    const s = services.get('player')?.phys?.state, st = g.document?.getElementById?.('lk-load')?.dataset?.state;
    return { armed: !!s && (st === 'gone' || st == null) && isPlayMode(services.get('mode')), held: services.get('controls')?.rate === 0, simT: services.get('player')?.phys?.t ?? null, x: s?.x ?? 0, z: s?.z ?? 0, frames: D.frames, renders: D.renders };
  };
  const wd = createWatchdog({ read, kick: () => core.kick?.(), reload: (why) => (core.recover ? core.recover(`watchdog: ${why}`, { watchdog: true }) : g.location.reload()), storage, log });
  const timer = setInterval(() => {
    const r = wd.tick(g.performance.now() / 1000, g.document?.visibilityState !== 'hidden');
    if (r === 'kick' || r === 'reload' || r === 'gave-up') D.error?.('watchdog', `${r}: ${JSON.stringify(log.at(-1))}`);
  }, WATCHDOG.pollMs);
  return { wd, dispose() { clearInterval(timer); } };
}
