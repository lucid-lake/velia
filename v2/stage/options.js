// The stage's URL options: ?stage= (main.js passes it to the director) and Tessie's flag, which a capture reads as
// a pin and a live page as her opening's time. Here, not in living/tessie-policy.js (which re-exports it), so a phone's page
// reads it without fetching any of Tessie's files.
//   tessieFlag(flag) -> { set, off?, now?, breach?, firstAt? }   flags.tessie: null | '0' | 'off' | '1' | 'on' | 'now' | 'breach' | seconds
//   stageOptions({ flags, headless }) -> { pin, overrides }        the director's pin (null | 'off' | an act id) and opening overrides
export function tessieFlag(flag) {
  if (flag == null || flag === '' || flag === true) return { set: false };
  const v = String(flag).toLowerCase();
  if (v === '0' || v === 'off' || v === 'false') return { set: true, off: true };
  if (v === 'now') return { set: true, now: true };
  if (v === 'breach') return { set: true, now: true, breach: true };   // M2: a sighting now, breaching (captures, films)
  const n = parseFloat(v);
  if (Number.isFinite(n) && n > 1) return { set: true, firstAt: n };
  return { set: true };   // '1', 'on': on (the stage decides when)
}


export function stageOptions({ flags = {}, headless = false } = {}) {
  const tf = tessieFlag(flags.tessie);
  const pin = flags.stage ? String(flags.stage) : headless && tf.set && !tf.off && !tf.now ? 'tessie' : null;
  return { pin, overrides: tf.firstAt ? { tessie: { atS: tf.firstAt } } : {} };
}
