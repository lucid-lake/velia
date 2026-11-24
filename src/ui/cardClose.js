// One way for a card over the live world to close (owner, 2026-10-31: the logbook did not close on a press outside it,
// while the menu card and its pages did). The home card (home.js) and the logbook (logbook.js) both use it.
//
//   const off = closeOnOutside({ isOpen, inside, close, esc });   // off() removes the listeners
//
// A press outside the card (isOpen() true, inside(target) false) closes it. That press is eaten whole: its pointerdown,
// touchstart, mousedown, ups and click stop here, so a tap on the water never steers the boat. With esc: true, Esc closes it too (the
// home card handles its own Esc: it goes back a page first).
export const OUTSIDE = ['pointerdown', 'touchstart', 'mousedown', 'pointerup', 'mouseup', 'click'];

export function closeOnOutside({ isOpen, inside, close, esc = false, target = globalThis }) {
  let eat = false;   // the press that closed the card: its mousedown, ups and click stop here too
  const onPress = (e) => {
    if (e.type === 'pointerdown') {
      eat = !!isOpen() && !inside(e.target);
      if (eat) close();
    }
    if (!eat) return;
    e.stopPropagation();
    if (e.type !== 'touchstart') e.preventDefault();   // a touch listener on window is passive: it may only stop the event
    if (e.type === 'click') eat = false;
  };
  const onKey = (e) => {
    if (e.type !== 'keydown' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.code === 'Escape' || e.key === 'Escape') && isOpen()) close();
  };
  for (const t of OUTSIDE) target.addEventListener(t, onPress, true);
  if (esc) target.addEventListener('keydown', onKey);
  return () => { for (const t of OUTSIDE) target.removeEventListener(t, onPress, true); target.removeEventListener('keydown', onKey); };
}
