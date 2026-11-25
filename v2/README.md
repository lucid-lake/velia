# Velia v2 · the engine (map)

Velia on our own raw-WebGPU engine, no three.js. This file is the map; the detail lives in `v2/notes/` (one file per subsystem, moved verbatim from the old 4,834-line README on 2026-11-23, refactor round 3 D1). The section list is `v2/notes/INDEX.md`: an old "README § Title" points there.

Milestone history (M0 to M5e): `v2/notes/overview.md`. How to work in this repo: and `CONTRIBUTING.md`.

## Run

| Command | What |
|---|---|
| `npm run dev:v2` | the v2 page at http://127.0.0.1:5174/ (strict port; v1 stays on 5173) |
| `npm run build:v2` | `dist-v2/`: one JS chunk + the terrain worker + the grids v2 streams |
| `npm run build:site` | the public site: v2 plus v1 under `/classic/`, assembled in `dist-site/` (`v2/notes/ui.md` § The launch gate) |
| `npm run test:v2` | `node --test v2/tests/`: the fast suite (no browser) |
| `npm run test:v2:slow` | `v2/tests/slow/*.slow.mjs`: the Regatta's long sweeps and full place-race sails |
| `npm run test:pages:v2` | the page tests (`v2/tests/pages/`; need the GPU; a private Vite) |
| `npm run goldens:v2` | the v2 golden frames (`v2/golden/frames.json`) |
| `bash tools/gate.sh` | the per-merge gates in one command, one summary line |
| `node tools/capture.mjs --app v2 --name <n> --hour <h> --cam A` | a headless capture to `renders/captures/v2/` |

URL rows (`?hour=&cam=&seed=&exposure=&headless=1` and the rest): `v2/engine/flags.js` (`V2_ROWS`); the full contract is in `v2/notes/run-and-tools.md`.

## Folder map

| Folder | What |
|---|---|
| `main.js`, `start.js`, `index.html` | boot, the launch gate, the page |
| `engine/` | device, frame graph, pipelines, governor, quality ladder, clock, flags, mode table, plug-in list, player |
| `sim/` | pure simulation: boat, wind, waves, clouds, regions, kayaks, seamanship (no DOM, no GPU) |
| `render/` | the GPU passes: terrain, forest, water, sky, clouds, night, storm, boat, cockpit, wake, birds |
| `terrain/`, `forest/`, `towns/`, `photo/` | streamed lake data and its decoders |
| `audio/` | beds, music, engine, fireworks sound |
| `ui/` | HUD, cockpit, front door, plan, logbook, touch and flat controls |
| `cruise/`, `regatta/`, `stage/`, `living/` | the modes' chunks, the stage venues, the living lake (kayaks, Tessie, plug-ins) |
| `tests/`, `golden/`, `assets/` | tests (fast, `slow/`, `pages/`), golden frames, baked assets |

Shared with v1: `src/` (read-only from v2; `v2/notes/engine.md` § Shared modules). The file-by-file tree: `v2/notes/folder-tree.md`.

## Architecture (refactor round 3, 2026-11-23)

The frame graph and depth: `v2/notes/engine.md`.

### The mode table (refactor round 3 C1, 2026-11-23: engine/modes.js)

One row per mode v2 plays: Sail, Cruise, Regatta. Names, labels, aliases, card looks and the home card's order stay in
`src/modes/rows.js` (shared with v1 and `tools/loading_shell.py`); `engine/modes.js` adds v2's facts: `chunk` (the dynamic
import), `enter`/`leave` (the switch's hooks, from the mode's own `plan.js`), `clock` (`sail` | `race` | `own`), `pro`, `race`,
`swap` (the Sail ⇄ Cruise partner), `home`, `pipes` (its pipeline groups) and `knockdown` (`logbook` | `race` | null).
The readers take what they need from the table and compare no mode names: `ui/modeSwitch.js` (enter, leave, clock, Pro, speed),
`ui/frontPlan.js` and `ui/front.js` (the picks v2 plays), `engine/buildGate.js` PHONE_ORDER and `main.js` PIPE_ORDER (`modePipes()`
after 'storm'), `sim/knockdownGame.js`, `sim/tessieSwap.js`, `living/tessiePlayer.js` and `main.js` (the boot mode, the end card).
`'regatta'` in code outside its folder went from 23 literals in 7 files to 1 (main.js looks up its row); all mode names, 158 in
41 files to 112 in 36. What is left is a real behaviour of one mode (Sail-only features, Cruise's chart and music) or another
word (`kind: 'sail'`, a kayak's `'cruise'` gait). `tests/mode-table.test.mjs` lists a fake School row through every reader,
and fails on any new mode-name literal outside the mode's folder (raise its allow-list count only for a one-mode behaviour).

A new mode (School) in 4 steps, 3 files before its first line (the audit counted about 8):
1. `src/modes/rows.js`: its row (School has one; give it an `order` to put it on the home card,'s pill).
2. `v2/school/plan.js`: its pure facts and `SCHOOL_SWITCH` ({ enter, leave }, as `cruise/plan.js`); `v2/school/index.js` its chunk.
3. `engine/modes.js`: one row in ROWS (chunk, the hooks, clock, pro, pipes, knockdown).
4. `main.js`: its loader with the page's parts in `createModeSwitch({ chunks })` (as `cruiseLoad`). Keys, stats and Setup rows
   come only if it has its own.

### The plug-in list (refactor round 3 C2, 2026-11-23: engine/plugins.js, living/lakePlugins.js)

The living lake's features are rows of one list: kayaks, the glass boat, the birds, the boats at anchor, the busy lake. A row is
`{ id, on(ctx), group, fetch?, load?, create(ctx, mods), createAt, at: { [anchor]: fn }, prime?, statsAt, stats, hook }`
(engine/plugins.js has the contract). `ctx` is the bag `boot()` builds once (`plugCtx`: device, layouts, flags, P, feature,
inGroup, terrain, water, and getters for what boot makes later: B, regatta, eye, clock …); `ctx.plugins.get(id)` is how one row
reads another (the glass boat reads the kayaks). An anchor is one call site in `boot()`: `plugins.create('living')`,
`plugins.run('scene.solid', pass, c, S)`, `plugins.run('fill.living', F)`, `plugins.reduce('night.lights', n, …)`,
`plugins.prime('boat', 'capture')`, `plugins.stats('lake')`. `ORDER` (living/lakePlugins.js) lists, per anchor, the ids in the
order `boot()` called them before the move, so the step, fill and draw order is unchanged (`tests/plugins.test.mjs` asserts it);
a feature that is off (`on` false, or `create` returning null) is skipped at every anchor and gives its stats' and hook's off value.
The capture, `?filmui=1` and live prime lists are one list: `prime.paths` says which paths prime a row (kayaks and the glass boat:
capture and film; the birds: all three). Tessie moved in at C3 (below: The played seam).

The fireworks are a row too (round 3 follow-up, 2026-11-23: living/lakePlugins.js FIREWORKS; the show itself stays in
living/fireworksPlugin.js). `fetch(feature)` starts its chunk's import early in boot() (`fetchChunks`: `ctx.chunks.fireworks`, null
on a phone); its `create` returns null unless `fireworksOn(flags)` (the highlight day, `?fireworks` not 0), which switches the show off
whole. Rows can also answer the list: `plugins.some(anchor)` (every on row asked, true if any said yes), `plugins.first(anchor)` (the
first answer not null), `plugins.runs(anchor)`. The four couplings C2 left hand-wired are hooks: the music door is `ctx.musicDoor`;
the post pass is the anchor `graph.post` (the row adds its `fw-post` pass at the same place in the graph); the start code asks
`plugins.first('start.pose', hour)` for the show's start and facing (the page's start, a birth, a Sail cut into the show); Regatta's
`onSalute` is `plugins.some('race.salute')`. Its other anchors: `boot.night` / `boot.pipes` (an evening page's or `?fwt`'s pipelines
with the load), `compute.forest`, `scene.depth`, `scene.solid2` (after the birds), `scene.light`, `attach` (first), `camera.cruise`,
`camera.race` (the salute's camera), `show.t` (the day clock, the night's cover), `sim.show` (its frame, or idle in a race),
`post.bloom`, `prime.show` (a capture), `stats.show`. boot() keeps no reference to the show; other readers by name:
`ctx.plugins.has('fireworks')` (the kayaks' evening), `__velia.fireworks` (the page tests and tools).

A new living-lake feature in 4 steps, 2 files:
1. `living/lakePlugins.js`: its row (`on` from its `src/core/features.js` policy, `group`, `create`, the `at` hooks it needs).
2. Same file, `ORDER`: its id at each anchor it uses, where it should run among the others.
3. `tests/plugins.test.mjs`: the same lines in `RECORDED` (the test fails until both agree).
4. `main.js` only if it needs a new anchor (a new call site) or a getter in `plugCtx`.

### The played seam (refactor round 3 C3, 2026-11-23: engine/player.js, living/lakePlugins.js TESSIE)

One `player` object, made once in `boot()`, answers "what is the player, where is it, who has the keys and the camera". The boat
is the default (`as` 'boat'); a played thing adds itself with `player.add(id, thing)` and `as` is its id while it is played.
A thing is `{ active, swap(entry, at), back(opts), camera(dt, c, orbit), step(dt), pose(), threat(), bubbles(dt), dives, view() }`
(all but `active` optional). The seam: `as`, `played`, `drive()`, `view()`, `pose()` ({ x, z }, else the boat's state),
`camera()` (every thing's camera in turn, last in placeCamera: a swap's glide and veil stay the thing's own), `swap(to)`, `back()`,
`step(dt)`, `threat()`, `bubbles(dt)`, `dives`. The UI reads it as the service `'played'` (`'player'` is the boat's sim); the page
hook is `__velia.played`. Readers that asked Tessie by name now ask the seam: main.js (the camera, the hands' step, the eye under
the water and its split, the knockdown's end card, the bubbles), the busy lake's escape (`threat()`), the kayaks' launch
(`pose()`), the Calm HUD and Sail's dash (`played`). The under-water pipelines are the group `'under'` (was `'tessieUnder'`).
Tessie is a row of the plug-in list (living/lakePlugins.js TESSIE: create, compute, draws, fill, attach, audio, step, prime, stats, hooks at
the anchors where boot() called her) and her row's attach adds her player as `'tessie'`. Code (not comment) refs to Tessie outside
her own 25 files: 42 files before (38 in v2 + `src/core/features.js`), 33 after; what is left is her own features (her policies
and flags, the stage's act and her water, Tessie's Deep and the hunts, her keys tab, tutorial chapter, chart mark and vessel row,
the kayakers' reactions, the end card's title, the news), not "who is the player". `tests/played.test.mjs` swaps a stub drone in
and back through `player` with no reader edited.

A second played creature or craft in 3 steps: 1. its plug-in row (as `living/lakePlugins.js TESSIE`: a row in `LAKE_PLUGINS`, its ids in
`ORDER`) whose attach calls `c.player.add('<id>', thing)`; 2. its thing (the members above; its camera passes `c` through when it
is not played); 3. only if it needs them: a vessel row in the menu's Boat plate, its keys tab, its tutorial chapter.

### The region table (refactor round 3 C5, 2026-11-23: sim/regions.js, src/waters/tahoe-emerald.json `regions`)

One row per region of the lake, in the lake profile (`CURRENT_WATERS.regions`), holds everything keyed by region: `id`, `name`,
`centre` + `radiusM` (the traffic's circle: the region the player is in), `area` (the cup's boxes `[x0, x1, z0, z1]`, null an open
side; `null` = the rest of the lake), `neighbours`, `keepOut`, `label` (the chart's name), `birthplaces`, `kayaks` (lanes),
`launchSpots`, `boats` (its traffic: the count is their number), `cup` (`id`, `name`, `line`, `races`, `hunt`, `huntName`),
`names` (more chart names: its towns and marinas) and `level` (its own detail level: `{ dir, full, phone, photo }`, the folder
under `terrain/` and its manifests; `terrain/region.js`).
Today: `emerald-bay` (4 birthplaces, 5 lanes, 4 put-ins, 5 boats, the Emerald Bay cup), `tahoe-west` (named Lake Tahoe: 1
birthplace, 3 lanes, 3 put-ins, 3 boats, The Mouth) and `south-lake` (South Lake Tahoe: 1 birthplace, Off Ski Run; its level
`terrain/south/`, 4 m on a desktop and 8 m on a phone; no traffic yet).

**A region's detail loads only on selection (owner, 2026-11-24).** A region's `level` is fetched only when the page starts at
one of its birthplaces (`?birth=`, the saved pick, a pin on the home card: a pick on another level reloads the page). It fills
the bay's slot (heights, cover, shore distance, photo layer 0) in place of the bay's grids, which are then never fetched; the
coarser levels stay and its edges blend into them. A start elsewhere fetches none of it; a region with no `level` starts on the
bay's. No mid-sail swap: sailing into another region keeps the start's level (the hook: `terrain/region.js`).
`tests/region-level.test.mjs` checks every birthplace of every row (and a fake second region): its start's files hold its own
region's level (or the bay's) and no other region's; `tests/pages/southStart.page.mjs` records the page's requests. The readers derive their old tables from it, digit for digit
(`tests/region-table.test.mjs` against `tests/fixtures/regions-before.json`): busyLake.js `REGIONS` (and with it the resident
kayakers, the stone regions, the launcher's regions), kayakLaunch.js `LAUNCH_SPOTS`, birthplace.js `listBirthplaces`, places.js
`CUPS`, `cupAt` and the hunts' names, the chart's `NAMES` (the regions' labels first). `tests/region-table-extra.test.mjs` adds a
fake `tahoe-city` row to a fixture profile and every reader picks it up with no code edit.

A new region (what Phase 3's whole lake needs) in 5 steps: 1. a row in the waters file's `regions` (id, name, centre, radius,
neighbours both ways, label); 2. its first birthplace in the row (a region with none spends nothing: no boats, no kayakers, no
stones); 3. its lanes, put-ins and boats in the row, routes on the chart (`tests/busy-lake.test.mjs`: 4 m of water, 80 m off
the shore; `kayak-launch.test.mjs`: put-ins 6–15 m off it); 4. its cup, if it races: `area` boxes (checked in table order, the
first match wins: narrow a neighbour's box if they overlap), race ids in `sim/racePlaces.js PLACE_RACES` with `cup` set, its hunt's
corners in `regatta/hunts.js` and its flag in `hub.js` (`.ctab[data-cup=…]`); 5. its ground, terrain and names as the terrain
work brings them: a `level` (built by `tools/terrain/build_tahoe.py --region`, `tools/v2-photo-tiles.mjs --region`), which
loads only when the player starts in the region, never for a start elsewhere.

### Import directions (refactor round 3 C6, 2026-11-23; `tests/import-direction.test.mjs`)

Lowest first: `sim/` (pure state and maths: imports only `sim/`, `terrain/`, `src/`) → `terrain/`, `forest/`, `towns/` → `render/`
(GPU; reads `sim/`) and `audio/` (reads `sim/`) → `ui/` (DOM) → `engine/` (frame, flags, quality, the mode table) → `living/`,
`stage/`, `photo/`, `regatta/`, `cruise/` (features and modes that compose the layers) → `main.js`, `start.js` (nobody imports them).
Not allowed: `sim/` into anything else in v2; `render/` into `ui/`, `audio/` or the modes; `audio/` into `render/`, `ui/` or the modes;
`ui/` into the modes; `engine/` into `ui/` or `render/`. The lint also fails on any import cycle among v2's modules. Its `ALLOWED`
table names the 4 deliberate exceptions, each with its reason (the sims read `engine/modes.js`, the pure mode table; `ui/planChart.js`
reads Cruise's chart rows). C6 brought 16 back-edges and 1 cycle to 0: `sim/ease.js`, `sim/exposure.js` (with the twilight shares),
`sim/kayak-clip.js`, `sim/kayak-rigid.js`, `sim/steadyCamera.js`, `sim/clearLook.js`, `sim/raceLevels.js`, `sim/racePlaces.js` moved
in; `BIG` lives in `sim/bedBoulders.js`; the fireworks plug-in is `living/fireworksPlugin.js`; the race-level row is
`ui/raceLevelRow.js`; `render/boat/colour.js` holds `hexLinear`. Every boat's physics is built through
`craftOf(vessel).createPhysics` (`src/sim/craft/`), pinned by `tests/craft-seam.test.mjs`.

**`classic/` is v1's alone (refactor round 3 C7b, 2026-11-23).** `src/` holds only what both apps read (245 files reached by
v2, plus the 15 three-free v1-only `src/sim/` files and 7 tests/tools-only modules, among them Cruise's `src/modes/chill/sim.js`);
v1's 198 private files live in `classic/src/` (same subpaths: `classic/src/main.js`, `classic/src/core/world.js` …). No v2 file
and no `src/` file may import from `classic/`: `tests/import-direction.test.mjs` fails on one, except the 13 parity tests in its
`CLASSIC_PARITY` list (v2's copy against v1's original, or v1's lake-wide ground as the reference: birds, captain, cockpit-rig,
day-clock, frame-look, front-door, plan, sea-parity, shuffle, storm, terrain-shadow, vhf-set, world-audit). The bakes in
`tools/v2-*` read v1's layouts from `classic/src/`. Recount with `node tools/classic-reach.mjs`.

## Tools

The full table (about 60 commands: captures, A/B budgets, films, packs, probes) is `v2/notes/run-and-tools.md`. The ones used most:

| Command | What |
|---|---|
| `node tools/v2-perf.mjs --v base=<url> --v new=<url> --pose …` | the speed profile: GPU and CPU frame per pose, alternated rounds |
| `node tools/v2-perf-diff.mjs --a <url> --b <url> --pose …` | the look check: the share of pixels that differ between two servers |
| `node tools/v2-flicker.mjs --app v2 --query "…"` | the water's flicker metric |
| `node tools/v2-hitch.mjs --url <url>` | hitches on a live page: ENTER, the cockpit fold, the view change |
| `node tools/v2-ab-m5e.mjs --url <url> --what night\|storm` | an in-page A/B budget for one feature |
| `node tools/classic-reach.mjs` | recounts what v2 and `src/` reach of `classic/` |

## Budgets (summary)

The frame budget is 30 fps, picture quality first (`engine/governor.js` `frameBudget`). Every feature records its measured budget (M5 Pro Mac, headless Chrome, 60 frames, per-pass medians) beside its section:

| Where | Budgets |
|---|---|
| `v2/notes/perf.md` | the speed pass, M3, M3b, M2 |
| `v2/notes/sky.md` | clouds (M5a), night and storm (M5e), birds, fireworks |
| `v2/notes/terrain.md` | forest (M5b, T5), shallows (M5c), island (M5d), towns (10a) |
| `v2/notes/water.md` | reflection (M5c), shore (#56 M3), wake |
| `v2/notes/living.md` | kayaks |
| `v2/notes/phone.md` | the phone passes (the quality ladder, the 30 fps limiter) |

The phone Regatta is measured at 31.5 ms (estimate) against the 27.3 ms line:.

## Subsystem notes

| File | What |
|---|---|
| `v2/notes/terrain.md` | terrain, forest, shallows, island ground, lake-bed edges, shore, towns |
| `v2/notes/sky.md` | clouds, the frame's look, night and storm, birds, fireworks |
| `v2/notes/water.md` | water colour, surface, reflection, caustics, breakers, wake |
| `v2/notes/boat.md` | the boat, v1's models, parity, motion, engine and ground tackle |
| `v2/notes/engine.md` | frame graph, depth, buffers, pipeline rules, determinism, governor, shared modules |
| `v2/notes/ui.md` | UI, clock, nav, plan, front door, launch gate, logbook, first sail, binoculars |
| `v2/notes/phone.md` | the phone passes, landscape-only, flat and touch controls |
| `v2/notes/audio.md` | sound beds and music |
| `v2/notes/cruise.md`, `v2/notes/regatta.md` | the two mode chunks |
| `v2/notes/living.md` | the kayaks |
| `v2/notes/perf.md` | budgets, MSAA |
| `v2/notes/overview.md`, `run-and-tools.md`, `folder-tree.md`, `INDEX.md` | history, commands and URL rows, the file tree, the section list |
