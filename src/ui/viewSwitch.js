// The view switch (owner, 2026-10-29: the toggle between the boat and the helm "needs to be very visible on our
// screen; that is our main feature"): a permanent two-segment pill at the TOP centre (owner, 2026-10-29: at the bottom
// it covered the hull, and in the helm view the wheel and the cockpit; the top of the frame is sky in both views), its
// top on the top safe margin, level with the chart's top. Boat (the boat seen from astern on its waterline) · Helm (the wheel), each with its word;
// the active segment lit (the lit-cap state: full cream on a 10 % fill, a hairline), the other at 62 %. A primary
// control, not a whisper: about 44 px tall at 1280×720, larger than the hint row. Hover or focus shows its keys
// (C, the gamepad's Y held). It never idles out as the dock does: it is always there in Sail, the helm view
// included, and leaves only for Cruise's cinematic camera (Sail's controls are not up yet), the binoculars, the
// pages (the menu, the logbook, the enlarged chart) and the loading card.
// At phone width (≤ 640 px) it drops the words (icons only) and sits centred in the gap between the menu mark
// (top-left) and the small chart (top-right): the chart's size formula is copied below (chartplotter.js --sz).
// The keys' tip and the first-session line sit under it.
//
// First session: about 20 s in, if the player has not switched yet, one soft glow on the Helm segment and one line
// under it ("C · the helm"). It waits for the skill model's hints (feat/mastery, the 'skills' service) and the
// hint row's teaching to be quiet, for up to NUDGE.waitMaxS (10 s), so it rarely talks over them. Once the player has
// switched (any input), never again; it shows once per browser (localStorage 'lakeshore.view.v1'; ?once=0: every page).
//
//   const vs = createViewSwitch({ view: () => 'follow' | 'helm', set: (v) => …, hidden: () => bool,
//                                 quiet: () => bool, modality: () => 'mouse' | 'keys' | 'pad' | 'touch', once: true });
//   vs.update(dt); vs.used();  // used(): a switch by any input (C, the pad's Y, the dock): the nudge is off for good
//   vs.dispose();
// Pure parts (switchVisible, Nudge): tests/viewSwitch.test.mjs.
import { ensureTokens } from './tokens.js';
import { ICONS } from './toolDock.js';
import { createFullscreen } from './fullscreen.js';
import { track } from '../metrics.js';
import { sharedTips } from './tips.js';
import { shipClock, widest } from './shipClock.js';
import { PLACE } from '../sim/place.js';
// the four wind levels, said plain (owner, 2026-10-30)
export const WIND_LEVELS = [{ name: 'Light', range: '4–7 kn' }, { name: 'Moderate', range: '8–12 kn' }, { name: 'Fresh', range: '13–17 kn' }, { name: 'Strong', range: '18–24 kn' }];

// The Weather button's symbols (weatherMenu.js; 24 × 24, the bar's hairline strokes): the sun; the sun behind a cloud; a cloud with a
// bolt; a cloud alone (Cruise's Cloudy, which has no row here). The bar's button wears the one that is now.
const CLOUD = 'M7.2 18.6h9.6a3.6 3.6 0 0 0 .5-7.17 5.2 5.2 0 0 0-9.9-1.1A4.2 4.2 0 0 0 7.2 18.6Z';
export const WEATHER_ICONS = {
  clear: '<circle cx="12" cy="12" r="3.9"/><path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.4 5.4 7 7M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/>',
  fair: '<path d="M12.6 6.6a3.5 3.5 0 0 1 6.3 2.9"/><path d="M15.6 1.6v1.7M21.3 3.9l-1.2 1.2M22.6 9.2h-1.7M10 3.9l1.1 1.1"/><path d="M5.9 20.2h8.9a3.3 3.3 0 0 0 .5-6.57 4.8 4.8 0 0 0-9.1-1A3.9 3.9 0 0 0 5.9 20.2Z"/>',
  storm: '<path d="M8.2 15.2H7.2a4.2 4.2 0 0 1 .2-8.37 5.2 5.2 0 0 1 9.9 1.1 3.6 3.6 0 0 1-.5 7.17h-.6"/><path d="M12.9 11.2 10 15.9h3.6l-2.4 5.3"/>',
  cloudy: `<path d="${CLOUD}"/>`,
};

export const NUDGE = { atS: 20, waitMaxS: 10, glowS: 2.4, lineS: 6, key: 'lakeshore.view.v1' };

// The switch's icons (24 × 24, hairline strokes): the boat from astern on its waterline (the transom, the mast, the
// main's curve, the fin under the water), and the wheel (the dock's own, so the two read as one control).
export const VIEW_ICONS = {
  boat: '<path d="M1.8 17.6h20.4"/><path d="M4.6 13.4h14.8l-2.1 4.2H6.7Z"/><path d="M12 13.4V2.6"/><path d="M12.4 3.6c2.3 2.6 2.7 6 1.5 9.4"/><path d="M12 17.6v3.2"/>',
  helm: ICONS.helm,
  // Cruise's cameras (src/modes/chill/cameras.js): a film frame with a play mark, a hull seen from above in a frame's corners, a hill with a lens line
  cinematic: '<rect x="2.6" y="5.6" width="18.8" height="12.8" rx="1.6"/><path d="M10 9.4v5.2l4.4-2.6Z"/>',
  above: '<path d="M12 4.6c2.3 2.4 3 5.6 2.7 9.6L14 19.4h-4l-.7-5.2C9 10.2 9.7 7 12 4.6Z"/><path d="M12 8.6v7.4"/><path d="M2.6 7V2.6H7M17 2.6h4.4V7M21.4 17v4.4H17M7 21.4H2.6V17"/>',
  island: '<path d="M2.6 18.2h18.8"/><path d="M3.6 18.2 9.4 8l3.4 5.2 2.4-3 4.2 8Z"/><path d="M16.6 4.6 19.4 3M17 6.6l3.4-.4"/>',
  // Take the helm (Cruise's one action): a wheel with eight spokes
  take: '<circle cx="12" cy="12" r="5.6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 10.5V2.8M12 13.5v7.7M10.5 12H2.8M13.5 12h7.7M10.9 10.9 5.6 5.6M13.1 13.1l5.3 5.3M10.9 13.1l-5.3 5.3M13.1 10.9l5.3-5.3"/>',
};

// Where the switch is not shown (ctx: what is up now). Everything else: shown.
export function switchVisible(ctx = {}) {
  if (!ctx.controls) return false;        // no Sail controls: Cruise's cinematic camera, a headless page
  if (ctx.loading) return false;          // under the loading card
  if (ctx.menu || ctx.logbook || ctx.chartBig) return false;   // a page is open
  if (ctx.bino) return false;             // the binoculars are up (or rising)
  return true;
}

// The first-session nudge: one glow and one line, once. t counts only while the switch is shown.
export class Nudge {
  constructor({ storage = null, once = true } = {}) {
    this.storage = once ? storage : null;
    const s = this.read();
    this.done = !!(s.used || s.pulsed);   // used it, or was already shown it (one session gets it, not every one)
    this.t = 0; this.waited = 0; this.firedAt = null;
  }
  read() { try { return JSON.parse(this.storage?.getItem(NUDGE.key) ?? '{}') ?? {}; } catch { return {}; } }
  write(k) { try { this.storage?.setItem(NUDGE.key, JSON.stringify({ ...this.read(), [k]: true })); } catch { /* private mode */ } }
  used() { this.write('used'); if (this.firedAt == null) this.done = true; this.usedAt = this.t; }
  // dt: real seconds; shown: the switch is on screen; quiet: no hint is teaching now. Returns 'glow' on the frame it fires.
  update(dt, { shown = true, quiet = true } = {}) {
    if (shown) this.t += dt;
    if (this.done || this.firedAt != null || !shown || this.t < NUDGE.atS) return null;
    if (!quiet && (this.waited += dt) < NUDGE.waitMaxS) return null;
    this.firedAt = this.t; this.done = true; this.write('pulsed');
    return 'glow';
  }
  // the glow's and the line's level now, 0–1 (a soft rise and fall; the line holds, then fades); a switch ends both
  level() {
    if (this.firedAt == null) return { glow: 0, line: 0 };
    const a = this.t - this.firedAt;
    if (this.usedAt != null && this.usedAt >= this.firedAt) return { glow: 0, line: 0 };
    const g = a < NUDGE.glowS ? Math.sin(Math.PI * a / NUDGE.glowS) ** 2 : 0;
    const l = a < 0.6 ? a / 0.6 : a < NUDGE.lineS ? 1 : a < NUDGE.lineS + 0.8 ? 1 - (a - NUDGE.lineS) / 0.8 : 0;
    return { glow: g, line: l };
  }
}

// The top capsule (owner, 2026-10-30; the iOS Dynamic Island as a reference, interpreted): ONE compact near-black capsule at the top
// centre, the scene untouched around it. At rest it is small: Menu and the current view ("≡ · Boat"). It morphs (a spring-like
// width and height, about 380 ms, the content cross-fading) on the pointer near the top, a hover, a tap or the / key to show the items
// (Menu, the view segments, Wind, Sound, Settings), and contracts after 3 s idle. It also shows game and system events for 2.4 s
// ("Wind 3", "Cruise"): never the skipper's lines, which are the bottom subtitle's (tests/dashboard.test.mjs). Reduced motion: a fade.
export const MCAP_S = 4, MCAP_WAITS = 20;   // the song caption shows this long; it waits at most this long for a hint line to clear
export const ISLAND = { idleS: 3, nearPx: 56, nearHalfPx: 280, msgS: 2.4, key: 'Slash' };
const CSS = `
/* crisp on a 3x phone: no translate(-50%) anywhere (half a pixel on a
   composited, backdrop-blurred layer is what Safari smeared), the bar centred by a full-width row whose width and the capsule's
   share their parity (fit()), the glyphs at whole pixels, 1.7 px strokes */
.lk-view{--ih:32px;position:fixed;left:0;right:0;top:calc(var(--lk-sat,0px) + var(--lk-edge-gap));transform:none;z-index:var(--lk-z-hud);pointer-events:none;
  display:flex;flex-direction:column;align-items:center;gap:.55em;user-select:none;-webkit-user-select:none;
  font:var(--lk-medium) calc(var(--lk-fs-caption) * .88)/1 var(--lk-ui);color:var(--lk-chrome-ink);letter-spacing:var(--lk-track);
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  opacity:1;transition:opacity var(--lk-in) var(--lk-ease),transform var(--lk-in) var(--lk-ease)}
.lk-view>.isl,.lk-view .lk-windpick,.lk-view .lk-sndpick,.lk-view .lk-timepick{pointer-events:auto}
.lk-view.off *{pointer-events:none!important}
.lk-view.off{opacity:0;transform:translate(0,calc(-1 * var(--lk-rise)));pointer-events:none;transition:opacity var(--lk-out) var(--lk-ease-out),transform var(--lk-out) var(--lk-ease-out)}
.lk-view .isl{position:relative;height:var(--ih,36px);width:var(--iw,auto);background:rgb(var(--lk-brand-navy) / .78);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);border:var(--lk-line) solid var(--lk-glass-edge);box-sizing:border-box;border-radius:calc(var(--ih,36px) / 2);overflow:hidden;
  box-shadow:0 2px 12px rgb(0 0 0 / .35);transition:width .38s cubic-bezier(.34,1.32,.5,1),height .38s cubic-bezier(.34,1.32,.5,1),border-radius .38s}
.lk-view.cold .isl{transition:none}
.lk-view .lay{position:absolute;top:0;left:1px;height:100%;display:flex;align-items:center;gap:.2em;padding:0 .35em;white-space:nowrap;transition:opacity .22s}
.lk-view .full{opacity:1;pointer-events:auto}
.lk-view button{all:unset;position:relative;box-sizing:border-box;display:flex;align-items:center;gap:.42em;height:calc(var(--ih,32px) - 7px);padding:0 .62em;border-radius:999px;cursor:pointer;
  color:var(--lk-chrome-ink);touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background-color .2s,color .2s}
/* the bar is slimmer than a finger: the hit area (44 px least) is the button's own invisible margin */
.lk-view button::after{content:'';position:absolute;left:-4px;right:-4px;top:50%;height:44px;transform:translateY(-50%)}
.lk-view button:hover{background:rgb(255 255 255 / .12)}
.lk-view button:focus-visible{outline:var(--lk-line) solid var(--lk-chrome-ink);outline-offset:-2px}
.lk-view button svg{flex:none;width:round(1.4em,1px);height:round(1.4em,1px);fill:none;stroke:currentColor;stroke-width:1.7px;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;overflow:visible}
.lk-view button svg *{vector-effect:non-scaling-stroke}
.lk-view .seg.on{background:var(--lk-chrome-ink);color:var(--lk-chrome-bg)}
.lk-view .seg.on:hover{background:var(--lk-chrome-ink)}
/* round 3b: both views at rest, the current one lit, the other dimmer with a hairline so it reads as a button */
.lk-view .seg:not(.on){opacity:.82;box-shadow:inset 0 0 0 var(--lk-line) rgb(255 255 255 / .3)}
.lk-view .seg:not(.on):hover{opacity:1}
.lk-view .rest .pill{margin-left:.1em}
.lk-view .seg .ring{position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:var(--glow,0);box-shadow:0 0 0 2px var(--lk-chrome-ink),0 0 14px var(--lk-chrome-ink)}
.lk-view .dv{width:var(--lk-line);height:46%;background:rgb(255 255 255 / .22);margin:0 .25em}
.lk-view .lvl{font-variant-numeric:tabular-nums;opacity:.85}
.lk-view .pill{display:flex;align-items:center;gap:2px}
.lk-view .tip{position:absolute;left:50%;white-space:nowrap;display:flex;align-items:center;gap:.5em;pointer-events:none;
  font-size:var(--lk-fs-caption);color:var(--lk-chrome-ink);padding:.35em .75em;border-radius:999px;background:var(--lk-chrome-bg)}
.lk-view .tip{top:calc(100% + .6em);transform:translate(-50%,calc(-1 * var(--lk-rise)));opacity:0;transition:opacity .2s,transform .2s}
.lk-view .tip{display:none}   /* the capsule's words say it; the key is in the Keys list (the subtitle line sits where the tip stood) */
.lk-view.nudge .tip,.lk-view.done .tip{opacity:0!important}
.lk-view .cap{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:1.7em;height:1.7em;padding:0 .45em;
  border:var(--lk-line) solid rgb(255 255 255 / .4);border-radius:.35em;font-weight:var(--lk-medium);font-size:var(--lk-fs-caption);letter-spacing:.02em}
.lk-view .soft{opacity:.8}
:where(:root[data-f-finger-targets=on]) .lk-view{--ih:40px}
/* one rule for every button (owner, 2026-11-10: "when we have space we need to have word, when in short, show buttons only"):
   icon + word while the worded bar fits the window, icons only when it does not. fit() measures it and sets .ico: no width or
   device guess, and every button switches together (the names are then tips: tips.js). The clock keeps its reading: it is the word */
.lk-view.ico .w,.lk-view.ico .clk svg:not(.cv){display:none}
.lk-view.ico .clk{column-gap:0}
:where(:root[data-screen~=narrow]) .lk-view button{padding:0 .45em}:where(:root[data-screen~=narrow]) .lk-view .lay{gap:0;padding:0 .2em}:where(:root[data-screen~=narrow]) .lk-view .dv{margin:0 .1em}
:where(:root[data-f-finger-targets=on]) .lk-view button{min-width:44px;justify-content:center}:where(:root[data-f-finger-targets=on]) .lk-view button svg{width:22px;height:22px}   /* the height's 44 px is the ::after: a taller button was clipped by the 40 px bar */
.lk-view .xt[hidden]{display:none}
/* Cruise's view slot (owner, 2026-11-11): the camera on screen with its menu, then Take the helm, the one quiet
   emphasis (a faint cream fill and hairline, not the white of an "on" state) */
.lk-view .xt[data-x=take]{background:rgb(var(--lk-cream) / .13);box-shadow:inset 0 0 0 var(--lk-line) rgb(var(--lk-cream) / .42);margin-left:.25em}
.lk-view .xt[data-x=take]:hover{background:rgb(var(--lk-cream) / .22)}
:where(:root[data-screen~=narrow],:root[data-f-finger-targets=on]) .lk-view .xt[data-x=take]{margin-left:2px}
/* the expand chevron (owner, 2026-11-11): one glyph after the word of every bar button that opens a menu under it
   (aria-haspopup), never on one that acts at once. 70 % at rest, full on hover, focus and open; open flips it and lights the button */
.lk-view .cv{flex:none;width:10px;height:10px;margin-left:-.12em;fill:none;stroke:currentColor;stroke-width:1.7px;stroke-linecap:round;stroke-linejoin:round;
  opacity:.7;transition:transform var(--lk-t1,120ms) cubic-bezier(.2,0,0,1),opacity var(--lk-t1,120ms)}
.lk-view button:hover .cv,.lk-view button:focus-visible .cv,.lk-view button[aria-expanded=true] .cv{opacity:1}
.lk-view button[aria-expanded=true] .cv{transform:rotate(180deg)}
.lk-view button[aria-expanded=true]{background:rgb(255 255 255 / .16)}
/* icon-only (no room for the words: an upright phone, a narrow window): the chevron tucks into the icon's lower-right corner as a
   badge; no width. A sideways phone that has room for the words keeps the chevron after the word (a badge there sat on the word) */
.lk-view.ico .cv{position:absolute;right:5px;bottom:3px;width:7px;height:7px;margin:0;stroke-width:2px;opacity:.8}
[data-screen~=compact] .lk-view.ico .cv{right:7px;bottom:5px}
@media (prefers-reduced-motion:reduce){.lk-view .cv{transition:none}}
/* the ship's clock (owner, 2026-11-09): quiet words at the bar's end, the bar's own type and ink, a touch dimmer than a button; not a timer, not a score.
   The ghost (the widest reading, invisible) reserves its width so the bar never breathes as the digits change; .tx is what is read. */
.lk-view .clk{display:inline-grid;grid-template-columns:auto auto auto;column-gap:.42em;align-items:center;flex:none;padding:0 .7em 0 .62em;white-space:nowrap;font-variant-numeric:tabular-nums;opacity:.86}
.lk-view .clk[aria-expanded=true],.lk-view .clk:hover{opacity:1}
.lk-view .clk>*{grid-area:1/2;font-style:normal;font-weight:inherit}
.lk-view .clk>svg{grid-area:1/1}
.lk-view .clk>.cv{grid-area:1/3}
.lk-view.ico .clk>.cv{grid-area:auto}
.lk-view .clk .gh{visibility:hidden}
.lk-view .clk .tx{text-align:end}
.lk-view .clk[hidden],.lk-view .clkdv[hidden]{display:none}
/* a narrow bar: the time alone when the date will not fit (clkFit), nothing under about 340 px */
:where(:root[data-screen~=narrow]) .lk-view .clk{padding:0 .2em}:where(:root[data-screen~=narrow]) .lk-view .clkdv{margin:0}
/* a phone: Sail's bar is Menu | Boat · Helm | Cruise | Settings; Cruise's keeps Sound. Wind and Sound are in Settings, Keys behind Menu, Log in PANEL */
[data-screen~=compact] .lk-view .xt[data-x=wind],[data-screen~=compact] .lk-view .xt[data-x=weather],[data-screen~=compact] .lk-view .xt[data-x=log],[data-screen~=compact] .lk-view .xt[data-x=keys],[data-screen~=compact] .lk-view:not(.fsph) .xt[data-x=fullscreen]{display:none}
/* Sail's bar on a phone with the Fullscreen API (Android; an iPhone has none: the button stays hidden): Full, which turns it sideways (feat/cockpit-phone) */
.lk-windpick{position:absolute;top:calc(100% + .5em);left:50%;transform:translateX(-50%);display:flex;gap:.2em;padding:.25em;border-radius:999px;background:var(--lk-chrome,rgb(28 35 64 / .88));color:var(--lk-chrome-ink,#fff);z-index:7}
.lk-windpick[hidden]{display:none}
/* the clock's menu (owner, 2026-11-09): five rows under the clock, navy and cream like the wind picker; amber only on the row that is now.
   The Weather button's menu (owner, 2026-11-10) is the same one: three rows, each with its symbol */
.lk-timepick{position:absolute;top:calc(100% + .5em);display:flex;flex-direction:column;padding:.25em;border-radius:1em;background:var(--lk-chrome,rgb(28 35 64 / .88));color:var(--lk-chrome-ink,#fff);z-index:7;font-size:var(--lk-fs-caption,13px);min-width:9.5em;box-shadow:0 2px 12px rgb(0 0 0 / .35)}
.lk-timepick[hidden]{display:none}
.lk-timepick button{all:unset;position:relative;box-sizing:border-box;display:flex;align-items:center;gap:.5em;min-height:36px;padding:0 .9em;border-radius:.75em;cursor:pointer;white-space:nowrap;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.lk-timepick button::after{content:none}
.lk-timepick button:hover{background:rgb(255 255 255 / .12)}
.lk-timepick button:focus-visible{outline:var(--lk-line,1px) solid var(--lk-chrome-ink,#fff);outline-offset:-2px}
.lk-timepick button.fw,.lk-timepick button.sep{margin-top:.35em}
.lk-timepick button.dead{opacity:.45;cursor:default}
.lk-timepick button.fw::before,.lk-timepick button.sep::before{content:'';position:absolute;left:.9em;right:.9em;top:-.2em;height:var(--lk-line,1px);background:rgb(255 255 255 / .22)}
.lk-timepick button svg{flex:none;width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7px;stroke-linecap:round;stroke-linejoin:round}
.lk-timepick button.on{color:rgb(var(--lk-amber));font-weight:var(--lk-medium)}
:where(:root[data-f-finger-targets=on],:root[data-screen~=narrow]) .lk-timepick button{min-height:44px}
/* the music segment (owner, 2026-11-04): a note (opens the Sound popover) and a skip in one subtle pill, in every mode and on a phone; the note dims while the music is paused or off */
.lk-view .mus{display:flex;align-items:center;flex:none;height:calc(var(--ih,32px) - 7px);border-radius:999px;background:rgb(255 255 255 / .1)}
.lk-view .mus button{width:calc(var(--ih,32px) - 7px);min-width:0;padding:0;justify-content:center}
.lk-view .mus button:hover{background:rgb(255 255 255 / .12)}
.lk-view:not(.ico) .mus .xt[data-x=sound]{width:auto;padding:0 .5em 0 .55em}
.lk-view .mus .xt[data-x=sound]{transition:opacity .2s,background-color .2s}
.lk-view .mus.dim .xt[data-x=sound] svg{opacity:.55}
:where(:root[data-f-finger-targets=on],:root[data-screen~=narrow]) .lk-view .mus button{width:44px;min-width:44px}:where(:root[data-f-finger-targets=on],:root[data-screen~=narrow]) .lk-view .mus{height:44px}
/* the song's title (owner, 2026-11-05: no pill under the bar): when a song starts the music segment widens to show it inline, a note, the title, a skip; 4 s, then it eases back. --tw is the title's measured width */
.lk-view .mus .ttl{display:block;flex:none;box-sizing:border-box;max-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;opacity:0;font-size:var(--lk-fs-caption);letter-spacing:var(--lk-track);
  transition:max-width .5s cubic-bezier(.22,.7,.2,1),opacity .3s,padding .5s cubic-bezier(.22,.7,.2,1)}
.lk-view .mus.song .ttl{max-width:var(--tw,12em);opacity:.95;padding:0 .35em}
.lk-view.song .isl{transition:height .38s cubic-bezier(.34,1.32,.5,1),border-radius .38s}   /* the capsule follows the segment frame by frame (the resize observer) */
/* a narrow screen: the other items step out of the way while the title shows (their widths are pinned inline first, so the collapse eases) */
.lk-view .lay.full>*{transition:width .45s cubic-bezier(.22,.7,.2,1),padding .45s,margin .45s,opacity .3s,visibility 0s 0s,background-color .2s,color .2s}
.lk-view.tight .lay.full>:not(.mus){width:0!important;min-width:0!important;padding:0!important;margin:0!important;opacity:0;overflow:hidden;visibility:hidden;transition:width .45s cubic-bezier(.22,.7,.2,1),padding .45s,margin .45s,opacity .3s,visibility 0s .45s}
@media (prefers-reduced-motion:reduce){.lk-view .mus .ttl,.lk-view .lay.full>*,.lk-view.tight .lay.full>:not(.mus){transition:none}}
/* Cruise's Sound dropdown (owner, 2026-10-30): the music's pause / play, next, the piece, the volume */
.lk-sndpick{position:absolute;top:calc(100% + .5em);display:flex;flex-direction:column;align-items:stretch;gap:.1em;padding:.25em;border-radius:1em;background:var(--lk-chrome,rgb(28 35 64 / .88));color:var(--lk-chrome-ink,#fff);z-index:7;font-size:var(--lk-fs-caption,13px)}
.lk-sndpick[hidden]{display:none}
.lk-sndpick .row{display:flex;align-items:center;gap:.15em;padding-right:.35em}
/* the menu's first row (owner, 2026-11-11): Next song, a row like the clock menu's (the ] key stays) */
.lk-sndpick button.nx{display:flex;align-items:center;justify-content:flex-start;gap:.5em;width:auto;height:auto;min-height:36px;padding:0 .9em;border-radius:.75em;white-space:nowrap}
.lk-sndpick button.nx svg{width:18px;height:18px}
:where(:root[data-f-finger-targets=on],:root[data-screen~=narrow]) .lk-sndpick button.nx{min-height:44px;width:auto;height:auto}
[data-input=touch] .lk-sndpick button.nx{width:auto;height:auto;min-height:44px}
.lk-sndpick button{all:unset;position:relative;box-sizing:border-box;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;cursor:pointer;touch-action:manipulation}
:where(:root[data-f-finger-targets=on]) .lk-sndpick button{width:44px;height:44px}:where(:root[data-f-finger-targets=on]) .lk-sndpick input[type=range]{height:44px}
[data-input=touch] .lk-sndpick button{width:44px;height:44px}[data-input=touch] .lk-sndpick input[type=range]{height:44px}
.lk-sndpick button:hover{background:rgb(255 255 255 / .12)}
.lk-sndpick button:focus-visible{outline:var(--lk-line,1px) solid var(--lk-chrome-ink,#fff);outline-offset:-2px}
.lk-sndpick button.mu[aria-pressed=true]{opacity:.55}
.lk-sndpick svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7px;stroke-linecap:round;stroke-linejoin:round}
.lk-sndpick .ti{max-width:11em;min-width:6em;padding:0 .5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9}
.lk-sndpick input[type=range]{-webkit-appearance:none;appearance:none;width:clamp(70px,7vw,100px);height:34px;margin:0;background:none;cursor:pointer;touch-action:none}
.lk-sndpick input[type=range]::-webkit-slider-runnable-track{height:2px;background:linear-gradient(90deg,var(--lk-chrome-ink,#fff) var(--v,100%),rgb(255 255 255 / .28) var(--v,100%))}
.lk-sndpick input[type=range]::-moz-range-track{height:2px;background:rgb(255 255 255 / .28)}
.lk-sndpick input[type=range]::-moz-range-progress{height:2px;background:var(--lk-chrome-ink,#fff)}
.lk-sndpick input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-6px;border-radius:50%;background:var(--lk-chrome-ink,#fff);border:0}
.lk-sndpick input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--lk-chrome-ink,#fff);border:0}
.lk-sndpick input[type=range]:focus-visible{outline:var(--lk-line,1px) solid var(--lk-chrome-ink,#fff);outline-offset:2px}
:where(:root[data-screen~=narrow]) .lk-sndpick .ti{display:none}:where(:root[data-screen~=narrow]) .lk-sndpick input[type=range]{width:64px}
.lk-windpick button{all:unset;box-sizing:border-box;display:grid;grid-template-columns:auto 1fr;column-gap:.5em;align-items:baseline;min-height:44px;min-width:44px;padding:.3em .9em;border-radius:999px;cursor:pointer;font-size:var(--lk-fs-caption,13px)}
.lk-windpick button{position:relative}   /* its own rule: beside all:unset Chrome kept it unset, and each ::after hit area spanned the whole picker (the last option took every press) */
.lk-windpick button i{grid-column:2;font-style:normal;opacity:.75;font-size:.85em}
.lk-windpick button:hover{background:rgb(255 255 255 / .12)}
.lk-windpick button.on{background:rgb(255 255 255 / .22);font-weight:var(--lk-medium)}
.lk-windpick button:focus-visible{outline:var(--lk-line,1px) solid var(--lk-chrome-ink,#fff);outline-offset:-2px}
:where(:root[data-screen~=narrow]) .lk-windpick{flex-wrap:wrap;width:max-content;max-width:94vw;border-radius:1em}
/* a phone: Menu | Boat · Helm | Cruise | Wind · Log · Settings; Keys has no place on touch, Sound sits in Settings */
:where(:root[data-screen~=narrow]) .lk-view .xt[data-x=keys]{display:none}
@media (prefers-reduced-motion:reduce){.lk-view .isl{transition:none}.lk-view,.lk-view.off{transform:none}.lk-view .tip{transform:translate(-50%,0)}}   /* the bar is a full-width row (left 0, right 0): no -50% shift, it slid half off screen */
`;

// the ship's clock's sources for a mode's bar: the game's hour (core.sun.hour, every mode, the day clock), the map's day (PLACE.date:
// the highlight day, ?day=normal and so on)
export const barClock = (core) => ({ hour: () => core.sun?.hour ?? null, date: () => PLACE.date });
// the clock menu's Fireworks mark: a burst, rays from a centre and a dot at each tip (the bar's 1.7 px stroke)
const BURST_ICON = '<circle cx="12" cy="12" r="1.3"/><path d="M12 5.2v3.6M12 15.2v3.6M5.2 12h3.6M15.2 12h3.6M7.2 7.2l2.5 2.5M14.3 14.3l2.5 2.5M16.8 7.2l-2.5 2.5M9.7 14.3l-2.5 2.5"/><path d="M12 3.3h.01M12 20.7h.01M3.3 12h.01M20.7 12h.01M5.9 5.9h.01M18.1 18.1h.01M18.1 5.9h.01M5.9 18.1h.01" stroke-width="2.6"/>';
const SEGS = [['follow', 'boat', 'Boat'], ['helm', 'helm', 'Helm']];
// chevron.down (SF Symbols' shape): a 10 × 10 box, the bar's hairline; the badge form on an icon-only bar is CSS
export const CHEVRON = '<svg class="cv" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.2 3.6 5 6.4 7.8 3.6"/></svg>';
export const CRUISE_ICON = '<path d="M5 12a7 7 0 0 1 12-5M19 12a7 7 0 0 1-12 5"/><path d="M17 3.5V7h-3.5M7 20.5V17h3.5"/>';

// segments: [[id, icon, word], …] (default Boat | Helm); tip: the hover tip's inner html; nudge: the first-session glow
// on the segment 'helm' (Sail only). Cruise passes its five cameras (src/modes/chill/index.js).
export function createViewSwitch({ root = document.body, view, set, hidden = () => false, quiet = () => true,
  modality = () => 'mouse', once = true, storage = globalThis.localStorage ?? null, moveS = 1,
  segments = SEGS, label = 'view', tip = null, nudge: nudgeOn = true, cruise = null, log = null, windPick = null, music = null, subtitle = null, fullscreen = createFullscreen(),
  services = null, titles = false, extras: only = null, fullscreenOnPhone = false, fullKey = true,
  clock = null, clockMenu = null, weatherMenu = null, views = null, primary = null, locker = null } = {}) {   // locker: lockerMenu() (toolDock.js): a mode with no cockpit keeps the passenger's gear in one menu after the view slot (Cruise)
   // views: { cameras: [[id, icon, word], …], get, set }: more views than a pill holds (Cruise's five cameras), one button named for the one on screen and a menu under it; primary: { word, icon, label, go }: the one pill beside it (Cruise's Take the helm)   // weatherMenu: { rows, current, pick } (src/weather/weatherMenu.js): a Weather button after Wind, its symbol the weather now, the same menu under it   // clockMenu: { rows: [{ id, name }], current: () => id | null, pick: (id) => … } (timeMenu.js): the clock opens it; without it the clock is a plain readout   // clock: { hour: () => the game's hour of day (or null), date: () => 'YYYY-MM-DD' (the map's day) }: the ship's clock at the bar's end (shipClock.js)   // services: the page's registry (src/core/services.js): the shell's menu, the mode for the metrics; titles: kept for the callers, unused since Solaria stage 1 (no browser tooltip on any button: the page's one tip names each, tips.js)
  // Sail (owner, 2026-10-30): Cruise (a mode: its own segment) after the views, Log among the tools before Full
  ensureTokens();
  if (!document.getElementById('lk-view-css')) {
    const st = document.createElement('style'); st.id = 'lk-view-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = document.createElement('div'); el.className = `lk-view cold${fullscreenOnPhone ? ' fsph' : ''}`;
  const MENU_ICON = '<path d="M5 8h14M5 12h14M5 16h9"/>';
  const FS_IN = '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', FS_OUT = '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>';
  const XT = [['wind', '<path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7"/>', 'Wind'], ['sound', '<path d="M4 9.5h3l4-3.5v12l-4-3.5H4Z"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11"/>', 'Sound'],
    ['fullscreen', FS_IN, 'Full'], ['settings', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>', 'Setup']];
  const NOTE = '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>';
  const tt = () => '';   // no browser titles (they floated over the sky): tips.js names every button
  const ibtn = (id, ic, name) => `<button type="button" class="xt" data-x="${id}" aria-label="${name}"${tt(name)}><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg></button>`;
  // the music segment: Music (its menu holds Next song, pause and the volume; owner, 2026-11-11: ⏭ folded into the menu everywhere, the ] key stays)
  const musicSeg = `<span class="mus" role="group" aria-label="music">${ibtn('sound', NOTE, 'music').replace('</svg>', '</svg><span class="w">Music</span>')}<span class="ttl" aria-hidden="true"></span></span>`;
  const CLOCK_ICON = '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>';
  const btn = (cls, ic, word, extra = '') => `<button type="button" class="${cls}" ${extra}><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><span class="w">${word}</span></button>`;
  // only: the extras this bar keeps (Cruise's, owner 2026-11-06: the app's own, the music, Full, Settings); no segments: no view pill, a hairline after the music
  if (weatherMenu) XT.splice(1, 0, ['weather', WEATHER_ICONS.fair, 'Weather']);   // after Wind
  // the world's settings at the bar's end beside the clock (owner, 2026-11-11: "all game god mode settings group at same place"):
  // Music, Full, Setup, then Wind and Weather, then the time
  const WORLD = new Set(['wind', 'weather']);
  XT.push(...XT.splice(0, XT.length).sort((a, b) => WORLD.has(a[0]) - WORLD.has(b[0])));
  const xts = XT.filter(([id]) => (!only || only.includes(id)));
  const pillHtml = segments.length ? `<div class="pill" role="group" aria-label="${label}">${segments.map(([id, ic, word]) =>
      `<button type="button" class="seg" data-view="${id}" aria-pressed="false" aria-label="${word} ${label} (C)"${tt(word)}>`
      + `${id === 'helm' && nudgeOn ? '<span class="ring"></span>' : ''}<svg viewBox="0 0 24 24" aria-hidden="true">${VIEW_ICONS[ic]}</svg><span class="w">${word}</span></button>`).join('')}</div>` : '';
  // the where slot (Menu | where you are | the app | the world | the clock): Sail's Boat | Helm pill, or Cruise's camera menu and Take the helm
  const cam0 = views ? (views.cameras.find((c) => c[0] === views.get()) ?? views.cameras[0]) : null;
  const whereHtml = segments.length ? pillHtml : views
    ? `<button type="button" class="xt vw" data-x="views" aria-haspopup="menu" aria-expanded="false" aria-label="View · ${cam0[2]} (C)"><svg viewBox="0 0 24 24" aria-hidden="true">${cam0[1]}</svg><span class="w">${cam0[2]}</span></button>`
      + (primary ? btn('xt', primary.icon, primary.word, `data-x="take" aria-label="${primary.label ?? primary.word}"`) : '')
    : '';
  const lockerHtml = locker ? `<span class="dv"></span>${btn('xt', ICONS.locker, 'Locker', 'data-x="locker" aria-label="Locker" aria-haspopup="menu" aria-expanded="false"')}` : '';
  const where = !!whereHtml;
  el.innerHTML = `<div class="isl" role="group" aria-label="${label}">`
    + `<div class="lay full">${btn('mn', MENU_ICON, 'Menu', 'aria-label="Menu (Esc)"')}${where ? `<span class="dv"></span>${whereHtml}` : ''}${lockerHtml}`
    + (cruise ? `<span class="dv xt"></span>${btn('xt cr', CRUISE_ICON, 'Cruise', 'data-x="cruise" aria-label="Cruise: let her sail herself (`)"')}` : '')
    + `<span class="dv xt"></span>${xts.map(([id, ic, word], i) => (WORLD.has(id) && i > 0 && !WORLD.has(xts[i - 1][0]) ? '<span class="dv xt"></span>' : '') + (id === 'sound' ? musicSeg + (!where && i < xts.length - 1 ? '<span class="dv xt"></span>' : '') : id === 'weather' ? btn('xt', ic, 'Fair', `data-x="${id}" aria-label="${word}" aria-haspopup="menu" aria-expanded="false"`) : btn('xt', ic, word, `data-x="${id}" aria-label="${id === 'log' ? 'Log (L)' : word}"`))).join('')}`
    + (clock ? `<span class="dv clkdv"></span><button type="button" class="clk" data-tip="Time of day"${clockMenu ? ' aria-haspopup="menu" aria-expanded="false"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${CLOCK_ICON}</svg><i class="gh" aria-hidden="true"></i><b class="tx"></b></button>` : '')
    + '</div></div>'
    + `<div class="tip" aria-hidden="true">${tip ?? ''}</div>`;
  root.appendChild(el);
  const segs = [...el.querySelectorAll('.seg')];
  const isl = el.querySelector('.isl'), layFull = el.querySelector('.lay.full');
  // Round 4 (owner, 2026-10-30): the bar is always expanded, no island morph. Menu | Boat | Helm | Wind Sound Log Full Settings stay up as one compact bar; a game event
  // (wind level, saved...) shows for msgS as a small line UNDER it (the subtitle steps down for that time: the two channels never overlap).
  // the ship's clock (shipClock.js): the date and time, "4 Jul · 21:45", the time alone on a window too narrow for it.
  // The text changes only when the minute does (no per-frame writes); the ghost keeps the bar's width still.
  const clkEl = el.querySelector('.clk'), clkDv = el.querySelector('.clkdv');
  const clkTx = clkEl?.querySelector('.tx'), clkGh = clkEl?.querySelector('.gh');
  let clkMode = 'full', clkKey = '', clkGhKey = '', clkRoom = true;   // clkRoom: false on a window too narrow even for the time alone: no readout
  const clkPaint = () => {
    if (!clkEl) return;
    const hr = clock.hour?.(), date = clock.date?.();
    const none = !Number.isFinite(hr) || !clkRoom;
    if (clkEl.hidden !== none) { clkEl.hidden = none; clkDv.hidden = none; }
    if (none) return;
    const key = `${Math.floor(hr * 60 + 1e-6)}|${date}|${clkMode}`;
    if (key === clkKey) return;
    clkKey = key;
    const r = shipClock({ hour: hr, date });
    clkTx.textContent = r[clkMode]; clkEl.setAttribute('role', 'img'); clkEl.setAttribute('aria-label', r.label);
    const gk = `${date}|${clkMode}`;
    if (gk !== clkGhKey) { clkGhKey = gk; clkGh.textContent = widest({ date })[clkMode]; }
  };
  const clkFit = () => {   // the longest reading that fits the window (not while a song title has the bar)
    if (!clkEl || el.classList.contains('song') || !Number.isFinite(clock.hour?.())) return;
    const vw = document.documentElement.clientWidth;
    clkRoom = true; clkPaint();
    for (const m of ['full', 'time']) {
      if (clkMode !== m) { clkMode = m; clkPaint(); }
      if (Math.ceil(layFull.scrollWidth) + 2 <= vw - 16) return;
    }
    clkRoom = false; clkPaint();
  };
  // words or icons (owner, 2026-11-10): the worded bar, with the clock's longest reading, is measured against the window; if it does
  // not fit, every word goes at once (.ico). Not while a song title has the bar (its width is the title's, for 4 s).
  const wordFit = () => {
    if (el.classList.contains('song') || el.classList.contains('tight')) return;
    const vw = document.documentElement.clientWidth;
    el.classList.remove('ico');
    if (clkEl && clkMode !== 'full' && Number.isFinite(clock.hour?.())) { clkRoom = true; clkMode = 'full'; clkPaint(); }
    const w = Math.ceil(layFull.scrollWidth) + 2;
    if (Number.isFinite(w) && Number.isFinite(vw) && w > vw - 16) el.classList.add('ico');
  };
  const fit = () => {
    wordFit(); clkFit();
    // whole pixels, and the same parity as the window's width: centred, the capsule's left edge lands on a whole pixel
    let iw = Math.ceil(layFull.scrollWidth) + 2;
    if ((document.documentElement.clientWidth - iw) % 2) iw += 1;
    isl.style.setProperty('--iw', `${iw}px`);
  };
  const wake = () => {};   // kept for the callers (the first-session nudge, the extras): the bar has nothing to wake
  // a game event (wind level, saved, a status) is a brief line in the subtitle line (subtitle: its caller's), never a pill under the bar
  const say = (text, o = {}) => { subtitle?.(text, { secs: ISLAND.msgS, ...o }); };
  const menu = () => services?.get('menu');
  const press = (code) => { for (const type of ['keydown', 'keyup']) { const e = new KeyboardEvent(type, { code, key: code.replace(/^Key|^Digit/, ''), bubbles: true }); e.lkDock = true; dispatchEvent(e); } };
  const extras = {
    wind: () => (windPick ? toggleWind() : document.querySelector('.lk-dock .it[data-id=wind]')?.click()),
    fullscreen: () => fullscreen.toggle(),
    sound: () => { if (snd) toggleSnd(); else { press('KeyM'); say('Sound toggled'); } },
    next: () => nextSong(),
    keys: () => { menu()?.open?.(); menu()?.show?.('keys'); },   // the Keys page of the home card (the same card, the same frame), not the H list
    settings: () => { menu()?.open?.(); menu()?.show?.('settings'); },
    cruise: () => cruise?.(), log: () => log?.(),
    weather: () => wxM?.toggle(),
    views: () => vwM?.toggle(),
    take: () => primary?.go?.(),
    locker: () => lkM?.toggle(),
  };
  // Wind: a direct picker (owner, 2026-10-30): four levels with a plain name and range; one tap applies and closes
  const fsBtn = el.querySelector('.xt[data-x=fullscreen]'), windBtn = el.querySelector('.xt[data-x=wind]');
  const paintFs = () => {
    if (!fsBtn) return;
    fsBtn.hidden = !fullscreen.supported();   // iPhone: no API, no button
    const on = fullscreen.active();
    const fsName = `${on ? 'Exit full screen' : 'Full screen'}${fullKey ? ' (Shift+F)' : ''}`; fsBtn.setAttribute('aria-label', fsName); fsBtn.setAttribute('aria-pressed', String(on));   // (fullKey false on v2: no Shift+F handler there)
    fsBtn.querySelector('svg').innerHTML = on ? FS_OUT : FS_IN; fsBtn.querySelector('.w').textContent = on ? 'Exit' : 'Full';
  };
  fullscreen.on(paintFs); paintFs();
  let pick = null;
  const closeWind = () => { if (pick) { pick.hidden = true; windBtn?.setAttribute('aria-expanded', 'false'); } };
  const windW = windBtn?.getElementsByClassName?.('w') ?? null;   // live (paintWind runs every frame; a test DOM without it queries)
  const paintWind = () => {
    if (!windPick || !windBtn) return;
    const n = windPick.level(), lv = WIND_LEVELS[n - 1];
    const word = lv ? lv.name : 'Wind', full = lv ? `Wind ${n} · ${lv.name}, ${lv.range}` : 'Wind';   // the bar says the word only; the number and range are the title
    const w = windW ? windW[0] : windBtn.querySelector('.w'); if (w.textContent !== word) w.textContent = word;
    windBtn.setAttribute('aria-label', full); windBtn.dataset.tip = full;   // the tip says the number and the range the word leaves out
    if (pick) for (const b of pick.querySelectorAll('button')) { const on = +b.dataset.level === n; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
  };
  if (windPick && windBtn) {
    windBtn.setAttribute('aria-haspopup', 'true'); windBtn.setAttribute('aria-expanded', 'false');
    pick = document.createElement('div'); pick.className = 'lk-windpick'; pick.hidden = true; pick.setAttribute('role', 'radiogroup'); pick.setAttribute('aria-label', 'Wind');
    pick.innerHTML = WIND_LEVELS.map((l, i) => `<button type="button" role="radio" aria-checked="false" data-level="${i + 1}"><b>${i + 1}</b><span>${l.name}</span><i>${l.range}</i></button>`).join('');
    pick.addEventListener('pointerdown', (e) => e.stopPropagation());
    for (const b of pick.querySelectorAll('button')) b.addEventListener('click', (e) => { e.stopPropagation(); windPick.set(+b.dataset.level); paintWind(); closeWind(); b.blur(); });
    el.appendChild(pick);
    addEventListener('pointerdown', (e) => { if (pick && !pick.hidden && !pick.contains(e.target) && !windBtn.contains(e.target)) closeWind(); });
    paintWind();
  }
  // Cruise's Sound dropdown: the passenger's music (src/modes/chill/music.js: toggle, next, title, paused, setVolume) in a small popover under Sound
  const sndBtn = el.querySelector('.xt[data-x=sound]'); let snd = null;
  const SI = { play: '<path d="M8 5.2v13.6l11-6.8Z"/>', pause: '<path d="M8.6 5.5v13M15.4 5.5v13"/>', next: '<path d="M5.5 5.5v13l9.5-6.5ZM18.4 5.5v13"/>', vol: '<path d="M4 9.6h3.4L12 5.6v12.8l-4.6-4H4Z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6M17.8 6.8a7.4 7.4 0 0 1 0 10.4"/>' };
  const si = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${SI[k]}</svg>`;
  let sndLast = { title: null, paused: null };
  const paintSnd = () => {
    if (!snd) return;
    const m = music(), title = m?.title ?? '', paused = !!m?.paused;
    if (title !== sndLast.title) { sndLast.title = title; snd.querySelector('.ti').textContent = title || 'the lake'; }
    const mu = snd.querySelector('.mu'), off = !!m?.off; if (mu.getAttribute('aria-pressed') !== String(off)) mu.setAttribute('aria-pressed', String(off));
    if (paused !== sndLast.paused) { sndLast.paused = paused; const b = snd.querySelector('.pp'); b.innerHTML = si(paused ? 'play' : 'pause'); b.setAttribute('aria-label', paused ? 'play music' : 'pause music'); }
  };
  const closeSnd = () => { if (snd) { snd.hidden = true; sndBtn?.setAttribute('aria-expanded', 'false'); } };
  const toggleSnd = () => {
    if (!snd) return;
    snd.hidden = !snd.hidden; sndBtn.setAttribute('aria-expanded', String(!snd.hidden));
    if (!snd.hidden) { const er = el.getBoundingClientRect(), br = sndBtn.getBoundingClientRect(); const vw = document.documentElement.clientWidth, w = snd.offsetWidth; snd.style.left = `${Math.max(12, Math.min(vw - w - 12, br.left + br.width / 2 - w / 2)) - er.left}px`; sndLast = { title: null, paused: null }; paintSnd(); }
  };
  if (music && sndBtn) {
    sndBtn.setAttribute('aria-haspopup', 'true'); sndBtn.setAttribute('aria-expanded', 'false');
    snd = document.createElement('div'); snd.className = 'lk-sndpick'; snd.hidden = true; snd.setAttribute('role', 'group'); snd.setAttribute('aria-label', 'Sound');
    snd.innerHTML = `<button type="button" class="nx" aria-label="next song (])">${si('next')}Next song</button>`
      + `<div class="row"><button type="button" class="pp" aria-label="pause music"${tt('pause music')}>${si('pause')}</button>`
      + `<span class="ti">&nbsp;</span><button type="button" class="mu" aria-label="sound on or off (M)"${tt('sound on or off (M)')} aria-pressed="false">${si('vol')}</button><input type="range" min="0" max="100" step="1" value="100" aria-label="music volume"></div>`;
    const vol = snd.querySelector('input'), paintVol = () => vol.style.setProperty('--v', `${vol.value}%`); paintVol();
    snd.addEventListener('pointerdown', (e) => e.stopPropagation()); snd.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    snd.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') e.stopPropagation(); });
    snd.querySelector('.nx').addEventListener('click', (e) => { e.stopPropagation(); nextSong(); e.currentTarget.blur(); });   // the menu stays: a second song is one more tap
    snd.querySelector('.pp').addEventListener('click', (e) => { e.stopPropagation(); music()?.toggle(); paintSnd(); e.currentTarget.blur(); });
    snd.querySelector('.mu').addEventListener('click', (e) => { e.stopPropagation(); press('KeyM'); const b = e.currentTarget; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); b.blur(); });
    vol.addEventListener('input', () => { music()?.setVolume(vol.value / 100); paintVol(); }); vol.addEventListener('change', () => vol.blur());
    el.appendChild(snd);
    addEventListener('pointerdown', (e) => { if (snd && !snd.hidden && !snd.contains(e.target) && !sndBtn.contains(e.target)) closeSnd(); });
  }
  // ⏭: one tap = the next song now (Cruise's playlist, or a bed piece in Sail, Regatta and School); the sound comes back on if it was off
  const musicSegEl = el.querySelector('.mus');
  const nextSong = () => {
    const m = music?.(); if (!m) return;
    if (m.off) m.turnOn?.();
    m.next?.(); paintSnd();
    track('music_next', { mode: services?.get('mode') });
  };
  // the song's title (owner, 2026-11-05: no pill under the bar): when a song starts (any cause) the music segment widens to show it, ♪ title ⏭,
  // MCAP_S seconds, then eases back. A popover, the first-session glow or a hidden bar holds it back (up to MCAP_WAITS). On a narrow screen the other
  // items step out of the way while it shows (their widths are pinned first so the collapse eases), or the title ends in an ellipsis.
  const ttl = el.querySelector('.mus .ttl');
  let capLeft = 0, capWait = 0, capSeen = null, pending = null, songOn = false, pinTimer = 0;
  const unpin = () => { for (const n of layFull.children) { n.style.width = ''; n.style.flexShrink = ''; } };
  const showSong = (title) => {
    if (!ttl || !musicSegEl) return;
    const vw = document.documentElement.clientWidth;
    ttl.textContent = title; ttl.style.transition = 'none'; ttl.style.maxWidth = 'none';
    const nat = Math.ceil(ttl.scrollWidth) + 14; ttl.style.maxWidth = ''; void ttl.offsetWidth; ttl.style.transition = '';
    const rest = Math.ceil(layFull.scrollWidth) - (songOn ? Math.ceil(ttl.getBoundingClientRect().width) : 0);
    let w = nat;
    if (!songOn && rest + nat > vw - 24) {
      if (vw - 24 - rest >= 100) w = vw - 24 - rest;
      else {
        clearTimeout(pinTimer);
        for (const n of layFull.children) if (n !== musicSegEl && n.offsetWidth > 0) { n.style.width = `${n.offsetWidth}px`; n.style.flexShrink = '0'; }
        void layFull.offsetWidth; el.classList.add('tight');
        w = Math.min(nat, vw - 24 - Math.ceil(musicSegEl.offsetWidth) - 16);
      }
    } else if (el.classList.contains('tight')) w = Math.min(nat, vw - 24 - Math.ceil(musicSegEl.offsetWidth) - 16);
    ttl.style.setProperty('--tw', `${Math.max(40, w)}px`);
    musicSegEl.classList.add('song'); el.classList.add('song'); songOn = true; capLeft = MCAP_S;
  };
  const endSong = () => {
    if (!songOn) return;
    songOn = false; musicSegEl.classList.remove('song'); el.classList.remove('tight');
    clearTimeout(pinTimer); pinTimer = setTimeout(() => { unpin(); el.classList.remove('song'); }, 600);
  };
  const paintMusic = (dt) => {
    const m = music?.();
    musicSegEl?.classList.toggle('dim', !!m && (!!m.paused || !!m.off));
    const id = m?.songId ?? 0;
    if (capSeen == null) capSeen = id;
    else if (id !== capSeen) { capSeen = id; const t = m?.title; if (id && t) { pending = t; capWait = MCAP_WAITS; } }
    const blocked = el.classList.contains('nudge') || (snd && !snd.hidden) || !shown || !ttl;
    if (pending != null) { if (!blocked) { showSong(pending); pending = null; } else if ((capWait -= dt) <= 0) pending = null; }
    else if (songOn && (!shown || (capLeft -= dt) <= 0)) endSong();
  };
  const toggleWind = () => { if (!pick) return; if (pick.hidden) for (const m of barMenus) m.close(); pick.hidden = !pick.hidden; windBtn.setAttribute('aria-expanded', String(!pick.hidden)); paintWind(); };
  // no tooltips (Cruise): a hover (a mouse) or a long-press (a finger) shows the name of a button whose word is not on screen (nameTag.js)
  // the page's one tip (tips.js): every button's name, and its key, under the bar on a hover (a mouse) or a long-press (a finger)
  const tags = sharedTips();
  const tipped = [...layFull.querySelectorAll('button'), ...(snd ? snd.querySelectorAll('button') : [])];
  for (const b of tipped) tags.add(b, { side: 'down' });
  const eaten = (b) => !!tags?.consumed(b);
  for (const b of el.querySelectorAll('.xt[data-x]')) b.addEventListener('click', (e) => { e.stopPropagation(); if (eaten(b)) return; extras[b.dataset.x]?.(); wake(); b.blur(); });
  for (const b of el.querySelectorAll('.mn')) b.addEventListener('click', (e) => { e.stopPropagation(); if (eaten(b)) return; menu()?.toggle?.(); b.blur(); });
  // a bar menu: rows under its button (the clock's time menu, timeMenu.js; the Weather button's, weatherMenu.js). A click on the button
  // opens it; a row picks and closes it; a press outside, Escape (this one first: not the Menu's) or a hidden bar closes it. The row
  // that is now (api.current()) is lit amber. Arrow keys move through the rows. One menu at a time.
  const barMenus = [];
  const barMenu = ({ button, api, name, rowHtml, left }) => {
    const m = document.createElement('div'); m.className = 'lk-timepick'; m.hidden = true; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', name);
    m.innerHTML = api.rows.map(rowHtml).join('');
    m.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.appendChild(m);
    const close = () => { if (!m.hidden) { m.hidden = true; button.setAttribute('aria-expanded', 'false'); } };
    const paint = () => {
      const now = api.current?.() ?? null;
      for (const b of m.querySelectorAll('button')) {
        const id = b.dataset.id, on = api.lit ? !!api.lit(id) : id === now;
        b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
        if (api.live) { const dead = !api.live(id); b.classList.toggle('dead', dead); b.setAttribute('aria-disabled', String(dead)); }
        const nm = api.name ? b.querySelector('.nm') : null; if (nm) { const t = api.name(id); if (nm.textContent !== t) nm.textContent = t; }
      }
    };
    const place = () => {
      const br = button.getBoundingClientRect(), vw = document.documentElement.clientWidth, w = m.offsetWidth;
      m.style.left = `${Math.round(Math.max(8, Math.min(vw - w - 8, left(br, w))))}px`;   // under its button; never off a narrow screen
    };
    const self = { el: m, close, paint, place, get open() { return !m.hidden; },
      toggle() { if (!m.hidden) return close(); closeWind(); closeSnd(); for (const o of barMenus) o.close(); paint(); m.hidden = false; button.setAttribute('aria-expanded', 'true'); place(); } };
    button.addEventListener('pointerdown', (e) => e.stopPropagation());
    for (const b of m.querySelectorAll('button')) b.addEventListener('click', (e) => { e.stopPropagation(); close(); api.pick(b.dataset.id); b.blur(); });
    m.addEventListener('keydown', (e) => {
      if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
      const rows = [...m.querySelectorAll('button')], i = rows.indexOf(document.activeElement);
      rows[(i + (e.code === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus(); e.preventDefault(); e.stopPropagation();
    });
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && !m.hidden) { close(); e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    addEventListener('pointerdown', (e) => { if (!m.hidden && !m.contains(e.target) && !button.contains(e.target)) close(); });
    barMenus.push(self);
    return self;
  };
  const svg = (ic) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>`;
  // the clock's: five rows, its right edge flush with the clock's; Fireworks wears its burst under a hairline
  let timeM = null;
  if (clkEl && !clockMenu) { clkEl.tabIndex = -1; clkEl.style.pointerEvents = 'none'; }
  if (clkEl && clockMenu) {
    timeM = barMenu({ button: clkEl, api: clockMenu, name: 'Time of day', left: (br, w) => br.right - w,
      rowHtml: (r) => `<button type="button" role="menuitemradio" aria-checked="false" data-id="${r.id}"${r.id === 'fireworks' ? ' class="fw"' : ''}>${r.id === 'fireworks' ? svg(BURST_ICON) : ''}${r.name}</button>` });
    clkEl.addEventListener('click', (e) => { e.stopPropagation(); if (eaten(clkEl)) return; timeM.toggle(); clkEl.blur(); });
  }
  // the Weather button's: three rows, each with its symbol, centred under the button; the button wears the symbol of the weather now
  // and its name ("Fair"), as Wind says its level; icons only on a bar with no room (.ico)
  const wxBtn = weatherMenu ? el.querySelector('.xt[data-x=weather]') : null;
  const wxM = wxBtn ? barMenu({ button: wxBtn, api: weatherMenu, name: 'Weather', left: (br, w) => br.left + br.width / 2 - w / 2,
    rowHtml: (r) => `<button type="button" role="menuitemradio" aria-checked="false" data-id="${r.id}">${svg(WEATHER_ICONS[r.id] ?? '')}${r.name}</button>` }) : null;
  let wxNow = null;
  const paintWx = () => {
    if (!wxBtn) return;
    const now = weatherMenu.current();
    if (now === wxNow) return;
    wxNow = now;
    const name = weatherMenu.rows.find((r) => r.id === now)?.name ?? (now ? now[0].toUpperCase() + now.slice(1) : null);
    wxBtn.querySelector('svg').innerHTML = WEATHER_ICONS[now] ?? WEATHER_ICONS.fair;
    const ww = wxBtn.querySelector('.w'); if (ww) ww.textContent = name ?? 'Weather';
    const full = name ? `Weather · ${name}` : 'Weather'; wxBtn.setAttribute('aria-label', full); wxBtn.dataset.tip = full; wxBtn.dataset.wx = now ?? '';
  };
  paintWx();
  // the view menu (Cruise's five cameras): one row each with its icon, the one on screen lit; the button wears its icon and its name
  const vwBtn = views ? el.querySelector('.xt[data-x=views]') : null;
  const vwM = vwBtn ? barMenu({ button: vwBtn, api: { rows: views.cameras.map(([id, , word]) => ({ id, name: word })), current: () => views.get(), pick: (id) => views.set(id) },
    name: 'View', left: (br, w) => br.left + br.width / 2 - w / 2,
    rowHtml: (r) => `<button type="button" role="menuitemradio" aria-checked="false" data-id="${r.id}">${svg(views.cameras.find((c) => c[0] === r.id)[1])}${r.name}</button>` }) : null;
  let vwNow = cam0?.[0] ?? null;
  const paintVw = () => {
    if (!vwBtn) return;
    const now = views.get(); if (now === vwNow) return;
    const cam = views.cameras.find((c) => c[0] === now); if (!cam) return;
    vwNow = now; vwBtn.querySelector('svg').innerHTML = cam[1]; vwBtn.querySelector('.w').textContent = cam[2]; vwBtn.setAttribute('aria-label', `View · ${cam[2]} (C)`);
  };
  // the Locker (owner, 2026-11-11): Chart · Glasses · VHF · Logbook │ Photo, each with its icon; a row lit (amber,
  // the bar's on state) while its thing is on, the chart with the mark's name ("Chart · Fannette"); a dead row (no live tool) is dim
  const lkBtn = locker ? el.querySelector('.xt[data-x=locker]') : null;
  const lkM = lkBtn ? barMenu({ button: lkBtn, api: locker, name: 'Locker', left: (br, w) => br.left + br.width / 2 - w / 2,
    rowHtml: (r) => `<button type="button" role="${r.id === 'photo' || r.id === 'logbook' ? 'menuitem' : 'menuitemcheckbox'}" aria-checked="false" data-id="${r.id}"${r.sep ? ' class="sep"' : ''}>${svg(r.icon)}<span class="nm">${r.name}</span></button>` }) : null;
  // the expand chevron: on every bar button that opens a menu under it (aria-haspopup), after its word (the clock's
  // reading), and on no other. Its open state is the button's own aria-expanded (CSS), so no script keeps a chevron state
  for (const b of layFull.querySelectorAll('button[aria-haspopup]')) {
    if (b.querySelector('.cv')) continue;
    const t = document.createElement('span'); t.innerHTML = CHEVRON; b.appendChild(t.childNodes[0]);
  }
  const nudge = new Nudge({ storage, once });
  let shown = null, cur = null, disposed = false, kbd = false, tipFor = null;
  // the key the tip teaches follows the hands: C on a keyboard (Y there is the sails), a held Y on a pad, nothing to teach a finger
  const TIPS = { mouse: '<span class="cap">C</span><span>switch view</span>', pad: '<span class="soft">hold</span><span class="cap">Y</span><span>switch view</span>', touch: '<span>tap to switch view</span>' };
  const tipEl = el.querySelector('.tip');
  const setTip = () => { const m = modality(); if (m === tipFor) return; tipFor = m; tipEl.innerHTML = TIPS[m] ?? TIPS.mouse; };
  setTip();

  const place = () => fit();   // the capsule's width follows the layer showing (fonts and words arrive late)
  const paint = (v) => {
    if (v === cur) return;
    cur = v;
    for (const s of segs) { const on = s.dataset.view === v; s.classList.toggle('on', on); s.setAttribute('aria-pressed', String(on)); }
    document.documentElement.dataset.lkView = v === 'helm' ? 'helm' : 'sail';   // the helm view steps the circles down (tokens.css)
    place(); fit();
  };
  for (const s of segs) {
    s.addEventListener('pointerdown', (e) => { e.stopPropagation(); kbd = false; });   // not the camera's press, not a course
    s.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') kbd = true; });
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      if (eaten(s)) return;   // a long-press showed its name: not a switch
      const v = s.dataset.view;
      if (v !== view()) { set(v); used(); }
      paint(view());
      if (!kbd && e.detail > 0) { s.blur(); el.classList.add('done'); }   // a mouse or a tap: the keys go back to the boat; Enter or Space keeps focus
    });
  }
  // Space or Enter on a focused segment is the button's own; keep them from the boat's keys while it has focus
  el.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') e.stopPropagation(); });
  // after a click the keys' tip stays down until the pointer leaves (it has done its job)
  el.addEventListener('pointerleave', () => el.classList.remove('done'));
  const onResize = () => place();
  addEventListener('resize', onResize);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null; { ro?.observe(layFull); }   // the font arriving
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('cold')));   // the first placement does not slide

  function used() { nudge.used(); el.classList.remove('nudge'); el.style.setProperty('--glow', '0'); }

  function update(dt) {
    if (disposed) return;
    const vis = !hidden();
    if (!vis) { closeSnd(); for (const m of barMenus) m.close(); }
    if (vis !== shown) { shown = vis; if (!vis) tags?.hide(); el.classList.toggle('off', !vis); el.setAttribute('aria-hidden', String(!vis)); for (const s of segs) s.tabIndex = vis ? 0 : -1; if (vis) place(); }
    clkPaint(); paintWx(); paintVw(); for (const m of barMenus) if (m.open) { m.paint(); m.place(); }   // the bar moves as a song's title rolls out: a menu stays under its button
    paint(view()); paintWind(); if (snd && !snd.hidden) paintSnd(); paintMusic(dt);
    if (!tip) setTip();
    const fired = nudgeOn ? nudge.update(dt, { shown: vis, quiet: quiet() }) : null;
    if (fired) {
      const m = modality();
      if (m === 'pad') say('hold Y · the helm', { secs: 4 }); else if (m === 'touch') say('Tap Helm for the helm view', { secs: 4 }); /* the button named (owner 2026-11-15: was "tap · the helm") */ else say('the helm', { secs: 4, key: 'C' });
      el.classList.add('nudge'); wake();
    }
    if (nudge.firedAt != null && el.classList.contains('nudge')) {
      const { glow, line: l } = nudge.level();
      // the glow: a ring on the Helm segment, rising and falling once; its icon and word brighten with it
      el.style.setProperty('--glow', glow.toFixed(3));
      const hs = segs.find((q) => q.dataset.view === 'helm') ?? segs[1];
      hs.style.color = glow > 0.02 && cur !== 'helm' ? `rgb(var(--lk-amber) / ${(0.84 + 0.16 * glow).toFixed(3)})` : '';
      if (glow === 0 && l === 0 && nudge.t - nudge.firedAt > 1) { el.classList.remove('nudge'); hs.style.color = ''; }
    }
  }
  return {
    el, nudge, update, used, say, wake,
    get shown() { return !!shown; }, get view() { return cur; },
    get box() { const r = isl.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; },
    dispose() { disposed = true; for (const m of barMenus) m.close(); removeEventListener('resize', onResize); ro?.disconnect(); for (const b of tipped) tags.forget(b); el.remove(); },
  };
}
