# v2 notes: where each section went

Every `##` section of the old `v2/README.md` and the note file that holds it (refactor round 3 D1, 2026-11-23). An old reference of the form "README § Title" resolves here.

| Section | File |
|---|---|
| The terrain (render/terrain.js, terrain/*) | `terrain.md` |
| The clouds (M5a: render/clouds.js, sim/clouds.js, cloud-read.js) | `sky.md` |
| The forest (M5b: render/forest.js, forest/*) | `terrain.md` |
| The clear shallows and the island ground (M5c: render/bed.js, ground.js, shadow.js, rocks.js; terrain/photo.js, rocks-rules.js) | `terrain.md` |
| The lake bed's straight edges (fix(terrain) + fix(v2), 2026-11-13: tools/terrain/build_tahoe.py, render/bed.js, terrain.js) | `terrain.md` |
| The caustics on the bed (ultra M2, BACKLOG-v2 #56, 2026-11-14: render/caustics.js, bed.js, terrain.js; tools/v2-caustics.mjs) | `water.md` |
| The water's colour and the shore (render/water.js) | `water.md` |
| The island and the shore, round 5 (M5d, 2026-11-13: render/water.js, terrain.js, forest.js, bed.js) | `terrain.md` |
| The water's reflection and its filtering (M5c, 2026-11-13: render/water.js, render/water-aa.js) | `water.md` |
| The water's surface (#56 M1, 2026-11-14: render/water-surface.js, render/water.js, sim/spectrum.js FADES, sim/seaField.js) | `water.md` |
| The crest glow and the wave body (2026-11-24: render/water-surface.js SURF.crest, SURF.jelly; render/water.js) | `water.md` |
| The shore: breakers, swash, wet sand, spray (#56 M3, 2026-11-14: sim/shoreField.js, render/shore.js, render/water.js; tools/v2-shore-bake.mjs) | `water.md` |
| The wake and the spray (render/wake.js, sim/wake.js, sim/spray.js) | `water.md` |
| The birds (render/birds.js, sim/birds.js, engine/birdAudio.js) | `sky.md` |
| The fireworks (render/fireworks.js, living/fireworksPlugin.js, sim/fireworks.js, audio/fireworks.js) | `sky.md` |
| The sound beds (step 3, hybrid, 2026-11-13: audio/beds.js, recorded.js, bedsMix.js, noise.js, bedsLive.js, offline.js, script.js) | `audio.md` |
| The music (#7, #7a, 2026-11-14: audio/music.js; hooks in main.js, audio/fireworks.js, audio/recorded.js, bedsLive.js, ui/sail.js) | `audio.md` |
| Setup's rows (#9, 2026-11-14: ui/setup.js; hooks in front.js, sail.js, sim/boat.js assists, main.js quality.pin) | `ui.md` |
| The night and the storm (M5e, 2026-11-13: render/night.js, night-read.js, storm.js, shaders.js; sim/moon.js, night.js, storm.js) | `sky.md` |
| Buffers and bind groups | `engine.md` |
| Pipeline rules | `engine.md` |
| Determinism | `engine.md` |
| Governor, stats, anti-aliasing | `engine.md` |
| The phone pass (2026-11-13: the quality ladder, the diag panel, Safari's WGSL, touch) | `phone.md` |
| The phone speed pass (perf(v2) phone, 2026-11-13 night: engine/quality.js, diag.js, sweep.js, frame.js; render/water.js, clouds.js, shadow.js, boat.js) | `phone.md` |
| The phone speed pass, round 2 (perf(v2), 2026-11-14 night: engine/frame.js, sweep.js, diag.js, governor.js, quality.js; render/shaders.js, water.js, boat.js, clouds.js) | `phone.md` |
| The governor on the GPU's work (fix(v2), 2026-11-14 morning: engine/governor.js, quality.js, diag.js, sweep.js, frame.js) | `phone.md` |
| MSAA live (BACKLOG-v2 #31, 2026-11-14: engine/pipelines.js, frame.js, quality.js, diag.js; main.js, render/forest.js) | `perf.md` |
| Budgets (the speed pass, measured 2026-11-13 evening on the M5 Pro Mac, headless Chrome) | `perf.md` |
| Budgets (M3b, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 60 frames, per-pass medians, two runs) | `perf.md` |
| Budgets (M3, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 60 frames, per-pass medians) | `perf.md` |
| Budgets (M2, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 60 frames, per-pass medians) | `perf.md` |
| Shared modules (what v2 imports from src/) | `engine.md` |
| The boat (M3) | `boat.md` |
| v1's models (M3b) | `boat.md` |
| Parity with v1: the helm view's look, the game speed, the wind and the sea (2026-11-13) | `boat.md` |
| The boat's motion and the sea across the lake (#21, #25, 2026-11-14: sim/surface.js, sim/seaField.js, sim/boat.js, sim/spectrum.js, render/water.js) | `boat.md` |
| The UI (M4: ui/*, render/cockpit.js, render/cockpit/*) | `ui.md` |
| Phones are landscape-only (owner ruling 2026-11-15; ui/landscape.js, ui/landscapeBoot.js, index.html's turn rule) | `phone.md` |
| A phone's flat controls (option C, owner 2026-11-16: ui/flat.js) | `phone.md` |
| The phone's controls (BACKLOG-v2 #2, #52, 2026-11-14: ui/touch.js, ui/station.js, render/cockpit.js setSlots, render/cockpit/rig.js slotCam) | `phone.md` |
| The day clock and the key legend (2026-11-13: engine/clock.js, engine/flags.js clockParams, ui/dayClock.js, ui/sail.js) | `ui.md` |
| The nav column (2026-11-13: ui/nav.js, ui/sail.js) | `ui.md` |
| The passage plan (2026-11-14: ui/plan.js, ui/planChart.js, ui/planChart.bin, ui/sail.js) | `ui.md` |
| The front door (2026-11-13: ui/loading.js, ui/noReel.js, ui/frontPlan.js, ui/front.js, ui/settingsStore.js) | `ui.md` |
| The launch gate (2026-11-14: start.js, engine/gpuCheck.js, engine/device.js, sim/steadyCamera.js, ui/seaText.js; tools/build/base-path.mjs, site.mjs) | `ui.md` |
| Cruise (BACKLOG-v2 #11, 2026-11-14: cruise/*, a chunk of its own) | `cruise.md` |
| Regatta (BACKLOG-v2 #12, R1 + R2 + R3 + R4, 2026-11-14: regatta/*, a chunk of its own; render/raceLines.js, render/raceProps.js) | `regatta.md` |
| The logbook (fix(v2): LOG, 2026-11-13: ui/logbook.js, ui/logbookWorld.json) | `ui.md` |
| The first sail's lines and the island goal (#4, 2026-11-14: ui/firstSail.js, src/ui/firstSailGuide.js) | `ui.md` |
| The binoculars and the VHF (#5, #6, 2026-11-13: ui/captain.js) | `ui.md` |
| The engine and the ground tackle (#8, #14, 2026-11-14: sim/seamanship.js, ui/seamanship.js, audio/engine.js, render/exhaust.js) | `boat.md` |
| The kayaks (the living lake: living/kayaks.js, sim/kayaks.js, sim/lake.js, render/kayaks.js, render/kayak/*) | `living.md` |
| The towns (10a, trimmed by the owner 2026-11-13: render/towns.js, towns/format.js, towns/wgsl.js) | `terrain.md` |
| the opening text (milestones M0 to M5e) | `overview.md` |
| Run (commands, tools table, URL rows) | `run-and-tools.md` |
| Architecture (the file tree) | `folder-tree.md` |
| Frame graph (M3), Depth (M2) | `engine.md` |
| The mode table, The plug-in list, The played seam, The region table, Import directions | stay in `../README.md` |
