// The feature registry (owner, 2026-11-17): each device-dependent feature declares its policy once, here, on the
// device profile's axes (src/core/profile.js: input, form, screen, gpu, quirks), never on a raw device check. A feature is
//   fixed   decided once, at its first read, and kept for the page's life (an asset tier, the mounted control set: like the
//           quality ladder's BUILD_KEYS, a change waits for the next load)
//   live    decided again on every profile change (a level step, a resize, the turn) and every mount change
// It reads as feature(name).tier (its tier word) and feature(name).on (tier 'on'); CSS reads <html data-f-NAME="tier">
// (data-f-towns-tier="lite"), published once a fixed feature has been decided and at once for a live one.
//   features.configure({ headless, flags })   the page, before its first read (v2/main.js; v1 reads its own URL)
//   features.mounted(name, on)               a mount the page reports (the flat controls' layout up: ui/flat.js)
//   features.state() / lines()               every feature's tier, for the diag panel and the tests
// A new device-dependent feature adds a row to POLICIES (its axes, its tier rule, fixed or live, its URL aliases) and reads
// it through feature(name); v2/tests/features.test.mjs forces the six devices and checks every row.
import { profile as pageProfile } from './profile.js';
import { toFlags } from '../sim/core/flags.js';

// THE TABLET RULE (owner, 2026-11-18: "Tablets get desktop features, scaled by GPU power"): a tablet (an iPad asking for desktop
// sites too) is a desktop for every FEATURE; only a phone is not. The GPU level then scales it exactly as it scales a desktop (the
// ladder's L0-L1 full, L2-L3 the lite tiers). A row reads desktopLike(p) and, where it scales, lite(p); never p.form directly.
// Layout and input rows (flatControls, touchHands, fingerTargets, cockpitModel, phoneCard, deskTrim, binoculars, deskEnter) are
// about the screen and the finger, not features: they keep their own axes. Memory rows keep the tablet's lite tier and say so
// (terrainSet is the one).
const desktopLike = (p) => p.form !== 'phone';
// a phone, or a weak GPU's level (the ladder's L2 and L3): the lite asset tiers
const lite = (p) => !desktopLike(p) || (p.gpu != null && p.gpu >= 2);
// a phone's own page (a capture only when ?profile= forces an axis): the desktop-only features' rule
const phoneOnly = (p, c) => p.form === 'phone' && (!c.headless || !!p.forced);
// the rows: tier(p, c, m, get) with p the profile, c the context ({ headless, flags: the page's own, levers }), m the mounts,
// get(name) another feature's tier. why: one line for the diag panel and.
export const POLICIES = Object.freeze({
  // --- asset tiers: fixed (their grids, buffers and pipelines are sized by them, as the ladder's BUILD_KEYS) ---
  terrainSet: { fixed: true, axes: 'form', aliases: '?terrain=phone|full',
    why: 'the phone grid set (3.5 MB, a quarter of the memory) on a phone or a tablet; captures take the full land. A MEMORY row (a tablet tab has a phone\'s memory ceiling), so the tablet keeps the lite tier whatever its GPU',
    tier: (p, c) => (c.flags.terrain === 'phone' || c.flags.terrain === 'full' ? c.flags.terrain : c.headless ? 'full' : p.form !== 'desktop' ? 'phone' : 'full') },   // memory: the one row that reads the form itself
  townsTier: { fixed: true, axes: 'form, gpu', aliases: '?terrain=phone',
    why: 'the lite towns on a phone or at L2-L3 (a tablet by its level, like a desktop); never in a capture',
    tier: (p, c) => (c.flags.terrain === 'phone' || (!c.headless && lite(p)) ? 'lite' : 'full') },
  birdsTier: { fixed: true, axes: 'form, gpu', aliases: '?terrain=phone',
    why: 'v1\'s low bird tier on a phone or at L2-L3 (a tablet by its level); never in a capture',
    tier: (p, c) => (c.flags.terrain === 'phone' || (!c.headless && lite(p)) ? 'low' : 'high') },
  // --- the osprey's dive (owner, 2026-11-17: desktop only; 2026-11-18: a tablet is a desktop; BACKLOG #24) ---
  ospreyDive: { fixed: true, axes: 'form, gpu', aliases: '?birddive=0 (off)',
    why: 'the osprey\'s staged dive, its splash and rings on a desktop or a tablet at L0-L2; a phone never dives (no director, no splash, no rings map: 0 cost), the other birds fly as before',
    tier: (p, c) => (c.flags.birddive === '0' || c.flags.birddive === false || !desktopLike(p) || (p.gpu != null && p.gpu >= 3) ? 'off' : 'on') },
  kayaksTier: { fixed: true, axes: 'form, gpu', aliases: '',
    why: 'the kayaks\' phone tier on a phone or at L2-L3 (a tablet by its level); never in a capture',
    tier: (p, c) => (!c.headless && lite(p) ? 'lite' : 'full') },
  fireworksTier: { fixed: true, axes: 'form, gpu', aliases: '?touch=1 (phone), ?touch=0 (desktop)',
    why: 'v1\'s phone show (half the stars, no streaks) on a phone or at L2-L3 (a tablet by its level); never in a capture',
    tier: (p, c) => (c.flags.touch === '1' || (c.flags.touch !== '0' && !c.headless && lite(p)) ? 'phone' : 'desktop') },
  cockpitModel: { fixed: true, axes: 'form, screen', aliases: '',
    why: 'the cockpit\'s phone bake on a phone-sized frame of a phone or tablet (a phone loads a cockpit only with ?portrait=1)',
    tier: (p) => (p.form !== 'desktop' && p.screen !== 'full' ? 'phone' : 'full') },
  cockpitMaterials: { fixed: true, axes: 'form, gpu', aliases: '',
    why: 'v1\'s lite cockpit materials (no print-through, grain relief or knurl) on a phone or at L2-L3 (a tablet by its level)',
    tier: (p) => (lite(p) ? 'lite' : 'full') },
  // --- the controls: fixed (a phone never loads the cockpit's asset) ---
  flatControls: { fixed: true, axes: 'input, screen', aliases: '?portrait=1 (off)',
    why: 'the flat glass controls on a finger-only, phone-sized frame; never in a capture',
    tier: (p, c) => (!c.headless && p.input === 'touch' && p.screen !== 'full' && c.flags.portrait !== '1' ? 'on' : 'off') },
  touchHands: { fixed: true, axes: 'input, form', aliases: '?touch=1|0',
    why: 'a finger\'s hands on the canvas (the drag, the pinch): finger-only, or a tablet with a trackpad; never in a capture',
    tier: (p, c) => (c.flags.touch === '1' ? 'on' : c.flags.touch === '0' || c.headless ? 'off' : p.input === 'touch' || (p.input === 'mixed' && p.form !== 'desktop') ? 'on' : 'off') },
  // --- CSS: a finger may tap here (the 44 px targets the stylesheets' finger rules give; was @media (pointer: coarse)) ---
  fingerTargets: { fixed: false, axes: 'input, form', aliases: '?touch=1|0',
    why: 'finger-sized targets on a finger-only device, a phone or a tablet (an iPad with a trackpad too); a touch laptop keeps the desktop\'s',
    tier: (p) => (p.input === 'touch' || p.form !== 'desktop' ? 'on' : 'off') },
  deskTrim: { fixed: true, axes: 'input', aliases: '',
    why: 'the desk\'s sheet rates (a held winch\'s pull, the ease) for keys or mixed input; not with the flat controls',
    tier: (p, c, m, get) => (p.input !== 'touch' && get('flatControls') !== 'on' ? 'on' : 'off') },
  // --- what a finger-only device never gets ---
  binoculars: { fixed: true, axes: 'input', aliases: '',
    why: 'no binoculars for a finger-only device (every way in hidden); keys and mixed keep them',
    tier: (p) => (p.input !== 'touch' ? 'on' : 'off') },
  deskEnter: { fixed: true, axes: 'input', aliases: '',
    why: 'the home card lights Sail and Enter starts it unless the device is finger-only',
    tier: (p) => (p.input !== 'touch' ? 'on' : 'off') },
  // owner, 2026-11-18: the phone's card is built for a thumb (v2/ui/phoneCard.js): the chart and its big pins on the left, the modes on
  // the right with Sail in the corner, the links in one ⋯ menu; a pin on it asks twice in play. A tablet and a desktop keep the card
  phoneCard: { fixed: true, axes: 'form', aliases: '?profile=form:phone',
    why: 'the phone\'s thumb-first home card (chart and pins left, modes right, one ⋯ menu); a tablet and a desktop keep the desktop card',
    tier: (p) => (p.form === 'phone' ? 'on' : 'off') },
  // owner, 2026-11-21: the loading page tells a phone to add Velia to the Home Screen or use a computer (v2/ui/loadWords.js)
  loadPhoneAdvice: { fixed: true, axes: 'form', aliases: '?profile=form:phone',
    why: 'the loading page\'s advice on a phone: Add to Home Screen, or a computer for the best performance and every feature',
    tier: (p) => (p.form === 'phone' ? 'on' : 'off') },
  // --- Tessie (owner, 2026-11-17: desktop only; 2026-11-18: a tablet is a desktop; her code is a separate chunk loaded only when this is on) ---
  tessie: { fixed: true, axes: 'form, gpu', aliases: '?tessie=0|off (off), ?tessie=1|now|<s> (on in a capture)',
    why: 'Tessie on a desktop or a tablet at L0-L2 (a phone never loads her model, sounds or pipelines); never in a capture unless ?tessie= asks',
    tier: (p, c) => { const f = c.flags.tessie == null ? '' : String(c.flags.tessie).toLowerCase();
      if (f === '0' || f === 'off' || f === 'false') return 'off';
      if (!desktopLike(p) || (p.gpu != null && p.gpu >= 3)) return 'off';
      return c.headless && (f === '' || f === 'true') ? 'off' : 'on'; } },
  // play as Tessie (owner, 2026-11-20): she is a vessel where she exists at all (a desktop or a tablet at L0-L2); a phone
  // never sees her in the Boat plate, never gets the swap line or "Be Tessie" (it never loads her)
  playTessie: { fixed: true, axes: 'form, gpu', aliases: '?tessie=0 (off)',
    why: 'Tessie as a vessel (the Boat plate, T or the skipper\'s line when she shows herself, Be Tessie on her chart mark) wherever Tessie herself is on; never on a phone',
    tier: (p, c, m, decide) => (decide('tessie') === 'on' ? 'on' : 'off') },
  // play as Tessie, phase 2a (owner, 2026-11-20): the eye goes under the water with her. Full at L0-L1 (a desktop or a
  // tablet: every under-water draw; 2b's shafts and motes join it), lite at L2 (the medium, the underside, the bed, the crossing; no shafts,
  // no motes), none at L3 and on a phone (Tessie herself is off there: her under-water pipelines are never declared)
  tessieUnder: { fixed: true, axes: 'form, gpu', aliases: '?tessie=0 (none)',
    why: 'the eye under the water as Tessie (the medium, Snell\'s window, the crossing): full at L0-L1, lite at L2, none at L3 or on a phone (no Tessie there)',
    tier: (p, c, m, decide) => (decide('playTessie') !== 'on' ? 'none' : p.gpu != null && p.gpu >= 2 ? 'lite' : 'full') },
  // her tablet controls: the floating thumbstick, Lunge and Dive, on a finger's device where she is playable
  tessieTouch: { fixed: false, axes: 'input', aliases: '?touch=1 (on), ?touch=0 (off)',
    why: 'play as Tessie\'s thumbstick, Lunge and Dive buttons on a touch or mixed input (a tablet, a touch laptop); keys only: the keys',
    tier: (p, c, m, decide) => (decide('playTessie') !== 'on' ? 'off' : c.flags.touch === '1' ? 'on' : c.flags.touch === '0' ? 'off' : p.input === 'keys' ? 'off' : 'on') },
  // her engraved mark in Help › Tutorials (v2/ui/tutorials.js): tessieMark.js is her code, so a phone never fetches it (the chapter keeps
  // its photo and words); a capture keeps the drawing (it is a picture, not her model)
  tessieArt: { fixed: true, axes: 'form', aliases: '?profile=form:phone',
    why: 'Tessie\'s engraved chart mark in the Tutorials chapter on a desktop or a tablet (her tessieMark.js chunk); a phone never fetches her code',
    tier: (p) => (desktopLike(p) ? 'on' : 'off') },
  // --- Fannette Island's tea house (owner, 2026-11-18: "build it, desktop only"): its mesh is a separate chunk,
  // fetched and built only when this is on; a phone never fetches it (and draws no ruin: oldRuin, below) ---
  teaHouse: { fixed: true, axes: 'form', aliases: '?teahouse=0 (off), ?profile=form:phone',
    why: 'the tea house on Fannette Island\'s summit (its chunk, about 13,600 triangles in the landmarks\' own draw, no new pipeline) on a desktop or a tablet; a phone never fetches it',
    tier: (p, c) => (c.flags.teahouse === '0' || c.flags.teahouse === false || !desktopLike(p) ? 'off' : 'on') },
  //): the live chart's ground: a desktop or a tablet bakes it from the terrain in 4 ms slices (crisp at a cove's zoom, its
  // night palette); a phone draws the shipped WebP (no bake); a capture draws the WebP (the same pixels on every machine)
  chartGround: { fixed: true, axes: 'form', aliases: '?chartground=webp|live',
    why: 'the live chart\'s ground baked live from the terrain on a desktop or a tablet; the shipped WebP on a phone and in a capture',
    tier: (p, c) => (c.flags.chartground === 'webp' || c.flags.chartground === 'live' ? c.flags.chartground : !c.headless && desktopLike(p) ? 'live' : 'webp') },
  //, § 6 (Phase 2b): the in-game menu's map. A desktop and a tablet draw its ground as glass over the live lake (90 %,
  // the lake tints it, a 14 px blur); a phone draws it opaque and pauses the lake under it (30 fps held)
  chartGlass: { fixed: true, axes: 'form', aliases: '?profile=form:phone (opaque)',
    why: 'the in-game menu map as glass (90 % over the live lake, blur 14 px) on a desktop and a tablet; opaque with the lake paused on a phone',
    tier: (p) => (p.form === 'phone' ? 'off' : 'on') },
  // owner, 2026-11-18: v1's box-and-gable ruin leaves the phones too (it was not the real tea house); ?oldruin=1 brings it
  // back where the tea house is off (the owner's switch)
  oldRuin: { fixed: true, axes: 'form', aliases: '?oldruin=1 (on where the tea house is off)',
    why: 'v1\'s simple ruin on the summit: off everywhere (a desktop draws the tea house); ?oldruin=1 shows it where the tea house is off',
    tier: (p, c, m, get) => (c.flags.oldruin === '1' && get('teaHouse') !== 'on' ? 'on' : 'off') },
  // Fannette Island's granite (owner, 2026-11-18: "our island is not close to the photo"): the terrain's island look; a desktop and a tablet the
  // detailed rock (boulders, cracks, lichen, the boulders' relief), a phone the same colours on their cheap path
  islandGranite: { fixed: true, axes: 'form', aliases: '?granite=full|lite|off (off: the photo alone, the A/B)',
    why: 'the island\'s pale granite: boulders, cracks, lichen and their relief on a desktop or a tablet; the colours alone on a phone (no new pipeline)',
    tier: (p, c) => (['full', 'lite', 'off'].includes(c.flags.granite) ? c.flags.granite : desktopLike(p) ? 'full' : 'lite') },
  // --- the lake bed's big boulders (owner, 2026-11-18: "the similar clear water, big stone effect" of the Emerald Bay
  // photos, desktop only; tablets take desktop features scaled by the GPU: L0-L1 full, L2-L3 lite): two packed layers of rounded,
  // mossy boulders on the rocky shallows in the terrain's draw, and near the eye the same stones in 3D (render/rocks.js, one
  // pipeline); 'lite' (a phone, or a desktop or tablet at L2-L3) keeps v1's one boulder layer in the new colours (today's cost) ---
  bedBoulders: { fixed: true, axes: 'form, gpu', aliases: '?boulders=full|lite',
    why: 'the bed\'s big mossy boulders (packed layers, 3D near the eye) on a desktop or a tablet at L0-L1; a phone and L2-L3 keep v1\'s one layer in the new colours',
    tier: (p, c) => (['full', 'lite'].includes(c.flags.boulders) ? c.flags.boulders : lite(p) ? 'lite' : 'full') },
  // --- the close rock (owner, 2026-11-20: "Look comparison", the close-range rock detail layer; render/rockDetail.js): within
  // 40 m of the eye the steep faces and the shore's rock take a hex-tiled CC0 rock layer (two more layers of the detail array, 0.37 MB);
  // a desktop or a tablet at L0-L1; a phone and L2-L3 keep the ground as it was (no fetch, no shader code) ---
  rockDetail: { fixed: true, axes: 'form, gpu', aliases: '?rockdetail=0 (off, the A/B), ?rockdetail=1 (on, a phone too)',
    why: 'the close rock detail (a hex-tiled CC0 rock face on steep and shore rock inside 40 m) on a desktop or a tablet at L0-L1; none on a phone or at L2-L3',
    tier: (p, c) => { const f = c.flags.rockdetail; if (f === '0' || f === 0 || f === false) return 'off'; if (f === '1' || f === 1 || f === true) return 'on'; return (!c.headless || !!p.forced) && lite(p) ? 'off' : 'on'; } },   // a capture: on (the same frame on every machine)
  // --- the ground tackle seen close (owner, 2026-11-18: "The anchor line is too thin to be noticed, and too simple, missing details
  // ... These details are desktop only"; v2/render/anchorGear.js): the real anchor, the chain's links on its catenary, the windlass, one
  // pipeline; a phone keeps hardware.glb's anchor and the one dark line (0 cost: no meshes, no pipeline) ---
  anchorDetail: { fixed: true, axes: 'form', aliases: '?anchordetail=0 (off), ?anchordetail=1 (on, a phone too), ?profile=form:phone',
    why: 'the anchor model, the chain as links on its catenary, the windlass and roller detail (1 pipeline, about 600 links near the eye) on a tablet or a desktop; a phone keeps the plain anchor and line',
    tier: (p, c) => (c.flags.anchordetail === '0' ? 'off' : c.flags.anchordetail === '1' ? 'on' : phoneOnly(p, c) ? 'off' : 'on') },
  // --- the water's detail (owner, 2026-11-19:'s fixes 1, 2 and 4, "desktop and strong tablets"; v2/render/water.js
  // WATER2_WGSL, v2/render/web-ocean/foamMap.js): the variation layer on each cascade's slopes, the 2.1 m layer turned, the persistent
  // whitecap foam (two 512² world maps, one compute pass, 4 MB). A desktop or a tablet at L0-L1; a phone and L2-L3 keep the water as
  // it was (the lite water; no map, no pass) ---
  waterDetail: { fixed: true, axes: 'form, gpu', aliases: '?waterdetail=0 (off, the A/B), ?waterdetail=1 (on, a phone too)',
    why: 'the water\'s variation layer and persistent foam on a desktop or a tablet at L0-L1; none on a phone or at L2-L3 (the lite water)',
    tier: (p, c) => { const f = c.flags.waterdetail; if (f === '0' || f === 0 || f === false) return 'off'; if (f === '1' || f === 1 || f === true) return 'on'; return (!c.headless || !!p.forced) && lite(p) ? 'off' : 'on'; } },   // a capture: on (the same frame on every machine)
  // --- the boats' mirrors in the water (owner, 2026-11-19: "Add the same reflection to the Halcyon and the busy lake's sailboats ...";
  // "this reflection is also a desktop-only feature"): the glass boat's, the player's, the rivals' and the lake's boats' flipped draws
  // after the water. A desktop or a tablet at L0-L1; off on a phone and at L2-L3 (no pipeline built, no draw) ---
  boatMirrors: { fixed: true, axes: 'form, gpu', aliases: '?mirrors=0 (off), ?mirrors=1 (on, a phone too), ?mirrors=all (every boat\'s and kayak\'s, parked)',
    why: 'the glass boat\'s mirror in the water on a desktop or a tablet at L0-L1; none on a phone or at L2-L3. The other boats\' and the kayaks\' mirrors are parked behind ?mirrors=all',   // parked 2026-11-19 (owner: "The reflection doesn't look good; disable it for all boats except the pontoon for now")
    tier: (p, c) => { const f = c.flags.mirrors; if (f === 'all') return 'all'; if (f === '0' || f === 0 || f === false) return 'off'; if (f === '1' || f === 1 || f === true) return 'on'; return (!c.headless || !!p.forced) && lite(p) ? 'off' : 'on'; } },   // a capture: on (the same frame on every machine)
  // --- the regions' kayakers (owner, 2026-11-19: "1–3 kayaks around each birthplace ... kayaks can't teleport with our sailboat";
  // v2/living/busyLake.js residentKayaks): each region's kayakers live on their lanes all day, in v1's fleet (v2/sim/kayaks.js
  // residents); they replace v1's day kayakers and the stage's staged pairs on a desktop or a tablet. A phone keeps v1's fleet as it was ---
  regionKayaks: { fixed: true, axes: 'form', aliases: '?regionkayaks=0 (off: v1\'s day kayakers and the staged pairs), =1 (on, a phone too), ?profile=form:phone',
    why: 'the regions\' own kayakers on their lanes all day (no staged pairs, none placed for the camera) on a desktop or a tablet; a phone keeps v1\'s day kayakers and the staged pairs',
    tier: (p, c) => { const f = c.flags.regionkayaks; if (f === '0' || f === 0 || f === false) return 'off'; if (f === '1' || f === 1 || f === true) return 'on'; return (!c.headless || p.forced) && !desktopLike(p) ? 'off' : 'on'; } },
  // the stage's staged kayak pairs (v2/stage/acts.js 'kayaks'): only where the regions' kayakers are off (one source of kayaks)
  stagedKayaks: { fixed: true, axes: 'form (regionKayaks)', aliases: '?regionkayaks=',
    why: 'the stage director\'s random kayak pair laid in view: only where the regions\' kayakers are off (a phone)',
    tier: (p, c, m, get) => (get('regionKayaks') === 'on' ? 'off' : 'on') },
  // --- the busy lake (owner, 2026-11-18: "it's a busy lake"; v2/living/busyLake.js): sailboats cruising the birthplace regions on v1's
  // physics and computer skipper, near the eye on the boat's rival slots (no new pipeline), farther as Regatta's lite and far boats.
  // full: up to 6 at once (a desktop or a tablet at L0-L1: the tablet rule); lite: 3 (L2-L3); phone: 1 (the lean sim: one boat's physics, a far
  // silhouette or one full-detail boat near); ?traffic= overrides ---
  busyLake: { fixed: true, axes: 'form, gpu', aliases: '?traffic=0 (off), ?traffic=full|lite|phone, ?traffic=1 (full), ?profile=form:phone',
    why: 'the busy lake\'s cruising sailboats: up to 6 at once on a desktop or a tablet at L0-L1, 3 at L2-L3, 1 on a phone',
    tier: (p, c) => { const f = c.flags.traffic; if (f === '0' || f === 0 || f === false) return 'off'; if (f === '1' || f === 1 || f === true) return 'full'; if (['full', 'lite', 'phone'].includes(f)) return f;
      const live = !c.headless || !!p.forced;   // a capture: full (the same frame on every machine)
      return live && !desktopLike(p) ? 'phone' : live && lite(p) ? 'lite' : 'full'; } },
  // --- boats at anchor in the bay's anchorages (owner, 2026-11-18: "one or two boats at anchor in each anchorage in the bay (desktop/
  // tablet only)", v2/sim/anchoredBoats.js): up to 4 of the fleet's full-detail boats bare-poled on the boat's rival slots
  // (no new pipeline), a riding light at night; a phone never makes them (the mooring balls are every device's) ---
  anchoredBoats: { fixed: true, axes: 'form', aliases: '?anchored=0 (off), ?anchored=1 (on, a phone too), ?profile=form:phone',
    why: 'boats lying at anchor in the bay\'s anchorages and on a Boat Camp ball (the fleet\'s full-detail model, up to 4, no new pipeline) on a tablet or a desktop; a phone has none',
    tier: (p, c) => (c.flags.anchored === '0' || c.flags.anchored === false ? 'off' : c.flags.anchored === '1' || c.flags.anchored === true ? 'on' : phoneOnly(p, c) ? 'off' : 'on') },
  // --- the glass boat (owner, 2026-11-18: "the next thing to add is Tahoe's signature glass boat", v2/sim/tourBoat.js):
  // "Velia Travel", a clear-view tour pontoon on a slow loop through Emerald Bay, her clear kayaks (paddlers in three) and their night
  // LEDs. Owner ruling 2026-11-18: tablets get desktop features, scaled by the GPU level: L0-L1 full, L2-L3 lite (the pontoon and her
  // two empty kayaks, no wake foam, kayaks drawn half as far); a phone never makes it (no sim, no pipelines) ---
  glassBoat: { fixed: true, axes: 'form, gpu', aliases: '?glassboat=0 (off), ?glassboat=1 (full, a phone too), ?glassboat=lite, ?profile=form:phone',
    why: 'the glass-bottom tour pontoon and her clear kayaks (2 pipelines, the kayaks\' skin for the paddlers) on a desktop or a tablet: full at L0-L1, lite at L2-L3; a phone has none',
    tier: (p, c) => { const f = c.flags.glassboat == null ? '' : String(c.flags.glassboat);
      if (f === '0' || f === 'false' || f === 'off') return 'off';
      if (f === '1' || f === 'true' || f === 'full') return 'full';
      if (f === 'lite') return 'lite';
      if (phoneOnly(p, c)) return 'off';
      return !c.headless && lite(p) ? 'lite' : 'full'; } },   // the tablet rule: desktopLike, scaled by lite(p)
  // --- the phone is for the sail sim (owner, 2026-11-17: "No fireworks, Milky Way, rainbow [on phones]"): desktop
  // only on a phone (a tablet and a desktop keep them); their code, assets and pipelines are never fetched or built there. A
  // capture keeps them unless ?profile= forces the form (v2-perf's phone A/B) ---
  fireworks: { fixed: true, axes: 'form', aliases: '?fireworks=0 (off everywhere: the plug-in\'s own rule), ?profile=form:phone',
    why: 'the July 4th show (its chunk, sounds, 10 pipelines, the strip\'s marker) on a tablet or a desktop; never on a phone',
    tier: (p, c) => (phoneOnly(p, c) ? 'off' : 'on') },
  milkyWay: { fixed: true, axes: 'form', aliases: '?profile=form:phone',
    why: 'the Milky Way\'s maps (v1\'s 4K map and its tint, 2.5 MB, fetched at dusk) on a tablet or a desktop; a phone\'s night keeps the sky, the moon, the stars and the lights',
    tier: (p, c) => (phoneOnly(p, c) ? 'off' : 'on') },
  rainbow: { fixed: true, axes: 'form', aliases: '?profile=form:phone',
    why: 'the clearing\'s rainbow (the composite\'s bow variant and the stored depth) on a tablet or a desktop; a phone\'s storm clears without it',
    tier: (p, c) => (phoneOnly(p, c) ? 'off' : 'on') },
  // --- round 2 (owner, 2026-11-17: "cut all six on phones"): the same rule, the same 0 cost where off ---
  birds: { fixed: true, axes: 'form', aliases: '?birds=0 (off everywhere: the plug-in\'s own rule), ?profile=form:phone',
    why: 'the birds (gulls, geese, eagles, the osprey: their chunk, sim, draws, 4 pipelines and calls) on a tablet or a desktop; never on a phone',
    tier: (p, c) => (phoneOnly(p, c) ? 'off' : 'on') },
  farTowns: { fixed: true, axes: 'form', aliases: '?profile=form:phone',
    why: 'the ski runs and the far towns\' decks on a tablet or a desktop; a phone loads the bay\'s set (its piers, boathouses, tower, harbour and Hwy 89\'s cut)',
    tier: (p, c) => (phoneOnly(p, c) ? 'off' : 'on') },
  // --- rain on the lens (owner, 2026-11-24: "rain on the lens" per weather; phones only if within budget, behind a policy row): the
  // storm composites' lens pass (render/weatherLook.js: three lattices of drops, one extra texel read a pixel). A phone has no storm
  // (the storm row below), so it never draws; the row keeps the rule in one place if a phone storm comes back ---
  lensRain: { fixed: true, axes: 'form', aliases: '?lensrain=0 (off everywhere), ?profile=form:phone',
    why: 'rain on the camera\'s lens in a storm (the follow and chase cameras) on a tablet or a desktop; a phone has no storm',
    tier: (p, c) => (c.flags.lensrain === '0' || phoneOnly(p, c) ? 'off' : 'on') },
  lightningBolts: { fixed: true, axes: 'form', aliases: '?profile=form:phone',
    why: 'the lightning bolt\'s channel (its mesh and pipeline) on a tablet or a desktop; a phone\'s storm keeps the rain, the flashes and the thunder',
    tier: (p, c) => (phoneOnly(p, c) ? 'off' : 'on') },
  // --- round 3 (owner, 2026-11-18: "Remove storm from phone"): the same rule. Off: no storm ever runs (no rain, flashes,
  // thunder, storm sky or storm waves); the weather stays fair; ?weather=storm, ?storms=natural and the Weather menu's Storm row
  // are skipped or hidden; the storm's chunk (its sim, draws and thunder), its 4 pipelines and the rain's sound are never fetched ---
  storm: { fixed: true, axes: 'form', aliases: '?profile=form:phone',
    why: 'the thunderstorm (its chunk, the rain and bolt pipelines, the storm and bow composites, the thunder, the rain\'s sound, the Weather menu\'s Storm) on a tablet or a desktop; a phone\'s weather stays fair',
    tier: (p, c) => (phoneOnly(p, c) ? 'off' : 'on') },
  // --- the post chain's bloom (owner, 2026-11-18: desktop on; phones by cost): its 3 pipelines, its mip texture and its 11 small
  // render passes a frame. A phone is for the sail sim and builds every pipeline before play: off there (0 pipelines, 0 passes);
  // a tablet and a desktop keep it. A capture keeps it unless ?profile= forces a phone ---
  bloom: { fixed: true, axes: 'form', aliases: '?bloom=0 (off everywhere), ?bloom=1 (on everywhere, a phone too), ?profile=form:phone',
    why: 'the soft glow round bright lights (render/bloom.js: 3 pipelines, a half-size mip chain, 11 small passes) on a tablet or a desktop; never on a phone unless ?bloom=1',
    tier: (p, c) => (c.flags.bloom === '0' ? 'off' : c.flags.bloom === '1' ? 'on' : phoneOnly(p, c) ? 'off' : 'on') },
  // owner, 2026-11-18: the cinematic intro (v2/ui/cinematicIntro.js): the letterbox, the lens look and the HUD's entrance
  // on the first Sail or Cruise of a page load, desktop only; 2026-11-18, the tablet rule: a tablet plays it too (a touch-only tablet skips by a tap: cinematicIntro.js listens to pointerdown and touchstart); only a phone skips it; never in a capture or an
  // automated browser unless ?cinema=1
  cinematicIntro: { fixed: true, axes: 'form', aliases: '?cinema=0 (off), ?cinema=1 (on: a capture or an automated browser too), ?profile=form:phone',
    why: 'the first Sail or Cruise of a page load opens as a film (2.39:1 bars, a lens look, the HUD after them) on a desktop or a tablet; a phone starts as before',
    tier: (p, c) => (c.flags.cinema === '0' ? 'off' : !desktopLike(p) ? 'off' : c.flags.cinema === '1' ? 'on' : !c.headless && !globalThis.navigator?.webdriver ? 'on' : 'off') },
  // --- the phone's clouds (owner, 2026-11-18: "remove the clouds on phones"): a phone's sky is the clean gradient with the sun, the moon
  // and the stars; its key, 5 cloud pipelines and ~15 MB of textures are never made. A tablet and a desktop keep the live march. ?phoneclouds=full
  // puts them back on a phone, =off takes them off anywhere (the A/B) ---
  phoneClouds: { fixed: true, axes: 'form', aliases: '?phoneclouds=full|off, ?profile=form:phone',
    why: 'the clouds (the live march into the sky key: 5 compute pipelines, about 15 MB of textures) on a tablet or a desktop; a phone\'s sky stays clear',
    tier: (p, c) => (c.flags.phoneclouds === 'full' ? 'full' : c.flags.phoneclouds === 'off' ? 'off' : phoneOnly(p, c) ? 'off' : 'full') },
  // --- live ---
  quietSkipper: { fixed: false, axes: 'flatControls (mounted)', aliases: '',
    why: 'the quiet skipper follows the flat controls\' layout while it is up',
    tier: (p, c, m) => (m.flatControls ? 'on' : 'off') },
  // --- the gennaker (owner, 2026-11-21:; v2/render/boat/gennaker.js) ---
  gennakerCloth: { fixed: true, axes: 'form, gpu', aliases: '?gennaker=1 (a capture: full)',
    why: 'the gennaker\'s cloth grid: full (28 x 48, 2,688 triangles) on a desktop or a tablet at L0-L1 and in a capture; lite (14 x 24, 672 triangles: the same shape, a quarter of the refill) on a phone or at L2-L3. Every device flies it',
    tier: (p, c) => (!c.headless && lite(p) ? 'lite' : 'full') },
  shoreSpray: { fixed: false, axes: 'gpu', aliases: '?levers=lite (main.js pins it)',
    why: 'the shore\'s lite train (one train, no lean, lace or spray) at L2-L3',
    tier: (p) => (p.gpu != null && p.gpu >= 2 ? 'lite' : 'full') },
  // --- Regatta's fleet (the race fixes, 2026-11-18) ---
  fleetDetail: { fixed: false, axes: 'form, gpu', aliases: '',
    why: 'Regatta\'s full-detail rivals: every rival within 150 m of the eye on a desktop at L0-L1; one on a phone or at L2-L3 (a tablet by its level; v2/regatta/lod.js LOD_BANDS.lite)',
    tier: (p) => (lite(p) ? 'lite' : 'full') },
  // --- the load ---
  pipelineDeferral: { fixed: true, axes: '(a live page)', aliases: '?pipes=all (off)',
    why: 'the first frame\'s pipelines first, every plug-in after it, one at a time (every live page; captures and films build all first)',
    tier: (p, c) => (!c.headless && c.flags.filmui !== true && c.flags.pipes !== 'all' ? 'on' : 'off') },
  // owner, 2026-11-17: "For phones, the best experience is to build the shaders, then present": a phone builds every pipeline the
  // modes need behind the home card (the lake live beside it), and the modes start only once the build is done; nothing compiles
  // in play. A tablet and a desktop keep the deferral above (the modes start at once; the rest builds in the background)
  buildAllFirst: { fixed: true, axes: 'form', aliases: '?profile=form:phone (on), ?pipes=all (off: all before the first frame)',
    why: 'a phone builds every pipeline behind the home card before Sail, Cruise or Regatta can start (none in play); a tablet and a desktop start at once',
    tier: (p, c, m, get) => (p.form === 'phone' && get('pipelineDeferral') === 'on' ? 'on' : 'off') },
  levelRetry: { fixed: true, axes: 'quirks', aliases: '',
    why: 'a level settled on the frame interval alone is retried one up, unless this GPU compiles slowly (slow-compiler)',
    tier: (p) => (p.quirks.includes('slow-compiler') ? 'off' : 'on') },
});

const attrKey = (n) => `f${n[0].toUpperCase()}${n.slice(1)}`;   // the dataset key: fTownsTier is data-f-towns-tier

export function createFeatures({ profile = pageProfile, doc = globalThis.document, policies = POLICIES } = {}) {
  let ctx = null;
  const fixed = new Map(), mounts = {};
  const pageCtx = () => { let s = ''; try { s = globalThis.location?.search ?? ''; } catch { /* none */ } const f = toFlags(s); return { headless: f.headless != null, flags: f }; };
  const context = () => (ctx ??= pageCtx());
  const decide = (name) => {
    const P = policies[name]; if (!P) throw new Error(`features: no feature "${name}" (src/core/features.js POLICIES)`);
    if (P.fixed && fixed.has(name)) return fixed.get(name);
    const tier = P.tier(profile.get(), context(), mounts, decide);
    if (P.fixed) fixed.set(name, tier);
    return tier;
  };
  const publish = () => {
    const H = doc?.documentElement; if (!H?.dataset) return;
    for (const n of Object.keys(policies)) { if (policies[n].fixed && !fixed.has(n)) continue; const t = decide(n), k = attrKey(n); if (H.dataset[k] !== t) H.dataset[k] = t; }
  };
  profile.on?.('change', () => publish());
  profile.on?.('publish', () => publish());
  const api = {
    configure(c = {}) { ctx = { ...pageCtx(), ...c }; fixed.clear(); publish(); return api; },
    feature(name) { const known = fixed.has(name), tier = decide(name); if (!known) publish(); return { name, tier, on: tier === 'on', fixed: !!policies[name].fixed }; },
    mounted(name, on) { if (mounts[name] === !!on) return; mounts[name] = !!on; publish(); },
    state() { return Object.keys(policies).map((n) => ({ name: n, tier: decide(n), fixed: !!policies[n].fixed, axes: policies[n].axes })); },
    lines() { return api.state().map((s) => `${s.name} ${s.tier}${s.fixed ? '' : ' (live)'}`); },
    publish,
  };
  return api;
}
export const features = createFeatures();
export const feature = (name) => features.feature(name);
