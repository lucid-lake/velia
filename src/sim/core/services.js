// The services registry (refactor Phase 2 step 2): the one place the game's
// shared objects meet (the boat, the controls, the chart, the logbook, the shell's menu and settings …), in place of
// window.__lakeshore as an object bus. Game code gets it passed in (core.services, the shell's `services`) and never
// reads the global; window.__lakeshore is only a read-only mirror of it for the tools (src/core/mirror.js).
//
//   const services = createServices();      src/main.js: one per page
//   services.provide('settings', settings)  the shell: lasts the page
//   services.get('boat')                    the object, or undefined; services.has('boat')
//   services.remove('dock')                 gone; remove('chart', pub) only while it is still that object
//   const scope = services.scope();         src/core/index.js: one per mode, passed to the mode as core.services
//   scope.provide('boat', boat)             the mode's: scope.dispose() (the core, when the mode goes) removes it
//
// A reference that never changes in a mode's life is read once and kept (the boat in the physics tick: no lookup per
// frame); a late one (the shell's menu, the chart once its chunk loads) is a get() where it is used: a Map read, no
// allocation.

export function createServices() {
  const map = new Map();
  const services = {
    provide(name, value) { map.set(name, value); return value; },
    get: (name) => map.get(name),
    has: (name) => map.has(name),
    // value given: only while the name still holds that object (a newer provide of the same name stays)
    remove(name, value) {
      if (!map.has(name) || (arguments.length > 1 && map.get(name) !== value)) return false;
      map.delete(name); return true;
    },
    names: () => [...map.keys()],
    // a mode's view: the same get/has; what it provides is removed by dispose(), each name only while it holds the
    // scope's own object (the shell's later provide of the same name, or a removal already made, is left alone)
    scope() {
      const own = new Map();
      let live = true;
      return {
        root: services,
        provide(name, value) { own.set(name, value); return services.provide(name, value); },
        get: services.get,
        has: services.has,
        remove(name, value) { if (arguments.length < 2 || own.get(name) === value) own.delete(name); return arguments.length > 1 ? services.remove(name, value) : services.remove(name); },
        names: services.names,
        scope: services.scope,
        get live() { return live; },
        owned: () => [...own.keys()],
        dispose() { live = false; for (const [name, value] of own) services.remove(name, value); own.clear(); },
      };
    },
  };
  return services;
}
