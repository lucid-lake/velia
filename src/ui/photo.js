// The photo (owner, 2026-11-06; Cruise's Locker › Photo, src/ui/toolDock.js lockerMenu): one press, a clean frame. Every piece of UI
// fades out (html.lk-photo: only the scene's canvas stays), the next frame drawn is copied in its own task (the core's
// afterFrame: the only time a WebGPU canvas can be read, as the logbook's pictures are), then saved: the share sheet on
// a touch device that can share a file, else a PNG download. The UI comes back after PHOTO.holdMs.
//
//   const shot = await takePhoto({ afterFrame: core.afterFrame, canvas: renderer.domElement, name: photoName('the waterfall', 19.07) });
//   // → { name, w, h, how: 'share' | 'download' } (null when the frame could not be read)
// photoName is pure (tests/cruiseBar.test.mjs).
export const PHOTO = { holdMs: 450, waitFrames: 2 };

const CSS = `html.lk-photo body *{visibility:hidden!important}
html.lk-photo body [data-lk-scene]{visibility:visible!important}`;

// velia-<place>-<hh>-<mm>.png, the place's words in lower case joined by dashes ("the waterfall" → the-waterfall)
export function photoName(place, hourOfDay) {
  const slug = String(place ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const h = ((Number(hourOfDay) || 0) % 24 + 24) % 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60 + 1e-6);
  return `velia-${slug ? `${slug}-` : ''}${String(hh).padStart(2, '0')}-${String(mm).padStart(2, '0')}.png`;
}

const frames = (n) => new Promise((ok) => { const step = (k) => (k <= 0 ? ok() : requestAnimationFrame(() => step(k - 1))); step(n); });

// afterFrame(fn): fn(canvas) right after the next frame is drawn (src/core/loop.js); share: try the share sheet first
export async function takePhoto({ afterFrame, canvas: scene = null, name = 'velia.png', share = false, doc = document, nav = globalThis.navigator } = {}) {
  if (typeof afterFrame !== 'function') return null;
  if (!doc.getElementById('lk-photo-css')) { const st = doc.createElement('style'); st.id = 'lk-photo-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const H = doc.documentElement;
  if (scene?.dataset) scene.dataset.lkScene = '';   // the scene stays on screen; everything else fades
  H.classList.add('lk-photo');
  try {
    await frames(PHOTO.waitFrames);
    const copy = await new Promise((ok) => {
      afterFrame((canvas) => {
        try {
          const c = doc.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
          c.getContext('2d').drawImage(canvas, 0, 0);
          ok(c);
        } catch { ok(null); }
      });
    });
    if (!copy) return null;
    const blob = await new Promise((ok) => copy.toBlob(ok, 'image/png'));
    if (!blob) return null;
    const out = { name, w: copy.width, h: copy.height, how: 'download' };
    if (share && typeof File === 'function' && nav?.canShare && nav?.share) {
      const file = new File([blob], name, { type: 'image/png' });
      try {
        if (nav.canShare({ files: [file] })) { await nav.share({ files: [file] }); return { ...out, how: 'share' }; }
      } catch (e) { if (e?.name === 'AbortError') return { ...out, how: 'share' }; /* else: the download below */ }
    }
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return out;
  } finally {
    setTimeout(() => H.classList.remove('lk-photo'), PHOTO.holdMs);
  }
}
