// The page's one settings store (v1's src/ui/settings.js, format 2, as it is: localStorage 'lakeshore.settings.v1'), shared by
// the front door (front.js: the home card's Setup page, the welcome, the first visit's profile) and Sail's UI (sail.js: the Calm
// HUD's preset), however their chunks arrive. v1's shell makes the same one store (src/shell.js createSettings).
import { createSettings } from '../../src/ui/settings.js';

let store = null;
export const pageSettings = () => (store ??= createSettings());
