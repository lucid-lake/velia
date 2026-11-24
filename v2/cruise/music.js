// Cruise's music on v2 ("Sail on a safe autopilot, music on"): the one place Cruise calls the page's music
// (v2/audio/music.js, v2/notes/audio.md § The music: the API for Cruise). v1 plays Cruise's own playlist (src/modes/chill/music.js) over the
// lake's beds, finishes it at the hand-over and starts it again on the hand-back:
//   enter()    Cruise has the boat (its start, the hand-back): music.setMode('cruise'): the beds hold, v1's seeded playlist claims the
//              music bus; it sounds from the first gesture (the page's context exists only then)
//   finish()   the hand-over: music.setMode('sail', { finish: true }): the piece playing plays out, the beds wait 240 s (v1's)
//   leave()    a switch to Sail from the card (v1 stops the playlist): music.setMode('sail'): a 1.5 s fade
//   next(), toggle()   v1's ] and [ on the playlist; player() the bar's Music (music.player: the playlist in Cruise)
// music: the page's (null on a capture, a ?filmui=1 film or ?music=0: every call is then a no-op).
export function cruiseMusic({ music = null } = {}) {
  const calls = [];
  const note = (name) => { calls.push(name); if (calls.length > 32) calls.shift(); };
  return {
    get wired() { return !!music; },
    enter() { note('enter'); return music?.setMode('cruise') ?? null; },
    finish() { note('finish'); return music?.setMode('sail', { finish: true }) ?? null; },
    leave() { note('leave'); return music?.setMode('sail', { finish: false }) ?? null; },
    next() { note('next'); return music?.mode === 'cruise' ? music.player?.next?.() ?? null : null; },
    toggle() { note('toggle'); return music?.mode === 'cruise' ? music.player?.toggle?.() ?? null : null; },
    player: () => music?.player ?? null,
    stats: () => ({ wired: !!music, mode: music?.mode ?? null, calls: calls.slice(-8), song: music?.player?.title ?? null }),
  };
}
