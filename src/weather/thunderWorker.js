// The thunder's samples off the main thread (fix/first-visit-hitches): each strike's waveform is ≈ 400 k samples of
// filtered noise and echoes, 40–90 ms of JavaScript; computed on the main thread at the strike, it froze a frame on
// every one (the storm's 50–90 ms frames). The same function, the same samples (src/weather/stormAudio.js).
import { thunderSamples } from './stormAudio.js';

self.onmessage = (e) => {
  const { id, t, sampleRate } = e.data;
  const d = thunderSamples(t, sampleRate);
  self.postMessage({ id, d }, [d.buffer]);
};
