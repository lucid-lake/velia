// The text the old skipper reads aloud for a hint. Pure JS, no DOM; the page loads this much only.
// src/ui/skipperLines.js lists every such text (the render tool and the tests); src/ui/skipperVoice.js plays the clips.
//
//   lineText('pull', words, { mouse, mouseHtml })  → the text the voice reads, as the player sees the line now
//   hashText(text)                                  → the 11-hex-digit key of a text (the clip's file name, the manifest key)
//
// What is read: the lead and the phrase, no key names (the caps say them). The mouse and the touch share one wording
// (the pointer: "Drag the sail line in"); a gamepad reads the key wording. Plain level and sailor level are two lines;
// a text that comes out the same (the chart line, a mouse line with no term in it) is one clip.
import { LEADS, TEXT, MOUSE_TEXT } from './skipper.js';
import { stripMarkup } from './words.js';

// cyrb53: a small, fast, well-spread 53-bit string hash, the same on every platform (the browser needs it synchronously)
export function hashText(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0').slice(-11);
}

const plainText = (html) => stripMarkup(html.replace(/<span class="tag">[\s\S]*?<\/span>(?=$)/, '')).replace(/<[^>]*>/g, '').replace(/\s*=\s*/g, ' means ').replace(/\s+/g, ' ').trim();   // "dark water = wind" is read "dark water means wind"
const cap = (s) => s[0].toUpperCase() + s.slice(1);
// the cap word the mouse line starts with ("drag", "click"), read from the line the player sees (controlsHint.js MOUSE)
const mouseVerb = (html) => html?.match(/data-k="(drag|click)"/)?.[1] ?? null;

// The text the voice reads for hint `name` ('pull', 'chart', 'look', 'whisper', …) at `words`' level; null if none.
// mouseHtml: the hint's line in the mouse's wording (MOUSE[name]), when the hand is the pointer; chart's mouse line is its own text.
export function lineText(name, words, { mouse = false, mouseHtml = null } = {}) {
  if (name === 'look') return `${TEXT.look}. ${TEXT.closer}.`;
  const m = mouse && !!mouseVerb(mouseHtml);
  if (LEADS[name]) {
    const lead = LEADS[name].replace(/\s*—$/, '.');
    const phrase = plainText(words.expand(`§${name}§`, { mouse: m }));
    return m ? `${lead} ${cap(mouseVerb(mouseHtml))} ${phrase}.` : `${lead} ${cap(phrase)}.`;
  }
  if (name === 'chart' && mouse) return `${MOUSE_TEXT.chart}.`;
  if (TEXT[name]) return `${TEXT[name]}.`;
  return null;
}
