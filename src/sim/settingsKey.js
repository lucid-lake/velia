// The saved settings' storage key (src/ui/settings.js). Any stored settings mean a returning visitor (src/ui/firstVisit.js).
// Its own module, so the sim (the saved lake and boat: src/waters/current.js, src/vessels/current.js) reads it without
// importing the UI (a UI import pulled the whole app into the worker bundles).
export const SETTINGS_KEY = 'lakeshore.settings.v1';
