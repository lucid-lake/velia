<div align="center">

<a href="https://velia.lucidlakelabs.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/velia-lockup-plush.svg">
    <img src="brand/velia-lockup-mono.svg" alt="Velia" width="360">
  </picture>
</a>

### Sail a real lake in your browser.

**[▶ Play now at velia.lucidlakelabs.com](https://velia.lucidlakelabs.com)**

[![CI](https://github.com/lucid-lake/velia/actions/workflows/ci.yml/badge.svg)](https://github.com/lucid-lake/velia/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-1C2340.svg)](LICENSE)
[![WebGPU](https://img.shields.io/badge/WebGPU-raw_WGSL-1C2340.svg)](v2/README.md)
[![Support on Ko-fi](https://img.shields.io/badge/Ko--fi-support_Velia-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/lucidlake)

<a href="https://velia.lucidlakelabs.com"><img src="brand/stills/hero-960.jpg" alt="Emerald Bay on Lake Tahoe in Velia: Fannette Island, the forested shore and wind on the water" width="100%"></a>

</div>

## Watch

[![Velia: week 3 update (YouTube, 2026-11-18)](https://img.youtube.com/vi/hbosudzwbSk/maxresdefault.jpg)](https://www.youtube.com/watch?v=hbosudzwbSk)

**▶ [Week 3 update](https://www.youtube.com/watch?v=hbosudzwbSk)** (2026-11-18). More videos: [July 4th fireworks and kayaks](https://www.youtube.com/watch?v=uqyhSGskhOs) (2026-11-11) · [Week 2 progress](https://www.youtube.com/watch?v=gvN_RuO8S2A) (2026-11-06) · [We built a sailing sim of Lake Tahoe](https://www.youtube.com/watch?v=MDWkyLbLV9g) (2026-11-01).

## What Velia is

- **A real place.** You sail Emerald Bay on Lake Tahoe. The terrain, the lake bed, the forest and the light come from real data.
- **Real wind and water.** Wind is one system, and every effect reads it. The waves are wind-driven. The boat sails by its polars.
- **Three modes.** **Sail**: the lake is yours, with no score and no timer. **Cruise**: an autopilot sails, the music plays. **Regatta**: race computer boats round the marks.
- **Its own engine.** Raw WebGPU and WGSL, no three.js. It runs in a recent Chrome, Edge or Safari.

## Run

You need Node.js 24 or newer and a browser with WebGPU.

```sh
npm ci
npm run dev:v2      # Velia at http://127.0.0.1:5174/
npm run build:v2    # dist-v2/: the game, its worker and the data it streams
```

The classic version (v1) still builds: `npm run dev` (port 5173) and `npm run build` (`dist/`).

## Test

```sh
npm run test:v2     # v2's fast suite (v2/tests/, no browser, about 20 s)
npm test            # the shared modules and both trees (about 25 s)
```

- Slower lanes: `npm run test:v2:slow`, `npm run test:slow`, `npm run test:classic`.
- With a GPU: the page tests (`npm run test:pages:v2`) and the golden frames (`npm run goldens:v2`) drive a headless browser.
- CI runs the fast suites and both builds on every push and pull request (`.github/workflows/ci.yml`).
- Tests check behaviour (call the module, read its output, DOM or state), never the source text. A refactor that keeps the behaviour stays green.

## Architecture

[`v2/README.md`](v2/README.md) is the engine's map: the mode table, the plug-in list, the played seam, the region table and the import directions. [`v2/notes/`](v2/notes/INDEX.md) holds one file per subsystem.

| Folder | What |
|---|---|
| `v2/` | Velia: boot, the launch gate and the page |
| `v2/engine/` | device, frame graph, pipelines, governor, quality ladder, clock, flags, mode table, plug-ins |
| `v2/sim/` | pure simulation: boat, wind, waves, clouds, regions, kayaks (no DOM, no GPU) |
| `v2/render/` | GPU passes: terrain, forest, water, sky, clouds, night, storm, boat, cockpit, wake, birds |
| `v2/terrain/`, `forest/`, `towns/`, `photo/` | streamed lake data and its decoders |
| `v2/audio/`, `v2/ui/` | sound and music; HUD, cockpit, chart, logbook, touch controls |
| `v2/cruise/`, `regatta/`, `stage/`, `living/` | the modes, the stage venues, the living lake |
| `src/` | modules both versions read (wind, day, flags, lake and vessel profiles, `src/sim/`) |
| `classic/` | the classic version (three.js 0.184 `three/webgpu` + TSL), frozen |
| `terrain/`, `data/`, `models/`, `audio/`, `fonts/`, `brand/` | assets the pages fetch by absolute URL |
| `tools/` | build scrub, packers, capture and golden tools, bakes the tests check |

Every URL flag is a row of a flag table (`v2/engine/flags.js`, `V2_ROWS`). Scenes are deterministic: `?hour=6.5&cam=A&seed=1&headless=1` gives the same frame every time.

## Support Velia

Velia is free to play. A coffee keeps the lake open.

<a href="https://ko-fi.com/lucidlake"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support Velia on Ko-fi" height="36"></a>

## Contributing

- **Issues are welcome:** bugs, a device where the game will not start, a sailing detail that is wrong.
- **Pull requests are by invitation for now.** Open an issue first. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Security reports:** [`SECURITY.md`](SECURITY.md).

Before your first commit, turn on the repo's hooks. They scan each commit and push for secrets, local paths and private data.

```sh
git config core.hooksPath .githooks
```

## Credits and licence

- **Code:** MIT ([`LICENSE`](LICENSE)), by Lucid Lake Studio.
- **Third-party data, sounds, fonts and textures** keep their own licences: [`ATTRIBUTION.md`](ATTRIBUTION.md) lists each one, [`LICENSES/`](LICENSES/) holds the texts.
- **Not covered by the MIT licence:** the AI-generated music (MusicAPI) and images (Gemini), and the Velia and Lucid Lake names and logos. They ship with the game; see [`NOTICE.md`](NOTICE.md).

Contact: [contact@lucidlakelabs.com](mailto:contact@lucidlakelabs.com)
