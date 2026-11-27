# v2 notes: The boat, v1's models, parity with v1, motion, engine and ground tackle

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## The boat (M3)
**The sim** (`v2/sim/boat.js`): v1's `BoatPhysics` built as the sloop's craft builds it, stepped on v1's fixed-step
accumulator at 1/60 s from the clock's 1/120 s steps (whole ticks, the remainder carried), its env v1's: `windAt` from the
WindField, `sea` the float's last reading (the surge, the slam), `waveAt` from the readback surface, `ext`/`post` the
bottom (`src/sim/boat/ground.js` over `terrain.field.height`: the keel meets the real bed and shore). The hull float
(`BoatOnWater` → `HullFloat`, 21 waterplane patches) reads `water.heightAt(x, z)` = the drawn surface's readback (the
85 m cascade's 21 m window and the 600 m's 150 m window now sit on the boat, the mesh on the eye); heave, pitch and the
waves' roll go onto the drawn pose as v1's `ride.step`. The wind is v1's `WindField` on the day's base at the scene's
hour (`?wind=` its level, `?windspeed/?winddir` a steady base), `setTerrain` over `terrain.field.height` (it asks for a
height function only; the wind's `roughMul` has no cover or shore distance here, as v1 has when those grids are absent).
The hands follow `src/controllers/sail.js`: the helm at `helmTau` while a key is down, let go and the pilot
(`Helm.toHeading`, `pilotHeading`) holds the course; the sheet is `HandSheets` (it stays where it is left; the start's
ease until the first pull), the winch slower under load (`winchRate`). Start: v1's Sail start (1200, −1050), 251°,
2.75 m/s; `?start=x,z`, `?heading=`, `?settle=` as v1's capture rows.

**The drawing** (`v2/render/boat.js`, `boat/mesh.js`, `boat/hullShape.js`): the hull and deck are v1's Blender build's
own lines (`blender/m1_hull.py`: the sheer, the plan, the superellipse bilge, the raked transom, the cambered deck with
the T cockpit well and the trunk) evaluated in JS at 81 stations, the band colours from the art bible (antifouling, the
boot band, the tide line, the two pinstripes, white topsides, non-skid), a fin keel and a spade rudder; the mast, boom,
spreaders and fittings are v1's `spars.js` arrays as they are; the sails are v1's `rig.js` surfaces (`mainPoint`,
`jibPoint`: the camber, the twist, the shrouds the cloth bears on) on v1's grids (40 × 64, 32 × 56), refilled on the CPU
only when the trim moves, the luff flutter on the GPU (v1's wave). The cloth shader is v1's `sails.js` in WGSL: cream
Dacron, the crosscut seams, tapes, corner patches and batten pockets as layers, the sun through the cloth from behind
(τ 0.22 × 0.45 per layer), a two-sided normal with the camber amplified. The lines and the standing rigging are
screen-space ribbons at least a pixel wide, their alpha the true coverage (v1's `lines.js` rule), under MSAA 4. Every
surface is lit by the M1 sun through the transmittance LUT, the sky's irradiance by the hemisphere it sees plus the
sky's own radiance in its facing direction for a sideways surface (a sail edge-on to the sun stays cream), the lake's
upwelling, the boat's own shadow map (4-tap PCF) and the aerial perspective. **Below the hull's own waterline nothing
is drawn** (the solid fragment shader discards it, a 2 cm blend into the water column's colour at the line): v1's water
is opaque and hides everything under it; v2's surface blends only its Fresnel share over what is below, assuming that
was drawn through the water column (the terrain's bed), so a hull drawn plainly showed its keel and rudder as a dark fin
wherever the lake is under 40 m deep, and a hull-coloured column still read darker than the sand-lit water beside it.
Draw order: terrain → boat → water → sky. **Not in M3:** the boat in the water's mirror (the land only), the wake and the bow spray
(since added: § The wake and the spray), the cockpit's interior and its 3D controls, the helmsman, the rudder's turn (M4+).

**The hands and the camera:** `v2/sim/controls.js` + `v2/ui/touch.js`: A/D or ←/→ steer, W/S or ↑/↓ the sheets (v1's
keys, held); a phone (a coarse pointer, or `?touch=1`) gets a helm strip (drag the knob from where the finger lands;
let go and the pilot holds) and IN / EASE buttons, navy and cream, above the phone's own swipe band; a drag on the water
orbits v1's follow camera, the wheel zooms; an upright phone uses v1's portrait lead. `?cam=` or `?campos=` pins a
viewpoint instead (the M2 goldens).

## v1's models (M3b)
The owner on M3 (2026-11-13): "The boat compared to v1 missing lots of details." v2 now draws v1's own GLBs.

**Reader** (`engine/gltf.js`, ≈ 6 KB source): the GLB container, accessors of every component type (normalized integers
dequantized; strided views), `KHR_mesh_quantization`, node TRS / matrices composed down the tree, the materials' PBR factors and
texture slots (`KHR_materials_clearcoat`, `KHR_materials_sheen`, `EXT_texture_webp`), the images as bytes. An unknown required
extension is refused. No decoder dependency.

**Compression** (`tools/build/glb-pack.mjs`, node only): still standard glTF 2.0. Positions as normalized int16 in a per-mesh
cube (the cube's offset and uniform scale on a new `#q` child node that carries the mesh, first among the children, so every
named node keeps its frame and the draw order holds); normals int8; COLOR_0 uint8; texture coordinates float, and only where a
material reads them (a texture, or v1's procedural teak); COLOR_1 dropped (v1's materials read COLOR_0 only: the cockpit's baked
AO there never reached v1's screen). Then gzip -9: 3.11 MB → 0.77 MB. Meshopt would reach ≈ 0.4–0.5 MB but needs a decoder;
quantization + the browser's own `DecompressionStream` needs none. A host that already sends it with Content-Encoding gzip
(vite preview does) is detected by the magic bytes.

**The build** (`render/boat/models.js`, pure; in a worker): v1's sockets (`src/boat/Boat.js`: hull and cockpit at the heel pivot,
the hardware at `[0, HULL.freeboard, 0]`, the stowed anchor moved to `HULL.anchorPin`, the wheel at the profile's `sockets.wheel`
turning `−rudderAngle × 4` about z, the traveller car sliding `x0 + travellerCarX(boom)` on the crowned track `trackY`), v1's
throttle stand-in (Boat.js's placeholder pod, lever and knob at `HULL.throttle`), and v1's material rules: `hullMaterials.js`
(the suffix stripped; gelcoat, non-skid, antifouling, stainless, teak, acrylic, aluminium, near_chrome, gelcoat_plain swapped;
a white-COLOR_0 gelcoat or non-skid scaled to 0.68 / 0.56), `cockpitLook.js` (the turned wheel stainless; the clear dodger vinyl
at 10 %; the dodger's side panels split by face normal and centre into smoked vinyl at 22 %; the cabin unlit behind its depth-only
portal), `canvas.js` (the variant's canvas and trim colours faded 14 % toward warm grey on the dodger, cushions, the bimini's boot,
the piping; the shade's tint). Everything merges into one vertex set (position, normal, uv, colour, material id) with index
ranges: cabin, portal, always, detail (v1's small-parts LOD: hidden past 24 ± 1 m), near / far (the cockpit's LOD at 15 m ± 5 %),
wheel, traveller, glass. 85.8 k triangles, 84 k vertices, 36 materials, 7 images.

**The shading** (`render/boatModels.js`): v1's TSL materials ported to WGSL on a hashed gradient noise (an integer hash, not
sin(), so 70 cycles a metre keep their pattern): the gelcoat's ivory, wear, chalk, yellowing by the waterline and the transom,
the scum line, the tannin streaks under the stanchions, the fender scuffs, the hull-deck joint grime, the print-through in the
clear coat; the non-skid's diamonds with v1's ≈ 2 px fade into roughness; the mottled antifouling; the tea-stained stainless; the
laid teak from the UVs. The glTF materials as they are: base colour × COLOR_0 × the base texture (an sRGB array), roughness and
metal × their texture, the normal map on a cotangent frame from the derivatives, the clear coat as a second lobe. Two texture
arrays at 1024 × 512 with full mips (colour 4 layers, data 3), the mips made by `createImageBitmap` resizes in the worker.
Two-sided (cull none, the normal turned to the camera). The waterline rule holds (nothing drawn below the hull frame's y = −2 cm);
every opaque part casts into the boat's 2048² shadow map (the LOD's choice, the wheel, the car).

**Streaming and the swap:** a live page draws M3's procedural hull in its first frame (same Blender lines, so the same
silhouette); `models.start()` begins with the first frame; the worker returns the arrays and bitmaps transferred; each frame then
uploads one ≤ 1 MB slice or one image with its mips (never in a frame that pumps the terrain). When all is resident, v1's models
dissolve in over 0.5 s with a per-pixel screen door while the M3 hull dissolves out with the complementary mask (both drawn for
those 30 frames), so the detail arrives without a pop and without a half-built boat. A capture (`?headless`) loads everything
before its first frame and starts with the models (deterministic: `goldens:v2 --twice` 0 px). Pipelines: 4 more, built at load
(24 in all before the clouds, 27 with them), none after the first frame. If the models fail, the M3 hull stays (the error in `__velia.errors`).

**The sails' cloth (M3b, owner 2026-11-13 on cmp-wind21: "v2 sail material, light reflection, shade pattern are more like
metal, while V1 give you the fabric feel"):** the cloth shader is now v1's `sails.js` clothMaterial term for term:
MeshStandard at roughness 0.72, metal 0 (a full GGX lobe at f0 0.04 plus the sky's blurred mirror; Lambert diffuse); v1's
shading normal (the camber amplified 0.6, a 1.6 mm plain weave faded under a pixel, soft 0.2–0.5 m crinkles along v1's
`tangentU` (now filled by `fillSail`), the flutter's slope along the chord); the sun through the cloth on the geometry's normal
(v1's normalWorld, not the camber-shaded one: that put a hard dark band across every panel), τ 0.22 × 0.45 per layer; v1's
layers (seams, tapes, patches, battens, the reef bands and reef points) and the furling jib's UV strip on the leech and foot.
v1 lights the cloth with the atmosphere light's indirect sky irradiance and the sky environment map besides; v2 adds both,
and then puts the cloth's sky light where v1 shows it (`CLOTH_AMB` k 2.3, pulled 45 % toward neutral): v1's AgX tone map
lifts and desaturates a sail's shade side that v2's ACES fit left dark and blue. Mid-panel samples, sRGB, v1 / v2 before /
v2 after: 21 kn jib 168,176,184 / 153,159,161 / 192,197,200; 21 kn main (shade side) 159,172,184 / 74,85,107 / 150,159,174;
follow 13:00 155,169,181 / 91,107,123 / 136,149,162; back-lit 16:00 183,184,188 / 140,147,152 / 181,187,192; 18:45
188,179,172 / 192,189,179 / 215,214,211 (v2's dusk exposure adaptation lifts the whole frame; the cloth reads cooler than v1's).
**#37 (2026-11-14): the lift fades where the sun shines through.** Measured by switching each term off on both apps (v1's
`transmit` 0 in a scratch copy; v2's terms in place): v1's back-lit cloth is mostly the sun through it (the 18:45 follow:
196,186,178 with it, 108,127,142 without; the 21 kn jib 181,183,186 / 122,148,166), while v2's `CLOTH_AMB` lift made the
sky term carry it (v2's 18:45 sky term alone 187,197,201: cool and bright). The lift belongs to a dark shade side, so it
now fades with the back light: k × (1 − 0.95 · back^1.25) (`CLOTH_AMB.back`). Noon's sunlit side has back 0 and is
unchanged. Sail-mask medians (each app's own mask: v2's `?boatdebug=1` frame, v1's sails hidden in place), v1 / v2 before /
v2 after: 18:45 follow 196,186,178 / 219,218,214 / 197,186,164; 21 kn jib 170,176,184 / 180,186,193 / 173,180,183 (by fifths of its height,
top to foot, +26 +14 +10 +7 +5 before, +17 +6 +3 +2 −1 after); 21 kn main (shade side) 163,173,183 / 157,166,179 / 153,162,175; follow 13:00 (sunlit) 225,220,216 /
211,210,208 / 211,210,208. No exposure or grade change; no cost (one `pow` a cloth pixel).

**Still different from v1's boat:** v1's helmsman (`src/boat/crew.js`, seen past 25 m) is not drawn (v2 has its own crew: § The crew); the burgee, telltales and nav
lights (`details-mesh.js`), the bulkhead and the binoculars are not ported; the canvas's sheen lobe, the wheel's anisotropy and three's environment map are approximated by the
sky's mirror and a GGX lobe; v1's teak "trodden" and stainless noise read the hardware's own frame (v2 reads the hull frame: a
0.95 m shift in a random pattern); the rudder and keel are M3's foils (v1's are box stand-ins; both under the water, never drawn).
v1's dropboards and the smoked dome end opaque in v1 (applyHullMaterials swaps cockpitLook's transparent clones back to acrylic),
and v2 matches that.

### The race look (2026-11-25: render/boat/models.js, render/boatModels.js, render/boat.js, render/boat/mesh.js, render/sailArt.js)
The owner: "the sail boat itself: make it more appealing and more race boat vibe". The hull, rig and sail numbers are untouched (the
physics and the GLB geometry are the same); the look is paint, cloth and colour.

**The hull livery** (`boat/models.js hullSkin`, `KIND.livery`; `boatModels.js livery()`): hull.glb's gelcoat is split at build time into
the deck and the hull's own skin (a triangle whose centroid lies under the sheer line plus 3 cm, side-facing, outward or the transom:
the trunk sides sit over the sheer, the well walls face inward, the companionway face is forward of the stern), the skin on its own
material `hull_livery` (a vertex shared with the deck is written twice: the material is flat per triangle) with its depth under the
Blender build's own sheer line (`hullShape.js sheer`) baked into uv.x, so the stripes follow the sheer exactly. The worker needs
`HULL.loa, lwl, beam, transomZ` for that (main.js passes them; a partial dims throws: it once made every face "skin" and the sheer NaN).
The shader paints v1's gelcoat first, then on the skin's side faces: a cream boot top 2.8–11.8 cm over the waterline (the antifouling
ends at 3 cm), the topsides in the boat's colour from there to the sheer (`M.p.w`, the tint path the rivals already had: the player's
`PLAYER_HULL` #1E2A4D on her hull and model slots, `pose.hullTint` overrides it; 0 keeps the white gelcoat with its weathering: the
Regatta fleet stays white, the owner's 2026-11-18 ruling), at a race hull's gloss (rough 0.10, coat 0.78) and without the cruiser's
yellowing, scum, streaks and scuffs; a gold cove line 30 mm wide 19 cm under the sheer and a cream pinstripe 11 mm at 24.8 cm; every
edge 6 mm soft. The M3 procedural hull (the first live frame, the mirrors) takes the same tint through `topsides()` from 0.118 up to
0.90 (it has no sheer datum: its trunk starts over 0.93); the lite boats' band starts at the boot top too. The transom name is gold
leaf with a navy shadow (the navy vinyl vanished on the navy hull). Anchored and busy-lake boats (`tint`) take the same livery.

**The sails:** the player's cloth is a silver laminate (`sailArt.js CLOTH_KIND.silver`, linear 0.40, 0.425, 0.46; τ 0.10; rough 0.40;
the grey's dark scrim threads every 9 cm), the number navy, the rose in the compass gold; the jib takes the boat's cloth as well (its
record carries the same code, no print; every rival's jib matches her main now). Laminates get tri-radial seams: tapes fanning from
the clew over the lower sail and from the head above (12 mm at 3 m, a soft pixel line at the follow camera, gone past 5 cm a pixel),
and a graphite UV strip in place of the canvas one. **The spars** are carbon (`mesh.js carbonSpars`: v1's aluminium vertex colour
→ a clear-coated near-black dielectric, rough 0.30; the fittings, track, steel and boots keep theirs; v2 only, `src/boat/spars.js`
untouched). **The lines:** the jib sheets and the jib halyard navy, the main halyard brass, the topping lift graphite, the sheets cream
(`mesh.js ROPE`). Not changed: the hull's lines (no plumb bow: the GLB and the physics share the shape), the deck's cream, the
dodger and the lazy bag (the owner's cockpit).

### The instruments (M4: render/boat/instruments.js, render/boatInstruments.js)
v1's `src/boat/instruments.js` on the world boat: the compass card (a 0.072 m disc at HULL (0, 1.305, 2.45), canvas north
held on world north: three's `rotation.x = −90°`, `rotation.z = heading`) with the lubber line on its aft edge, and the
0.12 × 0.06 m pod on the pedestal guard's rail at (0, 1.335, 2.33), leaning 25°, in its 22 mm bezel: the apparent wind's
needle and the boat's speed to a tenth of a knot. The faces are v1's canvas code unchanged (cream on navy; Jost falls back
to Helvetica Neue: the v2 page loads no Jost, and a late font load would break the captures' determinism), redrawn at most
10× a second and only when the needle moves 1.5° or the damped speed 0.08 kn (1 s lag, 2.5 s in the groove), then uploaded
with their mips (canvas downscales). The card is v1's MeshStandard (roughness 0.85) with its red night emissive; the pod's
face v1's MeshBasic × `faceGain` (nightLight.js), the night set by night; v2's exposure compensation is the exposure factor
at a high sun over the frame's. The face's level is v1's scene unit in v2's scale × `FACE_ONSCREEN` 3.0 (the pedestal shot:
numeral peak sRGB 229 vs v1's 240). Drawn after v1's models once the swap is done (they carry the pedestal), in three more
Model slots; no shadow cast. **As v1:** the dome is opaque acrylic, so the card is drawn but hidden by it (v1's too); the
lubber line on the aft edge sits over the reciprocal of the heading (v1's plain card, not a front-reading one); the pro
trend chevron is off (v1's `pro` setting has no v2 row). Cost: +4 calls, +0.03 ms on the scene pass at 2560 × 1600 in the
pedestal shot (2.458 vs 2.428 ms median, two runs each).

**The VHF set (#35, 2026-11-14).** v1's `src/boat/vhf.js` createVhf on the same path, a fourth slot (`SLOT.vhf`): the set at
HULL (0.172, 1.268, 2.322) on the pedestal guard, starboard of the pod, tilted 22° up and aft toward the helm (v1's
`rotation.x = −22°`: `vhfLocal`), 0.112 × 0.064 × 0.05 m. The body (0x1b1e22, roughness 0.55) and the steel strap under it
(0x9aa0a6, metal 0.9, roughness 0.35) are two boxes in the instruments' solid mesh, one draw on `boat-solid`; the face is a
0.1075 × 0.0589 m quad 0.6 mm proud of the body on `boat-instrument` (kind 1: v1's MeshBasic × `faceGain`), with its own
320 × 184 texture (v1's canvas size, full mips by canvas downscales) and bind group on the same layout. The face is v1's own
drawing: `src/boat/vhfFace.js` (VHF, lcdView, drawFace) is the set's pure half, moved out of vhf.js unchanged and re-exported
there (a seam; v1's behaviour and goldens unchanged). **The LCD** is driven by v2's radio (`ui/captain.js createLcd`: v1's
captainTools.update tail and createVhf().update's gate): the channel (16, WX 1), RX while the radio speaks or chatters, and
the spoken words as a 14-character window that follows the voice's token (`plan.charAt`), re-made at most 10 Hz (an RX change at
once) and only redrawn when the view changes (`captain.lcd.n`; main.js passes it to `boat.update`). A capture (no captain) shows
v1's idle face, 16. Night: v1's set has no night palette; the face holds its on-screen level × 0.16 (`faceGain`), as v1's.
**The face's level:** v1's AgX lifts the pale LCD and the grey face more than v2's ACES at the pod's unit, so the face takes
`VHF_FACE_K` 2.2 × the pod's gain: the LCD's glass in the close-up at 13:00 reads sRGB 228/231/217 vs v1's 233/234/220 (it was
194/201/176 at the pod's gain); the grey face stays darker than v1's (27/32/39 vs 48/63/74: the toe of the curve), and at
21:36 the LCD reads 123/132/102 vs v1's 160/164/146. **Placement checked against v1's own three model** (`v2/tests/vhf-set.test.mjs`:
the face's four corners and both boxes' sixteen corners within 1e-6 m in the HULL frame, the materials) and frame for frame on
the LCD (the same radio state through v1's gate and v2's: the same key every frame). `?shot=vhf` is a v2-only close shot
(`sim/shots.js`). **Cost:** +2 draws (the face, the boxes), 0 pipelines (`boat-instrument` and `boat-solid` exist), one
320 × 184 texture (≈ 315 kB with mips); a redraw (drawFace + 9 mip levels uploaded) 0.3 ms CPU median, 0.6 ms max, at most 10 a second while the words scroll, none while idle. GPU, ABBA in place (`tools/v2-ab-vhf.mjs`, the draws
switched off and on in one page, 5 rounds × 90 frames, the median of on − off; M5 Pro, headless Chrome, 2026-11-14): the scene pass (where the draws are) +0.0035 ms in the helm view at
2560 × 1600 (9 rounds × 120 frames; +0.0125 in a first 5-round run), −0.0175 ms in the set's close-up at 2560 × 1600 (the set
filling the frame: noise), −0.0025 ms on the phone path (L2, 390 × 844 at 3×; +0.0185 in the first run). The frame totals
moved −0.07 to +0.11 ms between runs, other passes' noise on a shared GPU. All under the 0.05 ms budget.
Stills and the clip: `tools/v2-vhf-shots.mjs`, `tools/v2-vhf-clip.mjs` (renders/v2-vhf-set/). **Not ported:** v1's helmPick
click on the set (it asks for the forecast; v2 has no helm pick yet: O and the Pro panel do it).

## The crew (2026-11-26: render/boat/crew.js, render/boatCrew.js, living/crew.js)

A helmsman and one crew on the player's boat, the kayakers' figure (render/figureRig.js) on their skin pipeline: two indexed draws,
posed in the HULL frame and carried by the hull's matrix (`boat.crewFrame`), so they heel, pitch and heave with her. Every mode the
boat sails (Sail, Cruise, Regatta); the rivals and the lake's boats have none.
- **Balance is dynamic** (round 2, 2026-11-27): each chest is an actively balanced pendulum on its hips. Its lean in the world,
  across and fore-and-aft, is a spring-damper (`BAL`: helmsman ω 4.6 rad/s, ζ 0.42; crew ω 3.8, ζ 0.5) toward the share of the heel
  and pitch a sailor takes out (helmsman 78 % / 60 %, seated crew 50 % / 40 %), pushed by what the hips feel: the roll's
  acceleration, a turn's lateral pull (u × yaw rate), the surge. So the chest lags a roll, catches up, overshoots a little and
  settles. The pelvis takes a share of the chest's lean against the boat (helmsman 45 %, seated 15 %: her hips ride the seat) and
  the spine bends over three segments between (render/figureRig.js `pelvisUp`); the head holds the horizon on a faster, better
  damped loop (ω 8, ζ 0.75; `headUp`); a standing helmsman's knees take the heave (ω 7). Idle life: breathing (1.1° at 4.3 s), a
  weight shift every 4.7–5.9 s, a glance at the sails or under the boom. All deterministic (`createBoatCrew({ idle: false })` for
  clean steps in tests).
- **The helmsman** stands behind the wheel, stance wide (±0.22 m), knees flexed, his weight on the low foot (the hips 7 cm to
  leeward at 20° of heel), his hands on the rim where the wheel's turn (4 × the rudder) carries them; a hand that has followed it 40°
  lets go and grips again 18° short (0.32 s, one hand at a time; past 52° the rim slips through the holding hand). When she rolls
  (≥ 4–18°/s) he firms on the wheel: pulled in 4 cm, lower, elbows out, leaning to it.
- **The crew** sits on the windward seat facing inboard and leans out over the coaming past 12–22° of windward heel (the aft hand on
  its top). When the drawn boom crosses (± 4°) she scrambles across in 2.4 s: the trailing hand pushes off the old seat, the body
  pitched forward low under the boom (ducking while it is within 28° of the centreline) with the weight leading toward the new side,
  the lead hand reaching for the new seat's edge, two long steps and a settling one (each foot lifted in its own window, never both
  up, never dragged), down onto the new seat with a small bounce (the landing kicks the body's own heave spring).
- **Hold on:** past 30° of heel, or a roll faster than 30°/s past 12° (a strike), both grip with effort: the crew's hands on the
  coaming top drawn in, elbows bent and out, her hips pulled toward it and the chest hunched to the grip, harder as she rolls; both
  take less of the heel out (they ride the boat's frame), then let go over 1.4 s once she is up.
- **Clocks:** the people move on the living clock (the kayakers' rule: real time live, not Sail's 2 ×); what they answer (the boom,
  the heel, the wheel) is the boat's. The first 1.5 s puts them straight on the right side (a start, a capture).
- **Hidden** in the Helm view (its blend past half), from an eye within 10 m of the hull (nearer than the Boat view's closest zoom, 1.5
  hull lengths: no faces up close), and past 160 m (lite: 90 m). Policy:
  `src/core/features.js crew` (full at L0–L1, the core LOD only at L2–L3, none on a phone; `?crew=0|1|lite`).
- **Cost** (M5 Pro, headless, the Boat view at 13:00): +40,238 triangles and +2 draws at full detail; GPU within the run-to-run noise
  (ABBA ×2 under a load average of 7–9); CPU ≈ 16 µs a frame (the balance, the choreography and two rig poses, node).
- **Checks:** `tests/boat-crew.test.mjs` (a roll step: the chest lags, overshoots ≤ 15 % of the roll and settles; the seated crew
  compensates 35–65 % of the heel, the helmsman 65–92 %; the side after a tack and a gybe, no joint through the boom, wheel, coaming, sole or hull,
  the two apart, feet stepped, hands on the turning rim, the hold, the hike, hidden in the Helm view, deterministic).

## The helm seen, and the lights at night (2026-11-26: boat/models.js, sim/wake.js, sim/night.js, render/night.js)

- **The wheel's turn:** the king spoke's sleeve (`WHEEL_MARK`: cream #EFE6D2 over 16° of the black leather rim's top (11 cm), a 23 mm tube;
  176 triangles in the wheel's own range) turns with the wheel (4 × the rudder), a light mark on the dark rim that reads its angle
  from the Boat view; the helmsman's hands carry the turn too (§ The crew).
- **The rudder:** M3's foil under the hull at `HULL.rudderZ`, turned about its stock (it was already drawn); a spade rudder 0.8 m
  forward of the transom, so from astern and above the hull hides it and from the quarter it shows through the water. No stock
  shows above the water on this hull (it rises inside her), so none is drawn.
- **The helm on the wake:** `WAKE.helmM` (1.2 m × sin(rudder) × the stamp's speed share) moves the transom's point now across the track
  toward the rudder's trailing edge (+ rudder: to port), so the strip's first metre bends with the helm (25°: ≈ 0.5 m); the older
  points never move and the Kelvin impulses are unchanged (point 0 carries none). `tests/wake-helm.test.mjs`.
- **The nav lights:** COLREGs' sectors as before (each sidelight 112.5° from dead ahead, the sternlight the 135° astern, a 2° fade)
  and on from sunset (`navLevel`); a fifth slot, the masthead (steaming) light on the mast's forward face 5.4 m above the step,
  white over the forward 225°, lit only while the engine drives her (`navMode`: on, in gear, turning; rule 25(e)); at anchor the
  all-round white alone. The halo (mode 1) keeps its hot core (smaller: r² × 400) and adds the lens' own colour in a soft ring
  (`NAV_HALO`: 0.09 HDR at full on, the hue squared, r² × 2.5) at a level the tone curve keeps: the red read pink and the green
  mint, both now read red and green. The glass boat's lights, the race marks and the riding lights share the halo. The lights'
  streaks on the water are the glows' own (`GLOW_STREAK.navGain`). `tests/nav-lights-sectors.test.mjs`.

## Parity with v1: the helm view's look, the game speed, the wind and the sea (2026-11-13)
The owner, playing local v2 beside v1: "In helm view, unlike v1, I can no longer use mouse to update view" and "under the
same wind, I feel the speed is slower and the tide is not big enough as v1" (the tide: the waves).

**The helm view's look** (`ui/touch.js`, `sim/controls.js` `routeLook`, `sim/boat.js` `camera()`, `ui/m4.js`): v2 sent every
drag to the follow camera, in both views, so the helm camera (v1's `src/sim/boat/helmCamera.js`, already shared) never got a
look. Now v1's deck (`src/deck/index.js`) exactly: a press is a click until it travels 5 px (v1's `Press`), then a drag that
carries its travel so far; any mouse button drags (no context menu); 0.005 rad/px round, 0.004 up; the follow camera takes the
look only in the follow view, the helm camera only in the helm view (also while the move to it runs); a held drag reaches the
camera as [0, 0], so the helm camera's spring back (3 s, then 1.2 s back to the bow; a look past 12° up stays) waits while a
hand is on it; v1's limits (±120°, −40° … +70°); the wheel zooms by v1's exp(deltaY × 0.001) (the follow camera's distance,
the helm view's lens 30–70°; it was v2's own clamped 0.0015); two fingers look and pinch (v1's `TwoFinger`,
`src/ui/touchLook.js`). The cockpit's controls are DOM above the canvas, so a press on the wheel or a winch never reaches the
look (v1's hit-testing). One finger on the water is v1's since #2 (§ The phone's controls: the tiller and the rope; it no
longer looks). Not ported: v1's 3D picking of the world boat's parts in the helm view (`helmPick`: the winches, the sheet's tail, the
wheel) and the click on the water that sets a course. Tests: `tests/helm-look.test.mjs`, `tests/pages/helmLook.page.mjs`.

**Why the boat felt slow:**
1. **The game speed.** v1's Sail runs its sim, the wind, the water and the scene clock at 2 × real time (`DEFAULT_SPEED`,
   `controllers/sail.js timeScale`; "no fast-forward in Day Sail"); v2 ran them at 1 ×, so the boat crossed the water and the
   waves moved at half v1's rate. Now `engine/flags.js GAME_SPEED` (`?speed=`, 2 by default): the live clock and the film
   clock advance dt × speed; the hands keep the frame's real dt (`B.step(simDt, hands, handDt)`, as v1); the level change blows
   in over `LEVEL_BLOW.overS` × speed of sim time; the stall cap scales with it. Captures step the clock themselves.
2. **The wind.** v2's WindField had the day and the level only; v1's Sail passes the first gust line ahead of the start, the
   readable shifts and the gust cells (`src/sail/options.js`). `sim/wind.js sailWindOptions` mirrors it (held to v1's own
   function by `tests/sea-parity.test.mjs`): the true wind at the boat rose from 4.8–20.5 kn to v1's 4.8–28.9 kn.

**Why the sea read small:** v2's one sim was a 20 km fetch's sea scaled to the bare fetch law and spread over the whole lake;
at the start, in Emerald Bay, it drew long, low swell (λ 8–23 m, steepness 0.023–0.052) where v1 draws its bay sim's short,
steep chop (λ 3.5–10 m, steepness 0.034–0.084) at 2.5 × the law. Now `sim/spectrum.js` ports v1's sea term for term:
v1's two FFT sims (the lake: a 25 km fetch, Hs gain 1.3 × the law at 25 km; the bay: 6 km, its own seed, 1.3 × the law at 6 km),
SEA_FEEL (× 1.3 lake, × 2.5 bay), the per-point mix by the fetch (m, beta, sB, the 600 m tile × m³, the 85 m × m^1.6, the 12 m
× the chop term, the open lake's swell through the mouth on a rough day), summed into one h0 table (two independent Gaussian
fields add, so the sum of the two tables is the two sims' sum in distribution) and weighted at the boat's point
(`seaWeights`, `seaTables`, `composeSea`). The wind it reads is v1's (`windField.base.speedMs`, its listener on the boat on a
live page, as `controllers/sail.js`); the fetch is traced upwind on v2's heights (`fetchAt`: within 1 % of v1's shore-map fetch
at the start, the bay, the mouth and the open lake; the shore bisected to 1 cm so it is continuous in the point, traced every 30th frame on a fixed cadence). The tables rebuild when the wind moves 0.5 m/s or 0.6°; between, the Hs law
and the fetch's weights re-compose (≈ 3 ms). The boat feels v1's sea through v1's filters: the float's Smith depth and the hull's
filter (`sim/surface.js weightsFor`, v1's per-tile k and fades, the bay's share per tile; v1 never reads the bay's 12 m tile on the
CPU); `waterFor.waveAt` is v1's unit normal. Not ported: the per-pixel mix (v2's whole lake carries the boat's sea; v1's open lake
past the mouth builds bigger in the distance), the depth damping (v1's long tile dies under 14 m, its chop under 2 m), BAY_SLOPE
(v1 draws the bay's slopes × 2: a shading term), v1's orbital current on the hull (`orbitAt`), the readback's carry-forward,
v1's short-wave fades 0.012 / 0.015 (v2 keeps 0.025 / 0.05: the M5c flicker ruling). (The day clock runs since 2026-11-13: § The
day clock and the key legend.)

**The numbers** (`tools/v2-sea-compare.mjs`, headless, v1's Sail start, seed 1, the 20 s settle, the film contract's helm on
the start heading; sail: 60 s of sim, means over 10–60 s, σ over the 60 s; sea: the boat held at the start, the drawn surface
40 s at the start point, Welch peak period; v1 / v2 before / v2 after):

| hour L | SOG kn | heel ° | TWS kn | pitch σ ° | heave σ cm | Hs m | λp m | Hs/λp |
|---|---|---|---|---|---|---|---|---|
| 13 L1 | 1.13 / 1.30 / 1.10 | 0.1 / 0.4 / 0.1 | 4.81 / 4.83 / 4.81 | 0.16 / 1.13 / 0.27 | 0.4 / 4.1 / 0.5 | 0.125 / 0.216 / 0.137 | 3.5 / 8.5 / 3.9 | .036 / .026 / .035 |
| 13 L2 | 5.93 / 4.54 / 5.82 | 14.6 / 8.4 / 14.6 | 10.05 / 8.51 / 10.11 | 0.36 / 1.63 / 0.61 | 1.1 / 7.6 / 2.0 | 0.195 / 0.394 / 0.225 | 5.7 / 12.5 / 5.2 | .034 / .031 / .043 |
| 13 L3 | 6.50 / 5.78 / 6.47 | 16.6 / 11.9 / 17.0 | 14.87 / 11.78 / 14.97 | 0.88 / 2.72 / 1.08 | 2.5 / 13.3 / 4.3 | 0.433 / 0.658 / 0.446 | 8.9 / 16.9 / 4.4 | .049 / .039 / .102 |
| 13 L4 | 6.29 / 5.99 / 6.36 | 21.3 / 17.3 / 21.6 | 21.24 / 15.29 / 21.33 | 1.44 / 3.03 / 1.75 | 4.4 / 17.8 / 6.4 | 0.654 / 1.094 / 0.492 | 10.2 / 23.1 / 12.2 | .064 / .047 / .041 |
| 16 L1 | 2.40 / 3.27 / 2.44 | 2.2 / 3.2 / 2.3 | 5.54 / 4.80 / 5.52 | 0.24 / 0.74 / 0.40 | 1.0 / 3.1 / 1.3 | 0.186 / 0.205 / 0.199 | 4.4 / 9.1 / 4.8 | .042 / .023 / .041 |
| 16 L2 | 5.80 / 4.68 / 5.92 | 10.3 / 8.4 / 10.6 | 9.57 / 7.31 / 9.60 | 0.44 / 1.59 / 0.84 | 1.3 / 6.7 / 3.2 | 0.358 / 0.352 / 0.384 | 6.1 / 12.1 / 7.5 | .059 / .029 / .052 |
| 16 L3 | 6.44 / 6.17 / 6.54 | 19.2 / 17.9 / 19.7 | 16.22 / 12.78 / 16.26 | 1.01 / 2.66 / 1.26 | 3.1 / 13.6 / 5.0 | 0.436 / 0.553 / 0.493 | 9.1 / 16.7 / 9.6 | .048 / .033 / .052 |
| 16 L4 | 6.29 / 6.01 / 6.51 | 24.9 / 20.7 / 25.0 | 28.86 / 20.51 / 28.92 | 1.61 / 2.99 / 1.82 | 5.6 / 18.4 / 8.7 | 0.856 / 1.013 / 0.794 | 10.2 / 19.6 / 11.4 | .084 / .052 / .069 |

Tolerance met: TWS within 0.1 kn; SOG within 0.25 kn (≤ 3.5 %; 0.1 kn at six of eight); heel within 0.5°. The sea's single-point
40 s estimates carry ± 15 % sampling noise: Hs within 15 % at seven of eight (L4 13:00 −25 %), λp v1's short bay sea at seven
of eight (13 L3's peak landed on a neighbouring bin). Left: the hull's pitch and heave are 1.2–2 × v1's (v1's were 0.3–0.5 × in
the before's long swell: v2's was 2–10 ×); the float's inputs match, so the rest is v1's depth damping, its readback carried
forward and its orbital current, not ported. In node, `tests/sea-parity.test.mjs` sails v2's boat against v1's own hull frame
and film step on the same wind and sea for 40 s: SOG, heel, heading, the true wind, pitch and heave agree to ≤ 0.05 kn / 0.2°.
Captures: `renders/parity/stack/stack-v1-over-v2-L2.jpg`, `-L4.jpg` (v1 over v2, the follow camera at 13:00),
`stack-v1-before-after-L*.jpg`, `renders/parity/helm-film.mp4` (10 s, 960 × 540, the helm view dragged round).

## The boat's motion and the sea across the lake (#21, #25, 2026-11-14: sim/surface.js, sim/seaField.js, sim/boat.js, sim/spectrum.js, render/water.js)
(This replaces the "Not ported" list of § Parity with v1 above: the depth damping, the carry-forward, the orbital current and the
per-pixel mix are in; BAY_SLOPE and v1's short-wave fades are still not.)

**v1's recipe, as found** (src/sim/waters/ultra/surface.js, src/water.js `ultraSurface`/`orbitAt`/`ultraDamp`/`mulOf`,
src/waters/ultra/gpuBridge.js, src/sim/boat/ride.js):
1. **The shallow-water calming** (`cascadeDamp`, the shader's `ultraDamp`): the 600 m tile × smoothstep(2, 14, depth), the 85, 12
   and 2.1 m tiles × smoothstep(−0.4, 2, depth), on the drawn surface and on the CPU surface the hull reads; the folds' foam fades
   with them (`mix(1, J, damp)`).
2. **The readback carried forward**: the CPU keeps the last two reads; `heightAt(x, z, t)` moves the newest along their trend to
   the float's time, at most 0.1 s (none when both reads share a time: a capture's settle).
3. **The wave push on the hull**: `orbitAt` = the time derivative of the choppy displacement between the two reads, at the hull's
   weights (filter half the hull, Smith at the canoe body's draft) → `ride.currentAt` → the physics' `env.currentAt`.
4. Two more found on the way: **v1's GPU read-back carries the 600 m tile and the two 85 m tiles only** (`pushWindow` layers 0, 1,
   4), so v1's hull never feels a 12 m tile; and **v1's sea runs downwind** (the bridge aims the spectrum at the travel + 180°, its
   fix of 2026-10-30): v2's ran into the wind (tools/v2-sea-dir.mjs at level 4 on the open lake: v1 to 0°, v2 before to 214°, v2
   after to 14°, under a 26° travel).

**v2 now:** `sim/surface.js` keeps two reads (two 1.18 MB buffers made once, swapped on adopt) and gives `heightAt(x, z, { t })`
(the carry-forward), `velocityAt` (the orbital velocity) and `setGains` (the drawn surface's per-point gains, below); the hull's
view drops the 12 m tile (`HULL_TILE12 = 0`; the drawn surface keeps it). `sim/boat.js waterFor(heightAt, { velocityAt, now })`:
`now` is the page's scene clock (the one the reads are stamped with; the boat's own clock runs a capture's settle ahead of it),
`orbitAt` feeds the ride's `currentAt`. `sim/spectrum.js spectrumFor` aims the spectrum at the travel + π.

**The sea across the lake** (`sim/seaField.js`): a 128² r16float fetch map over a 40 km square (312 m cells), traced upwind on a 512²
land mask from the terrain's CPU twin (13–20 ms in node; a live page spreads it over about 60 frames at `SEA_BUDGET` 8192 units a
frame; a capture traces it in the frame), rebuilt when the wind's direction moves 2° (v1's `setFetch`) and once the terrain's full
grids are in; plus a 64-byte uniform each frame. The water's vertex shader reads the depth (`terrainHeight`, which the lite water
already read) and the map, and makes each cascade's gain: v1's per-point weights at the point (`pointWeights`, v1's `mulOf` + `bayCpu`)
against v1's at the boat with the map's fetch there, energy-matched per tile (the tile carries both sims: the lake's and the bay's
energies from the tables, `tileEnergies`), capped at 20, × the depth's calm; the slopes take the same gains in the fragment (a
varying). At the boat the gain is exactly 1, so the near water keeps the size the owner tuned; the CPU surface applies the same
gains (`gainsAt`), so the hull floats on what is drawn. No allocation a frame, no new pipeline (two bindings in the draw group
at load, `SEA_BINDING` 10 and 11). Seen from the Sail start (level 4, noon) the open lake's long tile is 4–7 × the bay's and its
85 and 12 m tiles 0.7–1.1 ×: v1's mix makes the open lake bigger in the long swell, not in the chop, so at noon the far water's
shading barely moves; the shallows calm visibly. The map's 312 m cells are coarse for Emerald Bay (1 km wide): its fetch there
is a blend; the reference at the boat hides that near her. `seaField.off` (and `tools/v2-ab-sea.mjs`) is the A/B switch.

**The numbers** (`tools/v2-motion-compare.mjs`, headless, seed 1, 13:00, v1's film contract on the start heading, 60 s after a 5 s
lead-in, the float's pitch, heave and wave roll every 1/30 s; RMS / peak, ratio to v1 in brackets; the open lake: start 3000, −3500,
290°; the shallow approach: 1235, −1015, 135°, over the Emerald Bay shelf from 16 to 5 m):

| case | lvl | quantity | v1 RMS / peak | v2-before RMS / peak (ratio) | v2-after RMS / peak (ratio) |
|---|---|---|---|---|---|
| open | L2 | pitch ° | 0.80 / 2.55 | 0.83 / 2.24 (1.04 / 0.88) | 0.90 / 3.15 (1.12 / 1.23) |
| open | L2 | heave cm | 3.39 / 9.36 | 3.71 / 10.78 (1.09 / 1.15) | 3.43 / 11.13 (1.01 / 1.19) |
| open | L2 | roll ° | 1.10 / 2.66 | 1.10 / 3.31 (1.01 / 1.24) | 1.15 / 3.04 (1.04 / 1.14) |
| open | L4 | pitch ° | 2.23 / 7.49 | 2.11 / 6.48 (0.94 / 0.87) | 2.04 / 5.71 (0.91 / 0.76) |
| open | L4 | heave cm | 12.51 / 45.66 | 11.33 / 31.83 (0.91 / 0.70) | 11.44 / 31.36 (0.92 / 0.69) |
| open | L4 | roll ° | 2.45 / 7.80 | 3.42 / 10.00 (1.40 / 1.28) | 2.91 / 7.77 (1.19 / 1.00) |
| shallow | L2 | pitch ° | 0.41 / 1.39 | 0.39 / 1.48 (0.96 / 1.07) | 0.48 / 1.40 (1.18 / 1.01) |
| shallow | L2 | heave cm | 1.45 / 4.60 | 1.58 / 5.29 (1.09 / 1.15) | 1.72 / 5.87 (1.19 / 1.28) |
| shallow | L2 | roll ° | 0.42 / 1.43 | 0.47 / 1.25 (1.14 / 0.87) | 0.42 / 1.17 (1.00 / 0.82) |
| shallow | L4 | pitch ° | 1.06 / 3.01 | 1.07 / 4.00 (1.01 / 1.33) | 1.29 / 4.51 (1.22 / 1.50) |
| shallow | L4 | heave cm | 4.63 / 14.97 | 5.13 / 14.54 (1.11 / 0.97) | 5.91 / 17.73 (1.27 / 1.18) |
| shallow | L4 | roll ° | 1.21 / 3.87 | 1.35 / 3.83 (1.12 / 0.99) | 1.14 / 3.51 (0.94 / 0.91) |

**v1's own reference was wrong before.** v1's CPU windows follow the camera (the 85 m tiles' 64 m square) and its film contract
never moves the camera, so in `tools/v2-sea-compare.mjs` the boat sailed out of the window within seconds (56–70 % of the samples)
and v1's float felt the 600 m tile alone: the "1.2–2 ×" of § Parity was mostly that. The harness now puts v1's camera on the boat
(v1's live follow camera keeps her 18–25 m from the window's centre, inside it). With it, v2 before was already within ±15 % of v1
in 9 of 12 RMS cells; the outliers were the level-4 roll on the open lake (1.40 ×, the upwind sea) and two heaves. After: RMS within
±15 % in 9 of 12 cells; the open lake's level-4 roll 1.40 → 1.19 ×; the shallow approach reads 1.18–1.27 × in pitch and heave at
both levels (the downwind sea now meets the boat on her bow there, as v1's does). A 60 s single-seed record carries about ±15 %
sampling noise (§ Parity), so these cells are at the noise floor; the node test is the lock.

**The lock** (`tests/boat-motion.test.mjs`): v1's hull frame on v1's read-back surface and v2's boat on v2's, fed the same
synthetic sea as the GPU would (a read every 1/30 s, a frame late, choppy trains in the 600 and 85 m tiles, a frozen chop in the
12 m tile only v2's window carries) over a shelf from 22 to 3 m and in deep water: pitch, heave and roll RMS over 60 s agree to
1.000; the band is ±15 %. Without the recipe v2's shallow-water heave reads 1.18 × (the test fails); with the 12 m tile felt, the
roll reads 1.22 ×. `tests/sea-field.test.mjs`: the map against the exact trace, the weights against `seaWeights`, the gains, the
damping, a live page's spread build byte for byte. `tests/spectrum.test.mjs`: the energy sits against the travel.

**GPU cost** (`tools/v2-ab-sea.mjs`, in-page A B B A, 6 rounds × 90 frames, GPU timestamps, the median of the rounds' on − off):

| pose | frame off → on, ms | scene pass Δ | water-sim Δ | frame Δ |
|---|---|---|---|---|
| Mac, the Sail start's follow camera, 2560 × 1600 (L0, the full water) | 9.724 → 9.741 | −0.021 | −0.002 | −0.008 |
| Mac, cam B (the far shore), 2560 × 1600 | 6.079 → 6.035 | +0.005 | −0.001 | −0.044 |
| phone L2 (the lite water, the coarse grid), 569 × 1231 | 3.556 → 3.174 | −0.168 | −0.044 | −0.511 |
| phone L3, 456 × 987 | 2.769 → 2.586 | −0.055 | −0.036 | −0.266 |

No cost resolves: the Mac's deltas sit inside ±0.03 ms (budget 0.2 ms); the phone path's frames swing 1.8–4.3 ms round to round
(its split sim step), so its negative medians are noise, under the 0.3 ms budget either way. The added work is one `terrainHeight`
a vertex on the full water (the lite water read it already), one map sample and about 30 ALU a vertex, a vec4 + vec2 varying, four
multiplies a cascade a pixel; on the CPU, the 64-byte uniform and `gainsAt` in the float's patches.

**The look** (`renders/v2-motion-waves/`, the owner sees them before any merge): `follow-L3|L4-*.png` (the follow camera at noon),
`far-L3|L4-*.png` (cam E: out of the mouth to the open lake), `bay-L3|L4-*.png` (cam A: the sheltered bay), each `-v1`, `-v2-before`,
`-v2-after`; `contact-sheet.jpg` (rows in that order; columns v1 | before | after); `motion-*.mp4` (10 s, v1 | v2 before | v2
after, the same follow camera). No wind level 5 exists (levels 1–4, `src/sim/wind.js WIND_LEVELS`): the frames use 3 and 4.


## The engine and the ground tackle (#8, #14, 2026-11-14: sim/seamanship.js, ui/seamanship.js, audio/engine.js, render/exhaust.js)

v1's auxiliary and v1's anchor, mooring and dock, as v1's Sail wires them (`src/sail/seamanship.js`), on v2's sim. The physics was
already shared (`src/sim/boat/engine.js` inside BoatPhysics); what v2 lacked was v1's wiring, the parts you see and the sound.
- **The pure half** (`v2/sim/seamanship.js`): v1's createSeamanship line for line where it touches no three or DOM. `B.step`
  calls its `pre(dt)` before the hands (the engine's lever into `ctl.throttle`, the crew's furl while held, the arrival, the stop at
  N by state, the engine's first words, the nudge, the sunrise) and its `post(dt)` after the ride (the exhaust's clots, the anchor's
  drop on its socket, the rode's points, the chain's speed). The actions are v1's: `engine`, `lever`, `step(±1)`, `neutral`,
  `anchor` (drop under 1 kn in 3–20 m, else the skipper says why; J again weighs), `lines` (a mooring ball, else tie up alongside a
  pier within 1 m when stopped; again lets go), `sails`, `sunrise`. The tackle is v1's `createTackle` on the boat's env through v1's
  `tackleEnv` (the bottom's hooks while free). On the anchor or the lines the helm goes amidships and she swings (controllers/sail.js:
  `v2/sim/boat.js hands()`). The piers v1 collides with and ties up to are v1's own `piersFrom` on v1's layouts, baked once
  (`tools/v2-tackle-bake.mjs` → `v2/assets/towns/piers.json`, 3,552 rectangles, 173 kB, its own chunk after the first frame; the test
  demands the bake's bytes). v1 has no mooring balls (owner 2026-11-05); v2 has the Boat Camp's 22 (`sim/moorings.js`: J or U picks one up within 6 m of the bow under 0.8 m/s), and boats at anchor in the bay's anchorages on desktop and tablet (`sim/anchoredBoats.js`).
- **The anchor seen (2026-11-17, owner: "I have never seen the anchor work once"):** `anchor` no longer refuses for speed: the crew
  rounds her up head to wind (`sea.rounding` read by `hands()`), the sails down, the engine started and astern until her way is under
  0.3 m/s, then N and the drop under 1 kn ("Rounding up to anchor"); after the drop the crew backs her down (full astern while the
  chain lies slack, slow astern once it pulls, N once it bites). Too deep, the 'deepSpot' line names the nearest charted anchorage
  (`sim/anchorages.js`, `sim/anchorages.json` from `tools/v2-anchorage-bake.mjs`: 14 on the whole lake). v2's anchor falls at 1.6 m/s
  and the chain runs at 1.2 m/s (`ANCHORING`, `anchorNumbers`; v1 0.8 both; `A: ANCHOR` gives v1's). `sea.drain()` hands the page the
  events (letgo, splash, break) for `render/anchorSplash.js` (the kayaks' droplets under 'anchor-splash') and `audio/anchorSound.js`
  (the clunk, the chain's synthesised rattle, the recorded splash on the engine's bus); `sea.camera` eases the Boat view toward the bow
  for about 4 s (none with `reduced()`: the OS's Reduce Motion); "Anchor's holding." once the rode is taut and still,
  "We're dragging." if it moves after that (`SEA_NOTES` in `ui/seamanship.js`). The rode draws as its links' width (22 mm) with the
  telltales' 2.2 px floor. The chart draws the anchorages (`src/ui/chartplotter.js` `anchorages`, `onAnchorage`); a tap sets Sail's
  mark, so AUTO's target. Film: `tools/v2-anchor-film.mjs`. Tests: `v2/tests/anchor-seen.test.mjs`.
  Round 2 (owner: "Do another round"): full astern at once, the drop as her way comes off, 2 m/s chain, 3 : 1 scope, a 1.5 s set
  (`ANCHORING`): 14.6 s of real play to "Anchor's holding." over 10 m. The bow look holds while anchored (out on `sea.looked()`: a
  pointer or the wheel on the canvas; a view change; 1.5 s after the weighing) and no wide arrival shot. The rode is the whole chain
  (its catenary for the pull, then along the bottom). `pose.anchorLight` lights `render/night.js`'s fourth nav slot at the masthead
  (`v2/sim/night.js navLights({ anchored, mastHead })`, rule 30). Weighing (`startWeigh`/`stepWeigh`): the crew steers for the
  anchor and motors slow ahead so the windlass (1.2 m/s, `haulN` 450) hauls slack chain, then restores the sails or the idling engine
  and says "Anchor's up."; the rode's pull is capped (`maxN`, a near-vertical all-chain rode blew up a tick). The lines are voiced:
  `tools/v2-sea-lines.mjs` + `tools/v2-sea-voice.py` (tools/skipper_voice.py's Kokoro pipeline) into `audio/skipper-v2/`, played
  by a second skipperVoice (`ui/sail.js`).
  The voice speaks a line only once the skipper's row shows its words (`createShownVoice`: a line the row drops is never voiced), and
  the anchor lines carry explicit kinds for the lean skipper (`SEA_KINDS`: `sea.deepSpot`, `sea.dragging` must; `sea.holding` a tip
  once ever; `sea.rounding`, `sea.up`, `sea.anchorage` chatter): `v2/ui/leanSkipper.js` LEAN_CLASS needs `'sea.holding': TIP`.
- **The live half** (`v2/ui/seamanship.js`, mounted by `ui/sail.js`): v1's keys (I the engine, + − a notch, held a notch every 0.3 s,
  0 N, J the anchor, U the lines, Y the sails: `src/sail/keys.js` KEY), the dock rows the cockpit's panel reads (SAILS, ANCHOR with its
  chain progress, the engine, MOOR while a pier is within 15 m, DAWN at anchor after dark), the skipper's lines (`src/ui/skipper.js`
  NOTES, a finger's wording on a touch screen), the sunrise veil, and the `seamanship` service (v1's logbook reads `anchoredNow`:
  "at anchor" is recorded by v1's discoveries.js; the VHF reads it too). The throttle column calls the actions, as v1's station does.
  The 3D cockpit's key, lever, ANCHOR rocker and MOOR/DAWN cap draw from the same states (`ui.cockpitStates`).
- **The parts you see:** the anchor (hardware.glb's plough) has its own range and slot (`render/boat/models.js` 'anchor',
  `render/boat.js` SLOT.anchor): lowered along the hull's −y as the chain runs out, its waterline cut moved with it, hidden 1 m under
  (v1's socket rule); the rode is a ribbon from the roller toward the anchor (v1's 12 points and steepness, cut at the waterline: v2's
  water is clear, v1's hid the rest), v1's dark chain colour; the wet exhaust (`render/exhaust.js`): v1's clots
  (`src/boat/exhaustSim.js`) as camera-facing soft discs, v1's colour lit by the frame's sky and sun, blended after the spray.
- **The prop wash** (`v2/sim/wake.js` PROP, `render/wake.js` foam pass, marked `#14`): v1 stamps a disc (1 − smoothstep(0.5, 1.4, r))
  × the churn (|thrust| / 1,450 N while the engine turns; 0.25 + 0.75 × it) into its feedback foam map, 1.2 m aft of the transom
  going ahead, 1.5 m forward of it astern, foam × 0.55 and the slick × 1. v2's foam map has no history, so each track point carries
  its moment's churn and offset (a third vec4 a point) and the foam pass draws v1's stamp along the prop point's path, decayed at
  v1's 6 s and 14 s. With the engine off the term is 0 and every golden frame is unchanged.
- **The sound** (`v2/audio/engine.js`): v1's `src/engineAudio.js` as it is (engine_idle, engine_run, chain_run; its synthesised
  beat, wet exhaust and starter) on v1's effects bus of the music's core (`music.core.attach(fn, 'effects')`, as v1's audio.attach),
  so Settings' sound and effects and M act on it as in v1; with no music (`?music=0`) it joins the beds' boat input (`bedsLive.attach`).
  The shallow-water assist gets the seamanship as v1's (it stands down at anchor, on the lines and coming alongside) and J aground
  kedges off through its `kedge` (v1's hooks.kedge). `dist-v2/audio/boat/` gains the three files (Opus and AAC).
- **Proof:** `node tools/v2-engine-film.mjs` (the film), `node tools/v2-engine-compare.mjs` (v1 vs v2 motoring on the two
  headless pages, v1's film contract on both), `node tools/v2-anchor-trace.mjs` (the hold, v1's tackle on v1's physics vs v2's
  wiring on v2's boat), `node tools/v2-engine-stack.mjs` (v1 over v2 at the same pose). Tests: `v2/tests/seamanship.test.mjs`,
  `v2/tests/pages/seamanship.page.mjs`.
- **The hold** (`renders/engine-v2/anchor-trace.json`, 11.3 m at the Sail start, 5 : 1 = the rode's 45 m, the sails down, from
  rest at 251°, 400 s): in 15 kn from 160° both creep 1.71 m while the anchor sets (v1 1.712 m, v2 1.707 m), then hold (0 m more);
  both swing to 160.8° and lie at 201 N; the headings stay within 0.7° of each other all the way. In 20 kn (the drag limit at this
  scope is 21.5 kn, v1's dragWindMs) both creep 5.5 m (v1 5.481, v2 5.500) and hold at 357 N.
- **Motoring** (`renders/engine-v2/compare.json`, v1's Sail start after its 20 s settle under sail, 2 m/s of wind from 200°, the key
  and FULL AHEAD, 30 s, v1's film contract on both headless pages): speed within 0.076 kn (3.2 → 6.0 kn), heading within 0.02°,
  rpm equal (2,813 → 3,000), thrust within 6 N, positions 0.43 m apart at the end.
- **CPU:** the seamanship's pre 0.3 µs and post 1.9 µs a frame (node, 70 clots in the air); nothing allocated a frame (the rode's
  points reused). Pipelines: +1 (the exhaust), built at load; 0 after the first frame. With the engine off nothing new is drawn and
  the foam pass skips the wash.

**Seams in src/ (v1's behaviour unchanged; v1's tests and goldens green):** `src/sail/seamanshipRules.js` (SEA, ICONS, EngineNudge,
nextSunrise moved out of seamanship.js, re-exported there), `src/boat/exhaustSim.js` (the exhaust's flight moved out of exhaust.js,
which draws the same arrays; checked bit for bit against the old module over 600 frames), `src/sim/sail/tackleEnv.js` (tackleEnv
moved out of the Simulation, re-exported there, so v2 never reaches the craft registry).

**What differs from v1:** the cockpit.glb's gear lever, throttle and key on the pedestal don't move (v2 draws v1's models as one
merged set; the 3D cockpit's lever and key do), and the helm view has no pick on them (the throttle column and the keys work in both
views); the rode is cut at the waterline; no fenders and no dock lines drawn (the tackle works: MOOR, tie up, let go); no control
click on a lever notch (v1's sfx cue: v2's sfx sits inside the recorded half); the arrival's wide shot hands back on a key, a press or
the wheel as v1's.

### Open (from M2)
- Open from M2: the water's depth damping the FFT's shallow waves; the boat in the mirror (none, or a screen-space pass).
