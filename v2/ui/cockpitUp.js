// "The cockpit is up": the one rule for what shows only with the desktop's 3D cockpit (2026-11-25: the performance stats panel,
// ui/perfHud.js, the Pro nav column on the left and the key legend on the right, src/ui/navColumn.js and src/ui/keyLegend.js through
// ui/sail.js; their own rules stay: Pro, Setup's key hints, the legend leaves in the helm view). Up means the drawn cockpit is the
// station's form and on screen (no menu, page, logbook or keys list over it: station.js hidden), the player has not folded it (the
// fold tab, H), the HUD preset is not Clear or Instruments, the mode shows the dials (Sail, Regatta; not Cruise) and nothing is
// played in the boat's place (Tessie). The helm view counts as up: the player hid nothing and the boat's own cockpit is on screen
// (the Calm HUD sinks the drawn one there, but the column stayed in the helm view by an earlier owner decision).
//   cockpitUp({ form, stationShown, fold, preset, modeDials, played }) → boolean
export function cockpitUp({ form = null, stationShown = false, fold = false, preset = 'full', modeDials = false, played = false } = {}) {
  return form === 'cockpit' && !!stationShown && !fold && preset !== 'clear' && preset !== 'instruments' && !!modeDials && !played;
}
