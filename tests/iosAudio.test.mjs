// fix/ios-start: iOS mutes Web Audio under the silent switch ("ambient" session); the unlock asks for "playback".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackSession, isIOS, createAudio } from '../src/audio.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

test('an iPhone with navigator.audioSession gets the playback session', () => {
  const nav = { userAgent: IPHONE, maxTouchPoints: 5, audioSession: { type: 'auto' } };
  assert.equal(playbackSession(nav, null), 'session');
  assert.equal(nav.audioSession.type, 'playback');
});

test('an iPad (desktop UA with touch) counts as iOS; a Mac does not and is left alone', () => {
  assert.equal(isIOS({ userAgent: MAC, maxTouchPoints: 5 }), true);
  const mac = { userAgent: MAC, maxTouchPoints: 0, audioSession: { type: 'auto' } };
  assert.equal(playbackSession(mac, null), null);
  assert.equal(mac.audioSession.type, 'auto');
});

test('older iOS (no audioSession) plays a silent looping <audio> in the gesture', () => {
  let played = 0; const el = { setAttribute() {}, play() { played++; return Promise.resolve(); } };
  const doc = { createElement: (t) => { assert.equal(t, 'audio'); return el; } };
  assert.equal(playbackSession({ userAgent: IPHONE, maxTouchPoints: 5 }, doc), 'element');
  assert.equal(el.loop, true); assert.ok(played >= 1);
});

test('audio.start() on an iPhone sets the session before the context exists', async () => {
  const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const nav = { userAgent: IPHONE, maxTouchPoints: 5, audioSession: { type: 'auto' } };
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
  let typeAtCtx = null;
  class FakeCtx { constructor() { typeAtCtx = nav.audioSession.type; this.state = 'running'; this.destination = {}; } addEventListener() {} resume() { return Promise.resolve(); } }
  try {
    const audio = createAudio({ Ctx: FakeCtx, fetchFn: () => Promise.reject(new Error('no net')) });
    await audio.start().catch(() => {});
  } finally { if (was) Object.defineProperty(globalThis, 'navigator', was); else delete globalThis.navigator; }
  assert.equal(typeAtCtx, 'playback');
});

import { streamFile, sourceFor, streamsMusic } from '../src/audioFormat.js';

class FakeAudio {
  constructor() { this.attrs = {}; this.currentTime = 0; this.played = 0; this.paused = true; FakeAudio.made.push(this); }
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { if (k === 'src') this._src = ''; }
  set src(u) { this._src = u; if (u) setTimeout(() => (/bad/.test(u) ? this.onerror?.() : (this.duration = 180, this.onloadedmetadata?.())), 1); }
  get src() { return this._src; }
  canPlayType() { return 'probably'; }
  play() { this.played++; this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } load() {}
}
FakeAudio.made = [];

test('iOS music: a stand-in with the duration, no PCM; the other format when one will not play', async () => {
  const b = await streamFile('/audio/music/a.opus', { ok: true, Audio: FakeAudio });
  assert.deepEqual(b, { streamed: true, url: '/audio/music/a.opus', duration: 180 });
  const c = await streamFile('/audio/music/bad.opus', { ok: true, Audio: FakeAudio }).catch((e) => e);
  assert.ok(c instanceof Error);
});

test('a streamed piece plays through a media element source and ends clean', async () => {
  const connected = [];
  const node = { connect: (d) => connected.push(d), disconnect() { connected.length = 0; } };
  const ctx = { currentTime: 10, createMediaElementSource: () => node };
  const timers = [];
  const src = sourceFor(ctx, { streamed: true, url: '/m.m4a', duration: 180 }, { Audio: FakeAudio, setTimer: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearTimer() {} });
  let ended = 0; src.onended = () => ended++;
  src.connect('gain'); assert.deepEqual(connected, ['gain']);
  src.start(10, 42); assert.equal(src.el.currentTime, 42);
  timers.shift()[0](); assert.equal(src.el.played, 1);
  src.stop(12); const [f, ms] = timers.shift(); assert.equal(ms, 2000); f();
  assert.equal(ended, 1); assert.equal(src.el.paused, true); assert.equal(connected.length, 0);
});

test('only iOS streams the music; the Mac keeps its decoded buffers', () => {
  assert.equal(streamsMusic({ navigator: { userAgent: IPHONE, maxTouchPoints: 5 }, Audio: FakeAudio, location: { search: '' } }), true);
  assert.equal(streamsMusic({ navigator: { userAgent: MAC, maxTouchPoints: 0 }, Audio: FakeAudio, location: { search: '' } }), false);
});
