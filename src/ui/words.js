// Sailor's words ('s words): the right sailing terms, never a wall. One table
// holds every term the game says; the hints, the H list, the logbook's words page and the hover gloss all read it.
//
//   Plain first, the term beside it, fading with skill: a newcomer reads "pull the sails in · trim"; once the skill
//   model rates trim as learned the line reads "trim the sheets"; the pro reads the sailor's line. The level of a
//   term is a pure function of the skill model (and the menu setting), so the same save always reads the same.
//
//   const words = createWords({ storage: localStorage, skills });   // skills: createSkills() or null
//   words.expand('§pull§')            // a phrase, at the player's level → html (the hint's label)
//   words.expand('the {helm|helm|the wheel}')   // inline: {id|sailor text|plain text}
//   words.level('trim')               // 'plain' | 'sailor'
//   words.meet('winch')               // the player met it (a hint, a hover, an act): the logbook lists it
//   words.gloss('winch')              // { term: 'Winch', gloss: 'winds the rope in', why, skills }
//   words.met() / words.total         // the logbook's page: the met terms in table order; "n of N met"
//   words.mode = 'both' | 'sailor'    // the menu: "plain + sailor's" (default) or "sailor's only"
//
// A string with markup:  §key§ is a phrase in PHRASES;  {id} or {id|text} or {id|text|plain} is a term inline. A term
// outside the markup cannot be hovered, so tests/words.test.mjs fails any bare term in a hint, the H list or a note.
// Pure JS, no DOM: the glossary element is src/ui/gloss.js.

// id, term (as said), gloss (≤ 8 words, plain), why (one line), skills (the mastery model's ids; [] = met-count only).
// The skills decide the fade: a term fades to the sailor's form when every one of its skills is learned.
export const TERMS = [
  { id: 'tack', term: 'tack', gloss: 'turn the bow through the wind', why: 'Upwind you zigzag to your goal; the tack is the turn.', skills: ['tacking'] },
  { id: 'gybe', term: 'gybe', gloss: 'turn the stern through the wind', why: 'Downwind the boom swings across hard; take the sheet in first.', skills: ['gybing'] },
  { id: 'trim', term: 'trim', gloss: 'set the sails to the wind', why: 'Good trim is most of your speed.', skills: ['trim'] },
  { id: 'ease', term: 'ease', gloss: 'let a sail out', why: 'Easing spills wind: it slows the boat and stands it up.', skills: ['trim'] },
  { id: 'sheet', term: 'sheet', gloss: 'the rope that sets a sail', why: 'Pull it in for power, let it out to spill.', skills: ['trim'] },
  { id: 'mainsheet', term: 'mainsheet', gloss: 'the rope that trims the mainsail', why: 'The big sail’s rope; it takes the load in a gust.', skills: ['trim'] },
  { id: 'jib', term: 'jib', gloss: 'the small sail at the front', why: 'It feeds air over the mainsail and helps the boat turn.', skills: ['trim'] },
  { id: 'halyard', term: 'halyard', gloss: 'the rope that hoists a sail', why: 'Up to sail, down to stop; a slack one flaps against the mast.', skills: [] },
  { id: 'winch', term: 'winch', gloss: 'winds the rope in', why: 'A drum that gives you the muscle for a loaded sheet.', skills: ['trim'] },
  { id: 'let-fly', term: 'let fly', gloss: 'throw a sheet off its winch', why: 'The sail flogs and spills its wind: the quick way to stop.', skills: ['trim'] },
  { id: 'helm', term: 'helm', gloss: 'the tiller or wheel that steers', why: 'Small moves steer; a held-over helm drags the boat.', skills: ['steering'] },
  { id: 'bear-away', term: 'bear away', gloss: 'turn away from the wind', why: 'It fills the sails and gets you moving again.', skills: ['nogo'] },
  { id: 'head-up', term: 'head up', gloss: 'turn toward the wind', why: 'Closer to the wind, until the sail just starts to shake.', skills: ['nogo'] },
  { id: 'close-hauled', term: 'close-hauled', gloss: 'sailing as close to the wind as possible', why: 'The way upwind; any closer and the sails shake.', skills: ['nogo'] },
  { id: 'reach', term: 'reach', gloss: 'sailing across the wind', why: 'The fastest, easiest way to sail.', skills: ['trim'] },
  { id: 'run', term: 'run', gloss: 'sailing with the wind behind', why: 'Easy to steer, but a slip can gybe.', skills: ['gybing'] },
  { id: 'in-irons', term: 'in irons', gloss: 'stuck head to wind, no drive', why: 'The sails flap and nothing pulls; bear away to escape.', skills: ['nogo'] },
  { id: 'luff', term: 'luff', gloss: 'the sail shaking along its edge', why: 'A shaking edge says: pull in, or bear away.', skills: ['trim'] },
  { id: 'telltales', term: 'telltales', gloss: 'yarns showing the air over a sail', why: 'Both sides streaming means the trim is right.', skills: ['trim'] },
  { id: 'heel', term: 'heel', gloss: 'the boat leaning over', why: 'A little is fine; a lot means ease or reef.', skills: ['heavy'] },
  { id: 'header', term: 'header', gloss: 'a wind shift toward your bow', why: 'It pushes you off course; a good moment to tack.', skills: ['shifts'] },
  { id: 'lift', term: 'lift', gloss: 'a wind shift that lets you point higher', why: 'Stay on that tack and you gain.', skills: ['shifts'] },
  { id: 'traveller', term: 'traveller', gloss: 'slides the mainsheet’s base across', why: 'Down in a gust or up in light air, without changing twist.', skills: ['trim'] },
  { id: 'backstay', term: 'backstay', gloss: 'the wire from masthead to stern', why: 'Tight, it flattens the mainsail and sheds power.', skills: ['trim'] },
  { id: 'twist', term: 'twist', gloss: 'the sail’s top spilling more wind', why: 'More twist eases the load; less gives power.', skills: ['trim'] },
  { id: 'leech', term: 'leech', gloss: 'the sail’s trailing edge', why: 'It flutters when over-trimmed or twisted too far.', skills: ['trim'] },
  { id: 'gennaker', term: 'gennaker', gloss: 'a big downwind sail set from the bow', why: 'The crew hoists it with the wind behind the beam: she leaps forward and surfs.', skills: ['trim'] },
  { id: 'jib-lead', term: 'jib lead', gloss: 'where the jib sheet turns', why: 'Forward tightens the leech; aft opens it.', skills: ['trim'] },
  { id: 'reef', term: 'reef', gloss: 'make the sail smaller', why: 'Shorten sail before the wind makes you.', skills: ['heavy'] },
  { id: 'leeward', term: 'leeward', gloss: 'the side away from the wind', why: 'The low side; the boat heels toward it.', skills: ['trim'] },
  { id: 'windward', term: 'windward', gloss: 'the side toward the wind', why: 'The high side; the wind reaches you first.', skills: ['trim'] },
  { id: 'port', term: 'port', gloss: 'the left side, facing forward', why: 'Red light at night.', skills: ['steering'] },
  { id: 'starboard', term: 'starboard', gloss: 'the right side, facing forward', why: 'Green light at night.', skills: ['steering'] },
  { id: 'apparent-wind', term: 'apparent wind', gloss: 'the wind you feel on the moving boat', why: 'The sails trim to it, not to the true wind.', skills: ['trim'] },
  { id: 'groove', term: 'groove', gloss: 'the sweet spot where the boat is fastest', why: 'Held there, speed builds on itself.', skills: ['groove'] },
  { id: 'anchor', term: 'anchor', gloss: 'holds the boat to the lake bed', why: 'Drop it where it is sheltered and the bottom holds.', skills: [] },
  { id: 'rode', term: 'rode', gloss: 'the line or chain to the anchor', why: 'About five times the depth keeps the anchor biting.', skills: [] },
  { id: 'gust', term: 'gust', gloss: 'a sudden puff of stronger wind', why: 'Dark water shows one coming; ease before it hits.', skills: ['gusts'] },
  { id: 'knot', term: 'knot', gloss: 'one nautical mile an hour', why: 'The sailor’s speed; about 1.85 km/h.', skills: [] },
  { id: 'wing-on-wing', term: 'wing-on-wing', gloss: 'sails out on opposite sides, downwind', why: 'The steadiest way to run; watch the gybe.', skills: ['gybing'] },
  { id: 'astern', term: 'astern', gloss: 'backward, behind the boat', why: 'Reversing gives little steering; plan the room.', skills: [] },
  { id: 'keel', term: 'keel', gloss: 'the fin that stops sideways slipping', why: '"Under keel" is the water left beneath it.', skills: [] },
  { id: 'vmg', term: 'VMG', gloss: 'speed made good toward the mark', why: 'Fast is not the same as getting there sooner.', skills: ['trim'] },
];
export const BY_ID = Object.fromEntries(TERMS.map((t) => [t.id, t]));
export const TOTAL = TERMS.length;

// Sailing words that must be a term (tests/words.test.mjs). Ordinary English (ease, run, port in "support") is spelled
// by word boundary and left out when it reads as plain English; those stay terms only where markup says so.
export const WATCH = [
  ['tack', /\btack(s|ing|ed)?\b/i], ['gybe', /\bgyb(e|es|ing|ed)\b/i], ['trim', /\btrim(s|med|ming)?\b/i], ['sheet', /\bsheets?\b/i],
  ['mainsheet', /\bmainsheet\b/i], ['jib', /\bjib\b/i], ['let-fly', /\blet fly\b/i], ['halyard', /\bhalyards?\b/i], ['winch', /\bwinch(es)?\b/i],
  ['helm', /\b(helm|tiller)\b/i], ['bear-away', /\bbear(ing)? away\b/i], ['head-up', /\bhead(ing)? up\b/i], ['close-hauled', /\bclose-hauled\b/i],
  ['in-irons', /\bin irons\b/i], ['luff', /\bluff(s|ing)?\b/i], ['telltales', /\btelltales?\b/i], ['heel', /\bheel(s|ing)?\b/i],
  ['header', /\bheaders?\b/i], ['traveller', /\btraveller\b/i], ['backstay', /\bbackstay\b/i], ['twist', /\btwist\b/i], ['leech', /\bleech\b/i],
  ['jib-lead', /\bjib lead\b/i], ['reef', /\breef(s|ed|ing)?\b/i], ['leeward', /\bleeward\b/i], ['windward', /\bwindward\b/i],
  ['starboard', /\bstarboard\b/i], ['apparent-wind', /\bapparent wind\b/i], ['groove', /\bgroove\b/i], ['rode', /\brode\b/i],
  ['gust', /\bgust(s|ing|y)?\b/i], ['knot', /\bknots?\b|\bkn\b/i], ['wing-on-wing', /\bwing-on-wing\b/i], ['astern', /\bastern\b/i],
  ['keel', /\bkeel\b/i], ['vmg', /\bVMG\b/], ['lift', /\blift ▲|\blifts?\b/], ['anchor', /\banchor(ed|ing)?\b/i],
];
// ids a text uses (outside any markup: the caller strips it first)
export const termsIn = (text) => WATCH.filter(([, re]) => re.test(text)).map(([id]) => id);

// ---- phrases: the hint labels. skill: the mastery skill whose level fades it; plain + term for a newcomer ('both'),
// sailor for the learned and the pro (and the "sailor's only" setting). mouse*: the same line phrased for the mouse. thumb*: a touch
// line on v2's upright-phone one-thumb controls (v2/ui/thumb.js: no wheel, no winches; the steer zone low on the screen, down pulls in).
// flat*: a touch line on v2's phone flat controls (v2/ui/flat.js: the steer ring, the sheet ring with In at its top, Tack in the corner).
export const PHRASES = {
  pull:   { skill: 'trim', plain: 'pull the sails in', term: 'trim', sailor: '{trim} the {sheet|sheets}',
            touch: 'drag a {winch} down', touchSailor: 'drag a {winch} down to {trim}',
            thumb: 'drag down low on the screen', thumbSailor: 'drag down low on the screen to {trim}',
            flat: 'drag the sheet ring up', flatSailor: 'drag the sheet ring up to {trim}' },
  ease:   { skill: 'trim', plain: 'ease the sails out', term: 'ease', sailor: '{ease} the {sheet|sheets}',
            touch: 'drag a {winch} up', touchSailor: 'drag a {winch} up to {ease}',
            thumb: 'drag up low on the screen', thumbSailor: 'drag up low on the screen to {ease}',
            flat: 'drag the sheet ring down', flatSailor: 'drag the sheet ring down to {ease}' },
  irons:  { skill: 'nogo', plain: 'turn away from the wind', term: 'bear-away', sailor: '{bear-away|bear away}, you are {in-irons|in irons}',
            mouse: 'the water off the wind', mouseSailor: 'the water, to {bear-away|bear away}',
            touch: 'drag the wheel off the wind', touchSailor: 'drag the wheel to {bear-away|bear away}',
            thumb: 'drag sideways low on the screen, off the wind', thumbSailor: 'drag sideways low on the screen to {bear-away|bear away}',
            flat: 'tap Free', flatSailor: 'tap Free' },   // the phone's assist corner reads Free in irons (v2/ui/assist.js; owner 2026-11-16)
  steer:  { skill: 'steering', plain: 'steer', term: 'helm', sailor: 'take the {helm}',
            mouse: 'the water to steer there', mouseSailor: 'the water, a course for the {helm}',
            touch: 'drag the wheel', touchSailor: 'drag the wheel, a course for the {helm}',
            thumb: 'drag sideways low on the screen', thumbSailor: 'drag sideways low on the screen, a course for the {helm}',
            flat: 'drag the steer ring', flatSailor: 'drag the steer ring, a course for the {helm}' },
  tack:   { skill: 'tacking', plain: 'steer through faster', term: 'tack', sailor: '{tack} through the wind faster',
            mouse: 'the water across the wind, past it', mouseSailor: 'the water across the wind, to {tack}',
            touch: 'tap {tack|Tack}, or drag the wheel across', touchSailor: 'tap {tack|Tack}',
            thumb: 'tap {tack|Tack}', thumbSailor: 'tap {tack|Tack}',
            flat: 'tap {tack|Tack} in the corner', flatSailor: 'tap {tack|Tack}' },
  gybe:   { skill: 'gybing', plain: 'pull in, then steer gently downwind', term: 'gybe', sailor: '{sheet|sheet} in, then {gybe} gently',
            mouse: 'the sail line in, then click gently downwind', mouseSailor: 'the sail line in, then click gently to {gybe}',
            touch: 'drag a {winch} down, then tap {gybe|Gybe}', touchSailor: 'drag a {winch} down, then tap {gybe|Gybe}',
            thumb: 'drag down low on the screen, then tap {gybe|Gybe}', thumbSailor: 'drag down low on the screen, then tap {gybe|Gybe}',
            flat: 'drag the sheet ring up, then tap {gybe|Gybe}', flatSailor: 'drag the sheet ring up, then tap {gybe|Gybe}' },
  heavy:  { skill: 'heavy', plain: 'ease in a strong puff', term: 'gust', sailor: '{ease} in a {gust}',
            mouse: 'the sail line out in a strong puff', mouseSailor: 'the sail line out to {ease} in a {gust}',
            touch: 'drag a {winch} up in a strong puff', touchSailor: 'drag a {winch} up to {ease} in a {gust}',
            thumb: 'drag up low on the screen in a strong puff', thumbSailor: 'drag up low on the screen to {ease} in a {gust}',
            flat: 'drag the sheet ring down in a strong puff', flatSailor: 'drag the sheet ring down to {ease} in a {gust}' },
  gusts:  { skill: 'gusts', plain: 'dark water = wind', term: 'gust', sailor: 'dark water is a {gust}',
            mouse: 'dark water = wind', mouseSailor: 'dark water is a {gust}' },
  groove: { skill: 'groove', plain: 'tune the sails until the boat locks in', term: 'groove', sailor: '{trim} to the {groove}',
            mouse: 'the sail line until the boat locks in', mouseSailor: 'the sail line until you find the {groove}',
            touch: 'tap the {winch|winches} until the boat locks in', touchSailor: 'tap the {winch|winches} until you find the {groove}',
            thumb: 'drag up or down low on the screen until the boat locks in', thumbSailor: 'drag up or down low on the screen until you find the {groove}',
            flat: 'drag the sheet ring until the boat locks in', flatSailor: 'drag the sheet ring until you find the {groove}' },
  sheets: { skill: 'trim', plain: 'pull in for power, ease out to slow', term: 'trim', sailor: '{trim}: in for power, {ease} to slow' },
};

const SAVE_KEY = 'lakeshore.words.v1';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const span = (id, text) => `<span class="term" data-term="${id}">${esc(text)}</span>`;
export const stripMarkup = (s) => String(s).replace(/§[a-z]+§/g, '').replace(/\{([a-z-]+)(?:\|([^}|]*))?(?:\|([^}]*))?\}/g, (_, id, a) => a ?? BY_ID[id]?.term ?? id);
// every id named by a string's markup, for the table test
export function markupIds(s) { const out = []; String(s).replace(/\{([a-z-]+)(?:\|[^}]*)?\}/g, (_, id) => out.push(id)); return out; }
export const phraseKeys = (s) => { const out = []; String(s).replace(/§([a-z]+)§/g, (_, k) => out.push(k)); return out; };

// oneThumb(): v2's one-thumb controls are up (html.lk-one-thumb, v2/ui/thumb.js): a touch line then says its thumb* wording
const thumbClass = () => !!globalThis.document?.documentElement?.classList?.contains('lk-one-thumb');
// onFlat(): v2's phone flat controls are up (html.lk-flat, v2/ui/flat.js): a touch line then says its flat* wording
const flatClass = () => !!globalThis.document?.documentElement?.classList?.contains('lk-flat');
export function createWords({ storage = null, skills = null, mode = 'both', oneThumb = thumbClass, onFlat = flatClass } = {}) {
  let save = { v: 1, met: {} };
  try { const raw = storage?.getItem(SAVE_KEY); if (raw) { const j = JSON.parse(raw); if (j && j.v === 1 && j.met) save = { v: 1, met: { ...j.met } }; } } catch { /* corrupt or absent: start clean */ }
  const persist = () => { try { storage?.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private or full: memory only */ } };
  const listeners = new Set();
  let setting = mode === 'sailor' ? 'sailor' : 'both';
  let sk = skills;

  // a term's level: 'sailor' when the setting says so, the pro is detected, or every one of its skills is learned (a term
  // with no skill: met 3 times); else 'plain' (the plain words first, the term beside them)
  function level(id) {
    if (setting === 'sailor') return 'sailor';
    if (sk?.pro) return 'sailor';
    const t = BY_ID[id]; if (!t) return 'sailor';
    if (t.skills.length) return sk && t.skills.every((s) => sk.mastered(s)) ? 'sailor' : 'plain';
    return (save.met[id]?.n ?? 0) >= 3 ? 'sailor' : 'plain';
  }
  // a phrase's level follows its skill
  function phraseLevel(p) {
    if (setting === 'sailor' || sk?.pro) return 'sailor';
    return sk && p.skill ? (sk.mastered(p.skill) ? 'sailor' : 'plain') : level(p.term);
  }

  function meet(id) {
    if (!BY_ID[id]) return false;
    const m = save.met[id], first = !m;
    save.met[id] = { at: m?.at ?? new Date().toISOString(), n: (m?.n ?? 0) + 1 };
    persist();
    if (first) for (const f of listeners) try { f({ type: 'met', id }); } catch { /* a listener's fault is its own */ }
    return first;
  }

  // html for a string with §phrases§ and {terms}; { mouse } picks the mouse phrasing, { touch } the finger's (a phrase with no touch
  // wording says its plain one: no key is ever named on a touch device); { meet: true } records what it shows
  function expand(str, { mouse = false, touch = false, thumb = null, flat = null, meetTerms = false } = {}) {
    const met = (id) => { if (meetTerms) meet(id); };
    const fl = touch && (flat ?? onFlat()), th = touch && !fl && (thumb ?? oneThumb());
    let out = String(str).replace(/§([a-z]+)§/g, (_, key) => {
      const p = PHRASES[key]; if (!p) return key;
      if (phraseLevel(p) === 'plain') {
        met(p.term);
        return esc(fl && p.flat ? p.flat : th && p.thumb ? p.thumb : touch && p.touch ? p.touch : mouse && p.mouse ? p.mouse : p.plain);   // no trailing "· trim" tag (owner, 2026-11-05: the sentence says it)
      }
      return expandInline(fl && p.flatSailor ? p.flatSailor : th && p.thumbSailor ? p.thumbSailor : touch && p.touchSailor ? p.touchSailor : mouse && p.mouseSailor ? p.mouseSailor : p.sailor, true, met);
    });
    out = expandInline(out, false, met);
    return out;
  }
  // {id}, {id|text}, {id|text|plain}: a sailor's form shows the text, a plain level shows the plain alt (still a hover target)
  function expandInline(s, forceSailor, met) {
    return s.replace(/\{([a-z-]+)(?:\|([^}|]*))?(?:\|([^}]*))?\}/g, (_, id, text, plain) => {
      const t = BY_ID[id]; if (!t) return esc(text ?? id);
      const say = text ?? t.term;
      if (!forceSailor && plain != null && level(id) === 'plain') return span(id, plain);
      met(id); return span(id, say);
    });
  }

  const gloss = (id) => { const t = BY_ID[id]; return t ? { id, term: t.term[0].toUpperCase() + t.term.slice(1), gloss: t.gloss, why: t.why, skills: t.skills } : null; };
  const metList = () => TERMS.filter((t) => save.met[t.id]);
  return {
    expand, level, meet, gloss, phraseLevel,
    met: metList, metAt: (id) => save.met[id]?.at ?? null, isMet: (id) => !!save.met[id],
    get metCount() { return Object.keys(save.met).filter((id) => BY_ID[id]).length; }, total: TOTAL,
    get mode() { return setting; }, set mode(m) { const n = m === 'sailor' ? 'sailor' : 'both'; if (n !== setting) { setting = n; for (const f of listeners) try { f({ type: 'mode' }); } catch { /* ignore */ } } },
    setSkills(s) { sk = s; },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
