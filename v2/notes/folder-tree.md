# v2 notes: The file tree: what every v2 file does

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## Architecture

```
v2/index.html ─ main.js (boot: flags → device → manifests → targets → every pipeline async ∥ the terrain's first stage
                in a worker → the sky's fixed LUTs → the first grids' maps baked → first frame → seal → ready → stream the rest)
  engine/flags.js      the URL rows (v1's table for the shared ones + V2_ROWS) and sceneParams()
  engine/camera.js     M2: the pose from ?cam (v1's presets), ?campos/camlook, ?camyaw/campitch, ?camfov; near 0.5 m, far 120 km
  sim/exposure.js   M2: the exposure factor (sunlit ground at the base; a partial adaptation toward dusk)
  engine/device.js     adapter + device; WebGPU only; the plain card (#nogpu, link to the current Velia) when absent
  engine/canvas.js     backing size = CSS × min(DPR, cap) × scale, shrunk to the pixel budget; a ResizeObserver
  engine/clock.js      the fixed-step sim clock (1/120 s, ≤ 10 steps a frame) and the day clock on it: v1's schedule or a constant
                       rate, cuts and pace changes, the hour a pure function of sim time (§ The day clock and the key legend)
  engine/uniforms.js   the one per-frame uniform block (Frame struct, 256 B) as a 3-slot ring; one writeBuffer a frame
  engine/pipelines.js  the registry: add() → buildAll() (all async) → seal(); anything later is a counted error
  engine/frame.js      the frame graph: render and compute passes, one encoder, one submit; GPU timestamps per pass (+ medians)
  engine/readback.js   the readback ring: 3 mappable staging buffers, mapped async, never a new buffer
  engine/governor.js   the dynamic-resolution governor (pure) + the frame budget (30 fps, picture quality first: frameBudget)
  engine/pacer.js      perf(v2) phone 30 fps: the frame limiter (pure): a phone draws on every 2nd / 3rd / 4th vsync, evenly
  engine/quality.js    the phone pass: the quality ladder L0 / L1 / L2 (pure): the first guess, the pin, the stored level, the ladder's settle and steps
  engine/diag.js       the phone pass: ?diag=1, the navy-glass panel for phone screenshots; the crash log (a note that survives an iOS tab kill)
  engine/wgsl-lint.js  the phone pass: the Safari WGSL lint (reversed smoothstep edges and the other rules), run over every module by a page test
  engine/hook.js       window.__velia (ready, frames, stats(), errors, renderOnce, water, terrain)
  engine/math.js       mat4 (perspective, M2's perspectiveReversed, lookDir, multiply, invert), forwardOf
  sim/sun.js · sim/wind.js · sim/spectrum.js · sim/surface.js   (M1: the sun, the wind, h0, the CPU water surface)
  sim/sea-worker.js    the day clock: a live page's sea tables (seaTables) built off the main thread
  terrain/levels.js    M2: the five slots, the stream plan (3 stages), the variant pick, the files a build ships (pure)
  terrain/decode.js    M2: .lsh inflate + unpredict (a copy of v1's maths: § Shared modules), per-cell min/max (pure)
  terrain/worker.js    M2: fetch → inflate → unpredict → bounds, off the main thread; the codes come back transferred
  terrain/sample.js    M2: the CPU twin of the WGSL height function (v1's heightAt with every full grid in)
  terrain/quadtree.js  M2: CDLOD: the bounds grid + pyramid, the frustum, the per-frame selection into one Float32Array (pure)
  render/landmarks.js  G1, G2 (the world audit): v1's ruin, stone house and waterfall (baked: tools/v2-landmarks-bake.mjs) and the five shore flags (two pipelines)
  sim/shoreFlags.js    G2: v1's flag cloth (flagShape, flagFlight, flagVertex copied) flown from the local wind at 5 Hz (pure)
  sim/solids.js        L3: v1's solid show props (src/fireworks/solids.js copied three-free) in the boat's tick (pure)
  render/raceLines.js  Regatta: the on-water lines (one pipeline, one instanced draw; nothing off a race)
  render/raceProps.js  Regatta: the committee boat, the pin, the marks, the lite rival (one pipeline)
  regatta/*            Regatta (BACKLOG-v2 #12): its own chunk (§ Regatta)
  render/sky.js        the atmosphere: 3 LUTs, the sky draw; M2: the aerial-perspective froxels and the frame's light record
  render/terrain.js    M2: the grids as textures, the upload slices and swaps, the bake (normal + albedo maps), the draw, the
                       water's mirror of the land, the GPU height probe
  render/water.js      the FFT sea (M1); M2: blended over the bed, the depth, the deep body, the soft shore, the mirrored land;
                       M5c: the footprint's roughness, the averaged mirror, the rough Fresnel, v1's Beckmann glint
  render/water-aa.js   M5c: the specular anti-aliasing maths (JS, tested) and the same formulas as WGSL
  render/shaders.js    the shared WGSL head, the fullscreen triangle (reversed z), the tonemap
  sim/clouds.js        M5a: the deck's numbers (v1's CLOUD_DECK), the key's direction mapping, the amortised bake schedule,
                       the drift from the shared wind, the params record, the JS twins of the WGSL noise and density (pure)
  render/forest.js     M5b: the cards' bake (T5: the trees' meshes drawn → a 12 × 3-frame atlas a layer, its mips), the place and scatter, the needle light
                       passes, the per-frame cull (indirect arguments) and the one indirect draw
  forest/format.js     M5b: the packed lidar files (encode for the tool, decode for the worker; pure)
  forest/lod.js        M5b: the ranges, the keep rule, the per-frame tile pick (pure)
  forest/scatter.js    M5b: the rules' trees round the box: the WGSL and its JS twin (pure)
  forest/worker.js     M5b: fetch → inflate → decode a forest file, off the main thread
  forest/trees.js      T5: the seven trees as meshes (Cold Smoke's boughs and sprays, MIT; pure)
  render/clouds.js     M5a: the noise and weather bakes (at load), the key march (a band of rows a frame), the GPU side;
                       the blended layer's mip chain, re-made each frame (the far water's shimmer fix)
  render/cloud-read.js M5a: the readers every scene shader gets through the sky-read group (cloudAt, cloudDistKm, skyWithClouds;
                       cloudAtUEGrad: the key filtered over a footprint, for the water's mirror)
  render/bed.js        M5c: v1's clarity bed in WGSL for the terrain pass (sand, ripples, cobbles, boulders, caustics, the
                       refraction wobble off the FFT slopes, the shelf's look); the numbers from src/waters/clarity-optics.js
  render/ground.js     M5c: the ground photo's tiles and v1's detail set on the GPU: the array textures, the per-tile mip bake,
                       the worker-fed queue the frame pumps (≤ 1 MB a frame), prime() for captures
  render/shadow.js     M5c: the terrain's sun shadow map (2048², ±2.5 km round the eye's look point): a second CDLOD selection
                       against the light's box, drawn every 4th live frame or on a sun or box move; shadow-read.js the PCF read
  render/rocks.js      M5c: the shore and island boulders: the GPU scatter (one candidate per 8 m cell, packed), the cull, one
                       indirect instanced draw of v1's lumped icosahedron, lit as the terrain and seen through the water column
  terrain/photo.js     M5c: the tile sets (bay 2 m + region 32 m; phone 4 m + 64 m), the tiles, the stream order (pure)
  terrain/rocks-rules.js  M5c: the boulders' rules (v1's shore band and the slopes' rocks): the WGSL and its JS twin (pure)
  terrain/ground-worker.js  M5c: fetch + decode a WebP (a tile or a detail strip) off the main thread
  sim/boat.js          M3: v1's sloop on the shared sim: BoatPhysics (src/sim/boat.js), the hull float and ride, the bottom,
                       the follow camera, Sail's hands (the helm + pilot, the sheet + winch), the capture's settle, v1's film contract
  sim/controls.js      M3: the two verbs from v1's keys (A/D ←/→, W/S ↑/↓) and the phone's hands; the orbit and zoom maps (pure)
  ui/flat.js C: a touch phone's flat controls in place of the 3D cockpit (corner quarters Tack and Auto, the steer and sheet arcs, ⋯, the lever, the drawer and Pro panel, the dials, the camera's ease back); flatLayout() pure
  ui/touch.js          the hands on the canvas: v1's one-finger tiller and rope (#2; on a phone with the flat controls one finger looks instead), two fingers look and pinch, the mouse's drag and wheel; M3's helm strip (a tablet only now)
  render/boat/hullShape.js  M3: v1's hull lines and deck (blender/m1_hull.py) in JS: the sheer, the sections, the deck, the stations
  render/boat/mesh.js  M3: the hull and foils as typed arrays, v1's spars (src/boat/spars.js), the sail grids filled from v1's
                       rig.js surfaces, the line set (a subset of v1's lines.js) and the wires as one ribbon buffer (pure)
  render/boat.js       M3: the GPU side: 3 draw pipelines (solid, cloth, ribbon), 2 shadow pipelines, the 2048² shadow map,
                       the Model records (one 256 B slot a part, dynamic offset), the per-frame update and the draws;
                       M3b: the swap's dissolve, the wheel, rudder and traveller slots, the glass draw after the sky
  engine/gltf.js       M3b: the GLB reader (container, accessors incl. KHR_mesh_quantization, node transforms, materials, images)
  render/boat/models.js  M3b: v1's boat from the GLBs: sockets, v1's material rules, the LOD sets, one merged vertex set (pure)
  render/boat/worker.js  M3b: fetch + gunzip + parse + build + decode the images (with mips), off the main thread
  render/boatModels.js M3b: the GLB pipelines (opaque, glass, cabin, portal), v1's materials in WGSL, the sliced upload
  sim/shots.js         M3b: v1's close shots in the hull frame (captures)
  sim/moon.js          M5e: the moon (a compact Meeus ephemeris: topocentric altitude and azimuth within 1° of astronomy-engine,
                       the lit fraction within 0.02) and the J2000 → world rotation for the stars and the Milky Way (pure, tested)
  sim/night.js         M5e: the night's levels from the sun and the moon (v1's fades: src/core/milkyway-math.js), the lights' and
                       stars' decoders, the boat's nav lights in the world (COLREGs sectors: src/boat/details.js), the look's numbers
  render/night-read.js M5e: the night record and the Milky Way's read (the sky draw's group 2; the water's draw group, bindings 4–7)
  render/night.js      M5e: the Milky Way's maps, the stars (one instanced draw of soft points, v1's twinkle), the glows (the towns'
                       lights, the boat's nav lights: camera-facing quads with a least size on screen); the data streamed after the first frame
  sim/storm.js         M5e: v1's thunderstorm sim (src/sim/weather/stormSim.js) on v2's clock, eye and sun; the uniform rows; the cell's
                       shade of the sun at the eye (v1's shadowAt); the water's wind under the outflow; the bolt's channel (v1's boltPaths)
  render/storm.js      M5e: the rain (v1's streaks in a box round the camera, placed in the vertex stage) and the bolts (the channel as
                       camera-facing ribbons: a white-violet core and a wide glow, additive)
  engine/audio.js      M5e: the page's AudioContext, made in the first gesture (the thunder: v1's src/weather/stormAudio.js, synthesised); started in the capture phase (step 3: the home card's ENTER starts the sound); iOS (fix/v2-ios-audio): every touchend, pointerup, click or key resumes it until it runs (v1's UNLOCKERS), asks for the playback session and unlocks the music's media elements
  audio/elementPool.js fix/v2-ios-audio: the music's <audio> elements, unlocked in a tap (iOS plays an element outside a gesture only once it has played inside one) and lent to src/audioFormat.js sourceFor
  audio/beds.js        step 3 (hybrid): the wind in code, one Web Audio graph built once; the way out every bed shares (the
                       compressor, its make-up taken out, the soft ceiling), v1's sound and effects switches, the fade
  audio/recorded.js    step 3 (hybrid): the hull and water, the sails, the load and the controls as v1's recordings on v1's own
                       engines (src/boatAudio.js, src/sfx.js) and the lake's lap and rain loops, loaded after the first gesture
  audio/bedsMix.js     step 3: one frame of sim state → the targets (stepWind: the wind's, the lake loops' gains; pure)
  audio/noise.js       step 3: the noise material (white, pink, lfo, patter), ported from Cold Smoke, MIT (pure)
  audio/bedsLive.js    step 3: the beds on a live page (the page's context after the first gesture, the files, Settings, the hide fade)
  audio/offline.js     step 3: the beds rendered offline (the WAV test, the A/B clips, the film's sound), the meter, WAV bytes
  audio/script.js      step 3: the scripted 60 s sail the offline checks render (calm, gusts, a tack, a luff, rain)
  render/boat/instruments.js  M4: v1's compass card and pedestal pod without three: the 2D-canvas faces, the redraw rule, the
                       speed's damping, the night set (src/boat/nightLight.js), the card's and the pod's hull-frame matrices (pure)
  sim/wake.js          the wake's track (v1's impulses on src/sim/boat/wakePhysics.js), its packing, the maps' JS twins (pure)
  sim/spray.js         v1's bow spray flight (src/boat/spray.js's update, three-free; v1's seeded generator) (pure)
  render/wake.js       the Kelvin and foam maps (2 compute dispatches in water-sim), the water's wake reads (WGSL), the spray's draw
  render/spume.js      v1's spume (src/wind-cues.js): the lanes, the breaking threshold from the readback, the WGSL the water reads;
                       its JS twins (§ The spume)
  render/windWater.js  audit W1–W3: v1's gust patches, whitecaps and lanes on the local wind (WGSL + JS twins; § The wind on the water)
  sim/windTex.js       audit W1–W3: v1's wind texture for the water, filled in sim/wind-worker.js on a live page, in place in a capture
  sim/gust.js          audit W4: v1's gust payoff (the snap, the rush, the camera's lean)
  sim/seamanship.js    #8, #14: v1's seamanship without three: the engine's lever and the tackle's rules around B.step, the exhaust's clots,
                       the anchor's drop and the rode, the chain's speed, the arrival's wide shot (pure)
  ui/seamanship.js     #8, #14: its live half: v1's keys, the dock rows the cockpit reads (ANCHOR, MOOR, DAWN), the skipper's lines, the veil
  render/exhaust.js    #14: the wet exhaust's soft discs, blended after the spray
  audio/engine.js      #14, #8: v1's engineAudio (the engine and the chain) on the music core's effects bus (v1's); renderEngine for the film's sound
  living/kayaks.js     the living lake's kayaks: the plug-in (the shore grids and the asset streamed, the fleet made, the pair laid)
  sim/kayaks.js        v1's fleet (src/kayaks/fleet.js) without three: plan, routes, minds, contact, tiers, the first pair (pure)
  sim/lake.js          v1's lake terrain object (src/sim/lake.js buildLakeOn) on v2's heights + v1's island and bay shore grids
  render/kayaks.js     the kayaks' GPU side: 'kayak-skin' (full + mid, palettes of rigid slots), 'kayak-far' (v1's impostor)
  render/kayak/asset.js · clip.js   the baked asset (KYB1) and v1's strokes at run time (the gaits' blend, the pace, the surge)
  render/boatInstruments.js  M4: their GPU side: one 2-layer texture (copyExternalImageToTexture on a redraw), the card and the
                       pod's face ('boat-instrument'), the bezel and the lubber line on the boat's solid pipeline; #35: v1's
                       VHF set (its 320 × 184 face on the same pipeline, its body and strap on the solid one, `vhfLocal`)
```
