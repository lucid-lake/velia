# Velia

**Sail a real lake in your browser.** Velia is a sailing game on Lake Tahoe's Emerald Bay, built on its own raw-WebGPU engine (WGSL, no three.js). The terrain, the lake bed, the forest and the light come from real data; wind, waves and weather are real systems, and the boat sails by its polars.

Play it at **[velia.lucidlakelabs.com](https://velia.lucidlakelabs.com)**. The first version (three.js, now frozen) is at [velia.lucidlakelabs.com/classic/](https://velia.lucidlakelabs.com/classic/).

By Lucid Lake Studio. The code is MIT-licensed (`LICENSE`); data, sounds, fonts and textures keep their own licences (`ATTRIBUTION.md`, `LICENSES/`); the Velia and Lucid Lake names and logos are not licensed (`NOTICE.md`). The game's music (MusicAPI) and a few images (Gemini) are AI-generated: they ship with the game under their providers' terms and are not covered by the MIT licence (`NOTICE.md` § AI-generated files).

## Run

You need Node.js 24 or newer and a browser with WebGPU (a recent Chrome, Edge or Safari).

```sh
npm ci
npm run dev:v2      # Velia at http://127.0.0.1:5174/
npm run dev         # the classic version (v1) at http://127.0.0.1:5173/
```

Build:

```sh
npm run build:v2    # dist-v2/: the game, its worker and the data it streams
npm run build       # dist/: the classic version
```

## Test

```sh
npm run test:v2     # v2's fast suite (v2/tests/, no browser, about 20 s)
node --test tests/  # the shared modules and both trees (about 25 s)
```

Slower lanes: `npm run test:v2:slow`, `npm run test:slow`, `npm run test:classic`. The page tests (`npm run test:pages:v2`) and the golden frames (`npm run goldens:v2`) drive a headless browser and need a GPU. CI runs the fast suites and the build on every push and pull request (`.github/workflows/ci.yml`).

Tests check behaviour (call the module, read its output, DOM or state), never the source text, so a refactor that keeps the behaviour stays green.

## Architecture

`v2/README.md` is the engine's map (the mode table, the plug-in list, the played seam, the region table, the import directions); `v2/notes/` holds one file per subsystem (`v2/notes/INDEX.md` lists them).

| Folder | What |
|---|---|
| `v2/` | Velia: boot, the launch gate and the page (`main.js`, `start.js`, `index.html`) |
| `v2/engine/` | device, frame graph, pipelines, governor, quality ladder, clock, flags, mode table, plug-in list, player |
| `v2/sim/` | pure simulation: boat, wind, waves, clouds, regions, kayaks, seamanship (no DOM, no GPU) |
| `v2/render/` | the GPU passes: terrain, forest, water, sky, clouds, night, storm, boat, cockpit, wake, birds |
| `v2/terrain/`, `v2/forest/`, `v2/towns/`, `v2/photo/` | streamed lake data and its decoders |
| `v2/audio/`, `v2/ui/` | sound beds and music; HUD, cockpit, front door, chart, logbook, touch controls |
| `v2/cruise/`, `v2/regatta/`, `v2/stage/`, `v2/living/` | the modes' chunks, the stage venues, the living lake (kayaks, Tessie, plug-ins) |
| `src/` | the modules both versions read (wind, day, flags, the lake and vessel profiles, the pure `src/sim/`) |
| `classic/` | the classic version (three.js 0.184 `three/webgpu` + TSL), frozen |
| `terrain/`, `data/`, `models/`, `audio/`, `fonts/`, `brand/` | the assets the pages fetch by absolute URL |
| `tools/` | the build's scrub and packers, the capture and golden tools, the bakes the tests check |

Every URL flag is a row of a flag table (`v2/engine/flags.js`, `V2_ROWS`). Scenes are deterministic: `?hour=6.5&cam=A&seed=1&headless=1` gives the same frame every time.

## Contributing

Issues are welcome; pull requests are by invitation for now (`CONTRIBUTING.md`). Security reports: `SECURITY.md`.

Before your first commit, turn on the repo's hooks (they scan each commit and push for secrets, local paths and private data):

```sh
git config core.hooksPath .githooks
```
