// window.__lakeshore: a read-only mirror of the services registry (src/core/services.js) for the tools, the probes, the
// page tests and the film runner (tools/capture.mjs: ready, renderOnce(), stats(), camera; the probes: boat, controls,
// chart …). Game code never reads it (tests/services.test.mjs checks src/): it gets the registry passed in.
//
//   installMirror(services)   src/main.js, before boot: window.__lakeshore.x is services.get('x'), live
//
// Reads, `in`, Object.keys and JSON see what is provided now. A write or a delete on it throws: the tools read it only
// (a tool that needs to set something sets it on the object it read, e.g. __lakeshore.boat.env). The global itself
// stays replaceable (a page test or a demo without src/main.js puts its own object there).

export function mirrorOf(services) {
  const ro = (k) => { throw new TypeError(`window.__lakeshore is a read-only mirror of core.services (${String(k)})`); };
  return new Proxy(Object.create(null), {
    get: (_, k) => (typeof k === 'string' ? services.get(k) : undefined),
    has: (_, k) => typeof k === 'string' && services.has(k),
    ownKeys: () => services.names(),
    getOwnPropertyDescriptor: (_, k) => (typeof k === 'string' && services.has(k)
      ? { value: services.get(k), writable: false, enumerable: true, configurable: true } : undefined),
    set: (_, k) => ro(k),
    deleteProperty: (_, k) => ro(k),
    defineProperty: (_, k) => ro(k),
    setPrototypeOf: () => false,
  });
}

export function installMirror(services, target = globalThis) {
  const mirror = mirrorOf(services);
  Object.defineProperty(target, '__lakeshore', { value: mirror, writable: true, configurable: true, enumerable: true });
  return mirror;
}
