// Start a mode from the home card the player's way. The desktop/tablet panel selects the mode on a press of its pick and starts
// it on Set sail (#lk-load .lk-go; owner, 2026-11-18); the phone card starts on one tap of the pick.
//   await pickMode(page, 'sail' | 'cruise' | 'regatta', { tap: false })
export async function pickMode(page, mode, { tap = false } = {}) {
  const sel = `#lk-load .lk-pick[data-mode=${mode}]`;
  await (tap ? page.tap(sel) : page.click(sel));
  if (await page.evaluate(() => document.documentElement.dataset.mapCard === 'panel' && !!document.querySelector('#lk-load .lk-go')?.getClientRects().length)) {
    await (tap ? page.tap('#lk-load .lk-go') : page.click('#lk-load .lk-go'));
  }
}
