# Velia: notes for coding agents

Velia is a sailing game on Lake Tahoe in the browser. **v2 is the product**: our own raw-WebGPU engine (WGSL, no three.js), in `v2/`. **v1 is frozen** (three.js 0.184 `three/webgpu` + TSL), served built at `/classic/`; its private code is `classic/src/`; `src/` holds what both read. Change v1 only to fix a shared module or a test.

Read first: `README.md` (run, test, folder map), `v2/README.md` (the engine's map: mode table, plug-in list, played seam, region table, import directions), the subsystem note in `v2/notes/` for the area you touch (`v2/notes/INDEX.md`).

## Run

- `npm run dev:v2`: v2 at http://127.0.0.1:5174/ (strict port). `npm run dev`: v1 at http://127.0.0.1:5173/. Stop only the servers you started, by PID.
- `npm run build:v2` → `dist-v2/`; `npm run build` → `dist/`; then `bash tools/scrub_dist.sh dist-v2` (no internal words in a build).
- `node tools/capture.mjs --app v2 --name <n> --hour <h> --cam A [--seed s]`: a headless WebGPU capture (PNG + stats JSON under `renders/captures/v2/`, git-ignored).
- After a dependency change or a rebase, restart Vite and clear its cache (`rm -rf node_modules/.vite .vite-v2`): a stale cache renders wrong without an error.

## Gates

- Fast: `npm run test:v2` (about 20 s) and `npm test` (about 25 s). Both run in CI with the two builds.
- Slow lanes before a change to physics, wind, Cruise, the bottom or the Regatta: `npm run test:v2:slow`, `npm run test:slow`.
- With a GPU: `npm run test:pages:v2` (page tests on a private Vite) and `npm run goldens:v2` (golden frames; `-- --bless <name>` only for a look that was reviewed by eye). `bash tools/gate.sh` runs the local set and prints one line.
- Tests check behaviour (call the module, read its output, DOM or state), never the source text.

## Rules of the code

- v2 imports nothing from three.js (`v2/tests/no-three.test.mjs`) and nothing from `classic/` (`v2/tests/import-direction.test.mjs`).
- Deterministic scenes: no `Math.random()` and no wall clock in the scene when `?hour` is set. URL contract: `?hour=6.5&cam=A&seed=1&exposure=6&headless=1` (`hour` is local time at Tahoe on the map's highlight day, `src/sim/day.js`).
- Every URL flag is a row of a flag table (v2: `v2/engine/flags.js` `V2_ROWS` plus the shared rows).
- Wind is one module; every effect reads it. Water is wind-driven.
- Device-dependent behaviour is a policy in `src/core/features.js` read from `src/core/profile.js`; no user-agent sniffing, no device-width queries in new code.
- A new third-party asset needs a licence that allows redistribution here and a row in `ATTRIBUTION.md`.

## Commits

- `type(scope): summary`, one subject per commit. Never `--no-verify`, never `--force`.
- Turn on the hooks once: `git config core.hooksPath .githooks`. They run `tools/oss/scrub.mjs` over each staged diff, commit message and push (secrets, local paths, emails, private names, internal names, money); fix a hit, do not bypass it. A false positive gets a rule with a reason in `.scrub-allow`.
- Machine-specific notes go in an untracked `CLAUDE.local.md`, never in this file.
