// Help › About on v2: Contact, Support and About in one page (owner, 2026-11-18: "Contact, Support and About should be consolidated
// into one page — About must be kept — and rewrite the content to be well designed"). The Help nav reads Tutorials · Keys · Setup ·
// What's new · Credits · About. v1 (/classic/) keeps its three pages (src/ui/homePages.js): this rebuilds only v2's About and takes
// Contact and Support off v2's card, as setup.js already shape v2's pages after src/ui/home.js builds them.
//   ABOUT                     the page's words (one source for the tests and)
//   aboutHtml({ mark, playtest, versionLine })   the page's body (two panels: one page on a wide screen, two tabs on a phone)
//   mountAbout(root, { versionLine })             on the card (front.js), after the version line is set
// The parts keep their old hooks, so src/ui/home.js runs them unchanged: .addr .mail and [data-act=copy] (copy the address), the
// mailto link, [data-go=feedback] (Send feedback; its page's way back is About: home.js feedbackFrom), a[data-support] (the Ko-fi
// link, counted as support_click 'about'), [data-act=export-session] (the playtest export), .stamp-b (the version line).
import { SUPPORT, CUP_ICON, supportLink } from '../../src/ui/support.js';
import { CONTACT } from '../../src/ui/feedback.js';
import { EXPORT_NOTE } from '../../src/ui/playtest.js';
import { tabList, tabPanel } from '../../src/ui/homePages.js';
import { SOURCE } from './source.js';

export const ABOUT = Object.freeze({
  lead: 'A sailing game on a real lake, in your browser. Free, no sign-up.',
  by: 'Made by Zhao Lou at Lucid Lake Studio.',
  site: 'lucidlakelabs.com',
  touch: 'Get in touch',
  touchLine: 'Questions, press, a bug, a kind word: one address.',
  support: 'Support Velia',
  privacy: 'Privacy',
  privacyLine: 'Velia counts anonymous plays to improve the game. No cookies, no personal data.',
  news: 'What’s new',
});
const GONE = ['contact', 'support'];   // the pages About now holds (v2's card only)

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ic = (paths) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const FEEDBACK_IC = '<path d="M12 5c4.7 0 8 2.6 8 5.8s-3.3 5.8-8 5.8c-.9 0-1.8-.1-2.6-.3L5.6 19l.9-3.4C5 14.4 4 12.7 4 10.8 4 7.6 7.3 5 12 5Z"/><path d="M8.8 9.8h6.4M8.8 12.2h4.2"/>';

// Two panels: Velia (the studio, the source on GitHub, Privacy, the version line) and Get in touch (the address, Send feedback, Support Velia). A wide
// screen shows both as one page (the panels are display: contents in one grid, the tab strip hidden); a compact screen (a phone)
// shows them as the card's own tabs on the title's line, so neither scrolls (menu cards do not scroll)
export function aboutHtml({ mark = '', playtest = false, versionLine = '' } = {}) {
  const velia = `<section class="ab-s ab-v">${mark ? `<span class="ab-mk">${mark}</span>` : ''}<div><p class="ab-lead">${esc(ABOUT.lead).replace('no sign-up', '<span class="ab-nw">no sign-up</span>')}</p><p class="ab-by">${esc(ABOUT.by)} <a href="https://lucidlakelabs.com" target="_blank" rel="noopener">${esc(ABOUT.site)}</a></p><p class="ab-by ab-src">${esc(SOURCE.line)} <a href="${SOURCE.url}" target="_blank" rel="noopener" aria-label="${esc(SOURCE.label)}">${esc(SOURCE.short)}</a></p></div></section>
<section class="ab-s ab-p"><h3 class="ch3">${esc(ABOUT.privacy)}</h3><p class="note">${esc(ABOUT.privacyLine)}</p>${playtest ? `<p class="note">${EXPORT_NOTE}</p><p><button class="pbtn" type="button" data-act="export-session">Export session ↓</button></p>` : ''}</section>
<p class="stamp-b">${esc(versionLine)} · <button class="ab-news" type="button" data-go="news">${esc(ABOUT.news)}</button></p>`;
  const touch = `<section class="ab-s ab-t"><h3 class="ch3">${esc(ABOUT.touch)}</h3><p>${esc(ABOUT.touchLine)}</p>
<div class="addr"><span class="mail">${CONTACT}</span><button class="pbtn" type="button" data-act="copy">copy</button><a class="pbtn" href="mailto:${CONTACT}">write</a></div>
<p><button class="pbtn" type="button" data-go="feedback">${ic(FEEDBACK_IC)}Send feedback</button></p></section>
<section class="ab-s ab-su"><h3 class="ch3">${esc(ABOUT.support)}</h3><p class="kofi">${esc(SUPPORT.aboutLine)}</p><p class="kofib">${supportLink('about', `${ic(CUP_ICON)}${esc(SUPPORT.aboutLink)}`, 'pbtn kl')}</p></section>`;
  return `${tabList('ab', [['velia', 'Velia'], ['touch', ABOUT.touch]], 'About')}<div class="ab">${tabPanel('ab', 'velia', velia, true)}${tabPanel('ab', 'touch', touch)}</div>`;
}

const ABOUT_CSS = `
#lk-load[data-pg=about] .lk-card,#lk-load[data-pg=feedback] .lk-card{width:min(calc(var(--cw) + var(--hnw) + var(--F) * 8),calc(100vw - 2 * clamp(24px,5vw,84px)))}
#lk-load .pg[data-page=about] .kofib .pbtn{white-space:nowrap}
#lk-load .pg[data-page=about] .ab{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-areas:'v v' 't s' 't p' 'st st';column-gap:1.6em;row-gap:.45em}
#lk-load .pg[data-page=about] .ab > .tp,#lk-load .pg[data-page=about] .ab > .tp[hidden]{display:contents}
#lk-load .pg[data-page=about] .tabs{display:none}
#lk-load .pg[data-page=about] .stamp-b{grid-area:st}
#lk-load .pg[data-page=about] .ab-t{grid-area:t}
#lk-load .pg[data-page=about] .ab-su{grid-area:s}
#lk-load .pg[data-page=about] .ab-s{min-width:0}
#lk-load .pg[data-page=about] .ab-v{grid-area:v}
#lk-load .pg[data-page=about] .ab-p{grid-area:p}
#lk-load .pg[data-page=about] .ab-v{display:flex;align-items:center;gap:1em;padding-bottom:.45em;border-bottom:1px solid rgb(var(--lk-cream) / .22)}
#lk-load .pg[data-page=about] .ab-mk{flex:none;width:3.2em;color:var(--navy)}
#lk-load .pg[data-page=about] .ab-mk svg{display:block;width:100%;height:auto}
#lk-load .pg[data-page=about] .ab-lead{font-family:'Velia Sub A',var(--lk-font);font-size:1.12em;line-height:1.4;margin:0 0 .25em}
#lk-load .pg[data-page=about] .ab-nw{white-space:nowrap}
#lk-load .pg[data-page=about] .ab-by{margin:0;color:var(--ink2)}
#lk-load .pg[data-page=about] .ab-src{margin-top:.2em}
#lk-load .pg[data-page=about] .ab-by a{color:var(--navy);text-decoration:underline;text-underline-offset:.15em;margin-left:.3em}
#lk-load .pg[data-page=about] .ch3{margin:0 0 .35em}
#lk-load .pg[data-page=about] .ab-s p{margin:0 0 .5em}
#lk-load .pg[data-page=about] .addr{margin:.1em 0 .55em}
#lk-load .pg[data-page=about] .ab-p .note{margin:0 0 .3em;font-style:normal;font-family:inherit}
#lk-load .pg[data-page=about] .stamp-b{margin:.2em 0 0}
#lk-load .pg[data-page=about] .ab-news{font:inherit;color:inherit;text-decoration:underline;text-underline-offset:.15em;padding:0 .1em}
/* a phone's Help nav beside the page: its six rows (44 px) fit under the way back without the "Help" head, which the rows already say */
:where(:root[data-screen~=compact]) #lk-load[data-help] .hnav .hn-t{display:none}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .tabs{display:flex}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .ab{display:block}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .ab > .tp{display:block}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .ab > .tp[hidden]{display:none}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .tp[data-tp=touch]{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:1.1em}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .tp[data-tp=touch][hidden]{display:none}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .tp > *{grid-area:auto}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .ab-s{margin:0 0 .45em}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .ab-mk{display:none}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .ab-v{padding-bottom:.35em}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .ab-p .ch3{display:inline;margin:0 .6em 0 0}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .ab-p .note{display:inline}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .pg[data-page=about] .ab-lead{font-size:1.02em}
`;

export function mountAbout(root, { versionLine = '', doc = globalThis.document } = {}) {
  const about = root?.querySelector?.('.pg[data-page=about] .pg-b');
  if (!about || about.querySelector('.ab')) return null;
  const mark = about.querySelector('.studio .lk-mk')?.outerHTML ?? '';
  const playtest = !!about.querySelector('[data-act=export-session]');
  const vl = versionLine || about.querySelector('.stamp-b')?.textContent || '';
  if (!doc.getElementById('lk-about-css')) { const st = doc.createElement('style'); st.id = 'lk-about-css'; st.textContent = ABOUT_CSS; doc.head.appendChild(st); }
  about.innerHTML = aboutHtml({ mark, playtest, versionLine: vl });
  // Contact and Support leave v2's sheet: their nav rows and pages; Send feedback steps back to About
  for (const k of GONE) for (const n of root.querySelectorAll(`.hnav .hn[data-go=${k}], .pg[data-page=${k}]`)) n.remove();
  const back = root.querySelector('.pg[data-page=feedback] .pg-back');
  if (back) { back.dataset.go = 'about'; const t = [...back.childNodes].find((n) => n.nodeType === 3); if (t) t.textContent = 'About'; }
  return { el: about, removed: GONE };
}
