// v2's own anchor lines to voice (v2/ui/seamanship.js SEA_NOTES, the anchor seen, 2026-11-17): [{ hash, text, ids }] on stdout,
// for tools/v2-sea-voice.py (the old skipper's Kokoro voice, as tools/skipper_lines.mjs is for v1's lines). The hash is v1's
// (src/ui/skipperText.js hashText of the spoken text), so src/ui/skipperVoice.js finds each clip by it.
import { SEA_NOTES } from '../v2/ui/seamanship.js';
import { hashText } from '../src/ui/skipperText.js';

export const seaLines = () => {
  const by = new Map();
  for (const [id, n] of Object.entries(SEA_NOTES)) { const h = hashText(n.speak); if (!by.has(h)) by.set(h, { hash: h, text: n.speak, ids: [] }); by.get(h).ids.push(`sea.${id}`); }
  return [...by.values()];
};
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(JSON.stringify(seaLines()));
