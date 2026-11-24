// Send feedback: the form's payload, as a prefilled mailto. Pure functions, no DOM.
// Nothing is sent anywhere by the page: the mailto opens the player's own mail app, and they press send.
// The endpoint is a stub. A Cloudflare Worker (the same account and password gate as our hosting) needs the owner's go
// first; until then FEEDBACK.endpoint stays null and nothing calls the network.

export const CONTACT = 'contact@lucidlakelabs.com';   // the public contact on our sites
export const FEEDBACK = {
  to: CONTACT,
  subject: 'Velia feedback',   // the public name (owner, 2026-10-29); Lakeshore is the code name
  endpoint: null,     // the Worker's URL, after the owner's go; null: the mailto only
  maxText: 1500,      // characters of the player's text kept in the mailto (mail apps cut long URLs)
};

// the scene state that makes a bug reproducible: mode, wind level, hour, position, browser, GPU frame time
export function sceneLines(s = {}) {
  const f = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '–');
  const hh = Number.isFinite(s.hour) ? `${String(Math.floor(s.hour) % 24).padStart(2, '0')}:${String(Math.floor((s.hour % 1) * 60)).padStart(2, '0')}` : '–';
  return [
    `mode: ${s.mode ?? '–'}`,
    `wind level: ${s.windLevel ?? '–'}`,
    `hour: ${hh} (${f(s.hour, 3)})`,
    `position: ${f(s.x)}, ${f(s.z)} m, heading ${f(s.headingDeg)}°`,
    `browser: ${s.browser ?? '–'}`,
    `gpu frame: ${Number.isFinite(s.gpuMs) ? `${s.gpuMs.toFixed(2)} ms` : '–'}`,
    `view: ${s.viewport ?? '–'}`,
  ];
}

// the one-line note under the checkbox: what is attached
export const ATTACH_NOTE = 'Adds the mode, the wind level, the hour, the boat’s position, your browser and the frame time. Nothing else.';

// the quick rows (Solaria stage 1): [key, the row's words]; each is 1–5 or skipped
export const RATINGS = [['fun', 'fun'], ['beauty', 'beauty'], ['controls', 'controls'], ['performance', 'performance'], ['recommend', 'would recommend']];
// the ratings' lines in the mail: only the rows the player answered, "fun: 4 of 5"
export function ratingLines(ratings = {}) {
  return RATINGS.filter(([k]) => Number.isInteger(ratings?.[k]) && ratings[k] >= 1 && ratings[k] <= 5).map(([k, label]) => `${label}: ${ratings[k]} of 5`);
}

// the mail's body: the text, the reply address, the ratings answered and (ticked) the technical details; exactly what the
// mailto carries (the page shows the technical part as it will be sent)
export function feedbackBody({ text = '', email = '', scene = null, ratings = null } = {}, cfg = FEEDBACK) {
  const t = String(text).trim().slice(0, cfg.maxText);
  const lines = [t || '(no message)', ''];
  if (email && String(email).trim()) lines.push(`reply to: ${String(email).trim()}`, '');
  const r = ratingLines(ratings ?? {});
  if (r.length) lines.push('— quick rating —', ...r, '');
  if (scene) lines.push(...techLines(scene));
  return lines.join('\n');
}
// the technical details as the mail carries them (the Details tab shows these lines, exactly)
export const techLines = (scene) => ['— technical details —', ...sceneLines(scene)];
// the mailto: to, subject, and the body above
export function feedbackMailto(form = {}, cfg = FEEDBACK) {
  const enc = encodeURIComponent;
  return `mailto:${cfg.to}?subject=${enc(cfg.subject)}&body=${enc(feedbackBody(form, cfg))}`;
}

// a short browser name from the user agent ("Chrome 141 · macOS"); no fingerprinting beyond what a bug needs
export function browserName(ua = globalThis.navigator?.userAgent ?? '') {
  const m = (re) => ua.match(re)?.[1];
  const name = m(/Edg\/(\d+)/) ? `Edge ${m(/Edg\/(\d+)/)}` : m(/Chrome\/(\d+)/) ? `Chrome ${m(/Chrome\/(\d+)/)}` : m(/Firefox\/(\d+)/) ? `Firefox ${m(/Firefox\/(\d+)/)}`
    : m(/Version\/(\d+)[.\d]* .*Safari/) ? `Safari ${m(/Version\/(\d+)/)}` : 'unknown';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${name} · ${os}` : name;
}
