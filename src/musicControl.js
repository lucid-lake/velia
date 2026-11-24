// The music control's shared parts (the top bar's ♪ and ⏭: src/ui/viewSwitch.js): the pieces' real titles, the
// "sound is off" test, and the player Sail, Regatta and School hand the bar (Cruise's is src/modes/chill/music.js).
//
// A player is { title, songId, paused, off, next(), toggle(), setVolume(v), turnOn() }: songId counts the pieces
// started (the bar shows a caption when it changes); off is true while the sound or the music is switched off.

// the titles in ATTRIBUTION.md § Music (both takes of a brief share one)
export const TITLES = {
  first_light: 'Lake at first light', over_the_ridge: 'Over the ridge', wind_rising: 'Wind rising on the water',
  golden_hour: 'Golden hour on the lake', dusk_water: 'Dusk over the water', race_main: 'Close reach', race_prestart: 'Ten minutes to the gun',
};
// "/audio/music/over_the_ridge_a.opus" → "Over the ridge"; a piece with no entry gets a short name from its file, never the raw filename
export function songTitle(url) {
  const stem = String(url ?? '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/_[ab]$/, '');
  if (TITLES[stem]) return TITLES[stem];
  const w = stem.replace(/[_-]+/g, ' ').trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
}

// sound off by M (the master) or by the Settings switches (sound, music)
export const soundOff = (audio, settings = null) => !!audio && (audio.muted === true || audio.bus?.('music') === false || (settings ? settings.get('sound') === false || settings.get('music') === false : false));
// switch the sound and the music on again: the Settings rows follow, so the menu shows the truth
export function soundOn(audio, settings = null) {
  if (settings) { if (settings.get('sound') === false) settings.set('sound', true); if (settings.get('music') === false) settings.set('music', true); }
  if (audio?.muted) audio.setMuted?.(false);
  if (audio?.bus?.('music') === false) audio.setBus?.('music', true);
}

// Sail, Regatta and School: the beds of src/audio.js (BedScheduler) behind the bar's controls. settings: () => the settings store (or null).
export function createBedMusic(audio, settings = () => null) {
  const st = () => { try { return settings(); } catch { return null; } };
  return {
    get title() { return audio.song?.title ?? ''; },
    get songId() { return audio.songId ?? 0; },
    get paused() { return !!audio.held; },
    get off() { return soundOff(audio, st()); },
    turnOn() { soundOn(audio, st()); },
    next() { soundOn(audio, st()); return audio.nextSong?.() ?? null; },
    toggle() { if (audio.held) { soundOn(audio, st()); audio.hold(false); return !!audio.nextSong?.(); } audio.hold(true); return true; },
    setVolume(v) { return audio.setMusicVolume?.(v); },
  };
}
