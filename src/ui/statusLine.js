// The status line (owner, 2026-10-30: "people are visual animals; they need to see the feedback"): every action on the boat
// says what it is doing in plain words, at once, in the top bar's event line (viewSwitch.say), with the progress of a
// multi-second action kept up while the crew works ("Sails coming down…" → "Sails down"; "Engine starting…" →
// "Engine running · slow ahead"; "Anchor going down — 9 m" → "Anchor holding"; "Mooring picked up").
//
//   const sw = new StatusWatch();
//   const line = sw.step(snapshot, t)   // each frame; a line to show now, or null
// snapshot: { furl, furlWant, engine ('off'|'cranking'|'running'|'stopping'), lever, anchor: { phase, depth }, tackle
// ('free'|'anchor'|'moored'|'docked'), bino (bool), radio ('16'|'WX 1'), reef (0–2: the target), reefing (where the reef is now), view ('follow'|'helm') }. Pure:
// tests/statusLine.test.mjs.
import { NOTCHES, notchIndex } from '../stations/sloop/throttleLever.js';

export const STATUS = { repeatS: 1 };   // a progress line is said again this often while the work goes on
const NOTCH_WORDS = { 'full-ahead': 'full ahead', half: 'half ahead', slow: 'slow ahead', stop: 'stop', 'slow-astern': 'slow astern', 'full-astern': 'full astern' };
export const notchWords = (lever) => NOTCH_WORDS[NOTCHES[notchIndex(lever)].id];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// the reef changed with the sails down (from → to reefs): what the next hoist will be
export const REEF_DOWN = { in: 'Reef in — the main will go up reefed', second: 'Second reef in — the main will go up reefed', one: 'One reef out — the main will go up with one reef', out: 'Reef shaken out — full main when hoisted' };
const REEF_DOWN_LINES = Object.values(REEF_DOWN);
export const reefDownLine = (from, to) => (to === 0 ? REEF_DOWN.out : to > from ? (to === 1 ? REEF_DOWN.in : REEF_DOWN.second) : REEF_DOWN.one);

export class StatusWatch {
  // kind: the last line's kind for the phone's quiet skipper (src/ui/phoneQuiet.js): 'reply' for the reef set with the sails down, else 'status'
  constructor() { this.p = null; this.busy = null; this.busyAt = -9; this.kind = 'status'; }
  // a line to show now (null: nothing new); busy: the multi-second work under way, for the progress repeats and the camera
  step(n, t = 0) {
    const p = this.p; this.p = { ...n, anchor: { ...(n.anchor ?? {}) } };
    if (!p) return null;
    const lines = [];
    // the sails: the crew's work, its progress, its end
    const sailsMoving = Math.abs((n.furl ?? 0) - (n.furlWant ?? 0)) > 0.03;
    if (n.furlWant !== p.furlWant) { lines.push(n.furlWant >= 0.5 ? 'Sails coming down…' : 'Hoisting the sails…'); this.busy = 'sails'; this.busyAt = t; }
    else if (this.busy === 'sails' && !sailsMoving) { lines.push(n.furlWant >= 0.5 ? 'Sails down' : n.reef ? `Sails up · ${n.reef === 1 ? 'one reef' : 'two reefs'} in` : 'Sails up'); this.busy = null; }
    // the engine
    if (n.engine !== p.engine) {
      if (n.engine === 'cranking') { lines.push('Engine starting…'); this.busy = 'engine'; this.busyAt = t; }
      else if (n.engine === 'running') { lines.push(`Engine running · ${notchWords(n.lever ?? 0)}`); if (this.busy === 'engine') this.busy = null; }
      else if ((n.engine === 'stopping' || n.engine === 'off') && (p.engine === 'running' || p.engine === 'cranking')) { lines.push('Engine off'); if (this.busy === 'engine') this.busy = null; }
    } else if (n.engine === 'running' && notchIndex(n.lever ?? 0) !== notchIndex(p.lever ?? 0)) lines.push(cap(notchWords(n.lever ?? 0)));
    // the anchor
    const a = n.anchor ?? {}, pa = p.anchor ?? {};
    if (a.phase !== pa.phase) {
      if (a.phase === 'falling') { lines.push(`Anchor going down — ${Math.round(a.depth ?? 0)} m`); this.busy = 'anchor'; this.busyAt = t; }
      else if (a.phase === 'held') { lines.push('Anchor holding'); if (this.busy === 'anchor') this.busy = null; }
      else if (a.phase === 'weighing' || (a.phase === 'up' && pa.phase !== 'weighing')) { lines.push('Weighing anchor…'); this.busy = 'anchor'; this.busyAt = t; }
      else if (a.phase === 'stowed' && pa.phase) { lines.push('Anchor up'); if (this.busy === 'anchor') this.busy = null; }
    }
    // the lines: a mooring, a pier
    if (n.tackle !== p.tackle) {
      if (n.tackle === 'moored') lines.push('Mooring picked up');
      else if (n.tackle === 'docked') lines.push('Made fast alongside');
      else if (n.tackle === 'free' && (p.tackle === 'moored' || p.tackle === 'docked')) lines.push('Lines let go');
    }
    if (n.bino && !p.bino) lines.push('Binoculars');
    if (n.radio === 'WX 1' && p.radio !== 'WX 1') lines.push('VHF · the weather channel');
    // the reef: the crew at work (the main comes down a band over a few seconds), then the end
    const reefMoving = Math.abs((n.reefing ?? n.reef ?? 0) - (n.reef ?? 0)) > 0.03;
    // with the sails down the reef is tied in on the boom for the next hoist (real seamanship: reef before hoisting): one
    // reply that says so, no crew-at-work line (kind 'reply': a phone keeps it, it answers the player's own press)
    const down = (n.furlWant ?? 0) >= 0.5;
    let reply = false;
    if ((n.reef ?? 0) !== (p.reef ?? 0) && down) { lines.push(reefDownLine(p.reef ?? 0, n.reef ?? 0)); reply = true; if (this.busy === 'reef') this.busy = null; }
    else if ((n.reef ?? 0) !== (p.reef ?? 0)) { lines.push((n.reef ?? 0) > (p.reef ?? 0) ? 'Reefing…' : 'Shaking out the reef…'); this.busy = 'reef'; this.busyAt = t; this.reefIn = (n.reef ?? 0) > (p.reef ?? 0); }
    else if (this.busy === 'reef' && !reefMoving) { lines.push(n.reef ? (n.reef === 1 ? 'One reef in' : 'Two reefs in') : 'Reefs shaken out'); this.busy = null; }
    if (n.view !== p.view && n.view) lines.push(n.view === 'helm' ? 'Helm view' : 'Boat view');
    if (lines.length) { this.lastAt = t; this.kind = reply && REEF_DOWN_LINES.includes(lines[lines.length - 1]) ? 'reply' : 'status'; return lines[lines.length - 1]; }
    this.kind = 'status';
    // the work goes on: say it again (with the depth for the anchor) so the line stays up until the end
    if (this.busy && t - (this.lastAt ?? -9) >= STATUS.repeatS) {
      this.lastAt = t;
      if (this.busy === 'sails') return n.furlWant >= 0.5 ? 'Sails coming down…' : 'Hoisting the sails…';
      if (this.busy === 'reef') return this.reefIn ? 'Reefing…' : 'Shaking out the reef…';
      if (this.busy === 'engine') return n.engine === 'cranking' ? 'Engine starting…' : null;
      if (this.busy === 'anchor') return a.phase === 'falling' || a.phase === 'down' ? `Anchor going down — ${Math.round(a.depth ?? 0)} m` : a.phase === 'weighing' || a.phase === 'up' ? 'Weighing anchor…' : null;
    }
    return null;
  }
}
