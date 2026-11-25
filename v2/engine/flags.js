// v2's URL flags: the shared contract rows come from v1's table (src/core/flags.js, no three.js), so ?hour=&cam=&seed=
// &headless=1&exposure=&t=&day= mean the same on both pages; the engine's own switches are rows here.
//   const f = parseV2Flags(location.search);   f.hour, f.gov, f.maxpx …  (frozen)
// v1's table test (tests/flags.test.mjs) demands that every row of its table is read in src/, so v2-only flags cannot
// live there; they live in V2_ROWS. A v2 module reads flags only through this object.
import { parseFlags } from '../../src/sim/core/flags.js';
import { SAIL_HOUR, DEFAULT_TIMERATE } from '../../src/sim/timeOfDay.js';   // v1's Sail start hour (18:45) and its day clock's base rate

const num = (name, dflt, doc) => ({ name, type: 'number', default: dflt, doc, parse: (v) => (v == null || v === '' || Number.isNaN(parseFloat(v)) ? dflt : parseFloat(v)) });
const on = (name, doc) => ({ name, type: 'bool', default: true, doc, parse: (v) => v !== '0' });
const opt = (name, doc) => ({ name, type: 'bool', default: false, doc, parse: (v) => v === '1' });   // only ?name=1 turns it on
const str = (name, doc) => ({ name, type: 'string', default: null, doc, parse: (v) => v });

export const V2_ROWS = Object.freeze([
  on('gov', 'the dynamic-resolution governor (?gov=0 pins the scale; off anyway under ?headless)'),
  on('pace', 'perf(v2) phone 30 fps: a phone or tablet held at 30 fps by the frame limiter (engine/pacer.js; ?pace=0: every vsync, the A/B; off anyway under ?headless and on a desk)'),
  num('maxpx', 3.4e6, 'the pixel budget of the backing canvas, px (Cold Smoke: 3.4 Mpx)'),
  num('dpr', 2, 'the device-pixel-ratio cap'),
  num('msaa', 4, 'samples of the HDR scene target: 4 (the default since M1: the horizon and the far waves) or 1'),
  num('scale', 1, 'the starting render scale (0.5–1); the governor moves it from here'),
  str('w', 'a fixed backing width, px (tests); with ?h'),
  str('h', 'a fixed backing height, px (tests); with ?w'),
  str('autotier', 'Regatta R4: with ?autoplay=1, the tier of the mind that sails her after the start (easy, medium, hard; v1\'s pro without it)'),
  str('rivals', 'Regatta R4: the fleet\'s computer boats, 0–5 (5 by default; the budget\'s 1, 3 and 6 boats)'),
  str('quick', 'Regatta\'s front door: ?quick=1 deals today\'s hand and goes straight in the box (no hub); a URL with a race flag (rivals, course, autoplay, racet, speed, wind) skips the hub and sails the URL\'s race'),
  str('handseed', 'Regatta\'s front door: pins the hands\' seed (hand n of the day is hash(seed, n)) in place of today\'s date, for the page tests and a shared hand'),
  str('flyover', 'Regatta\'s fly-over up the course before the start (v2/regatta/flyover.js): ?flyover=1 plays it (an automated browser too), ?flyover=0 never; unset: on the first race of a course a session, off with reduce motion or in an automated browser'),
  str('levers', 'perf(v2) phone: the phone path\'s rows over the level\'s (engine/quality.js LEVER_ROWS): none | all | a comma list of grid, aniso, lite, clouds, sim, air (the A/B on a phone or in tools/v2-perf.mjs)'),
  str('layers', 'the scene draws to keep, comma-separated (terrain,forest,water,sky,boat; profiling: ?layers=terrain,sky); all by default'),
  str('windshift', 'Sail\'s wind shifts by experience: ?windshift=new|sail|race pins the profile (0: none, the lake\'s own shifts as before); unset: the player\'s profile (Pro or I race: race; New to it: new; else sail), none in Cruise and Regatta'),   // owner, 2026-11-17 (src/sim/sail-shifts.js)
  on('forest', 'M5b: the forest\'s cards (?forest=0: the terrain\'s canopy colour alone, M3\'s look)'),
  str('tessie', 'Tessie (desktop only: v2/living/tessie-policy.js): ?tessie=0 off; =1 on (a capture too: captures leave her out without it); =now a sighting at the first frame, 11 s into it (captures, films); =breach one breaching at once; =<s> the first sighting\'s humps break at that play time (25 s by default)'),
  str('teahouse', 'Fannette Island\'s tea house (desktop only: src/core/features.js teaHouse): ?teahouse=0 off (v1\'s simple ruin stays on the summit, as on a phone or a tablet)'),
  str('oldruin', 'v1\'s simple box ruin on Fannette Island (src/core/features.js oldRuin): ?oldruin=1 shows it where the tea house is off (a phone, a tablet, ?teahouse=0)'),
  str('anchored', 'boats at anchor in the bay\'s anchorages and on a Boat Camp ball (src/core/features.js anchoredBoats): ?anchored=0 off, =1 on (a phone too)'),
  str('mirrors', 'the boats\' mirrors in the water (src/core/features.js boatMirrors): ?mirrors=0 off, =1 the glass boat\'s (a phone too), =all every boat\'s and kayak\'s (parked)'),
  str('regionkayaks', 'the regions\' own kayakers (v2/living/busyLake.js residentKayaks; src/core/features.js regionKayaks): ?regionkayaks=0 off (v1\'s day kayakers and the staged pairs), =1 on (a phone too)'),
  str('traffic', 'the busy lake\'s sailboats (v2/living/busyLake.js; src/core/features.js busyLake): ?traffic=0 off, =full|lite|phone that tier (=1: full, a phone too)'),
  str('glassboat', 'the glass boat, "Velia Travel", and her clear kayaks (src/core/features.js glassBoat): ?glassboat=0 off, =1 full (a phone too), =lite the weak GPU\'s'),
  str('tourt', 'the glass boat\'s timetable pinned: s into her loop (0: arriving at the head of the bay\'s stop; v2/sim/tourBoat.js tourPhase) in place of the clock\'s natural schedule (the evidence\'s stills)'),
  str('anchordetail', 'the ground tackle seen close (src/core/features.js anchorDetail): ?anchordetail=0 off (a phone\'s plain anchor and line), =1 on (a phone too)'),
  str('granite', 'Fannette Island\'s granite look (src/core/features.js islandGranite): ?granite=full the detailed rock, =lite the colours alone (a phone\'s), =off the photo alone (the A/B)'),
  str('boulders', 'the lake bed\'s big boulders (src/core/features.js bedBoulders): ?boulders=full the two packed layers (a desktop\'s, a tablet\'s at L0-L1), =lite v1\'s one layer in the new colours (a phone\'s; the A/B)'),
  str('tessiem', 'Tessie\'s staged moment, forced (captures, films and tests; with ?tessie=1 and ?stage=tessie): =alongside she swims beside the boat; =under she dives under the hull; =breach the sunset breach; =lightning her neck staged across the next flash of a storm; =glow her night wake glows at any hour; =sighting the plain sighting'),
  str('fwsite', 'the July 4th show\'s launch site (v2/sim/fireworksSite.js): =mouth (the default) the two barges out on the big lake past the mouth on the bay\'s axis, ?fwsited m out; =bay the old site inside Emerald Bay (the A/B\'s A, for comparisons)'),
  num('fwsited', 1000, 'the barges\' distance past the mouth (the channel\'s lake end), m (300–2500; 1,000 by default)'),
  str('birth', 'the birthplace this load starts from (v2/sim/birthplace.js): ?birth=<id> (tessie, fannette, vikingsholm, narrows, lake) or random (Surprise me, seeded by ?seed= or the visit); wins over the saved pick for one load and is never saved; ?start= / ?heading= without it pin today\'s fixed pose'),
  str('chartground', 'the live chart\'s ground (src/core/features.js chartGround): ?chartground=live bakes it from the terrain, =webp draws the shipped WebP (a phone\'s, and every capture\'s)'),
  on('livechart','the live chart (v2/ui/chart/liveChart.js) as the voyage start and the in-game menu: the card is a slim panel over the full-window map; on by default, ?livechart=0 keeps today\'s card and enlarged chart for one release'),
  on('mapux', 'the map\'s crosshair, layers and wake on the live chart (ui/chart/mapUx.js): the eased crosshair with its reading and magnet, the layer toggles, your wake kept per device; on by default, ?mapux=0 turns them off for one release'),   //, 2026-11-18
  str('stage','the opening stage and its acts: ?stage=off no acts; =<act id> (kayaks, tessie, ospreyDive) that act alone, its opening then its cooldown (a capture too: captures have no stage without it)'),
  str('pipes', 'perf(v2) iOS pipelines: ?pipes=all builds every pipeline before the first frame (the A/B; a live page builds the first frame\'s set, then the rest one group at a time after it: main.js PIPE_ORDER)'),
  num('pipedelay', 0, 'perf(v2) phone build: ms added before each pipeline build, one at a time (an emulated slow compiler: iPhone WebKit builds one pipeline at a time, about 280 ms each; tools/v2-phone-load.mjs --slow); 0 by default'),
  on('models', 'M3b: v1\'s boat models streamed in after the first frame (?models=0 keeps the M3 procedural hull: the A/B)'),
  on('telltales', '#20: the boat\'s own wind instruments: the jib\'s luff and the main\'s leech telltales, the masthead vane, the flag on the backstay (?telltales=0: none, the A/B)'),
  num('tshadow', 1, 'M5c: the terrain\'s sun shadow map: 1 re-drawn every 4th live frame or when the sun or the box moved (the default), 2 every frame (the budget\'s measure), 0 off (the map stays empty, everything sunlit: the A/B)'),
  on('photo', 'M5c: the ground photo tiles streamed after the first frame (?photo=0: the baked class albedo alone)'),
  on('detail', 'M5c: v1\'s detail textures close up (?detail=0: no grain or detail normal)'),
  on('rocks', 'M5c: the shore and island boulders (?rocks=0: none)'),
  on('bed', 'M5c: the clear-water bed\'s detail and caustics (?bed=0: the plain column, the A/B)'),
  on('caustics', 'ultra M2: the sun\'s caustics on the bed, splatted from the 12 m cascade (render/caustics.js; ?caustics=0: no splat, flat light on the bed: the A/B)'),
  str('sailart', 'the mainsail\'s graphics (2026-11-18, Mix: the compass rose as the class emblem, the Velia mark in it, the sail number; render/sailArt.js), on by default with the Regatta fleet in white hulls, each rival told apart by her sail; ?sailart=off: the plain cream main and the coloured hulls (an off switch for one release)'),
  num('boatdebug', 0, 'the cloth shader\'s debug view: 1 the sun term, 2 the back light, 3 the sun, 4 the layers, 5 the shadow (0: the sail)'),
  on('night', 'M5e: the night (?night=0: no airglow, stars, Milky Way, moon glow or lights: the old black night; the A/B and the budget)'),
  str('bino', '#5: the binoculars raised from the start on a live page (?bino=1; ?bino=228.4,1 aimed at that bearing and pitch, degrees; with ?filmui=1 the golden v2-binoculars)'),
  on('timer', '#32: the GPU timer where the page asks for one (?timer=0: none, as Safari or iOS without timestamp-query: the forced no-timer mode for the quality ladder\'s work-done probe; with ?diag the panel still shows)'),
  str('look', 'fix(v2) frame look: v1\'s camera (AgX, v1\'s noon LUT and sky polariser, v1\'s day exposure) by default; ?look=v2 the camera before it (ACES, no grade, M2\'s exposure): the A/B'),
  str('webgpu', 'the launch gate: ?webgpu=0 shows the WebGPU page as a browser without WebGPU would (the live check of the page; v2/start.js)'),
  str('rockdetail', 'the close rock detail (src/core/features.js rockDetail): ?rockdetail=0 off (the ground before, the A/B), =1 on (a phone too)'),
  str('waterdetail', 'the water\'s detail (src/core/features.js waterDetail; waterDetail): ?waterdetail=0 off (the water before, the A/B), =1 on (a phone too)'),
  on('m1', '#56 M1: the water\'s surface (v1\'s short-wave fades and slope gain, the MTF, the near mirror, Ultra-Water\'s foam, crest light and glint); ?m1=0 the water before (M5c\'s fades and shading): the A/B'),
  on('crest', 'the backlit crest glow (web-ocean-3d\'s scattering lobe through thin crests, render/water-surface.js SURF.crest; wind-driven, against the sun); ?crest=0 Ultra-Water\'s crest term before it: the A/B'),
  on('jelly', 'the wave body (web-ocean-3d\'s lit volume: the body by the long waves\' facing and height, skylight through the thin tops, the crest blend; render/water-surface.js SURF.jelly); ?jelly=0 the body before it: the A/B'),
  str('sea', 'the sea state (v2/sim/spectrum.js SEA_STATES): big (the default since 2026-11-24) the bigger, longer sea: a swell on the open lake, the wind sea\'s shape at a 60 km fetch and × 1.4, the bay\'s at 20 km and × 1.6; ?sea=v1 v1\'s fetch-limited lake sea before it: the A/B'),
  on('shore', '#56 M3: the shore (Ultra-Water\'s breakers on the baked travel-time field, the swash and the wet sand, the breaking crests\' spray in strong wind); ?shore=0 the water before: the A/B'),
  str('bar', 'the top bar: the new bar by default, Menu · Full │ Chart │ the view │ Conditions (time, wind, weather, sound in one sheet); ?bar=old the old bar (Setup, Music, Wind, Weather, clock; Cruise\'s Take the helm and Locker), the fallback for one release (v2/ui/topBar.js)'),   // owner, 2026-11-15
  str('portrait', 'phones are landscape-only: an upright phone shows the landscape page turned on its side (ui/landscape.js); ?portrait=1 keeps the upright layouts (the one-thumb controls, the portrait cards) for one release, then they go'),
  str('fit', 'a phone\'s safe areas (ui/screenFit.js): cover (never the fallback), bars (always the fallback: the insets an iPhone has, set by hand); unset: the fallback only on a notched iPhone whose insets read 0 while the page reaches the notch (the Safari 26 viewport-fit bug)'),
  str('install', 'the Home Screen card (ui/install.js): ios or android shows that card at once (the page tests and stills); 0 never shows it'),
  on('thumb', 'an upright phone\'s one-thumb controls (ui/thumb.js); ?thumb=0 keeps v1\'s portrait slots (the wheel, the winches, the rockers, the lever): the A/B'),
  on('speedfeel', 'the speed feel: the Boat view a touch lower and wider toward hull speed, the lee side\'s foam and droplets when heeled and fast, the rush building to a hiss, the wet rail\'s fizz and the rig\'s hum (sim/speedFeel.js, audio/speedSound.js); ?speedfeel=0 none: the A/B'),   // 2026-11-17
  str('gennaker', 'the gennaker (src/sim/sail/gennaker.js): ?gennaker=1 starts with it flying, full (captures, page tests); ?gennaker=hoist starts the hoist at the first tick (the sock, then the bang); unset: down until the crew hoists it (v2/sim/gennakerCrew.js) or Pro\'s F held at the jib\'s full ease'),   // 2026-11-21
  on('knockdown', 'the knockdown: the large-angle model past 35 deg, the gust\'s downdraft, the rig in the water, the rudder\'s grip gone past 50 deg, the watch (sim/knockdown.js: the warning 1.5 s ahead of 38 deg, the knockdown at 55 deg for 0.5 s), its look and sound (sim/knockdownFx.js, audio/knockdownSound.js) and the game end (sim/knockdownGame.js, ui/endCard.js); on by default since 2026-11-17, ?knockdown=0 none'),   // 2026-11-17
  str('camtilt', 'the Boat view\'s tilt up, degrees, over the pose\'s own (sim/camTilt.js BOAT_VIEW 5.5°; the eye stays); ?camtilt=0 none: the A/B'),   // owner, 2026-11-17
  on('beacon', 'the target beacon (the light pillar, cream): the light over the mark in force (Sail\'s waypoint or double-tap mark, Cruise\'s mark, Regatta\'s next mark; render/waymark.js, sim/waymark.js); ?beacon=0 none: the A/B'),   // owner, 2026-11-15
  str('wavehit', 'the bow\'s wave hits (slaps and slams): rec a recorded slap of water on a hull (the default), synth soft low-passed noise, today v1\'s layered noise hits, off none (the hull\'s rush and chuckle stay; v2/audio/recorded.js WAVE_HIT)'),
  str('loadreport', 'the load report (ui/loadReportDoor.js): ?loadreport=1 records the load from the first module (the long tasks, the main thread\'s stalls) and shows the report card once the home card is live: the stages\' waterfall, the slowest stages and files, the likely blocker; Copy, Share, Download JSON'),
  str('bloom', 'the post chain\'s bloom (render/bloom.js; src/core/features.js \'bloom\': a desktop and a tablet, never a phone): ?bloom=0 off everywhere, =1 on everywhere (a phone too: its 3 pipelines built behind the card); unset: the feature row'),   // owner, 2026-11-18
  str('wlook', 'the weather\'s look (v2/sim/weatherLook.js): ?wlook=clear|fair|overcast|storm|rain|clearing pins that row whatever the weather (the review A/B), ?wlook=off the identity; unset: the look follows the weather'),
  on('lensrain', 'rain on the lens in the storm (render/weatherLook.js; src/core/features.js \'lensRain\'): ?lensrain=0 none, the A/B'),
  num('bloomk', 1, 'the bloom\'s strength, a multiple of the calm default (render/bloom.js BLOOM.strength): ?bloomk=0.5 half, 2 double; 1 by default'),   // owner, 2026-11-18
  str('phoneclouds', 'the clouds (render/clouds.js; src/core/features.js \'phoneClouds\'): ?phoneclouds=off no clouds (no key, no cloud pipeline, a clean sky: a phone\'s default), =full the live march into the sky key (a tablet\'s and a desktop\'s default; a phone too: the A/B)'),
  on('dither', 'the final pass\'s dither (render/bloom.js: a fixed ±1 LSB triangular pattern before the 8-bit output, so no bands in the dusk and night sky, the navy, the fog); ?dither=0 none: the A/B'),   // owner, 2026-11-18
  str('cinema', 'the cinematic intro on the first Sail or Cruise of a page load (ui/cinematicIntro.js; src/core/features.js \'cinematicIntro\': a desktop only): ?cinema=0 never, =1 on (a capture or an automated browser too; never on a phone or a tablet); unset: on a live desktop page, off in a capture and an automated browser'),   // owner, 2026-11-18
  num('filmrate', 0,'M5e: a headless film\'s day clock, game seconds per sim second (tools/v2-film.mjs --timerate; 0: frozen, as every capture)'),
]);

// v1's game speed (src/sim/boat/contract.js DEFAULT_SPEED; controllers/sail.js timeScale): a live Sail page runs its sim, the
// wind, the water and the scene clock at 2 × real time ("no fast-forward in Day Sail", owner 2026-10-29); the hands, the
// camera and the UI stay on real time. ?speed= sets it (1: real time). Captures step the clock themselves and ignore it.
export const GAME_SPEED = 2;

// the rows v2 reads from the shared table (the capture contract and the day)
export const SHARED = Object.freeze(['headless', 'hour', 'cam', 'seed', 'exposure', 't', 'day', 'timerate', 'clock', 'pixelratio', 'camyaw', 'campitch', 'camfov', 'diag', 'gputime',
  'quality',   // the phone pass: v1's row; v2 reads ?quality=0|1|2 (or high | balanced | low) as a pinned level (engine/quality.js); ?diag=1 the panel (engine/diag.js); perf(v2) phone: ?quality=3 (L3), ?diag=2 the panel and its sweep (engine/sweep.js)
  'wind', 'windspeed', 'winddir',   // M1: v1's wind rows (?wind=1–4 the level; ?windspeed m/s and ?winddir compass pin it)
  'menu',   // ?menu=0: no shell and no home card (v1's row; read by ui/m4.js and ui/loading.js)
  'windref', 'nogust', 'fv', 'shifts', 'gustfx', 'advisory',   // v1's Sail wind (src/sail/options.js): the level's reference, the first gust, the shifts, the gust cells, an advisory day
  'campos', 'camlook', 'terrain',   // M2: v1's proof viewpoint rows and its terrain set (?terrain=phone|full)
  'camdist', 'settle', 'start', 'heading', 'rudder', 'touch', 'profile', 'boat', 'speed',   // M3: v1's capture rows for the boat (its settle, start pose, a held helm), the phone hands (?touch=1|0), ?boat=0; v1's game speed (?speed=, 2 by default)
  'clouds', 'cloudcov', 'cloudtype', 'cloudbase', 'cloudthick',   // M5a: v1's deck rows (?clouds=0 none; the deck's coverage, type, base and thickness; src/sim/core/params.js CLOUD_DECK)
  'shot', 'canvas',   // M3b: v1's close shots (?shot=cockpit-astern …) and its canvas colour (?canvas=a|b|c)
  'kayaks',   // the living lake: v1's kayaks' kill switch (?kayaks=0 | off: src/sim/kayaks/on.js), on by default
  'view', 'filmui', 'hud', 'pro', 'dials', 'panel', 'once',
  'pilot', 'hand',   // DRV-6: v1's assists rows (?pilot=0 the pilot off, ?hand=0 the crew trims the main: v2/sim/boat.js assists)
  'birds', 'birddive',   // birds: v1's rows (?birds=0|1; captures leave them out unless =1; ?birddive=0|1 the osprey's plunge)   // M4: the helm view (?view=helm), the live UI on the film clock (?filmui=1), v1's HUD preset, Pro, the dials' place, the panel, the once marks
  'fireworks', 'fwt', 'fwsound', 'show',   // the July 4th show: ?fireworks=0 off, ?fwt= pins the show time, ?fwsound=0 silent, ?show=fireworks (v1's share link: the highlight day)
  'weather', 'stormt', 'stormrate', 'stormref', 'storms',   // M5e: v1's storm rows (?weather=storm&stormt=&stormrate=&stormref=x,z; ?storms=natural)
  'nowake', 'wake_amp', 'wake_rc', 'wake_r0', 'wake_bow',   // the wake: v1's ?nowake=1 and its four tuning knobs
  'mode', 'cruisecam', 'coursecam', 'chillsettle',   // Cruise (v2/cruise): v1's ?mode=cruise (or chill), its start camera, the Above camera course-up, a capture's sailing before the frame
  'autoplay', 'racet', 'course',   // Regatta (v2/regatta): v1's ?autoplay=1 (a pro skipper sails the player's boat after the start), ?racet= (a capture's race sailed that long), ?course= (short | full | a place race's id: v2/sim/racePlaces.js)
  'music',   // music: v1's ?music=0 (no pieces; v2/audio/music.js)
  'grade']);   // fix(v2) frame look: v1's ?grade=0 (no LUT, no sky polariser), =lut (the LUT only), =sky (the polariser only)

export function parseV2Flags(search = '') {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const base = parseFlags(q);
  const o = {};
  for (const k of SHARED) o[k] = base[k];
  for (const r of V2_ROWS) o[r.name] = r.parse(q.get(r.name) ?? null);
  return Object.freeze(o);
}

// ?livechart, one rule for both readers (ui/loading.js, ui/sail.js): on with ?livechart=1 (a page with no shell too), off with
// ?livechart=0, otherwise on when the page has the shell (the #lk-load card).
export function liveChartOn(search = '', hasShell = false) {
  const v = (typeof search === 'string' ? new URLSearchParams(search) : search).get('livechart');
  return v === '1' || (v !== '0' && !!hasShell);
}

// The scene parameters a frame needs, typed and defaulted (the URL contract: "URL contract").
//   hour: local clock time at the lake, 0–24 (default: v1's Sail start, 18:45); the sail camera yaw/pitch/fov in degrees;
//   exposure as v1's number (6 = the base; the tonemap uses exposure / 6 as its factor).
// The day clock (v1's Sail: src/sail/options.js timeSchedule, timeRate; src/core/index.js), clockMode:
//   'day'     a live page with no ?timerate: v1's day clock (slow golden hours, a quick night) at its base rate,
//             DEFAULT_TIMERATE game s per sim s (1 game hour per 3 real minutes at the 2 × game speed), from ?hour when given
//             (v1's timeParams: ?mode=sail&hour=13 starts at 13:00 and runs; owner 2026-11-14, BACKLOG-v2 #36), else 18:45
//   'rate'    ?timerate= on a live page, or ?clock=flat: a constant rate (v1: an explicit rate has no schedule)
//   'film'    a headless film's ?filmrate= (constant)
//   'frozen'  every capture (?headless), ?timerate=0, and a ?filmui=1 film with ?hour (the goldens' live hud frames keep
//             their hour: the film clock steps a pinned scene; v1's films are pinned by their own harness)
export function clockParams(f) {
  const n = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  if (f.headless != null) { const r = Math.max(0, n(f.filmrate, 0)); return { clockMode: r > 0 ? 'film' : 'frozen', timerate: r }; }
  if (f.timerate != null && f.timerate !== '') { const r = Math.max(0, n(f.timerate, 0)); return { clockMode: r > 0 ? 'rate' : 'frozen', timerate: r }; }
  if (f.filmui === true && f.hour != null && f.hour !== '') return { clockMode: 'frozen', timerate: 0 };
  return { clockMode: f.clock === 'flat' ? 'rate' : 'day', timerate: DEFAULT_TIMERATE };
}
export function sceneParams(f) {
  const n = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  const hour = ((n(f.hour, parseFloat(SAIL_HOUR)) % 24) + 24) % 24;
  return Object.freeze({
    hour, seed: Math.trunc(n(f.seed, 1)), cam: f.cam ?? 'A',
    headless: f.headless != null,
    exposure: Number.isFinite(f.exposure) ? f.exposure : 6,
    t0: Number.isFinite(f.t) ? f.t : 0,
    ...clockParams(f),   // timerate (game s per sim s) and clockMode (above): frozen in captures, ?timerate=0 and a ?filmui=1 film with ?hour; v1's day clock otherwise (from ?hour)
    speed: Math.min(8, Math.max(0.1, n(f.speed, GAME_SPEED))),   // the sim seconds a live second runs (v1's timeScale)
    // the camera's pose is v2/engine/camera.js cameraPose(flags) (v1's presets); these are the URL's turns, null when absent
    camYawDeg: f.camyaw != null ? n(f.camyaw, null) : null, camPitchDeg: f.campitch != null ? n(f.campitch, null) : null, camFovDeg: f.camfov != null ? n(f.camfov, null) : null,
    gov: f.gov && f.headless == null, maxPx: f.maxpx, dprCap: f.dpr, msaa: f.msaa === 1 ? 1 : 4,
    scale: Math.min(1, Math.max(0.5, f.scale)),
    pixelRatio: f.pixelratio != null ? n(f.pixelratio, NaN) : NaN,
    fixed: f.w != null && f.h != null ? [Math.trunc(n(f.w, 0)), Math.trunc(n(f.h, 0))] : null,
    timing: f.timer && (f.headless != null || f.diag != null || f.gputime === true),
    // the wind (v2/sim/wind.js): a level pins the speed at its band's mean; speed and direction pin the numbers; else the day's wind
    windLevel: f.wind != null ? Math.min(4, Math.max(1, Math.trunc(n(f.wind, 3)))) : null,
    windSpeed: f.windspeed != null ? n(f.windspeed, NaN) : null,
    windDir: f.winddir != null ? n(f.winddir, NaN) : null,
  });
}
