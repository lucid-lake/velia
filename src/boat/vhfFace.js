// The VHF set's pure half (v2 seam, BACKLOG-v2 #35): its numbers, the LCD's view and the face's 2D drawing, with no three.js,
// so v2's engine (v2/render/boatInstruments.js) draws the same face. Moved here unchanged from src/boat/vhf.js, which imports
// and re-exports them (v1's behaviour byte for byte).
//   lcdView({ channel, text, charAt, rx }, width) → { big, tag, line };  drawFace(g, W, H, view)
export const VHF = {
  // HULL frame (x starboard, y up, z aft). The pedestal guard's arc crosses x 0.17 at ≈ 1.22 m (blender/m3_cockpit.py:
  // the U at ±0.22, its top 1.15–1.25 m, at z 2.33); the set sits on it, clear of the binnacle (r 0.12 at z 2.45)
  at: [0.172, 1.268, 2.322], w: 0.112, h: 0.064, d: 0.05, tiltDeg: 22,
  lcd: { x: 0.40, y: 0.16, w: 0.55, h: 0.40 },   // the LCD's box on the face (fractions of the face)
  hz: 10, scrollCps: 9,                          // characters per second the line scrolls at (behind the voice)
  px: [320, 184],
};

// What the LCD shows: { big (the channel), tag ('WX' / 'RX' / ''), line (the text window) }. state: { channel: '16' |
// 'WX 1', text, charAt (the character the voice is at, or null), rx (receiving) }, width: the line's characters.
export function lcdView(state, width = 14) {
  const big = state.channel ?? '16';
  const tag = state.rx ? 'RX' : '';
  let line = '';
  if (state.text && state.charAt != null) {
    const t = state.text.toUpperCase(), c = Math.max(0, Math.floor(state.charAt));
    line = (t.slice(Math.max(0, c - width + 4), Math.max(0, c - width + 4) + width)).padEnd(width, ' ');
  }
  return { big, tag, line };
}

export function drawFace(g, W, H, view) {
  const L = VHF.lcd;
  g.fillStyle = '#16191d'; g.fillRect(0, 0, W, H);
  // the speaker grille: a field of small holes, left
  g.fillStyle = '#07080a';
  for (let j = 0; j < 7; j++) for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(W * (0.07 + i * 0.045), H * (0.2 + j * 0.1), W * 0.011, 0, 2 * Math.PI); g.fill(); }
  // two knobs, bottom right, and a channel key row
  g.fillStyle = '#2a2e33';
  for (const x of [0.52, 0.86]) { g.beginPath(); g.arc(W * x, H * 0.80, H * 0.11, 0, 2 * Math.PI); g.fill(); }
  g.fillStyle = '#23272c'; for (let i = 0; i < 3; i++) g.fillRect(W * (0.61 + i * 0.065), H * 0.74, W * 0.05, H * 0.12);
  // the LCD: a grey-green glass with dark segments
  const x = W * L.x, y = H * L.y, w = W * L.w, h = H * L.h;
  g.fillStyle = '#0c0e10'; g.fillRect(x - 3, y - 3, w + 6, h + 6);
  const grad = g.createLinearGradient(0, y, 0, y + h); grad.addColorStop(0, '#a4ad8f'); grad.addColorStop(1, '#8f9a7c');
  g.fillStyle = grad; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(24,30,22,0.92)'; g.textBaseline = 'alphabetic';
  g.font = `500 ${Math.round(h * 0.52)}px "Courier New", monospace`; g.textAlign = 'right';
  g.fillText(view.big, x + w * 0.96, y + h * 0.56);
  if (view.tag) { g.font = `600 ${Math.round(h * 0.2)}px "Courier New", monospace`; g.textAlign = 'left'; g.fillText(view.tag, x + w * 0.04, y + h * 0.3); }
  g.font = `500 ${Math.round(h * 0.24)}px "Courier New", monospace`; g.textAlign = 'left';
  g.fillText(view.line, x + w * 0.03, y + h * 0.88);
}
