# v2 notes: Overview and milestone history (the opening text of the old README)

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## Velia v2 · the engine (M3: the sloop floats and sails; M3b: v1's boat models; M4: v1's Sail UI and the 3D cockpit; M5a: the clouds; M5b: the forest; M5c: the clear shallows and the island ground; M5d: the navy past the shelf, the island's granite, the shrubs; M5e: the night and the storm; the wake and the bow spray)

Backlog: (one backlog since 2026-11-14; "BACKLOG-v2 #N" below is its row #N, the old rows).

Velia on our own raw-WebGPU engine, no three.js. Plan:; costs it answers:
; the techniques:. M0 was the foundation (the
engine core, the harness, the guard); M1 the sky (atmosphere LUTs) and Ultra-Water's FFT sea on the shared sun and wind;
M2 put the real Lake Tahoe under them: v1's elevation grids streamed onto the GPU, the lake bed seen through Tahoe's
clear water, the land mirrored in it, the haze on far ridges, and an exposure set for sunlit ground. **M3 is the first
playable v2:** v1's sloop (its physics from `src/sim/`, its hull and sail shapes from v1's own procedural code) floats on
the FFT water through the readback ring, sails on the shared wind over the terrain, and answers v1's keys, a phone's
on-screen helm and sheet, and a drag on the water round v1's follow camera. **M3b makes it v1's boat, detail for detail:**
v1's four Blender GLBs (the hull and deck, the cockpit with the dodger, the bimini's boot, the cushions and the cabin, the
deck hardware with the pulpits, stanchions and lifelines, the wheel) read by v2's own GLB reader, placed, coloured and
animated as v1's page does it, with v1's procedural materials ported to WGSL; streamed after the first frame (§ v1's models).
