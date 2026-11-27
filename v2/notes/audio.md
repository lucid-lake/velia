# v2 notes: Sound beds and music

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## The sound beds (step 3, hybrid, 2026-11-13: audio/beds.js, recorded.js, bedsMix.js, noise.js, bedsLive.js, offline.js, script.js)

The owner, 2026-11-13: "sound beds made in code: wind, hull, water and sails" (BACKLOG-v2 #7).
After the A/B by ear the same day: the code hull, sails and rain "very poor, not like real"; the wind not flagged; **"hybrid
sound"**. So: **the wind is code** (`beds.js`), **the hull and water, the sails, the load, the controls and the rain are v1's
recordings on v1's own engines** (`recorded.js`), with v1's triggers and levels exactly.

**The recorded half** (`recorded.js`): `src/boatAudio.js` createBoatAudio (audio/boat: hull_chuckle, hull_rush and the surf's roar
from it, sail_flutter, sail_flog, creak_rig, creak_sheet, sail_snap; its wind group, the rig's recorded rush and v1's whistle,
trimmed to 0), `src/sfx.js` createSfx (audio/sfx: winch_click, sheet_run, wheel_creak, page_turn), and src/audio.js's lake loops
(audio/lake_lap, audio/rain_water) at mixAt's gains. **Code voices where v1 has no recording, as in v1:** the slaps and slams (v1's
waterHit synthesis), the rig's hum, the stays' Aeolian note, the sigh (v1's own synthesis, inside v1's engine), and the wind's
voice, the rig's rush and the whistle (`beds.js`). The files load after the first gesture (the page's context exists only then:
after the first frame) through `src/audioFormat.js` (Opus, the AAC twin where Opus does not decode: Safari), each fetched once,
by v1's paths. **Bytes** (main 572f153e's compressed set, same paths, no code change): 13 files, 1,025,239 B Opus (Chrome,
Firefox; 1,576,885 B before) or 1,563,972 B AAC (Safari; those files were not re-encoded); `dist-v2/audio/` gains both sets
(2.6 MB; `vite.config.js` bedsAudio). Everything enters
`beds.js`'s effects and ambience inputs through a gain held at 0 until the files are in, then faded up over ≈ 0.3 s.

**The code wind** (`beds.js`, as the owner heard it): the WindField sampled at the eye (the gusts at the listener), v1's two wind
beds' level as one voice; pink noise → HP 42 Hz → a high shelf (−4 → 0 dB) → two low-passes at Cold Smoke's 300 + 830·u^1.1 Hz
(u = wind / 12 m/s) → each ear's own buffeting → a slow swell on both ears → panned to the side the apparent wind comes from at
the listener (±0.65). The rig: its rush above 1.4 kHz and the whistle above ≈ 15 kn apparent, by v1's windMix (the gains, the
whistle's pitch, the bus and the distance from v1's own boat mix this frame: `BedsMix.withBoat`), panned at 0.6 of the wind.

**The way out:** ambience + effects (v1's 0.6) → a compressor (−15 dB, 3.5 : 1) → its automatic make-up taken out (+ 4.4 dB in
Chrome, measured against v1's recordings) → the fade → a soft ceiling (straight to 0.7, bending under 1) → the page's master
(0.8). v1's recordings come out at v1's level (the A/B below), 6 ms later (the compressor's look-ahead). Settings: `sound` mutes
all, `effects` the boat (v1's switches, from the page's store; v2's Setup page does not show them yet). Views: v1 treats the
follow and helm views alike (the camera's distance, full inside 35 m); so does v2. Page hidden: fade, then suspend.

**Engine habits:** the code graph (55 nodes) is built once and moves only by setTargetAtTime, with a 0.6 % dead band. v1's
engines make no node on a frame without a one-shot; a one-shot (a creak, a snap, a click, a water hit) makes its source and
gain as in v1 (a water hit ≈ 16 nodes). A headless capture never builds the beds (goldens:v2 `--twice` at 0 px);
`__velia.beds.input()` gives the harness the input as data. The page's AudioContext (`engine/audio.js`) starts in the capture
phase, as v1's: the home card's ENTER, which stops its event, starts it.

**Measured (2026-11-13, M5 Pro Mac, headless Chrome, the compressed set).** The 60 s scripted sail (WAV test,
`tests/pages/beds.page.mjs`): peak −8.2 dBFS; largest sample step 0.081 before the rain, 0.363 in the rain (v1's rain_water recording's drops at full rain; v1's
own sound under the same 60 s with the earlier files: 0.559); gated loudness −30.4 dBFS; no window under −60 dBFS after the 0.3 s fade-in; 13 files
loaded once; the code graph unchanged after build. Main thread: on the live page (the wind at the eye, the code wind's mix,
v1's two engines, the parameter pass) **69 µs a frame on average** (213 frames; 96 µs before `stepWind` stopped running v1's
mixers twice); the offline loop 9 µs.

**The owner's A/B** (`node tools/v2-beds-render.mjs --ab`; a = v1 through v1's own engines, b = v2's hybrid, the same scripted
frames, one bed alone, 14 s, AAC ≈ 280 KB; both sides from the compressed files, what ships): `renders/beds/ab-hybrid/
{hull,sails,rain}-{a-v1,b-v2}.m4a`. Peak and gated loudness a / b: hull −27.7 / −27.7 and −44.2 / −44.2, sails −20.8 / −20.8 and
−41.7 / −41.7, rain −14.3 / −14.5 and −36.8 / −36.8 dBFS.
(The first, all-code round's clips, `renders/beds/ab/`, are the record of what the owner rejected.)

**The film:** `node tools/v2-beds-film.mjs` (30 s: calm at wind level 1, 2.5–3 kn; the breeze to level 4 at 8 s, 14 kn true at
12 s, heel to 21° at 15 s; the winch 9.5–11 s; a tack, the helm over 13–24.5 s, head to wind 18–23 s, full on the new side at
24 s; the sheet eased 26–27.5 s and left luffing), the beds' input read from the page each frame and rendered offline (hybrid)
in the same page, muxed under the frames: `renders/beds/v2-beds-sail.mp4` (14.4 MB, the compressed files; its sound peak −13.5 dBFS, max step
0.060, gated −32.7 dBFS, no silence).

**Still differs from v1:** the wind is code (no reed rustle; v1's light wind was shore reeds); the logbook's page turn is not played (the engine's
sound and the anchor chain are v1's engineAudio since #14: § The engine and the ground tackle) (page_turn loads with the controls' bank, unused); the groove's swell is the
music's (§ The music: v1's engine here fires it, the music plays it); Settings' sound and effects rows act on v2's Setup page (§ Setup's rows).

## The music (#7, #7a, 2026-11-14: audio/music.js; hooks in main.js, audio/fireworks.js, audio/recorded.js, bedsLive.js, ui/sail.js)

v1's music on v2's page, with v1's own logic imported as it is: the same pieces at the same times and moods, the groove's swell,
the top bar's Music, Settings' music, the boat radio's marches on the fireworks evening and Cruise's playlist.

| v1's piece | Where it comes from | On v2 |
|---|---|---|
| the beds by time of day and mood | `src/audio.js` BedScheduler with `src/core/sailMusic.js` SAIL_BEDS (dawn 05:54–09:00 and 18:18–20:30, golden 18:18–20:42, night 20:42–22:36, wind past 7 m/s at the listener, vista on entry when nothing else fits) | the same scheduler and pools, fed v2's scene clock (`clock.t`, 2 s a real second, as v1's) and the wind at the eye |
| silence first | firstS 90, a piece 120, gaps 240–480 hashed per cue, no piece again within 1800 or of the last two (all scene s) | unchanged (imported) |
| the entry piece | `arriveOnEntry`: the gesture that enters Sail cues a piece at once | the same listener (main.js), the card's states as v1's daysail |
| the groove's swell | v1's boat engine fires `swell` after 8 s in the groove; `grooveSwell` (an open D chord, 8 s), once per 240 s, never over a piece | the engine in `recorded.js` now gets `audio: { groove }`, so the same event reaches the same scheduler |
| the bar's Music | `src/musicControl.js` createBedMusic: Next song (a different piece now, 1.5 s fade), pause, the volume, the title in the bar | `music.player` to `createViewSwitch({ music })` |
| Settings | sound (the master), music (the music bus 1.8), effects (the effects bus 0.6), M | `setMuted`, `setBus` on v2's context; the beds' own switches (bedsLive.js) as before; the birds' own context follows sound and M |
| the boat radio | `src/fireworks/music.js` radioOn, Setup › Sound › radio (shows with `?fireworks=1`, as v1) | the fireworks' audio now joins the page's music bus through `createLateCore` (was its own context and a 0.9 music gain) |
| the skipper's voice | `src/ui/skipperVoice.js`: each hint line spoken once, the music ducked −8 dB | on the music's voice bus, passed to the hint line (sail.js); Setup's row turns it off |
| Cruise | `src/modes/chill/music.js` createMusic: the ten pieces as a seeded playlist, 4 s in, 6 s out, 6–18 s apart | `music.setMode('cruise')` (below) |

**The API for Cruise** (the Cruise helper calls these; nothing else is needed):

```js
const music = window.__velia.music;   // or the `music` main.js passes to m4.attach (ui.music in Sail's UI)
music.setMode('cruise');              // the beds hold (scheduler.next = Infinity), v1's playlist starts and claims the music bus
music.player                          // what the top bar's Music drives: the playlist in Cruise ({ title, songId, paused, next(), toggle(), setVolume() })
music.setMode('sail', { finish: true });   // v1's hand-over: the piece playing plays out; finish: false fades it over 1.5 s; the beds wait 240 s
music.mode, music.playlist, music.stats()
music.core                            // v1's audio contract for any other v1 player: attach(fn, bus), claimMusic, yieldMusic, duck, setBus …
```
The fireworks evening's score in Cruise (`src/fireworks/music.js` score) follows `music.mode` already. `]` and `[` (v1's Cruise keys
for next and pause) belong to Cruise's passenger keys, not here.

**Memory and bytes (#7a).** Every piece streams through an `<audio>` element and a MediaElementSource (`src/audioFormat.js`
streamFile + sourceFor, v1's iOS path, now on every device in v2: `setStreamMusic(true)`): only the metadata is read before a piece
starts, and no piece is ever decoded whole. Decoded, a piece is 43.9–65.9 MB of PCM (48 kHz stereo float); all ten would be 529 MB.
Cruise's playlist streams the same way. The fireworks' three pieces still decode as v1's do (`pieceChain` needs a buffer). **Nothing
loads before the first gesture** (the page's context exists only then) **and the first frame** (the scheduler runs in the frame);
then only the piece that plays. Files (Opus for Chrome and Firefox; the AAC twin on Safari): the ten pieces 12,337,547 B Opus
(1.0–1.6 MB each) or 14,787,468 B AAC; the skipper's clips 684,511 B Opus (fetched one at a time once the sound runs, v1's
prefetch); the radio's two marches 1.5 MB Opus. `dist-v2/audio/` gains the music, the skipper's clips and the evening's other two
pieces (≈ 37 MB in both formats). Main thread: the scheduler's check a frame (no node made on a frame without a cue).

**Proof:** `node tools/v2-music-render.mjs` renders the music core offline (an OfflineAudioContext decodes; the live page streams)
on v2's day clock at the game speed: `renders/music/v2-music-golden-to-night.m4a` (265 s, 1.98 MB, AAC 80 kb/s): ENTER at 20:33
(1.2 s): "Golden hour on the lake" (golden_hour_b), its 120 s and the fade; the silence-first gap; at 195.5 s, the clock at
21:12, "Dusk over the water" (dusk_water_a) from the night pool. Peak −7.1 dBFS.

**Tests:** `v2/tests/music.test.mjs` (the cues of a whole day equal v1's createAudio's for three seeds; the entry, next-song and
groove rules; nothing loads before the context, then the piece streams; the buses at v1's levels and Settings' switches; Cruise's
hand-over and back; the fireworks door; the shipped files) and `v2/tests/pages/setup.page.mjs` (ENTER at 20:30 streams a golden
piece, the Music menu, Next song, pause, M).

### Shuffle (owner, 2026-11-14: "Can we play songs randomly so users don't get bored?"; audio/shuffle.js, playlist.js, ui/musicRow.js)

Setup › Sound › **music: shuffle | by time of day**, Shuffle by default, stored under its own key (`velia.musicPick.v1`: v1's
settings store keeps only v1's keys; Regatta's level row does the same). By time of day is everything above, unchanged.

| | Shuffle | By time of day (today's) |
|---|---|---|
| Sail's order | a seeded deck of the ten pieces (five songs × A and B): all ten before any repeats; never the same song twice in a row, so never the A and B of one song back to back, inside a round or across the reshuffle (a draw that would force a pair before the round ends is refused) | v1's beds by the hour and the wind (pools of 3–4) |
| the hour | weighs lightly: the hour's song (first light 05:54–09:00, golden hour 18:18–20:42, dusk after, wind rising past 7 m/s, over the ridge through the day) counts 2 against 1; it opens a 07:00 visit 33 % of the time (uniform: 20 %) | decides the bed; midday in calm wind has no bed, so no music |
| a piece | plays whole (1:59–3:00) | cut at 120 s |
| the gap | 20–45 s of the lake alone, hashed per card, on the audio clock (real seconds, from the moment the last piece really stops) | firstS 90, gaps 240–480 scene s: at the game's 2 ×, 60–180 s of silence after a piece |
| the entry | a card at once | the hour's bed at once |
| Next song | the next card; the one playing fades over 1.5 s | a different piece of the hour's pool |
| Cruise | the deck's order in v2's playlist (`audio/playlist.js`: v1's playlist with the deck; v1's 4 s in, 6 s out, 6–18 s gaps) | v1's playlist |
| Regatta | **a race keeps the beds' scheduler whatever the pick** (`race()`, main.js): it does not join the shuffle; a song playing at the start plays out first | the same |

The groove's swell never sounds over a shuffled piece; the vista swell is the beds' only. The fireworks, the radio and Cruise still
claim the bus; when it comes back the shuffle waits one gap. **Randomness:** the deck and the gaps are seeded by the visit seed
(`src/visitSeed.js`: crypto on a live page, `?seed=` on captures, goldens and tests), so a fixed seed gives the same order. Music never
runs in a headless capture. **The fast clock:** `music.pace({ pieceS, gapScale })` (a page test's hook) cuts each card at pieceS and
scales the gaps. **API:** `music.setPick('shuffle' | 'time')`, `music.pick`, `music.shuffling`, `music.core.shuffle` (the scheduler),
`stats().shuffle`.

**Tests:** `v2/tests/shuffle.test.mjs` (the deck covers all ten before a repeat, 300 seeds × 6 rounds; no song twice in a row across
the reshuffle, 2000 seeds × 8 rounds; the weighting; gaps 20–45 s, and measured on the engine: 37.0, 28.5, 44.5, 28.5, 22.5, 36.0,
43.5, 24.0, 37.0, 41.0, 22.5 s; Next song; a race keeps v1's cues; Cruise's deck; the Setup row stored; a fixed seed's order) and
`v2/tests/pages/shuffle.page.mjs` (three songs at the fast clock on the real page, their titles logged; Next song; the Sound tab's row).
`setup.page.mjs` runs By time of day (the hour's entry piece).

**Seams in src/ (v1's behaviour byte for byte, v1's tests and goldens unchanged):** `src/audio.js` exports `BUS_LEVELS` (createAudio's
bus levels, hoisted unchanged: `const BUS_LEVEL = BUS_LEVELS`); `src/audioFormat.js` `setStreamMusic(on)` (default off: v1 streams on
iOS only, as before; v2's live page turns it on).

**Still differs from v1:** a piece streams on every device (v1 decodes on desktop); the race score is Regatta's (not in v2); v1's
loading-card ♪ chip is gone with the reel; the engine's sound and the anchor chain are not here (the engine helper's).
