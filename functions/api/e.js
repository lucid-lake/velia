// POST /api/e: Velia's anonymous play counts. A Cloudflare Pages Function on
// the game's own origin (no CORS). It checks the batch the client sends (src/metrics.js), then writes one Workers
// Analytics Engine data point per event to the dataset bound as VELIA_EVENTS. Free tier.
//
// Privacy, in the code:
//   * No cookie is read or set; nothing is stored on the device.
//   * The IP is never stored. Unique daily users are counted with `uid`: the first 16 hex of SHA-256(salt | UTC date |
//     IP | user agent). The salt is the Pages secret VELIA_SALT, so the hash cannot be rebuilt from a guessed IP, and the
//     date makes it a new value every day: nobody can be followed from one day to the next.
//   * Country is the cf-ipcountry request header (two letters). No city, no region.
//   * Do Not Track (DNT: 1) and Global Privacy Control (Sec-GPC: 1) write nothing. So do crawlers.
//   * The client sends no user text: events and fields come from the allow-list in src/metrics.js (EVENTS) and every
//     value is checked here again (enums for the labels, length caps for the rest).
// Data point layout (tools/velia_report.py reads this order):
//   index1 = event;  blob1 event · blob2 country · blob3 mode · blob4 device · blob5 backend · blob6 tier · blob7 lang
//   blob8 first_visit ('1' | '0' | '') · blob9 uid · blob10 detail (stage | reason | message | from | level | beat | source | race) · blob11 file
//   blob12 gpu (a coarse class: GPU_CLASSES in src/metrics.js; session_start and load_fail)
//   blob13 why (load_fail: LOAD_WHY in src/metrics.js) · blob14 steps (load_fail: each stage's seconds, loadSteps)
//   blob15 display (session_start: DISPLAY_MODES in src/metrics.js, browser | standalone | fullscreen; '' when not sent, as v1)
//   double1 duration_s · double2 line · double3 place · double4 1 (a count that SUMs) · double5 ms (load_fail, load_late)
import { EVENTS, LIMITS, GPU_CLASSES, FIRST_BEATS, LOAD_WHY, SUPPORT_SOURCES, DISPLAY_MODES, clean, fileOf } from '../../src/metrics.js';

const MODES = new Set(['sail', 'cruise', 'regatta', 'school', 'fly']);
const DEVICES = new Set(['phone', 'tablet', 'desktop']);
const BACKENDS = new Set(['webgpu', 'webgl2']);
const TIERS = new Set(['auto', 'high', 'balanced', 'low']);
const GPUS = new Set(GPU_CLASSES);
const BEATS = new Set(FIRST_BEATS);
const WHYS = new Set(LOAD_WHY);
const SOURCES = new Set(SUPPORT_SOURCES);
const DISPLAYS = new Set(DISPLAY_MODES);
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python-requests/i;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const reply = (status, text = null) => new Response(text, { status, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...(text ? { 'content-type': 'text/plain; charset=utf-8' } : {}) } });

export async function uidOf({ ip, ua, salt, day }) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(`${salt}|${day}|${ip}|${ua}`))).slice(0, 16);
}

const label = (set, v) => (typeof v === 'string' && set.has(v) ? v : '');
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : 0);

// one validated event -> an Analytics Engine data point (no uid or country yet), or null when the event is unknown
export function pointOf(ev) {
  if (!ev || typeof ev !== 'object' || typeof ev.n !== 'string' || !(ev.n in EVENTS)) return null;
  const p = ev.p && typeof ev.p === 'object' && !Array.isArray(ev.p) ? ev.p : {};
  const s = (k, n) => (typeof p[k] === 'string' ? clean(p[k], n) : '');
  const out = { event: ev.n, mode: '', device: '', backend: '', tier: '', lang: '', first_visit: '', detail: '', file: '', gpu: '', why: '', steps: '', display: '', duration_s: 0, line: 0, place: 0, ms: 0 };
  switch (ev.n) {
    case 'session_start':
      out.mode = label(MODES, p.mode); out.device = label(DEVICES, p.device); out.backend = label(BACKENDS, p.backend); out.tier = label(TIERS, p.tier);
      out.lang = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(p.lang ?? '') ? p.lang : ''; out.first_visit = p.first_visit === true ? '1' : p.first_visit === false ? '0' : ''; out.gpu = label(GPUS, p.gpu); out.display = label(DISPLAYS, p.display); break;
    case 'set_sail': case 'music_next': case 'sailed_2min': out.mode = label(MODES, p.mode); break;
    case 'mode_change': out.mode = label(MODES, p.to); out.detail = label(MODES, p.from); break;
    case 'regatta_finish': out.place = num(p.place, 1, 9); out.detail = /^[a-z0-9-]{1,16}$/.test(p.level ?? '') ? p.level : ''; break;
    case 'race_finished': out.detail = /^[a-z0-9-]{1,24}$/.test(p.race ?? '') ? p.race : ''; break;
    case 'session_end': out.duration_s = num(p.duration_s, 0, 86400); break;
    case 'load_fail':
      out.detail = s('stage', LIMITS.str); out.device = label(DEVICES, p.device); out.backend = label(BACKENDS, p.backend); out.gpu = label(GPUS, p.gpu);
      out.why = label(WHYS, p.why); out.ms = num(p.ms, 0, 36e5);
      out.steps = /^[a-z0-9:]{1,10} [0-9]{1,5}\.[0-9]\+?( [a-z0-9:]{1,10} [0-9]{1,5}\.[0-9]\+?)*$/i.test(p.steps ?? '') ? p.steps.slice(0, LIMITS.steps) : '';
      break;
    case 'load_late': out.ms = num(p.ms, 0, 36e5); break;
    case 'sky_fallback': out.detail = s('reason', LIMITS.str); break;
    case 'gpu_lost': out.detail = s('reason', LIMITS.str); out.backend = label(BACKENDS, p.backend); break;
    case 'watchdog_reload': out.detail = s('reason', LIMITS.str); break;
    case 'first_beat': out.detail = label(BEATS, p.beat); break;
    case 'support_click': out.detail = label(SOURCES, p.source); break;
    case 'js_error': out.detail = s('msg', LIMITS.str); out.file = typeof p.file === 'string' ? fileOf(p.file) : ''; out.line = num(p.line, 0, 10_000_000); break;
    default: break;   // goal_reached: nothing but the name
  }
  return out;
}

export async function handle(request, env, now = new Date()) {
  if (request.method !== 'POST') return reply(405, 'POST only.');
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > LIMITS.bodyBytes) return reply(413, 'Too large.');
  const raw = await request.text();
  if (enc.encode(raw).length > LIMITS.bodyBytes) return reply(413, 'Too large.');   // no content-length, or a lie
  let body;
  try { body = JSON.parse(raw); } catch { return reply(400, 'Not JSON.'); }
  if (!body || typeof body !== 'object' || body.v !== 1 || !Array.isArray(body.e) || body.e.length < 1 || body.e.length > LIMITS.batch) return reply(400, 'Bad batch.');
  const points = body.e.map(pointOf);
  if (points.some((x) => x === null)) return reply(400, 'Unknown event.');

  const h = request.headers;
  const ua = h.get('user-agent') ?? '';
  if (h.get('dnt') === '1' || h.get('sec-gpc') === '1' || BOT.test(ua)) return reply(204);   // asked not to be counted, or a crawler: counted as nothing
  if (!env?.VELIA_EVENTS?.writeDataPoint) return reply(503, 'No VELIA_EVENTS binding.');

  const cc = (h.get('cf-ipcountry') ?? '').toUpperCase();
  const country = /^[A-Z]{2}$/.test(cc) ? cc : 'XX';
  const uid = await uidOf({ ip: h.get('cf-connecting-ip') ?? '', ua, salt: env.VELIA_SALT ?? 'velia-unsalted', day: now.toISOString().slice(0, 10) });
  for (const o of points) {
    env.VELIA_EVENTS.writeDataPoint({
      indexes: [o.event],
      blobs: [o.event, country, o.mode, o.device, o.backend, o.tier, o.lang, o.first_visit, uid, o.detail, o.file, o.gpu, o.why, o.steps, o.display],
      doubles: [o.duration_s, o.line, o.place, 1, o.ms],
    });
  }
  return reply(204);
}

export const onRequest = ({ request, env }) => handle(request, env);
