# Attribution

Every third-party asset in this repo, one row each. CC0 needs no credit; we keep the row anyway (source, author, licence, date fetched).

**AI-generated files are not covered by the MIT licence.** The music (MusicAPI) and a few images (Gemini) are part of the game and distributed under their providers' terms; no licence to reuse them separately is granted. The exact paths: `NOTICE.md` § AI-generated files; the sources: § Music and § AI-generated and AI-assisted below.

## Audio (T6 sound pack: `tools/audio_pack.py`, `audio/sources.json`)

| File | Source | Author | Licence | Fetched | Cut |
|---|---|---|---|---|---|
| `audio/lake_lap.opus` | [Freesound 464798: Tiny waves lapping #1](https://freesound.org/people/guyburns/sounds/464798/) | guyburns | CC0 1.0 | 2026-10-28 | 36 s from 30 s, 3 s crossfade; from the hq Ogg preview |
| `audio/wind_light.opus` | [Freesound 513736: tuuli kaisla](https://freesound.org/people/JanneLaine/sounds/513736/) | JanneLaine | CC0 1.0 | 2026-10-28 | 36 s from 60 s, 4 s crossfade; from the hq Ogg preview |
| `audio/wind_strong.opus` | [Freesound 487541: ATM_EXT_OpenFarmlandDayStrongWindGustsPartSheltered](https://freesound.org/people/tbsound101/sounds/487541/) | tbsound101 | CC0 1.0 | 2026-10-28 | 36 s from 66 s, 4 s crossfade; from the hq Ogg preview |
| `audio/rain_water.opus` | [Freesound 572429: 180723 Rain, on water lake, modulating light to med, cottage ONTARIO](https://freesound.org/people/TRP/sounds/572429/) | TRP | CC0 1.0 | 2026-10-28 | 36 s from 10 s, 4 s crossfade; from the hq Ogg preview |
| `audio/birds_dawn.opus` | [Freesound 611453: Dawn chorus](https://freesound.org/people/Synge101/sounds/611453/) | Synge101 | CC0 1.0 | 2026-10-28 | 36 s from 51 s, 4 s crossfade; from the hq Ogg preview |
| `audio/loon.opus` | [Freesound 751848: Late Summer Loons](https://freesound.org/people/itinerantmonk108/sounds/751848/) | itinerantmonk108 | CC0 1.0 | 2026-10-28 | 38 s from 12 s, 4 s crossfade; from the hq Ogg preview |

## Boat sound (D1: `tools/boat_audio_pack.py`, `audio/sources.json` "boat", played by `src/boatAudio.js`)

The hum, the whistle, the sigh and the bow slap are synthesised (seeded noise); the wind in the rig reuses `audio/wind_strong.opus`.

| File | Source | Author | Licence | Fetched | Cut |
|---|---|---|---|---|---|
| `audio/boat/hull_chuckle.opus` | [Freesound 852108: Sailboat Bow](https://freesound.org/people/myLoop/sounds/852108/) | myLoop | CC0 1.0 | 2026-10-29 | 36 s from 2 s, 3 s crossfade; from the hq Ogg preview |
| `audio/boat/hull_rush.opus` | [Freesound 371172: Sailboat, cockpit at 12kn wind speed](https://freesound.org/people/borralbi/sounds/371172/) | borralbi | CC0 1.0 | 2026-10-29 | 36 s from 24 s, 4 s crossfade; from the hq Ogg preview |
| `audio/boat/sail_flutter.opus` | [Freesound 57280: RAH_Flapping_Fabric_3.flac](https://freesound.org/people/_earthbound_/sounds/57280/) | _earthbound_ | CC0 1.0 | 2026-10-29 | 16 s from 14.75 s, 2 s crossfade; from the hq Ogg preview |
| `audio/boat/sail_flog.opus` | [Freesound 448975: flag.wav](https://freesound.org/people/GeorgeHopkins/sounds/448975/) | GeorgeHopkins | CC0 1.0 | 2026-10-29 | 19 s from 0.25 s, 2 s crossfade; from the hq Ogg preview |
| `audio/boat/creak_rig.opus` | [Freesound 59160: grincements_helvetia.aif](https://freesound.org/people/f_ilippo/sounds/59160/) | f_ilippo | CC0 1.0 | 2026-10-29 | 9 one-shots at 1.17 s, 3.62 s, 9.62 s, 13.37 s, 27 s, 50.62 s, 56.07 s, 60.72 s, 77.27 s, one per 2 s slot; from the hq Ogg preview |
| `audio/boat/creak_sheet.opus` | [Freesound 145721: Mooring Rope.wav](https://freesound.org/people/Rmutt/sounds/145721/) | Rmutt | CC0 1.0 | 2026-10-29 | 4 one-shots at 31.57 s, 36.42 s, 55.02 s, 58.37 s, one per 2 s slot; from the hq Ogg preview |
| `audio/boat/sail_snap.opus` | [Freesound 57280: RAH_Flapping_Fabric_3.flac](https://freesound.org/people/_earthbound_/sounds/57280/) | _earthbound_ | CC0 1.0 | 2026-10-29 | 5 one-shots at 8.32 s, 11.02 s, 3.72 s, 34.02 s, 1.22 s, one per 2 s slot; from the hq Ogg preview |
| `audio/boat/engine_idle.opus` | [Freesound 450253: Lovis ship sailboat below deck small cabin with engine running idle and go slowly, various gear shifts.flac](https://freesound.org/people/kyles/sounds/450253/) | kyles | CC0 1.0 | 2026-10-29 | 30 s from 8 s, 3 s crossfade, high-pass 25 Hz; from the hq Ogg preview |
| `audio/boat/engine_run.opus` | [Freesound 264864: Marine diesel engine](https://freesound.org/people/AugustSandberg/sounds/264864/) | AugustSandberg | CC0 1.0 | 2026-10-29 | 36 s from 4 s, 4 s crossfade, high-pass 25 Hz; from the hq Ogg preview |
| `audio/boat/hull_slap.opus` | [Freesound 371169: Sailboat, mic at the side of the boat](https://freesound.org/people/borralbi/sounds/371169/) | borralbi | CC0 1.0 | 2026-11-15 | 7 one-shots at 14.44 s, 19.71 s, 25.02 s, 58.01 s, 8.66 s, 17.4 s, 43.88 s (0.95 s each), one per 1 s slot, high-pass 70 Hz; from the hq Ogg preview; v2's wave hits (`?wavehit=rec`) |
| `audio/boat/chain_run.opus` | [Freesound 347837: anchor and chain.wav](https://freesound.org/people/fennelliott/sounds/347837/) | fennelliott | CC0 1.0 | 2026-10-29 | 16 s from 2 s, 2 s crossfade, high-pass 80 Hz; from the hq Ogg preview |

## Control sounds (`tools/boat_audio_pack.py`, `audio/sources.json` "sfx", played by `src/sfx.js`)

The wind-change whoosh is `audio/wind_strong.opus` through a sweeping band; the rudder's water is `audio/boat/hull_chuckle.opus` band-passed; the sheet's creak on the winch reuses `audio/boat/creak_sheet.opus`; the find's wood note is synthesised.

| File | Source | Author | Licence | Fetched | Cut |
|---|---|---|---|---|---|
| `audio/sfx/winch_click.opus` | [Freesound 566049: ratchet.wav](https://freesound.org/people/Pagey1969/sounds/566049/) | Pagey1969 | CC0 1.0 | 2026-10-29 | 7 one-shot(s) at 0.406 s, 1.106 s, 1.736 s, 11.226 s, 11.696 s, 12.116 s, 12.636 s, one per 0.25 s slot; from the hq Ogg preview |
| `audio/sfx/sheet_run.opus` | [Freesound 394222: Large rope pulley operated.wav](https://freesound.org/people/mikewest/sounds/394222/) | mikewest | CC0 1.0 | 2026-10-29 | 7 s loop from 1.5 s, 1 s crossfade; from the hq Ogg preview |
| `audio/sfx/wheel_creak.opus` | [Freesound 861827: Creaking Metal Wire of Wooden Gate](https://freesound.org/people/qubodup/sounds/861827/) | qubodup | CC0 1.0 | 2026-10-29 | 3 one-shot(s) at 0.08 s, 1.6 s, 2.18 s, one per 1.5 s slot; from the hq Ogg preview |
| `audio/sfx/page_turn.opus` | [Freesound 437121: Magazine Page](https://freesound.org/people/mosaichorse/sounds/437121/) | mosaichorse | CC0 1.0 | 2026-10-29 | 1 one-shot(s) at 0 s, one per 0.5 s slot; from the hq Ogg preview |
| `audio/sfx/kayak_splash.opus` | [Freesound 585744: Foley_Natural_Water_Jump_Mono.wav](https://freesound.org/people/Nox_Sound/sounds/585744/) | Nox_Sound | CC0 1.0 | 2026-11-15 | 2 one-shots at 5.15 s, 9.55 s (2.3 s each), one per 2.5 s slot, high-pass 60 Hz; from the hq Ogg preview; v2's kayak capsize (`v2/living/kayaks-sound.js`) |

## Fireworks sound (S4: `tools/boat_audio_pack.py`, `audio/sources.json` "fireworks", played by `src/fireworks/sound.js`)

All CC0, so no credit is required; we name them anyway. The echoes (a slap-back off the bay's walls and the long tail off the ridges) are a synthesised impulse response, no file. Each `.opus` has an AAC `.m4a` twin (`tools/audio_m4a.sh`). Not used: Dan_AudioFile's "Fireworks, single, large, distant" (CC BY 4.0; the pack tool takes CC0 only) and Thimblerig's "Summer Night With Fireworks" (CC BY-NC).

| File | Source | Author | Licence | Fetched | Cut |
|---|---|---|---|---|---|
| `audio/fireworks/fw_boom.opus` | [Freesound 784660: Distant Explosion](https://freesound.org/people/VanEngelen/sounds/784660/) | VanEngelen | CC0 1.0 | 2026-11-08 | 1 one-shot at 2.3 s (3.4 s), one per 3.5 s slot; from the hq Ogg preview |
| `audio/fireworks/fw_bang.opus` | [Freesound 158727: Fireworks.wav](https://freesound.org/people/markedit/sounds/158727/) | markedit | CC0 1.0 | 2026-11-08 | 5 one-shots at 12.03 s, 51.64 s, 44.15 s, 25.64 s, 96.42 s (1.2 s each), one per 1.25 s slot; from the hq Ogg preview |
| `audio/fireworks/fw_launch.opus` | [Freesound 158727: Fireworks.wav](https://freesound.org/people/markedit/sounds/158727/) | markedit | CC0 1.0 | 2026-11-08 | 4 one-shots at 4.48 s, 23.24 s, 53.29 s, 103.85 s (0.6 s each), one per 0.75 s slot; from the hq Ogg preview |
| `audio/fireworks/fw_crackle.opus` | [Freesound 158727: Fireworks.wav](https://freesound.org/people/markedit/sounds/158727/) | markedit | CC0 1.0 | 2026-11-08 | 3 one-shots at 37.52 s, 70.04 s, 82.4 s (2.5 s each, high-passed at 900 Hz), one per 2.5 s slot; from the hq Ogg preview |
| `audio/fireworks/fw_deep.opus` | [Freesound 235338: Fireworks Finale.wav](https://freesound.org/people/jaydawgy/sounds/235338/) | jaydawgy | CC0 1.0 | 2026-11-08 | 4 one-shots at 4.15 s, 12.5 s, 27 s, 9.37 s (1.2 s each), one per 1.25 s slot; from the hq Ogg preview |
| `audio/fireworks/fw_finale.opus` | [Freesound 235338: Fireworks Finale.wav](https://freesound.org/people/jaydawgy/sounds/235338/) | jaydawgy | CC0 1.0 | 2026-11-08 | 20 s loop from 21 s, 3 s crossfade; from the hq Ogg preview |
| `audio/fireworks/fw_whistle.opus` | [Freesound 186933: rocket-whistle.wav](https://freesound.org/people/ReadeOnly/sounds/186933/) | ReadeOnly | CC0 1.0 | 2026-11-08 | 1 one-shot at 0 s (1.44 s), one per 1.5 s slot; from the hq Ogg preview |
| `audio/fireworks/fw_whistle2.opus` | [Freesound 140726: tiny_rocket.wav](https://freesound.org/people/j1987/sounds/140726/) | j1987 | CC0 1.0 | 2026-11-08 | 1 one-shot at 0 s (1.45 s), one per 1.5 s slot; from the hq Ogg preview |
| `audio/fireworks/fw_cheer.opus` | [Freesound 102108: 072510_distant_cheer.wav](https://freesound.org/people/moxobna/sounds/102108/) | moxobna | CC0 1.0 | 2026-11-08 | 1 one-shot at 7 s (8.8 s), one per 9 s slot; from the hq Ogg preview |

## The VHF forecast voice and the skipper's voice (`tools/vhf_voice.py`, `src/vhf/radio.js`; `tools/skipper_voice.py`, `src/ui/skipperVoice.js`; 2026-10-29, 2026-10-30)

Synthesised locally, offline, no paid service: 77 clips (the vocabulary of `src/vhf/forecast.js`), Kokoro voice
`am_michael`, speed 0.92, one sprite. The skipper's voice (owner pick, 2026-10-30): 49 clips of the old skipper's hint lines, Kokoro voice `bm_george`, speed 0.88, one file a line, each a few seconds.

| File | Made with | Licence | Source | Read |
|---|---|---|---|---|
| `audio/vhf/forecast.opus`, `audio/vhf/forecast.json` | Kokoro-82M v1.0 weights (int8 ONNX `kokoro-v1.0.int8.onnx`, voices `voices-v1.0.bin`) | Apache-2.0 (the weights and voices; the output is ours to use) | https://huggingface.co/hexgrad/Kokoro-82M ; files from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1 | 2026-10-29 |
| `audio/skipper/*.opus`, `audio/skipper/*.m4a`, `audio/skipper/manifest.json` (the skipper's voice: 49 hint lines, `tools/skipper_voice.py`) | Kokoro-82M v1.0 weights (same files as above), voice `bm_george`, speed 0.88 | Apache-2.0 (the weights and voices; the output is ours to use) | https://huggingface.co/hexgrad/Kokoro-82M | 2026-10-30 |
| (the runner) | kokoro-onnx 0.6.1 | MIT | https://github.com/thewh1teagle/kokoro-onnx | 2026-10-29 |
| (text to phonemes, build time only) | espeak-ng 1.52 via phonemizer 3.4 | GPL-3.0 (a tool we run; nothing of it ships) | https://github.com/espeak-ng/espeak-ng | 2026-10-29 |

The radio processing (band-pass, hiss, squelch) and the harbour's murmur are synthesised in the page; no recordings.

## Birds (wow/birds, 2026-11-05: `src/birds/`)

The birds are ours: procedural bodies (`src/birds/build.js`), no third-party model. The flocking follows Reynolds (1987). The instanced wings, flapped in the vertex shader, follow the idea of the three.js GPGPU birds example (MIT, © three.js authors); no code was copied. The calls are cut by `tools/birds_audio_pack.py` (`audio/sources.json` "birds").

| File | Source | Author | Licence | Fetched | Cut |
|---|---|---|---|---|---|
| `audio/birds/osprey_a.opus` | [Osprey.ogg](https://commons.wikimedia.org/wiki/File:Osprey.ogg) | G. McGrane (2004) | Public domain (PD-self) | 2026-11-05 | 2.3 s from 0.0 s, mono, high-passed, loudness-normalised |
| `audio/birds/osprey_b.opus` | [Osprey.ogg](https://commons.wikimedia.org/wiki/File:Osprey.ogg) | G. McGrane (2004) | Public domain (PD-self) | 2026-11-05 | 2.05 s from 2.2 s, mono, high-passed, loudness-normalised |
| `audio/birds/eagle_a.opus` | [Bald_Eagle_Yellowstone_National_Park.ogg](https://commons.wikimedia.org/wiki/File:Bald_Eagle_Yellowstone_National_Park.ogg) | National Park Service | Public domain (PD-USGov-NPS) | 2026-11-05 | 2.45 s from 0.0 s, mono, high-passed, loudness-normalised |
| `audio/birds/gull_a.opus` | [Western_Gull_Golden_Gate_National_Recreation_Area.ogg](https://commons.wikimedia.org/wiki/File:Western_Gull_Golden_Gate_National_Recreation_Area.ogg) | National Park Service | Public domain (PD-USGov-NPS) | 2026-11-05 | 3.0 s from 0.0 s, mono, high-passed, loudness-normalised |
| `audio/birds/gull_b.opus` | [Gull_1.ogg](https://commons.wikimedia.org/wiki/File:Gull_1.ogg) | avphillips (pdsounds.org) | Public domain | 2026-11-05 | 2.4 s from 0.0 s, mono, high-passed, loudness-normalised |
| `audio/birds/goose_a.opus` | [Yellowstone_sound_library_-_Canada_Geese_-_001.mp3](https://commons.wikimedia.org/wiki/File:Yellowstone_sound_library_-_Canada_Geese_-_001.mp3) | NPS & MSU Acoustic Atlas (Jennifer Jerrett) | Public domain (PD-USGov) | 2026-11-05 | 2.6 s from 12.6 s, mono, high-passed, loudness-normalised |
| `audio/birds/goose_b.opus` | [Yellowstone_sound_library_-_Canada_Geese_-_001.mp3](https://commons.wikimedia.org/wiki/File:Yellowstone_sound_library_-_Canada_Geese_-_001.mp3) | NPS & MSU Acoustic Atlas (Jennifer Jerrett) | Public domain (PD-USGov) | 2026-11-05 | 2.4 s from 4.6 s, mono, high-passed, loudness-normalised |
| `audio/birds/splash_big.opus` | [Freesound 179340 (hq preview)](https://freesound.org/people/lolamadeus/sounds/179340/) | lolamadeus | CC0 1.0 | 2026-11-05 | 2.2 s from 0.0 s, mono, high-passed, loudness-normalised |
| `audio/birds/splash_small.opus` | [Freesound 179340 (hq preview)](https://freesound.org/people/lolamadeus/sounds/179340/) | lolamadeus | CC0 1.0 | 2026-11-05 | 0.8 s from 6.0 s, mono, high-passed, loudness-normalised |

## Fireworks music (S4, owner picks 2026-11-08: `tools/fireworks/music_pack.sh`, played by `src/fireworks/music.js`)

Credit lines, as the licence asks (also on the in-game Credits page):
- "Full Moon" by Marcelo Fernandez (marcelofernandezmusic.com), CC BY 4.0.
- "Over The Clouds" by Marcelo Fernandez (marcelofernandezmusic.com), CC BY 4.0.

The marches: recordings by the United States Marine Band ("The President's Own"), made by serving Marines as part of their official duties, so a work of the U.S. federal government and in the public domain (17 U.S.C. § 105; Wikimedia Commons tag PD-USGov-Military-Marines). The Marine Band's page for "The Complete Marches of John Philip Sousa" says the recordings "are all available for public use". The compositions (Sousa, d. 1932) are public domain. Changes: each file loudness-normalised and re-encoded; the marches mono and band-passed (a small cockpit speaker).

| File | Title | Source | Author | Licence | Fetched | Cut |
|---|---|---|---|---|---|---|
| `audio/fireworks/music/full_moon.opus` | Full Moon | [OpenGameArt: Full Moon](https://opengameart.org/content/full-moon-0) | Marcelo Fernandez (marcelofernandezmusic.com) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 2026-11-08 | whole piece (3:38), -23 LUFS, stereo Opus 64 kb/s |
| `audio/fireworks/music/over_the_clouds.opus` | Over The Clouds (loop version) | [OpenGameArt: Over The Clouds](https://opengameart.org/content/over-the-clouds) | Marcelo Fernandez (marcelofernandezmusic.com) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 2026-11-08 | whole loop (2:42), -23 LUFS, stereo Opus 64 kb/s |
| `audio/fireworks/music/radio_stars_and_stripes.opus` | The Stars and Stripes Forever (2017) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sousa%27s_%22The_Stars_and_Stripes_Forever%22_-_United_States_Marine_Band_(2017).mp3) | United States Marine Band, Lt Col Jason K. Fettig | Public domain (U.S. government work) | 2026-11-08 | whole (3:34), mono, 280 Hz-3.8 kHz, -26 LUFS, Opus 32 kb/s |
| `audio/fireworks/music/radio_semper_fidelis.opus` | Semper Fidelis (2016) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sousa%27s_%22Semper_Fidelis%22_-_United_States_Marine_Band_(2016).mp3) | United States Marine Band, Lt Col Jason K. Fettig | Public domain (U.S. government work) | 2026-11-08 | whole (2:48), mono, 280 Hz-3.8 kHz, -26 LUFS, Opus 32 kb/s |

## Music (MusicAPI, AI-generated)

**AI-generated, not covered by the MIT licence** (`NOTICE.md`): made by MusicAPI (musicapi.ai, model sonic-v6) from our briefs in `audio/beds/*.json`, and distributed as part of the game under MusicAPI's terms. No licence to reuse these files separately is granted. **Terms** (https://musicapi.ai/terms, "Last updated July 27, 2026", re-read 2026-10-29): s.2 "you, as the user, retain full ownership of the generated content"; "You are permitted to use, distribute, and modify the songs generated through MusicAPI for commercial or personal purposes"; s.7.3 "you may use the Services, and the audio you generate through them, in your own commercial products and services". The open point: s.13.3 says third-party models' terms are "outside our control" and the terms do not name the upstream model, and s.2 makes us indemnify MusicAPI against third-party copyright claims. Reading: commercial web use is allowed by MusicAPI; the upstream model's own terms are unknown (our reading, not counsel's).

| File | Title | Source | Licence | Made | Cut |
|---|---|---|---|---|---|
| `audio/music/golden_hour_a.opus` | Golden hour on the lake (take A) | MusicAPI sonic-v6, generated 2026-10-29 from audio/beds/golden.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-29 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/golden_hour_b.opus` | Golden hour on the lake (take B) | MusicAPI sonic-v6, generated 2026-10-29 from audio/beds/golden.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-29 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/dusk_water_a.opus` | Dusk over the water (take A) | MusicAPI sonic-v6, generated 2026-10-29 from audio/beds/night.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-29 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/dusk_water_b.opus` | Dusk over the water (take B) | MusicAPI sonic-v6, generated 2026-10-29 from audio/beds/night.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-29 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/first_light_a.opus` | Lake at first light (take A) | MusicAPI sonic-v6, generated 2026-10-28 from audio/beds/dawn.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-28 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/first_light_b.opus` | Lake at first light (take B) | MusicAPI sonic-v6, generated 2026-10-28 from audio/beds/dawn.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-28 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/over_the_ridge_a.opus` | Over the ridge (take A) | MusicAPI sonic-v6, generated 2026-10-28 from audio/beds/vista.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-28 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/over_the_ridge_b.opus` | Over the ridge (take B) | MusicAPI sonic-v6, generated 2026-10-28 from audio/beds/vista.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-28 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/race_prestart_a.opus` | Ten minutes to the gun (Regatta pre-start) | MusicAPI sonic-v6, generated 2026-10-30 from audio/beds/raceprestart.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-30 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/race_main_a.opus` | Close reach (Regatta race loop) | MusicAPI sonic-v6, generated 2026-10-30 from audio/beds/racemain.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-30 | −23 LUFS, no tail fade (a loop: the player crossfades its end into its middle), Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/wind_rising_a.opus` | Wind rising on the water (take A) | MusicAPI sonic-v6, generated 2026-10-28 from audio/beds/wind.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-28 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |
| `audio/music/wind_rising_b.opus` | Wind rising on the water (take B) | MusicAPI sonic-v6, generated 2026-10-28 from audio/beds/wind.json | AI-generated, not MIT: MusicAPI's terms (s.2, s.7.3) | 2026-10-28 | −23 LUFS, 5 s tail fade, Opus 96 kb/s stereo (`tools/music_pack.py`) |

## Fonts
| File | Source | Author | Licence | Fetched |
|---|---|---|---|---|
| `fonts/jost-latin.woff2` | [Google Fonts: Jost](https://fonts.google.com/specimen/Jost) (variable, latin subset, v20) | Owen Earl (indestructible type*) | SIL Open Font License 1.1 | 2026-10-29 |
| `fonts/jost-italic-latin.woff2` | [Jost italic via Fontsource](https://fontsource.org/fonts/jost) (variable, latin subset; the Google Fonts Jost italic) | Owen Earl (indestructible type*) | SIL Open Font License 1.1 | 2026-10-30 |
| `fonts/atkinson-hyperlegible-next-latin-{400,500}.woff2` | [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next), latin subset via the `@fontsource/atkinson-hyperlegible-next` 5.3.0 package; licence text in `fonts/OFL-atkinson-hyperlegible-next.txt` | Braille Institute of America (The Atkinson Hyperlegible Next Project Authors) | SIL Open Font License 1.1 | 2026-10-29 |
| `fonts/LibreBaskerville-Italic.ttf` (+ `fonts/OFL-libre-baskerville.txt`) | [Libre Baskerville Italic](https://github.com/google/fonts/tree/main/ofl/librebaskerville) (variable, default instance), read by `blender/m1_hull.py` only: its outlines are the lettering of the boat's name on the transom (`hull.glb`, object `transom_name`); not served to the browser | The Libre Baskerville Project Authors (Impallari Type) | SIL Open Font License 1.1 | 2026-10-30 |

## Terrain: the real Lake Tahoe basin (`tools/terrain/`, `terrain/*.lsh`, read by `src/terrain-data.js`)

US federal works: public domain (17 U.S.C. § 105), no licence needed; we credit the U.S. Geological Survey as asked. Raw
downloads live in `third_party/tahoe/raw/` (git-ignored); only the compact derived grids (10.1 MB) are committed.
`tools/terrain/fetch_tahoe.sh` and `fetch_island_lidar.py` fetch them again; `build_tahoe.py` rebuilds the grids.

| Data | Source | Licence | Fetched | Used for |
|---|---|---|---|---|
| USGS 3DEP Bare Earth DEM (1 m lidar where flown, 1/3 arc-second elsewhere) | [3DEP Elevation ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer), exportImage in UTM 10N at 1 / 10 / 30 / 100 m | public domain (USGS) | 2026-10-29 | the bay (2 m), the basin (10 m), the lake (32 m), the far Sierra ring (96 m) |
| USGS 3DEP lidar point cloud, CA_SierraNevada_5_2022 (points over Fannette Island) | [usgs-lidar-public on AWS (Entwine Point Tiles)](https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SierraNevada_5_2022/ept.json) | public domain (USGS) | 2026-10-29 | Fannette Island at 1 m (the DEMs flatten it into the lake) |
| Lake Tahoe bathymetry, 10 m grid (Gardner, Mayer, Hughes Clarke 1998 multibeam; USGS DDS-55) | [pubs.usgs.gov/dds/dds-55](https://pubs.usgs.gov/dds/dds-55/pacmaps/lt_data.htm), `lt_bathy.e00.gz` | public domain (USGS); "U.S. Geological Survey"; not for navigation | 2026-10-29 | the lake bed |
| Lake Tahoe's water clarity: annual mean Secchi depth 69.2 ft (21.1 m) in 2025, 62.3 ft (19.0 m) in 2024, 97.4 ft (29.7 m) in 1967–71 (UC Davis Tahoe Environmental Research Center, "Tahoe: State of the Lake Report 2026") | [tahoe.ucdavis.edu/stateofthelake](https://tahoe.ucdavis.edu/stateofthelake); reported 2026-06-09 ([South Tahoe Now](https://www.southtahoenow.com/06/09/2026/how-clear-is-lake-tahoe-most-recent-clarity-report-released)) | a published figure (a fact; nothing copied) | 2026-11-05 | the water's attenuation and how deep the bed shows (`src/water-spectrum.js` WATER_K, `src/waters/clarity-optics.js`) |
| NLCD 2021 Land Cover (CONUS), 30 m | [MRLC WCS](https://www.mrlc.gov/geoserver/mrlc_download/wcs) `NLCD_2021_Land_Cover_L48` | public domain (USGS/MRLC) | 2026-10-29 | the ground cover: forest, shrub, grass, bare rock, built ground, other lakes |
| NLCD 2021 Impervious (CONUS), 30 m | the same WCS, `NLCD_2021_Impervious_L48` | public domain | 2026-10-29 | fetched, not used yet |
| NAIP 2022 aerial imagery, 4 band (red, green, blue, near infrared), 0.6 m, California, flown 2022-07-21 | [USGS National Map NAIP Plus ImageServer](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer) (exportImage in UTM 10N); [NAIP programme, USDA FSA](https://www.fpacbc.usda.gov/geo/naip/) | public domain (USDA Farm Service Agency, via USGS); "USDA Farm Service Agency, NAIP 2022" | 2026-10-30 | the ground's base colour and class masks (`terrain/naip/*.webp`): de-lit with our DEM at the capture sun, graded to's albedo targets by `tools/ground/build_naip.py`; raw tiles in `third_party/naip/raw/` (git-ignored) |

Real place positions (Vikingsholm, Emerald and Eagle Points, Eagle Creek, Mount Tallac, Dicks and Pyramid Peaks) are
GNIS / Wikipedia coordinates (facts, not copied works). Reference photos (Wikimedia Commons) are linked, never copied.

## Towns, ski runs, roads, piers (art/towns: `tools/geo/fetch_osm.sh`, `tools/geo/build_towns.mjs`)

| File | Source | Author | Licence | Fetched | Use |
|---|---|---|---|---|---|
| `data/geo/tahoe-towns.json` | [OpenStreetMap](https://www.openstreetmap.org) via the [Overpass API](https://overpass-api.de) (buildings, `piste:type=downhill`, `aerialway`, `landuse=winter_sports`, highways trunk–tertiary, land use, golf, parking, marinas, piers, place nodes) round Lake Tahoe | © OpenStreetMap contributors | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) ([copyright](https://www.openstreetmap.org/copyright)) | 2026-10-29 (OSM base 2026-10-29T23:10:06Z) | a derivative database: footprints reduced to oriented boxes, lines simplified (3–10 m), UTM 10N integers, names dropped. It stays under the ODbL; anyone receiving the game may ask for it. On-screen credit: "Map data © OpenStreetMap contributors" in the credits |

The Stateline high-rises' floor counts (15–19) and the other heights the data lacks are estimates from public sources.

## Ground textures (`terrain/ground/`, read by `src/ground.js`)

ambientCG PBR sets, CC0 1.0 (https://docs.ambientcg.com/license, read 2026-10-29), fetched 2026-10-29 as the 1K JPEG packs
(`https://ambientcg.com/get?file=<id>_1K-JPG.zip`). Only derived strips are committed: `albedo.webp` (six 512² colour tiles,
each graded to a target mean, stacked) and `pack.webp` (six 256² tiles: the GL normal's X and Y in R and G, the displacement
in B). Raw packs stay out of the repo.

| Layer | ambientCG set | Author | Licence | Fetched | Cut |
|---|---|---|---|---|---|
| granite slabs and cliffs (lichen) | [Rock051](https://ambientcg.com/view?id=Rock051) | ambientCG (Lennart Demes) | CC0 1.0 | 2026-10-29 | Color, NormalGL, Displacement; 1K → 512 / 256; mean to sRGB 126, 120, 110 |
| decomposed granite, talus | [Ground110](https://ambientcg.com/view?id=Ground110) | ambientCG | CC0 1.0 | 2026-10-29 | the same maps; 112 / 85 % saturation, gamma 1.25 (the white chips compressed); mean to 104, 96, 84 |
| pine-needle duff | [Ground077](https://ambientcg.com/view?id=Ground077) | ambientCG | CC0 1.0 | 2026-10-29 | the same maps; 72 / 55 %, colourised 12 % to #5a3f2e; mean to 92, 66, 48 |
| beach sand (coarse granitic grit) | [Ground079S](https://ambientcg.com/view?id=Ground079S) | ambientCG | CC0 1.0 | 2026-10-29 | the same maps; 104 / 70 %; mean to 176, 166, 146 (replaced Ground054, too smooth to read at 1.6 m) |
| meadow grass | [Grass004](https://ambientcg.com/view?id=Grass004) | ambientCG | CC0 1.0 | 2026-10-29 | the same maps; saturation 62 %; mean to 104, 128, 62 (June's green; the shader dries it to straw by `TAHOE.season.grassDry`) |
| snow | [Snow004](https://ambientcg.com/view?id=Snow004) | ambientCG | CC0 1.0 | 2026-10-29 | the same maps (no AO in the set); mean unchanged |

## Bark textures (art/bark, 2026-10-29)
ambientCG, CC0 1.0 ("All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License", https://docs.ambientcg.com/license, read 2026-10-29). Downloaded 2026-10-29 as the 1K-JPG sets, resized to 512 px (Color and NormalGL only) into `models/bark/`:
- Bark006 (https://ambientcg.com/a/Bark006) — grey scaly bark with cinnamon flakes: Jeffrey pine and sugar pine plates.
- Bark007 (https://ambientcg.com/a/Bark007) — light grey cracked bark: white fir.
- Bark014 (https://ambientcg.com/a/Bark014) — red-brown fissured fir bark: red fir, mountain hemlock.
- Bark012 (https://ambientcg.com/a/Bark012) — olive-brown fibrous vertical bark: incense cedar, the fallen logs.
- Bark015 (https://ambientcg.com/a/Bark015) — thin grey-brown striated bark: lodgepole pine.
- Bark009 (https://ambientcg.com/a/Bark009) — smooth pale bark: the snags (silvered in the shader).
The species' colours come from the shader's tint over these; the textures give the structure and the normals.

## AI-generated and AI-assisted (Gemini)

**AI-generated, not covered by the MIT licence** (`NOTICE.md`): the images below marked "AI-made" are distributed as part of the game under Google's Gemini terms; no licence to reuse them separately is granted. The Lucid Lake foil image is also a logo (the trademark note in `NOTICE.md`).

One Gemini image ships: G1, the Lucid Lake mark in foil (below). Every other image here stays under `renders/` (git-ignored), as a reference only.

| What | Model | Made | Use |
|---|---|---|---|
| **G1, the Lucid Lake foil image** (`brand/lucidlake/lucidlake-g1-foil.jpg`, 2048 px, the original; `lucidlake-g1-1024.webp` 63 kB and `-512.webp` 7.6 kB; in `brand/social/velia-og.jpg`) | Gemini (image), from our own mark (`brand/lucidlake/`); the exact model not recorded | 2026-10-29 | **AI-made, ships.** The mark and "Lucid Lake" as cream and gold foil pressed into textured navy paper. Made from our own mark; chosen by the owner, 2026-10-30. Used on the loading page's studio card, the menu's About, and the share card. The vector mark stays for small sizes |
| Design critiques (`tools/judge.py --brief ui`, `--brief cockpit`) | Gemini `gemini-3.1-flash-lite` | 2026-10-29 | text verdicts on our captures; no asset |
## Boat cockpit and rig (boat/hero-cockpit, 2026-10-29)
No third-party or AI-generated assets. Every texture is generated in code: the non-skid (normal, tone, roughness), the cushion canvas weave, the teak and the engine panel's dial in `blender/m3_hero.py` (numpy); the sail weave, crinkles and reef points, the rope braid and the lazy bag's folds are procedural TSL (`src/boat/sails.js`, `lines.js`, `spars-mesh.js`). Reference photos were viewed, not copied: Wikimedia Commons, `Category:Catalina_28` (CC0, user Ahunt), files named
## Boat cockpit and rig: the racing marks (feat/marks, 2026-10-30)
No third-party assets. The marks, the committee boat and the pin buoy are built in code (`src/marks/models.js`). The collision thump is synthesised at run time (`src/marks/scene.js` createThump: a falling sine and a low-passed noise puff, seeded); no recording and no licence to log. A recorded CC0 rubber thump (Freesound) can replace it later; log it here then.

## Home card art (brand/card-art, 2026-10-30)
| What | Model | Made | Use |
|---|---|---|---|
| **Card art, an engraved chart of a bay** (`brand/card/card-art-1.webp`, 866x1160, cropped from option A; the 16 px placeholder is inline in `src/ui/loading-shell.html`) | Gemini `gemini-3.1-flash-image`, 1K, from our written brief (`tools/card_art.py`, option `a`); no reference image, no text | 2026-10-30 | **AI-made, ships.** Sepia copperplate chart on paper with a compass rose; the background of the home card. Brief by us, picked from six directions (A-F) on the criteria; chosen by the owner (2026-10-30). Options B-F stay under `renders/cardart/` (git-ignored) |

The impostor hull card follows the idea in agargaro/octahedral-impostor (MIT), sweriko/horde (MIT) and SkyeShark/SeedThree (MIT); no code from them is copied or vendored. The Emerald Bay 2011 photo (Wikimedia Commons, DimiTalen, CC0) is a proof reference in `renders/` only (git-ignored), never shipped.
| **Wind dial glass texture** (`brand/dial/dial-glass.webp`, 512 px greyscale, contrast-stretched from option A; `tools/dial_texture.py`) | Gemini `gemini-3.1-flash-image`, 1K, from our written brief; no reference image, no text | 2026-10-30 | **AI-made, ships.** A dark brushed-glass grain behind the wind dial's boat drawing, screen-blended at 20 % so it takes the night palette. Option B (dark chart paper) was not used; it stays under `renders/dialtex/` (git-ignored) |
| **Key-row switch sprites** (`brand/dash/switches@{1,2,3}x.webp`, `placard@{1,2,3}x.webp`) | Made by us: rocker switches, stainless push-buttons, a mounting plate and an engraved placard modelled and rendered in Blender (Cycles) by `blender/dash_switches.py`, packed by `tools/dash/pack_sprites.py`; the printed glyphs are the dock's own hairline icons. No third-party model, texture or HDRI; no AI image. | Lucid Lake Studio | ours (Blender is GPL, its output is ours) | 2026-10-30 |
| **Subtitle faces** `fonts/sub/{fraunces-soft,cormorant-garamond-600,newsreader,spectral-500,figtree}.woff2` (Latin subsets; Fraunces pinned at SOFT 100, WONK 1, opsz 60, weight 400-700; Newsreader at opsz 28) via the `@fontsource` 5.3.0 packages of [Fraunces](https://github.com/undercasetype/Fraunces), [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant), [Newsreader](https://github.com/productiontype/Newsreader), [Spectral](https://github.com/productiontype/Spectral), [Figtree](https://github.com/erikdkennedy/figtree); licence texts `fonts/OFL-{fraunces,cormorant-garamond,newsreader,spectral,figtree}.txt` | The Fraunces, Cormorant, Newsreader, Spectral and Figtree Project Authors | SIL Open Font License 1.1 | 2026-10-30 |
| **Slogan faces** `fonts/pinyon-script-400.woff2`, `fonts/cormorant-sc-600.woff2` (Latin subsets: Basic Latin plus the curly quotes, made with fontTools from the `@fontsource` 5.3.0 packages of [Pinyon Script](https://github.com/SorkinType/Pinyon) and [Cormorant SC](https://github.com/CatharsisFonts/Cormorant)); licence texts `fonts/OFL-pinyon-script.txt`, `fonts/OFL-cormorant-sc.txt` | The PinyonScript Project Authors (Eduardo Tunni, Sorkin Type); The Cormorant Project Authors (Christian Thalmann) | SIL Open Font License 1.1 | 2026-11-19 |
| **Navy card art, an engraved chart with a gold-foil compass rose** (`brand/card/card-art-navy-1.webp`, 880x1180, cropped from option n3; its 16 px placeholder is inline in `src/ui/loading-shell.html`) | Gemini `gemini-3.1-flash-image`, 1K, from our written brief (`tools/card_art.py`, option `n3`); no reference image, no text | 2026-10-30 | **AI-made, behind the `?card=navy` flag.** Cream ink and a hint of gold foil on textured navy paper, in the Lucid Lake brand colours. Picked from four options (n1-n4); the owner picks parchment or navy. Options stay under `renders/` (git-ignored) |

## Icons (2026-10-30)
| Asset | Source | Date | Licence |
|---|---|---|---|
| The Settings gear in the top bar (`src/ui/viewSwitch.js`) | Feather Icons "settings" path, by Cole Bemis — https://feathericons.com | 2026-10-30 | MIT |
| The GitHub mark on v2's card foot, beside the word "GitHub", linking to this repo (`v2/ui/source.js` GH_MARK) | GitHub's mark (the Invertocat), GitHub, Inc. — https://github.com/logos | 2026-11-24 | GitHub's trademark, used as its logo guidelines allow: unaltered, to link to the project on GitHub; not under this repo's MIT licence |

## KTX2 texture compression (feat/ktx2, 2026-10-31)
| What | Source | Licence | Use |
|---|---|---|---|
| Basis Universal transcoder (`public/basis/basis_transcoder.{js,wasm}`) | copied from three.js 0.184.0 `examples/jsm/libs/basis` (Binomial LLC, Basis Universal) | Apache-2.0 | decodes the KTX2 files in the browser, self-hosted |

## Sky code (refactor/p1-perf, 2026-11-06)
| What | Source | Licence | Use |
|---|---|---|---|
| astronomy-engine 2.1.19 (npm) | Don Cross, https://github.com/cosinekitty/astronomy | MIT | the ephemeris under those helpers (a dependency of the sky library already; now declared) |

## v2 water and sky (v2 M1, 2026-11-12: `v2/sim/spectrum.js`, `v2/render/water.js`, `v2/render/sky.js`)
| What | Source | Licence | Use |
|---|---|---|---|
| `v2/sim/spectrum.js` (h0: JONSWAP + cos-2s spread, capillary-gravity dispersion, pcg2d Gaussian draws) and the WGSL of `v2/render/water.js`'s evolve, Stockham IFFT and assemble passes | Ultra-Water, https://github.com/Humpalumps/Ultra-Water, commit ce9248fa (2026-10-30), `OceanSim.js`; the maths ported to WGSL and plain JS from v1's own port `src/waters/ultra/gpu.js` | MIT (`src/waters/ultra/LICENSE`, copyright (c) 2026 Humpalumps; the notice is kept in the file headers) | the FFT sea; the mesh, the shading, the mips, the readback and the Hs gain are ours |
| `v2/sim/shoreField.js`, `v2/render/shore.js`, `tools/v2-shore-bake.mjs` (#56 M3, 2026-11-14): the shore field's bake (the exact distance transform, the fast-sweeping eikonal travel time, the front direction, coherence, curvature and ray tube), the shore trains (phase ω(τ + t), Green's law, the 0.42 d breaking limit, peeling, the plunging lean, the lip glow, the surf zone's lace), the swash and its drying, the breaker spray | Ultra-Water, https://github.com/Humpalumps/Ultra-Water, commit ce9248f, `src/water/shoreMap.js`, `src/water/OceanSurface.js` SHORE_GLSL / shoreWaves / SWASH_GLSL / FRAG, `src/water/Spray.js`; JS ported to v2's grids, GLSL to WGSL | MIT (`src/waters/ultra/LICENSE`, copyright (c) 2026 Humpalumps; the notice in the files' headers) | the beaches' breakers, swash, wet sand and spray; a lake's numbers (two travel times for short wind waves, the run-up by Stockdon et al. 2006, the breaker by the surf similarity), the field baked from v1's heights into `v2/assets/shore/shore.vsf.gz` |
| `v2/render/water-surface.js` (#56 M1, 2026-11-14): the whitecap foam bake (tileable Voronoi lace, billow height and gradient), its erosion with age and its shading (billow bump, crease shade, the thin foam's tint, the sun through thin foam, the bubble sheen), the crest subsurface (k1), the glint's height-correlated Smith term, floor and facet glitter (over v1's Beckmann lobe) (Poisson counts per cell) | Ultra-Water, https://github.com/Humpalumps/Ultra-Water, commit ce9248f, `src/water/bakeTextures.js` FOAM and `src/water/OceanSurface.js` FRAG; GLSL ported to WGSL | MIT (`src/waters/ultra/LICENSE`, copyright (c) 2026 Humpalumps; the notice in the file's header) | the water's whitecaps, crests against the sun and sun glint; the twinkle smoothed (a slow crossfade, capped), the coverage v1's (Monahan's share), the foam baked at 256² into the slope array |
| `v2/render/caustics.js` (#56 M2, 2026-11-14): the caustics' area-ratio splat (the refracted grid over a cascade tile, the B-spline slope read, the landed |det| clamped at 16, the margins' wrap-around, the depth slices' blend, the entry-point lookup) | Ultra-Water, https://github.com/Humpalumps/Ultra-Water, commit ce9248f, `src/water/Caustics.js` (after Evan Wallace's WebGL Water); GLSL ported to WGSL | MIT (`src/waters/ultra/LICENSE`, copyright (c) 2026 Humpalumps; the notice in the file's header) | the sun's caustics on the lake bed; two cascades (12 m and 2.1 m) multiplied, one 2-layer array, the mip chain, the depth and sun fades are ours |
| `v2/render/sky.js`: the atmosphere LUTs | written from Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique" (EGSR 2020), and Bruneton & Neyret 2008, "Precomputed Atmospheric Scattering" (the transmittance parametrisation); no code ported | – (papers) | the sky, the sun's transmittance, the water's reflections |
| `v2/render/sky.js` aerial perspective (v2 M2, 2026-11-13) and `v2/terrain/quadtree.js` (CDLOD) | written from Hillaire 2020 § 5.4 (the aerial-perspective froxels) and Strugar 2009, "Continuous Distance-Dependent Level of Detail for Rendering Heightmaps" (JGT 14(4)); no code ported | – (papers) | the haze on the far ridges; the terrain mesh's LOD and morph |
| `v2/render/terrain.js` `hash` (hash12, "Hash without Sine") | Dave Hoskins, https://www.shadertoy.com/view/4djSRW (read 2026-11-13) | MIT | the value noise that warps the cover classes' edges and varies the ground's albedo |
| `v2/render/web-ocean/foamMap.js` (2026-11-19): the persistent whitecap foam: two camera-centred world-space foam maps addressed toroidally, the semi-Lagrangian drift downwind, the decay (0.22/s), the growth and the freshness, the levels blended by the Chebyshev distance, aged foam broken into wind-aligned streaks | web-ocean, https://github.com/Noniv/web-ocean, commit a07c7fd (2026-10-17), `js/wgsl/sim.js` `FOAM_UPDATE`, `js/wgsl/ocean.js` (the foam read), `js/main.js` (its constants); © 2026 Maksymilian Dendura | MIT (`v2/render/web-ocean/LICENSE`) | ported to storage buffers (2 × 512², 128 and 1024 m) read bilinear by hand; the injection is v2's own whitecap density (render/water-surface.js), not web-ocean's Jacobian threshold; the streaks read v2's baked foam lace |

## v2 trees (T5, 2026-11-13: `v2/forest/trees.js`, `v2/render/forest.js`)
| What | Source | Licence | Use |
|---|---|---|---|
| `v2/forest/trees.js` (`env`, the bough lists and the mesh build: stem, tiers, sprays, curtains) and the WGSL in `v2/render/forest.js` (the needle cut `sprayCut`/`curtainCut`, the needle facets, the card's own shade and the needle light) | Cold Smoke, https://github.com/huiskylabs/cold-smoke, commit eaf635c, `src/14_trees.js` (read 2026-11-13) | MIT, Copyright (c) 2026 Huisky (the notice is kept in `v2/forest/trees.js`'s header; `forest.js` points to it) | the trees photographed into the cards' atlas and lit at draw time; the snow dropped, v1's species, the pine tufts and the shrub ours |

## v2 sound beds (step 3, 2026-11-13: `v2/audio/noise.js`, `v2/audio/beds.js`; v1's recordings in `v2/audio/recorded.js`)
| What | Source | Licence | Use |
|---|---|---|---|
| `v2/audio/noise.js` (the noise material: Gaussian white, Kellet's pink with the cross-faded loop, the fractal LFO curves, the patter grains) and in `v2/audio/beds.js` the always-running voices, the 0.6 % dead band, the hit envelopes, the compressor settings and the soft ceiling's curve, the wind's chain (the 300 + 830·u^1.1 Hz cutoff, each ear's buffeting) and the Q 18 whistle | Cold Smoke, https://github.com/huiskylabs/cold-smoke, commit eaf635c, `src/18_sound.js` (read 2026-11-13) | MIT, Copyright (c) 2026 Huisky (the full notice is kept in `v2/audio/noise.js`'s header; `beds.js` points to it) | the lake's wind synthesised in the page (the hull's water, the sails and the rain play v1's recordings since the owner's ear test, 2026-11-13: the boat and lake rows above); the snow's creaks, chirps and poles not ported; the patter's density, grain and soft limit ours |

## Milky Way (feat/milky-way, 2026-11-07: `tools/milkyway/build.mjs`, `data/sky/`, drawn by `src/core/milkyway.js`)
| Asset | Source | Date | Licence |
|---|---|---|---|
| The star catalogue for v2's night (`v2/assets/night/stars.bin`, a copy of `@takram/three-atmosphere`'s `assets/stars.bin`: the 9,096 stars of the Yale Bright Star Catalog v5 as J2000 directions, magnitudes and black-body colours, 10 bytes a star; v1 draws the same file through the library) | [Yale Bright Star Catalog v5](http://tdc-www.harvard.edu/catalogs/bsc5.html) (Hoffleit & Warren 1991) as packed by [@takram/three-atmosphere](https://github.com/takram-design-engineering/three-geospatial) 0.19.1 | Takram (the packing); the catalogue is public data | [MIT](https://github.com/takram-design-engineering/three-geospatial/blob/main/LICENSE) (the package, "except where indicated otherwise"; the catalogue itself carries no licence) | 2026-11-13 | the file as shipped in the package; decoded by `v2/sim/night.js` |
| The town lights for v2's night (`v2/assets/night/lights.bin`) | derived from `data/geo/tahoe-towns.json` (the OpenStreetMap row above) by v1's own layout (`src/towns-layout.js`) through `tools/v2-lights-pack.mjs` | © OpenStreetMap contributors | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | 2026-11-13 | 24,866 points (position, colour, size, switch-on sun elevation), 12 bytes each; the same on-screen credit |
| The piers, breakwaters, boathouses, harbour and the ground's marks (ski runs, Hwy 89's asphalt and cut) for v2 (`v2/assets/towns/shore.vsh.gz`, `mask.vtm.gz`) | derived from `data/geo/tahoe-towns.json` (the OpenStreetMap row above) by v1's own layouts (`src/towns-layout.js`, `src/shoreline-layout.js`, `src/harbour.js`) through `tools/v2-towns-pack.mjs` | © OpenStreetMap contributors | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | 2026-11-13 | 5,745 instanced boxes, pilings, roofs and rocks (a 3 × 4 matrix and a tint each) and the masks' rasters (2.5 m and 25 m, with their means); the same on-screen credit |
| The Milky Way in the night sky (`data/sky/milkyway-4k.webp`, `milkyway-2k.webp`, `milkyway-tint.png`) | NASA SVS "Deep Star Maps 2020" (ID 4851, 2020-09-09), the Milky Way background layer without the bright Hipparcos and Tycho stars, J2000 celestial coordinates, `milkyway_2020_4k.exr` — https://svs.gsfc.nasa.gov/4851 (animator Ernie Wright, USRA). Built from Hipparcos-2, Tycho-2 and Gaia DR2. Credit: "NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC." | downloaded 2026-11-07 | Public domain (NASA SVS: "All of our content is in the public domain (unless otherwise noted)", https://svs.gsfc.nasa.gov/help/; the page notes no exception). The Gaia data: "The Gaia data are open and free to use, provided credit is given to 'ESA/Gaia/DPAC'" (https://gea.esac.esa.int/archive/documentation/GDR2/Miscellaneous/sec_credit_and_citation_instructions/). No share-alike: ESA's CC BY-SA 3.0 IGO covers ESA's own images, not this NASA map. No NASA endorsement implied. |
| cwebp (libwebp; offline, not shipped) | https://developers.google.com/speed/webp (Google) | 2026-11-07 | BSD-3-Clause |

## The kayak's paddler (feat/kayak-paddler, 2026-11-07: `src/props/paddler/`)

| File | Source | Author | Licence | Fetched | Changes |
|---|---|---|---|---|---|
| `models/paddler/ubc-male.glb`, `models/paddler/ubc-female.glb` | Universal Base Characters [Standard] (https://quaternius.com/packs/universalbasecharacters.html; free zip from https://quaternius.itch.io/universal-base-characters, downloaded by the owner; licence file `License_Standard.txt` in the zip: "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication"; zip sha256 fdbf1804…455f40) | Quaternius | CC0 1.0 | 2026-11-07 | `tools/paddler-build-ubc.py`: the Godot/UE glTF bodies (Superhero_Male/Female_FullBody), the eyes, the eyebrows and the Hair_Buzzed / Hair_BuzzedFemale haircuts (rigged to the head bone) in one GLB each; extra UV sets, vertex colours, normal and roughness maps dropped; the skin map at 512 px JPEG, the eye map at 128 px; 605 KB and 628 KB. At load: clothes painted and the clothed skin smoothed, recoloured, our own PFD and cap |
| `models/paddler/paddler.glb` | ["Man", poly.pizza](https://poly.pizza/m/HMnuH5geEG) (Ultimate Animated Character Pack; licence https://quaternius.com/license.html) | Quaternius | CC0 1.0 | 2026-11-07 | the 11 clips and unused buffers stripped (`tools/paddler-strip-glb.py`), 493 KB → 222 KB; at load: one Loop subdivision step, eyes hidden, recoloured, our own PFD and hat |

## Phones are landscape-only (feat/v2-phone-landscape-only, 2026-11-15: `v2/ui/landscape.js`, `v2/index.html`'s turn rule)

## The loading line glides on the compositor (feat/v2-loading-bar-compositor, 2026-11-18: `v2/ui/lineGlide.js`, `v2/ui/buildCard.js`)

## Bloom and dither (feat/v2-bloom-dither, 2026-11-18: `v2/render/bloom.js`, the composite in `v2/render/shaders.js`)

| Technique | Source | Author | Licence | Read | Use |
|---|---|---|---|---|---|
| The bloom chain's shape: the first downsample's 4 bilinear taps each clamped and Karis-weighted (`kar`: 1 / (1 + max channel)), 4-tap box downs, 4-tap tent ups added level onto level; the final pass's triangular dither from two interleaved-gradient-noise samples (`ign`) | Abyssal Garden, https://github.com/Noniv/abyssal-garden (commit a596354, `source/src/shaders.js` `W_BLIT` lines 134–159, `S_G` line 204, `W_POST` line 779) | Maksymilian Dendura | MIT | 2026-11-18 | re-written in v2's WGSL and frame graph: an exposed-space soft-knee threshold after the Karis average, a half-resolution mip chain of up to 6 levels, the ups added at a scatter of 0.55 (blend constant), the glow added to the exposed colour before AgX; the dither after v1's LUT at ±1 LSB with a fixed pattern. The full MIT notice (Copyright (c) 2026 Maksymilian Dendura) is kept in `v2/render/bloom.js`'s header |

## The look from Ponlai (feat/v2-look-ponlai, 2026-11-20: `v2/render/rockDetail.js`, `terrain/ground/rock-*.webp`, `v2/render/purkinje.js`, `v2/render/water.js` WATER_FAR)

| Technique | Source | Author | Licence | Read | Use |
|---|---|---|---|---|---|
| Hex tiling: the triangle grid whose vertices are hexagonal tiles' centres, each tile's own offset and small turn, the barycentric weights to the 7th power with weak tiles skipped, the height-weighted blend, a tile's slope turned back through its turn | Ponlai, https://github.com/HuberyLL/ponlai (commit cca9056, `packages/render/materials/HexTiling.ts`), adapted from hextile-demo, https://github.com/mmikk/hextile-demo (`hextiling.h`; "Practical Real-Time Hex-Tiling", JCGT 11(3), 2022) | Hubery (Ponlai); Morten S. Mikkelsen (hextile-demo) | MIT (both) | 2026-11-20 | re-written in WGSL for the terrain's close rock (biplanar, inside 40 m, the grain as a luminance ratio on the ground's own colour); both MIT notices in `v2/render/rockDetail.js`'s header and in full in `v2/render/LICENSE-ponlai.txt` |
| The Purkinje shift: the receptor rows from linear Rec.709 and the rods' change from the cones' gains, folded into 7 constant vectors (`out = c + FROM_GAIN(rsqrt(1 + lms)) × rod × amount`), the colour first scaled to a retinal illuminance | Ponlai, https://github.com/HuberyLL/ponlai (commit cca9056, `packages/render/post/Purkinje.ts`); the model from Patry, "Real-Time Samurai Cinema" (SIGGRAPH 2021 Advances in Real-Time Rendering), after Cao, Pokorny, Smith and Zele (2008) and Kirk and O'Brien (2011) | Hubery (Ponlai) | MIT | 2026-11-20 | the constants copied; the WGSL and its JS twin written for Velia, in the composite on the exposed colour before the bloom's glow, its amount from `v2/sim/night.js` PURKINJE (0.02 at full night, less under a moon); the MIT notice in `v2/render/LICENSE-ponlai.txt` |

| Texture | Source | Author | Licence | Fetched | Cut |
|---|---|---|---|---|---|
| Rock Face 03 (the close rock) | [Poly Haven](https://polyhaven.com/a/rock_face_03), via Ponlai's asset release `assets-2026.11.16` (its `CREDITS.md`: CC0-1.0) | Dario Barresi and Rico Cilliers | CC0 1.0 | 2026-11-20 | 1024² → 512²: `rock-albedo.webp` (the colour, WebP q90) and `rock-pack.webp` (the GL normal's X and Y in R and G, the albedo's auto-levelled luminance as the height in B; near-lossless WebP) |

## Play as Tessie under the water (feat/v2-tessie-underwater-2a, 2026-11-20: `v2/render/water.js` WATER_UNDER_WGSL, `v2/render/underBack.js`, `v2/render/underMedium.js`)

| Technique | Source | Author | Licence | Read | Use |
|---|---|---|---|---|---|
| The surface from below: Snell's window by k = 1 − n² (1 − cos² θ) with a soft edge over k ∈ [0, 0.22], the Fresnel on the transmitted cosine (pow(1 − sqrt(k), 5)), the mirror round the window as the water's own light along the reflected ray (no scene copy), the normal's detail faded with distance; the underwater background as a full-screen triangle at the far plane in the water's own light | Abyssal Garden, https://github.com/Noniv/abyssal-garden (commit a596354, `source/src/shaders.js` `W_SURF` lines 582–621, `fogIn` lines 210–218) | Maksymilian Dendura | MIT | 2026-11-20 | the structure ported into Velia's WGSL with Velia's own inputs: the FFT's slopes and their mips (the footprint's mean normal, no sparkle), the sky's view LUT, the cloud key and the land's mirror ring through the window, the radiance's n² gain, the whitecaps' and the wake's foam from below; the medium is Tahoe's own (K, R∞, the bed's image scatter, the weather's bubble layer) with the closed-form in-scatter's height term (`fogIn`'s shape). The full MIT notice (Copyright (c) 2026 Maksymilian Dendura) is kept beside the code in `v2/render/LICENSE-abyssal-garden.txt` |
| The water's colour and light near the surface: the sunlit water colour WCOL (0.16, 0.58, 0.90) the top metres ease toward, the in-scatter's forward lobe 1.22 + 0.3 μ⁴ | Abyssal Garden, https://github.com/Noniv/abyssal-garden (commit a596354, `source/src/shaders.js` lines 196, 210–217) | Maksymilian Dendura | MIT | 2026-11-20 | the two numbers in `v2/render/underMedium.js` (UNDER.clear, UNDER.lobe0, UNDER.lobe4) on Tahoe's own medium (its σ, K and R∞ kept; Abyssal Garden's near-transparent σ not taken) |
| The light shafts under the water: a half-resolution ray march to the scene's depth with the start jittered per pixel by interleaved gradient noise, the light at each step down the sun's ray times a pattern and a shadow, a forward phase 0.2 + 2 μ³; a depth-aware 3 × 3 blur (weights 1 / (0.03 + Δz / z)); a depth-aware 4-tap upsample onto the frame | Abyssal Garden, https://github.com/Noniv/abyssal-garden (commit a596354, `source/src/shaders.js` `W_RAYS` lines 686–724, `W_RBLUR` 726–739, `W_POST` 749–760) | Maksymilian Dendura | MIT | 2026-11-20 | ported into `v2/render/underLight.js` with Velia's own inputs: the waves' caustic array (render/caustics.js) for the pattern, the terrain's and the boat's shadow maps at the sun's entry point, Tahoe's K and σ; the jitter fixed in time (no flicker), 24 / 12 steps, 40 m |
| The drifting specks and the bubbles under the water: specks in a box wrapped round the eye with fract(), faded at the box's edge and when under a pixel; bubbles as rising, wobbling billboards with a rim and two highlights, premultiplied, fading into the water's own light | Abyssal Garden, https://github.com/Noniv/abyssal-garden (commit a596354, `source/src/shaders.js` `W_SPR` `vsBub`/`fsBub` lines 626–660, `vsSnow`/`fsSnow` 661–683) | Maksymilian Dendura | MIT | 2026-11-20 | the pattern ported into `v2/render/underLight.js` with Tahoe's medium; no twinkle (the no-flicker rule), the specks' light kept over a 1.6 px disc; the bubbles' sources (her run, turns, dives, the breach, the propellers) and their CPU pool are Velia's |
