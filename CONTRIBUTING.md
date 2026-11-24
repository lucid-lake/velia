# Contributing

Thank you for looking.

- **Issues are welcome:** bugs, a device where the game will not start, a sailing detail that is wrong. Say what you saw, on which browser, GPU and OS, and the URL (the `?` flags make a scene repeatable).
- **Pull requests are by invitation for now.** We are a small studio and review every change by eye. If you would like to work on something, open an issue first and we will say whether we can take it.

If you are invited to send a change:

1. Run `git config core.hooksPath .githooks` once. The hooks scan each commit and push for secrets, local paths and private data (`tools/oss/scrub.mjs`); never bypass them.
2. Keep each change small and on one subject. Commit messages are `type(scope): summary` (for example `fix(sim): the jib luffs at 30° apparent`).
3. Run `npm run test:v2` and `node --test tests/` before you push. Tests check behaviour, not source text.
4. A change to how the water, sky, boat or world looks needs before and after captures of the same frames (`node tools/capture.mjs --app v2 --name <n> --hour <h> --cam A`).
5. Keep scenes deterministic: no `Math.random()` and no wall clock in the scene when `?hour` is set. A new URL flag needs a row in `v2/engine/flags.js`.
6. A new third-party asset needs a licence that allows redistribution in this repository and a row in `ATTRIBUTION.md`.

By sending a change you agree that it is licensed under the repository's MIT licence.
