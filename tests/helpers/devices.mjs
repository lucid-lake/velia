// Fake windows for the device profile's tests (src/core/profile.js): the six devices the owner named (2026-11-17), shared by
// tests/profile.test.mjs and v2/tests/features.test.mjs.
export const UA = {
  ipadDesk: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  tabAndroid: 'Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36',
  pixel: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Mobile Safari/537.36',
};
// a fake window: the pointer queries, the physical screen, the layout (after the turn), the UA and touch points
export function fakeWin({ coarse = false, anyCoarse = coarse, anyFine = !coarse, ua = UA.mac, touch = 0, screen = [1512, 982], inner = [1512, 860], search = '', rotated = false, frameH = null, standalone = false } = {}) {
  const q = { '(pointer: coarse)': coarse, '(any-pointer: coarse)': anyCoarse, '(any-pointer: fine)': anyFine, '(any-hover: hover)': anyFine, '(display-mode: standalone)': standalone, '(display-mode: fullscreen)': false };
  return {
    innerWidth: inner[0], innerHeight: inner[1], screen: { width: screen[0], height: screen[1] }, location: { search },
    navigator: { userAgent: ua, maxTouchPoints: touch, platform: '' }, matchMedia: (s) => ({ matches: !!q[s] }),
    __veliaTurn: { rotated: () => rotated }, __veliaScreen: frameH ? { frame: () => ({ w: inner[0], h: frameH }) } : undefined,
  };
}
export const DEVICES = {
  ipadTrackpad: fakeWin({ coarse: true, anyCoarse: true, anyFine: true, ua: UA.ipadDesk, touch: 5, screen: [1024, 1366], inner: [1366, 1024] }),
  touchLaptop: fakeWin({ coarse: false, anyCoarse: true, anyFine: true, ua: UA.win, touch: 10, screen: [1920, 1080], inner: [1920, 960] }),
  smallDesktop: fakeWin({ ua: UA.mac, screen: [1512, 982], inner: [600, 400] }),
  iphoneTurned: fakeWin({ coarse: true, ua: UA.iphone, touch: 5, screen: [390, 844], inner: [844, 390], rotated: true }),
  androidSideways: fakeWin({ coarse: true, ua: UA.pixel, touch: 5, screen: [412, 915], inner: [915, 412] }),
  desktop: fakeWin({ ua: UA.mac, screen: [1512, 982], inner: [1512, 860] }),
  // the tablets (owner, 2026-11-18: tablets get desktop features, scaled by GPU level): finger-only, no trackpad. An iPad asks for
  // desktop sites (a Mac UA with touch points); the levels each boots at are in v2/tests/features.test.mjs
  ipadPro: fakeWin({ coarse: true, anyCoarse: true, anyFine: false, ua: UA.ipadDesk, touch: 5, screen: [1024, 1366], inner: [1366, 1024] }),
  ipadOld: fakeWin({ coarse: true, anyCoarse: true, anyFine: false, ua: UA.ipadDesk, touch: 5, screen: [768, 1024], inner: [1024, 768] }),
  androidTablet: fakeWin({ coarse: true, anyCoarse: true, anyFine: false, ua: UA.tabAndroid, touch: 5, screen: [800, 1280], inner: [1280, 800] }),
};

