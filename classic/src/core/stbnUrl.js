// The self-hosted blue noise's URL (src/core/stbn.js; no library import here, so src/prebake.js can prefetch it):
// a hashed asset in a build (a year's cache), the source file on the dev server.
export const STBN_URL = new URL('./stbn.bin', import.meta.url).href;
