// The phone's card, built for a thumb (owner, 2026-11-18: "think from a mobile-friendly perspective"; feature phoneCard in
// src/core/features.js: a phone, landscape-only). Not the desktop card shrunk: the same parts, laid out from the hands in.
//   left, the chart   the mini chart fills the left 58 %: five big pins (44 px or more), the lit one with the sloop on it, a plain line
//                     under them says the place and why (tap, no hover); "Surprise me" at its foot; the voyage line over it
//   right, the thumb  the modes stacked in the right thumb's reach: Cruise and Regatta, and Sail, the filled one, in the bottom corner;
//                     pills sized to their words (46 px, Sail 52 px; owner, 2026-11-19: "the 3 big buttons on the right side are too big")
//   the ⋯ menu        Chart, Log, Controls, Setup, Support Velia, GitHub, About in one list (top right), nothing else on the card
//   the edges         safe areas at both sides (a notch), nothing under 44 px, the text 15 px and up
// First visit: one tap (Sail). Pick a place: two taps (a pin, Sail). In play: a pin (shows it), "Sail from here" (moves her).
// The desktop card and the loading shell are untouched: every rule is under :root[data-f-phone-card=on].
//   const pc = mountPhoneCard(root, { liveChart }); pc.dispose()   liveChart: the live map takes the left box (not ?livechart=0)
const P = ':root[data-f-phone-card=on] #lk-load';
const PHONE_CSS = `${P}{--lk-rc:clamp(148px,20%,172px)}
${P} .lk-card{--btn:48px;--pill:24px;left:max(env(safe-area-inset-left,0px),10px);right:max(env(safe-area-inset-right,0px),10px);top:max(env(safe-area-inset-top,0px),8px);bottom:max(env(safe-area-inset-bottom,0px),8px);
  width:auto;height:auto;min-height:0;transform:none!important;font-size:15px;border-radius:16px}
${P}[data-state=home] .lk-card{animation:lk-pcin .4s cubic-bezier(.2,0,0,1) both}
@keyframes lk-pcin{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}
${P} .lk-card .lk-map{height:100%}
${P} .lk-sheet,${P} .lk-plan{display:contents}
${P} .lk-plabel{display:none}
${P} .lk-card .lk-sub,${P} .lk-card .lk-hero,${P} .lk-card .lk-by,${P} .lk-card .lk-what,${P} .lk-card .lk-rose,${P} .lk-card .lk-voyage .lk-stage{display:none}
${P} .lk-card .lk-word{position:absolute;left:20px;top:12px;margin:0;font-size:26px;letter-spacing:.3em}
${P} .lk-card .lk-row.lk-sum{position:absolute;left:16px;top:50px;width:auto;max-width:calc(100% - var(--lk-rc) - 40px);flex-wrap:wrap;font-size:16px;min-height:44px;align-items:center}
${P} .lk-card .lk-sum .dot{display:inline}
${P} .lk-card .lk-sum .b{flex-basis:auto;order:0}
${P} .lk-card .lk-sum .ch{order:0}
${P} .lk-card .lk-row.plan{position:absolute;right:0;bottom:0;width:calc(var(--lk-rc) + 16px);box-sizing:border-box;padding:0 14px 12px 4px}   /* the card already sits inside the safe area */
${P} .lk-card .lk-row .v.picks{display:flex;flex-direction:column;gap:8px;width:100%;overflow:visible;border:0;background:none;border-radius:0}
${P} .lk-card .lk-pick{width:100%;height:46px;min-height:46px;border:1px solid var(--hair);border-radius:23px;background:var(--back);font-size:16px;letter-spacing:.05em}
${P} .lk-card .lk-pick + .lk-sep + .lk-pick{border-left:1px solid var(--hair)}
${P} .lk-card .lk-sep{display:none}
${P} .lk-card .lk-pick[data-mode=cruise]{order:1}
${P} .lk-card .lk-pick[data-mode=regatta]{order:2}
${P} .lk-card .lk-pick[data-mode=sail]{order:3;height:52px;min-height:52px;border-radius:26px;font-size:19px;letter-spacing:.12em;font-weight:var(--lk-medium);text-shadow:none;border:2px solid var(--brass);color:var(--paper);background:var(--brass)}
${P} .lk-card .lk-pick[data-mode=sail][aria-checked=true]{background:var(--brass);color:var(--paper)}
${P}[data-build=wait] .lk-card .lk-pick[data-mode=sail]{opacity:.62}
${P} .lk-card .lk-pick{text-shadow:none}
${P} .lk-card .lk-pick[data-mode=sail]{text-shadow:none}
${P} .lk-card .lk-pick:active{filter:brightness(.92)}
/* one chart on the card (owner, 2026-11-19: "it seems we have two layers of chart"): with the live map (data-pc-live, set when the card
   mounts, before the map's module loads) the card is plain navy: the N3 engraving (its coast, the rose's rays, the fleur-de-lis), the card's light and
   its neatlines stay off from the first frame, so no engraved coast shows first and then goes under the map; ?livechart=0 keeps them */
${P}[data-pc-live] .lk-card{background:rgb(var(--pan))}
${P}[data-pc-live] .lk-card > :is(.lk-art-n,.lk-art),${P}[data-pc-live] .lk-light{display:none!important}
${P}[data-pc-live] .lk-card::before,${P}[data-pc-live] .lk-card::after{display:none}
/* until the live map's module is in, the mini chart's box is the map's empty frame (same place, same hairline), so the map fills it */
${P}[data-pc-live] .lk-card .lk-bp{bottom:12px!important;border:1px solid rgb(var(--lk-cream) / .28);border-radius:12px;box-sizing:border-box}
${P}[data-pc-live] .lk-card .lk-bp > *{visibility:hidden}
/* the chart's box: the left side, under the voyage line; the build's lines (while it builds) take its foot */
${P} .lk-card .lk-bp{left:12px;right:auto;top:100px;bottom:12px;width:calc(100% - var(--lk-rc) - 40px);height:auto}
${P}[data-build=wait] .lk-card .lk-bp{bottom:86px}
${P}[data-build] .lk-card .lk-bld{left:20px;right:auto;width:calc(100% - var(--lk-rc) - 56px);top:auto;bottom:12px;height:auto;padding:6px 10px 7px}
${P}[data-build=ready] .lk-card .lk-bld,${P} .lk-card .lk-bld-tag{display:none}
/* a Help page (Tutorials, Controls, Setup, About …) covers the whole card: opaque and above the live chart, the modes and the ⋯ button (the live map's
   host sits in the card at z 3 since the map card, phase 2b, and showed through the pages' clear layer) */
${P}[data-pg] .lk-pg{z-index:8;background:rgb(var(--lk-brand-navy))}
${P}[data-pg] .lk-card .lk-pmore{display:none}
/* the ⋯ menu: the card's links and foot in one list */
${P} .lk-card .lk-pmore{all:unset;box-sizing:border-box;position:absolute;z-index:5;top:8px;right:10px;width:48px;height:48px;border:1px solid var(--hair);border-radius:50%;background:var(--back);
  display:flex;align-items:center;justify-content:center;color:var(--navy);font-size:22px;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent}
${P}[data-state=menu] .lk-card .lk-pmore{right:66px}
${P} .lk-card .lk-pmore[aria-expanded=true]{border-color:var(--navy)}
${P}[data-state=menu]:not([data-pg]) .lk-card .lk-x{top:8px;right:10px}
${P} .lk-card .lk-links{display:none;position:absolute;z-index:6;left:auto;right:10px;top:62px;bottom:auto;width:min(480px,calc(100% - 28px));max-height:calc(100% - 76px);overflow:auto;box-sizing:border-box;grid-template-columns:1fr 1fr;grid-auto-rows:min-content;gap:2px 8px;padding:6px;
  border:1px solid var(--hair);border-radius:16px;background:rgb(var(--pan) / .985);box-shadow:0 8px 24px rgb(0 0 0 / .35)}
${P}[data-pmore] .lk-card .lk-links{display:grid;opacity:1;animation:none}
${P} .lk-card .lk-link{height:44px;min-height:44px;justify-content:flex-start;padding:0 14px;border:0;background:none;font-size:16px;letter-spacing:.06em;text-align:left}
${P} .lk-card .lk-link + .lk-link{padding-left:14px;border-left:0}
${P} .lk-card .lk-links > .lk-link{grid-column:1}
${P} .lk-card .lk-foot{grid-column:2;grid-row:1 / span 4;display:flex;flex-direction:column;align-items:stretch;margin:0;padding:0 0 0 8px;background:none;border-top:0;border-left:1px solid var(--hair);border-radius:0}
${P} .lk-card .lk-sup{height:44px;min-height:44px;border:0;border-radius:8px;padding:0 14px;background:none;justify-self:stretch}
${P} .lk-card .lk-news{height:44px;min-height:44px;justify-content:flex-start;justify-self:stretch;grid-area:auto;margin:0;padding:0 14px;text-align:left}
${P} .lk-card .lk-supl,${P} .lk-card .lk-ver{display:none}
/* one family with the desktop panel (owner, 2026-11-19: "audit the phone card as well"): one edge (16 px), one scale (8 / 16), the panel's pills and foot style */
@font-face{font-family:'Velia Script';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/pinyon-script-400.woff2) format('woff2')}
${P} .lk-card .lk-word{left:16px;top:10px;height:44px;display:flex;align-items:center;line-height:1;font-size:26px}
${P} .lk-card .lk-row.lk-sum{left:16px;top:56px;min-height:44px;font-size:15px;letter-spacing:.01em;padding:0;margin:0;max-width:calc(100% - var(--lk-rc) - 48px)}
${P} .lk-card .lk-row.lk-sum .ch{font-size:20px;opacity:.8}
:root[data-f-phone-card=on][data-map-card=box] #lk-load .lk-card .lk-livechart{left:16px;top:108px;bottom:36px;width:calc(100% - var(--lk-rc) - 48px)}   /* 36: the chart's caption, the day's lake fact, sits under it (ui/chart/chartFact.js) */
${P} .lk-card .lk-livechart .lkc-lyb{top:12px;right:12px}
${P} .lk-card .lk-livechart .lkc-ctl{right:12px}
${P} .lk-card .lk-livechart .lkc-surprise{left:12px;bottom:12px}
${P} .lk-card .lk-livechart .lkc-hint{display:none}   /* "Pinch to zoom" crossed the north arrow and the scale; the controls say it */
${P} .lk-card .lk-row.plan{right:16px;bottom:16px;width:var(--lk-rc);padding:0}
${P} .lk-card .lk-row .v.picks{gap:8px}
${P} .lk-card .lk-pick{height:44px;min-height:44px;border:1px solid rgb(var(--ink3) / .72);border-radius:22px;background:none;font-size:16px;letter-spacing:.05em;color:var(--navy)}
${P} .lk-card .lk-pick[data-mode=sail],${P} .lk-card .lk-pick[data-mode=sail][aria-checked=true]{height:48px;min-height:48px;border:0;border-radius:24px;background:var(--navy);color:var(--paper);font:500 16px/1 var(--lk-ui);letter-spacing:.2em;text-transform:uppercase}
${P} .lk-card .lk-pick:focus-visible{outline:none}
${P}[data-kbd] .lk-card .lk-pick:focus-visible{outline:2px solid var(--navy);outline-offset:3px}
${P} .lk-card .lk-pmore{top:10px;right:16px;width:44px;height:44px;background:var(--lk-glass-dense,var(--back));border:1px solid var(--lk-glass-edge,var(--hair))}
${P}[data-state=menu] .lk-card .lk-pmore{right:68px}
${P}[data-state=menu]:not([data-pg]) .lk-card .lk-x{top:10px;right:16px;width:44px;height:44px}
${P} .lk-card .lk-links .lk-go{display:none!important}
${P} .lk-card .lk-sup .lk-cup{display:none!important}
${P} .lk-card .lk-sup::before{content:'';flex:none;width:6px;height:6px;border-radius:50%;background:var(--brass);margin-right:8px}
${P} .lk-card .lk-news .t i{display:none!important}
${P} .lk-card .lk-sup,${P} .lk-card .lk-news{font:400 16px/1 var(--lk-ui);letter-spacing:.04em;color:var(--navy)}
${P} .lk-card .lk-news{justify-content:center;align-items:flex-start;text-align:left;padding-left:35px}   /* a column: its word at the left, centred in its 44 px row like Support and GitHub above it */
${P} .lk-card .lk-news .t{font:inherit;letter-spacing:inherit}
/* the source link in the ⋯ list's right column, between Support Velia and About: the same row (44 px, 16 px type); the GitHub mark (14 px) where
   Support has its brass dot, so the three words line up */
${P} .lk-card .lk-gh{height:44px;min-height:44px;justify-content:flex-start;gap:7px;padding:0 14px;border-radius:8px;font:400 16px/1 var(--lk-ui);letter-spacing:.04em;color:var(--navy)}
${P} .lk-card .lk-gh .lk-ghm{width:14px;height:14px}
/* the slogan, where the header has the room: right of VELIA, the script, the brass wave, the tracked caps (the desktop panel's treatment, smaller) */
${P} .lk-card .lk-hero .hs1{display:block;font:400 23px/1 'Velia Script','Snell Roundhand',Georgia,serif;font-style:italic;font-synthesis:none;white-space:nowrap}
${P} .lk-card .lk-hero .hs2{display:block;font:var(--lk-brand) 11px/1 var(--lk-font);letter-spacing:.28em;text-transform:uppercase;white-space:nowrap;opacity:.92}   /* Jost, the wordmark's face: three faces on the card, as on the panel (2026-11-24) */
${P} .lk-card .lk-hero .hw{display:block;width:96px;height:7px;margin:3px 0 4px 2px;fill:none;stroke:var(--brass);stroke-width:1;stroke-linecap:round;opacity:.9;overflow:visible}
@media (min-width:760px){${P} .lk-card .lk-hero{display:block!important;position:absolute;left:150px;top:9px;margin:0;z-index:1;pointer-events:none;color:var(--navy)}}
@media (prefers-reduced-motion:reduce){${P}[data-state=home] .lk-card{animation:none}}`;

export function mountPhoneCard(root, { doc = globalThis.document, liveChart = false } = {}) {
  const card = root?.querySelector?.('.lk-card');
  if (!card || card.querySelector('.lk-pmore')) return null;
  if (!doc.getElementById('lk-phonecard-css')) { const s = doc.createElement('style'); s.id = 'lk-phonecard-css'; s.textContent = PHONE_CSS; doc.head.appendChild(s); }
  card.classList.add('pc');
  doc.defaultView?.document?.fonts?.load?.("23px 'Velia Script'", 'The water is real.')?.catch?.(() => {});
  const onKey = () => root.setAttribute('data-kbd', ''), onPtr = () => root.removeAttribute('data-kbd');   // the focus ring is for a keyboard player (as on the desktop panel)
  doc.addEventListener('keydown', onKey, true); doc.addEventListener('pointerdown', onPtr, true);
  if (liveChart) root.dataset.pcLive = '';   // the live map will take the box: the card drops its engraving now (one chart on the card)
  const b = doc.createElement('button'); b.type = 'button'; b.className = 'lk-pmore'; b.setAttribute('aria-label', 'More'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-haspopup', 'true');
  b.innerHTML = '<span aria-hidden="true">⋯</span>';
  card.appendChild(b);
  const set = (on) => { if (on) root.dataset.pmore = ''; else delete root.dataset.pmore; b.setAttribute('aria-expanded', String(!!on)); };
  b.addEventListener('click', (e) => { e.stopPropagation(); set(!root.hasAttribute('data-pmore')); });
  // a link or a mode closes the list; so does a press anywhere else on the card
  const onClick = (e) => { if (root.hasAttribute('data-pmore') && !e.target.closest?.('.lk-pmore')) set(false); };
  root.addEventListener('click', onClick, true);
  const mo = doc.defaultView?.MutationObserver ? new doc.defaultView.MutationObserver(() => { if (root.dataset.state !== 'home' && root.dataset.state !== 'menu') set(false); }) : null;
  mo?.observe(root, { attributes: true, attributeFilter: ['data-state', 'data-pg'] });
  return { button: b, set, dispose() { mo?.disconnect(); root.removeEventListener('click', onClick, true); doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('pointerdown', onPtr, true); set(false); card.classList.remove('pc'); delete root.dataset.pcLive; b.remove(); } };
}
