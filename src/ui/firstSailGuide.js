// The first sail's lines and the island goal, three-free: the rules and the DOM layer that v1's
// src/ui/firstSail.js and v2's v2/ui/firstSail.js both run. Split out of v1's firstSail.js (BACKLOG-v2 #4) so v2, which must
// never reach three.js, runs v1's own code; v1 adds only its 3D beacon on the island (a three sprite) through the `beacon` hook.
//   createFirstSail({ settings, island, effects })  the rules: pure, driven by update(dt, ctx), tested in tests/firstVisit.test.mjs
//   attachFirstSailGuide({ settings, services, getOptions, menu, beacon, stage, … })  the chips, the hint row's lines, update()
// What it does, by profile (settings.profile, set by the welcome on the home card):
//   new      Sail: one subtitle line once ("Drag the wheel to steer…"), then, on v1 only, a goal, "Sail to Fannette Island",
//            with a pointer chip and a soft beacon on the island; on arrival (the logbook's island find, the postcard) R.'s
//            line, then one next suggestion. v2 sets no goal (goal: false, owner 2026-11-16). Cruise: after 60 s a gentle
//            "Take the helm".
//   sail     one winch hint.   race   one line pointing at Regatta on Hard.
//   any      once, when the skills model rates the player pro (and Pro mode is off): "Sailing like a pro — switch to Pro mode?"
// Each line shows once per welcome (the flags in settings; "show the welcome again" clears them). The lines go through the
// controls' hint row (src/ui/controlsHint.js note(), no key: gone after its 7 s), so Setup's hints row (setHints: the row
// hidden) hides them as it hides every hint line; the goal and offer chips are their own layer, as on v1.
import { track } from '../metrics.js';
import { keeps } from './phoneQuiet.js';   // a phone's quiet skipper (owner 2026-11-16): no offers
import { introLine, GOAL, ARRIVAL, PRO_OFFER, CRUISE_OFFER, CRUISE_OFFER_S, nextSuggestion, goalBearing, fmtDist } from './profile.js';

export const TIMING = { introAfterS: 1.5, retryS: 4, arrivalLineS: 3, nextS: 14, proShowS: 15, cruiseShowS: 14 };

export function createFirstSail({ settings, island, effects }) {
  const S = { sailT: 0, noteAt: -Infinity, cruiseT: 0, arrivedAt: null, said: { arrival: false, next: false }, goalOn: false, proAt: null, cruiseAt: null };
  const profile = () => settings.get('profile');
  function update(dt, ctx) {
    if (!settings.get('welcomed')) return;
    const quiet = ctx.quiet !== false;
    // ---- the pro prompt: any mode the skills model runs in, once ----
    if (ctx.proDetected && !settings.get('proOffered') && !settings.get('proMode') && profile() !== 'race' && quiet) {
      settings.set('proOffered', true); S.proAt = 0; effects.proOffer(true);
    }
    if (S.proAt != null) { S.proAt += dt; if (S.proAt > TIMING.proShowS || settings.get('proMode')) { S.proAt = null; effects.proOffer(false); } }
    // ---- Cruise, New: a gentle offer after ~60 s ----
    if (ctx.firstSail === 'offer' && profile() === 'new' && !settings.get('cruiseOffered') && quiet) {
      S.cruiseT += dt;
      if (S.cruiseT >= CRUISE_OFFER_S) { settings.set('cruiseOffered', true); S.cruiseAt = 0; effects.cruiseOffer(true); }
    }
    if (S.cruiseAt != null) { S.cruiseAt += dt; if (S.cruiseAt > TIMING.cruiseShowS || ctx.firstSail !== 'offer') { S.cruiseAt = null; effects.cruiseOffer(false); } }
    // ---- Sail ----
    if (ctx.firstSail !== 'goal' || !ctx.ready) { if (S.goalOn) { S.goalOn = false; effects.goal(null); } return; }
    if (!quiet) return;
    S.sailT += dt;
    if (!settings.get('introShown')) {
      if (ctx.holdIntro) return;   // the staged first visit: the line waits for the opening camera (src/ui/firstStage.js)
      if (S.sailT >= TIMING.introAfterS && S.sailT - S.noteAt >= TIMING.retryS) {
        S.noteAt = S.sailT; const text = ctx.introText ?? introLine(profile());
        effects.note(text, null, 'first');
      }
      if (effects.noteShown()) settings.set('introShown', true);
      return;
    }
    if (profile() !== 'new' || settings.get('goalDone') || ctx.noGoal) { if (S.goalOn) { S.goalOn = false; effects.goal(null); } }   // noGoal: the staged first visit has its own beats, no chip
    else if (!S.arrivedAt) {
      if (ctx.islandFound && !S.goalOn) { settings.set('goalDone', true); return; }   // the postcard is already in the logbook: no goal to set
      if (ctx.islandFound) {   // arrived: the postcard just landed
        settings.set('goalDone', true); S.goalOn = false; effects.goal(null); S.arrivedAt = S.sailT; effects.reached?.(); return;
      }
      S.goalOn = true; effects.goal({ ...goalBearing(ctx.boat, island), text: GOAL.text });
    }
    if (S.arrivedAt != null) {
      const age = S.sailT - S.arrivedAt;
      if (!S.said.arrival && age >= TIMING.arrivalLineS) { S.said.arrival = true; effects.note(ARRIVAL, ARRIVAL, 'arrival'); }
      else if (S.said.arrival && !S.said.next && age >= TIMING.nextS) { S.said.next = true; const t = nextSuggestion(settings); effects.note(t, t, 'next'); }
    }
  }
  return { update, get state() { return { ...S }; } };
}

// ---------------------------------------------------------------- the live layer ----
const CSS = `
.lk-guide{position:fixed;left:50%;top:calc(var(--lk-my) + 64px);transform:translateX(-50%);z-index:var(--lk-z-hud);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;font-family:var(--lk-font);font-size:var(--lk-fs-caption);letter-spacing:var(--lk-track);max-width:92vw}
.lk-guide .chip{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:.6em;padding:.2em .3em;color:rgb(var(--lk-cream));text-shadow:0 1px 2px rgb(var(--lk-brand-navy) / .95),0 0 8px rgb(var(--lk-brand-navy) / .75);opacity:0;transform:translateY(-6px);transition:opacity .6s var(--lk-ease,ease),transform .6s var(--lk-ease,ease);text-align:center;line-height:1.25;white-space:nowrap;max-width:92vw}
.lk-guide .chip.on{opacity:1;transform:none}
.lk-guide button.chip{pointer-events:auto;cursor:pointer;min-height:44px;border-bottom:1px solid rgb(var(--lk-cream) / .55)}   /* the watermark style (section 11): cream words, a soft navy shadow, no panel; an offer you can press keeps one thin hairline under it */
.lk-guide button.chip:hover,.lk-guide button.chip:focus-visible{border-bottom-color:rgb(var(--lk-cream) / .95);outline:none}
.lk-guide .chip[hidden]{display:none}
.lk-guide .arrow{width:1.35em;height:1.35em;flex:none;transition:transform .25s linear;fill:none;stroke:rgb(var(--lk-amber) / .95);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lk-guide .dist{opacity:.8;font-variant-numeric:tabular-nums}
.lk-guide .no{all:unset;cursor:pointer;opacity:.7;padding:0 .2em}
@media (prefers-reduced-motion:reduce){.lk-guide .chip{transition:none}.lk-guide .arrow{transition:none}}
`;

// settings: the page's store (src/ui/settings.js); services: the page's (controls.hint, player, logbook, skills, terrain,
// switchMode, filmNow); menu: the home card (its state 'gone' while playing); getOptions(): the mode's options ({ firstSail });
// beacon: v1's 3D island marker, { set(on, dist, island), dispose() }, or null (v2: none); stage: v1's staged first visit
// ({ t }) or null, with introLineS (the line waits that long) and stagedLine (its short text); goal: false sets no island goal
// (v2, owner 2026-11-16: the chip distracted and few followed it), so no chip, no arrival line and no goal_reached
export function attachFirstSailGuide({ settings, services, getOptions = () => services.get('modeOptions') ?? {}, menu, beacon = null, stage = null, introLineS = 0, stagedLine = null, goal = true, now = () => performance.now() }) {
  if (!document.getElementById('lk-guide-css')) { const st = document.createElement('style'); st.id = 'lk-guide-css'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div'); root.className = 'lk-guide'; root.setAttribute('role', 'status');
  const goalEl = document.createElement('div'); goalEl.className = 'chip goal'; goalEl.hidden = true;
  goalEl.innerHTML = '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v16M6 9.5l6-6 6 6"/></svg><span class="tx"></span><span class="dist"></span>';
  const proEl = document.createElement('button'); proEl.type = 'button'; proEl.className = 'chip pro'; proEl.hidden = true; proEl.textContent = PRO_OFFER;
  const cruEl = document.createElement('button'); cruEl.type = 'button'; cruEl.className = 'chip cruise'; cruEl.hidden = true; cruEl.textContent = CRUISE_OFFER;
  root.append(goalEl, proEl, cruEl); document.body.appendChild(root);
  const show = (el, on) => { if (on) { el.hidden = false; requestAnimationFrame(() => el.classList.add('on')); } else { el.classList.remove('on'); setTimeout(() => { if (!el.classList.contains('on')) el.hidden = true; }, 650); } };
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'wheel']) root.addEventListener(t, (e) => e.stopPropagation());
  proEl.addEventListener('click', () => { settings.set('proMode', true); show(proEl, false); proEl.blur(); });
  cruEl.addEventListener('click', () => { show(cruEl, false); cruEl.blur(); services.get('switchMode')?.('sail'); });

  // the island: the world's lake (the 'terrain' service, built before play), read when wanted
  const lakeIsland = () => services.get('terrain')?.lake?.island;
  const island = { get x() { return lakeIsland()?.x ?? 0; }, get z() { return lakeIsland()?.z ?? 0; } };
  let beaconOn = false;
  const setBeacon = (on, dist = 0) => { beaconOn = on; beacon?.set?.(on, dist, island); };
  const effects = {
    note: (text, speak = null, kind = null) => services.get('controls')?.hint?.note?.(text, '', speak ?? text, { kind }),
    noteShown: () => services.get('controls')?.hint?.current === 'note',
    goal: (g) => {
      if (!g) { show(goalEl, false); setBeacon(false); return; }
      goalEl.querySelector('.tx').textContent = g.text; goalEl.querySelector('.dist').textContent = fmtDist(g.dist);
      goalEl.querySelector('.arrow').style.transform = `rotate(${g.relDeg.toFixed(0)}deg)`;
      if (goalEl.hidden || !goalEl.classList.contains('on')) show(goalEl, true);
      setBeacon(true, g.dist);
    },
    reached: () => track('goal_reached'),   // Fannette (anonymous count, src/metrics.js)
    proOffer: (on) => show(proEl, on && keeps('offer')),   // a phone shows no offers
    cruiseOffer: (on) => show(cruEl, on && keeps('offer')),
  };
  const fs = createFirstSail({ settings, island, effects });
  let last = now();
  function update() {
    const n = services.get('filmNow')?.() ?? now(), dt = Math.max(0, Math.min(0.25, (n - last) / 1000)); last = n;   // a film page (?filmui=1) runs on the film's clock
    const firstSail = getOptions().firstSail ?? null, c = services.get('controls'), s = services.get('player')?.phys?.state;
    const log = services.get('logbook')?.logbook;
    // the chips sit under the subtitle line when it is up at the top (it is the old skipper's voice, which says the same line)
    // (read only while a chip is out: the read forces a layout every frame; a chip shows hidden = false a frame before its fade-in)
    if (!(goalEl.hidden && proEl.hidden && cruEl.hidden)) {
      const hr = c?.hint?.el?.getBoundingClientRect?.();
      const top = hr && hr.height > 0 && hr.top < innerHeight * 0.4 ? `${Math.round(hr.bottom + 10)}px` : '';
      if (root.style.top !== top) root.style.top = top;
    }
    fs.update(dt, {
      firstSail, ready: !!(c && s && c.hint), quiet: menu?.state === 'gone' && !log?.isOpen,
      boat: s ? { x: s.x, z: s.z, heading: s.heading } : null,
      islandFound: !!log?.found?.('island'), proDetected: !!services.get('skills')?.pro,
      holdIntro: !!stage && stage.t < introLineS, noGoal: !!stage || !goal, introText: stage ? stagedLine : null,
    });
  }
  function dispose() { root.remove(); beacon?.dispose?.(); }
  return { update, dispose, fs, el: root, island, get beaconOn() { return beaconOn; } };
}
