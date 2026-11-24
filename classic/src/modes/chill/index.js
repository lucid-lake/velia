// Cruise (public name; ?mode=cruise, old ?mode=chill still works; the folder keeps the old word): Sail on a safe autopilot, the music on, a background to leave running (owner, 2026-10-29).
// The boat (Day Sail's assembly) is sailed by the navigator (navigator.js: a scenic loop, tacks and gybes, clear of
// the shore, the island, the moorings and the traffic); the camera drifts between cinematic shots (director.js); the
// music plays (music.js) from the first click or key, over the lake's ambience and the boat's own sound. No hints, no
// logbook. Time runs at Day Sail's real-time pace.
// A PASSENGER MODE (owner, 2026-10-30): looking round (drag), zooming (wheel, pinch), the cameras
// (the view switch, C: cinematic, boat, above, helm, island; V the Above camera, again north-up / course-up), the chart (N) with a destination to pick, the logbook (L), the
// binoculars (B), the music plate and Esc never take the helm. Only the boat-operating inputs do (intent.js): steer, trim, the
// engine and anchor keys, the wheel and winches in the helm view, a gamepad stick or trigger, and the bar's "Take the helm".
// The bar (owner, 2026-11-11, 37c § 4): nothing on screen idle; a wake brings the one top bar, Sail's slots:
// Menu | Cinematic ▾ · Take the helm | Locker ▾ (Chart · Glasses · VHF · Logbook │ Photo) | Music Full Setup | Wind Weather | clock.
// No bottom bar, no Mood (deleted 2026-11-11). A double-tap or double-click on the water sets your mark (markAt below).
// Then Sail's controls attach in place on the same boat, clock and camera, with the skipper's trim and course, no veil.
// The ` key hands back the same way (the shell's quickSwitch).
// The mode interface: src/modes/README.md. URL: ?speed= (sim speed, default 1), ?shot=wide|follow|low|orbit|drone
// (one kind only), ?cruisecam=cinematic|astern|above|helm|island (the start camera; ?coursecam=1 starts the Above camera course-up), ?music=0, ?chillsettle=<s> (headless:
// sail and direct this long before the capture), ?debug=chill.
// The fireworks (S5, owner 2026-11-08): the clock menu's Fireworks row (and, on the show's evening, the navigator by
// itself at 20:15) makes for the viewing spot inside the mouth and anchors (src/fireworks/cruise.js: the trip, the crew's
// sails, engine and anchor on this boat's tackle); the evening's short time-lapse runs to 21:44; during the show the
// Cinematic camera takes the show's shots (src/fireworks/shots.js) and "Full Moon" plays; then the anchor comes up and
// Cruise sails on under the moon, its playlist back. On a page with no show (another day, ?fireworks=0) the button opens
// the share link (?show=fireworks), which lands here at anchor a minute before the show.
// The code (refactor round 2, Phase C step 11): start composes three parts on one shared state (cx): voyage.js (the boat,
// the navigator and skipper, the director and camera rig, one frame of sailing, the 'chill' service, the captures' path),
// passenger.js (the music, the line, the bar and dock, the look, keys and pad, the mark, the tools) and handover.js (take the
// helm, hand it back, the camera's ease); update(dt) calls them in the frame's order.
import { createWake } from '../../boat/wake.js';
import { SpeedCue, NIGHT_LINE } from '../../../../src/sim/timeOfDay.js';
import { clampFrame } from '../../../../src/sim/sail/stepper.js';
import { CHILL, chillClock } from '../../../../src/sim/modes/chill/params.js';
import { LINES } from '../../../../src/fireworks/evening.js';
import { WEATHER } from '../../../../src/sim/weather/weatherMenu.js';
import { createVoyage, settleCapture } from './voyage.js';
import { createPassenger } from './passenger.js';
import { createHandover } from './handover.js';
export { LANE } from './passenger.js';

const DEG = Math.PI / 180;
// Cloudy (the Mood's old row; the state stays in weatherMenu.js, no row offers it now): the main deck's coverage (src/core/params.js COVERAGE, 0.6 by default) and how fast it eases there
export const CRUISE_WEATHER = { cloudy: WEATHER.cloudy, rate: WEATHER.rate };   // the deck's coverage under Cloudy and its easing (src/weather/weatherMenu.js)

// The loading card speaks for Cruise (index.html's class is Sail's); this runs when the chunk arrives, under the studio card.
if (typeof document !== 'undefined') {
  const load = document.getElementById('lk-load');
  if (load && load.dataset.state === 'company') {   // only while the card loads (the home card writes its own plan line)
    document.documentElement.classList.remove('lk-m-sail'); document.documentElement.classList.add('lk-m-cruise');
  }
}

export function coreOptions(flags) {
  const fixedWind = flags.winddir || flags.windspeed;
  return {
    hud: 'calm',            // the Calm HUD's default (src/ui/calmHud.js)
    card: 'cruise',         // the loading card and the dock speak for Cruise (src/ui/loading.js markMode)
    stage: false,           // the staged first visit is Sail's (src/ui/firstStage.js)
    firstSail: 'offer',     // a New player is offered the helm after a while (src/ui/firstSail.js)
    fullscreenKey: false,   // Shift+F is a pro-trim key here that would take the helm: the bar's button is full screen (src/shell.js)
    defaultHour: CHILL.hour,
    timeRate: CHILL.timeRate,
    timeSchedule: chillClock(flags),   // the quick night (params.js); ?timerate= replaces it with a constant rate
    // ?wind=1–4: the wind level on the open bay (src/wind.js), as Sail's; absent: the default level, as before
    wind: fixedWind ? null : (hour) => ({ day: { hour, rate: 1, advisory: flags.advisory },
      ...(flags.wind ? { level: Math.min(4, Math.max(1, parseInt(flags.wind, 10) || 3)) } : {}) }),
    createWake: flags.nowake ? null : () => createWake({ kelvinSize: 512, trailN: 96 }),
  };
}

export async function start(core) {
  const { flags, headless, camera, lod, msg, services } = core;
  // the state the three parts share: the sim clock, the glasses and the captain's tools, whose hands the boat is in, the
  // music and the quiet line, Sail's controls with their logbook, chart and camera ease after a hand-over, the passenger's
  // bar and dock, the first gesture; and the hand-over's entry (cx.takeHelm: a key, a wheel press, the pad, the bar's button)
  const cx = { simT: 0, tools: null, handed: false, leaving: false, line: null, music: null, controls: null, logbook: null, chartApi: null,
    blend: null, passenger: null, begun: false, takeHelm: null };
  const v = await createVoyage(core, cx);
  const { sail, phys, boatAudio, nav, director, rig, input, speed, fwNow, sailFor, attachKayaks } = v;
  let kayaks = null;
  if (headless) {   // captures: sail and direct for ?chillsettle s from the settled boat, then hold the pose
    settleCapture(core, v, cx);
    kayaks = await attachKayaks();   // after the film (the fleet rides its step)
    return { update() {}, dispose() { kayaks?.dispose(); sail.dispose(); services.remove('chill'); services.remove('film'); } };
  }
  const P = createPassenger(core, v, cx);
  const H = createHandover(core, v, cx, P, { coreOptions, kayaks: () => kayaks });
  cx.takeHelm = H.takeHelm;
  const nightCue = new SpeedCue();
  kayaks = await attachKayaks();
  return {
    update(dtRaw) {
      const dt = clampFrame(dtRaw);

      if (!cx.handed) {   // the night's fast-forward: one calm line while time is speeding (Sail has its own in the top bar)
        const e = nightCue.step(core.clock.rateAt(cx.simT) / CHILL.timeRate);
        if (e === 'on') cx.line.show(fwNow()?.phase === 'lapse' ? LINES.lapse : NIGHT_LINE); else if (e === 'off') cx.line.hide();   // the fireworks' time-lapse says its own line
      }
      if (H.update(dt, dtRaw)) return;   // Sail's controls have the boat
      if (cx.passenger) P.look(dt);
      sailFor(dt, dt * speed);
      kayaks?.update(dt * speed, dt);
      P.evening();
      input.zoom = 1;
      if (cx.passenger) P.frame(dt, dtRaw);
      boatAudio?.update(cx.simT, phys.state, { camDist: Math.hypot(camera.position.x - phys.state.x, camera.position.y, camera.position.z - phys.state.z) });
      lod.update(camera.position, cx.tools?.lodOn ? cx.tools.lodFocus(dt) : null);
      core.setTime(cx.simT);
      if (flags.debug === 'chill') {
        const s = phys.state, n = nav.out;
        msg.textContent = `chill ${speed}× · ${rig.view}/${director.shot?.kind} · ${n.mode} → ${nav.target.key} · SOG ${(s.sog * 1.944).toFixed(1)} kn · TWA ${(s.trueWind.angle / DEG).toFixed(0)}° · TWS ${(s.trueWind.speed * 1.944).toFixed(1)} kn · tacks ${nav.tacks} gybes ${nav.gybes}`;
      }
    },
    dispose() {
      if (P.sched && !cx.handed) P.sched.next = core.time + 240;   // a switch away (src/shell.js): the core's beds come back, as on a hand-over
      P.off.abort(); cx.line.dispose(); P.ownHand.dispose(); cx.music?.stop();
      if (core.sky?.choice === 'cloudy') core.sky.pick('fair');   // Cruise's Cloudy is its own: the world's clouds ease back to the deck's own
      if (core.sky) core.sky.stormS0 = null;   // Sail's landing second again
      cx.passenger?.dispose(); P.unmountTools();
      cx.controls?.dispose(); kayaks?.dispose(); sail.dispose(); P.helmPick.hover(null);
      services.remove('quickSwitch'); services.remove('chill'); services.remove('cruiseLine', cx.line);
    },
  };
}
