// Regatta's results card model (refactor round 3 C4: cut out of index.js createRegatta; one shared state R).
// makeResult: the place, time and medal by race type (a place race's best and its cup series, a fleet race's course best,
// a match, a pursuit, the Emerald Cup's standings); trialResult: a time trial's best run and splits; bestKey.
import { CUPS, recordPlace } from '../sim/racePlaces.js';
import { placeCupState, placesOf, recordPlaceRace, savePlaceCup } from './placeCup.js';
import { loadBest, recordBest } from '../../src/sim/race/results.js';
import { LEVELS } from '../sim/raceLevels.js';
import { mmss1, resultCard } from './review.js';
import { matchCard, recordTrial, splitsLine } from './events.js';
import { CUP, cupPlaces, cupState, recordRace, saveCup } from './cup.js';
import { dayOf } from './setup.js';

/** @param {object} R the Regatta's shared state (index.js createRegatta) */
export function installResults(R) {
  const { HULLS, NAMES, hooked, live, memTrial, persist, placeRow, short, stats, store } = R;
  function makeResult(r) {
    const order = r.order(), views = Object.fromEntries(order.map((id) => [id, r.view(id)])), names = Object.fromEntries(R.S.boats.map((b) => [b.id, b.name]));
    const m = resultCard({ order, views, names, me: 'me', level: R.level, faults: R.review.faults }), ev = R.hand?.event ?? 'fleet', first = R.result == null;
    m.event = ev;
    if (R.knocked) Object.assign(m, { finished: false, medal: null, mark: 'DNF', ord: 'DNF', time: '\u2013', timeS: null, gapS: null, title: 'Knocked down \u00b7 DNF', gap: R.knocked.line ?? '', tip: { id: 'knockdown', text: R.knocked.tip ?? '' }, knocked: true });   // K3: a DNF in this race (the Cup scores it as one, cupPlaces below)
    if (ev === 'trial') return trialResult(m, first);
    if (R.hand?.place) {   // a place race: its best time and medal (places.js; the hub's row reads it)
      if (m.finished && first && persist) { const b = recordPlace(store, R.hand.place, { timeS: m.timeS, medal: m.medal ?? null, at: dayOf() }); m.best = b.isNew ? 'a new best' : `best ${mmss1(b.best.timeS)}`; stats.best = m.best; }
      m.kicker = `${placeRow()?.name ?? ''} \u00b7 ${LEVELS[R.level]?.label ?? ''}`;
      if (hooked('glass')) { const c = stats.chase?.caughtAt; m.gap = `${m.gap ? `${m.gap} \u00b7 ` : ''}${c != null ? `Caught Velia Travel at ${mmss1(Math.max(0, c))}` : 'Velia Travel stayed ahead'}`; }
      // Sail the cup: this race's places into the series (once), the standings after it, the cup's result after the last
      const sc = R.hand.placeCup;
      if (sc && R.placeCup && R.placeCup.cup === sc.cup) {
        if (first && R.placeCup.results.length === sc.i) {
          const fin = Object.fromEntries(order.map((id) => [id, views[id]?.status === 'finished']));
          R.placeCup = recordPlaceRace(R.placeCup, placesOf(order, fin)); if (persist) R.placeCup = savePlaceCup(store, R.placeCup) ?? R.placeCup;
        }
        const st = placeCupState(R.placeCup, NAMES), cname = CUPS.find((c) => c.id === sc.cup)?.name ?? 'Cup';
        m.cup = { name: cname, rows: st.rows.map((x) => ({ ...x, chip: HULLS[x.id] ?? null })), sailed: st.sailed, of: st.of, done: st.done };
        m.kicker = `${cname} \u00b7 race ${sc.i + 1} of ${sc.of}`;
        stats.placeCup = { cup: sc.cup, sailed: st.sailed, of: st.of, done: st.done, me: st.me };
      }
      return m;
    }
    if (ev === 'fleet' && !R.hand?.cup) {   // a course's best per level: a fleet race's (a match or a pursuit's time is not the course's)
      if (m.finished && live && first) { const b = recordBest(store, { course: bestKey(), tier: R.level, t: m.timeS }); m.best = b.isNew ? (b.prev == null ? 'first time round' : 'a new best') : `best ${mmss1(b.best)}`; stats.best = m.best; }
      else if (R.result?.best) m.best = R.result.best;
      else if (live) { const b = loadBest(store, bestKey(), R.level); if (b != null) m.best = `best ${mmss1(b)}`; }
    }
    if (ev === 'match') {   // 1 v 1: who won the match, by how much; gold for the win
      Object.assign(m, matchCard(m, names[R.S.rivals[0]?.id] ?? 'Your rival'), { kicker: `Match race \u00b7 ${LEVELS[R.level]?.label ?? ''}` });
    } else if (ev === 'pursuit') {
      m.kicker = `Pursuit \u00b7 ${LEVELS[R.level]?.label ?? ''}`;
      if (m.finished) m.title = m.place === 1 ? 'First home' : `${m.ord} of ${m.boats} home`;
    }
    // the Emerald Cup: this race's places into the series (once), the standings after it, the podium after the last
    if (R.hand?.cup && R.cup && R.cup.id === R.hand.cup.id) {
      if (first && R.cup.results.length === R.hand.cup.i) {
        R.cup = recordRace(R.cup, cupPlaces(order, { me: m.finished })); if (persist) R.cup = saveCup(store, R.cup) ?? R.cup;
      }
      const st = cupState(R.cup, NAMES);
      m.cup = { name: CUP.name, rows: st.rows.map((x) => ({ ...x, chip: HULLS[x.id] ?? null })), sailed: st.sailed, of: st.of, done: st.done };
      m.kicker = `${CUP.name} \u00b7 race ${R.hand.cup.i + 1} of ${R.hand.cup.of}`;
      stats.cup = { sailed: st.sailed, done: st.done, me: st.me };
    }
    return m;
  }
  // the time trial's card: the time, the best (kept with its splits and path when beaten), the splits against the best
  function trialResult(m, first) {
    m.title = m.finished ? `Time ${m.time}` : 'Did not finish'; m.kicker = 'Time trial';
    if (m.finished && first) {
      const run = { t: m.timeS, splits: R.trial.splits.map((x) => x.t), path: R.trial.rec };
      const b = persist ? recordTrial(store, R.trial.key, run) : (() => { const prev = memTrial.get(R.trial.key) ?? null, isNew = !prev || run.t < prev.t; if (isNew) memTrial.set(R.trial.key, { ...run, splits: [...run.splits], path: run.path.map((p) => [...p]) }); return { best: isNew ? run : prev, isNew, prev }; })();
      R.trial.verdict = b.isNew ? (b.prev ? `New best, was ${mmss1(b.prev.t)}` : 'First time round: your best') : `Best ${mmss1(b.best.t)} \u00b7 ${(m.timeS - b.best.t).toFixed(1)} s off`;
      R.trial.newBest = b.isNew; stats.trial = { ...stats.trial, newBest: b.isNew, t: m.timeS, best: b.best?.t ?? null };
    }
    m.medal = R.trial.newBest ? 'gold' : null; m.mark = R.trial.newBest ? '\u2605' : m.finished ? '\u23f1' : '\u2013';
    m.ord = ''; m.gap = R.trial.verdict ?? ''; m.best = null;
    // the splits: each mark's time, or its gain or loss against the best run's
    m.tmLine = splitsLine(R.trial.splits);
    return m;
  }
  // the best time's key: the default race (0.35) keeps its old key; a hand's other lengths their own
  const bestKey = () => (R.hand ? `${R.hand.length === 'short' ? R.course.id : `${R.course.id}-${R.hand.length}`}${R.hand.laps !== R.course.lapsDefault ? `-x${R.hand.laps}` : ''}` : `${R.course.id}${short ? '-short' : ''}`);
  Object.assign(R, { makeResult });
}
