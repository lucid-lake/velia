// The crew's net, on screen (owner 2026-11-20: it had no on-screen path; H + 5 was its only way, and H + 5 is gone):
// how long the crew waits before it trims for you when you let a sheet go. One button in Setup › Aids › assists, beside steady hands:
// it steps auto (12 s, then 25 s, then off as your trim and groove are mastered) → 12 s → 25 s → off → auto, the skill model's own
// cycle (src/sail/skills.js cycleNet, NET.steps). The skills object is the page's (ui.skills), so the row mounts when the page is wired.
//   mountNetRow(root, { skills })  → { btn, paint, dispose } | null
import { NET } from '../../src/sail/skills.js';

// the button's words: "crew's net: auto · 12 s" (auto shows what it is now), "crew's net: 25 s", "crew's net: off"
export function netWords(skills) {
  const v = skills?.netAfter, now = v === Infinity ? 'off' : `${v} s`;
  return skills?.netAuto ? `crew’s net: auto · ${now}` : `crew’s net: ${now}`;
}
export const NET_STEPS = NET.steps;

export function mountNetRow(root, { skills = null, doc = globalThis.document } = {}) {
  const v = root?.querySelector?.('#tp-set-aids [data-set="assists"] .v');
  if (!v || !skills || v.querySelector('[data-net]')) return null;
  const btn = doc.createElement('button');
  btn.className = 'opt'; btn.type = 'button'; btn.dataset.net = 'cycle';
  const paint = () => { btn.textContent = netWords(skills); btn.title = 'How long the crew waits before it trims for you: click to change'; };
  const click = (e) => { e.stopPropagation(); skills.cycleNet(); paint(); };
  btn.addEventListener('click', click);
  v.appendChild(btn);
  const off = skills.onChange?.((ev) => { if (ev.type === 'settings' && ev.id === 'net') paint(); }) ?? null;
  paint();
  return { btn, paint, dispose() { btn.removeEventListener('click', click); off?.(); btn.remove(); } };
}
