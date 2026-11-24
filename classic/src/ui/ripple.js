// The click's ripple: a tiny, quiet ring on the water where a click set the course, two thin rings
// spreading and fading out over RIPPLE.life s. Sized from the camera's distance, so it reads the same few pixels near
// or far. Nothing else of the course is drawn: the boat turning is the answer.
//   const r = createRipple({ scene, THREE }); r.spawn(x, z, dist); r.update(dt, exposure);
// The colour is divided by the scene's exposure (AgX after it), so the ring stays the hints' cream at dawn and noon.
export const RIPPLE = { life: 2, r0: 0.005, r1: 0.03, alpha: 0.5, color: 0xefe6d2, gain: 1.6, y: 0.06 };   // r0/r1: × the camera distance

// the ring's radius and opacity at age a (s): eased out, the second ring 0.35 s behind (pure: tests/mouse.test.mjs)
export function rippleAt(a, dist, lag = 0) {
  const u = Math.max(0, Math.min(1, (a - lag) / (RIPPLE.life - lag)));
  const e = 1 - (1 - u) * (1 - u);
  return { r: dist * (RIPPLE.r0 + (RIPPLE.r1 - RIPPLE.r0) * e), alpha: u >= 1 || a < lag ? 0 : RIPPLE.alpha * (1 - u) * Math.min(1, (a - lag) / 0.12) };
}

export function createRipple({ scene, THREE }) {
  const geo = new THREE.RingGeometry(0.94, 1, 64); geo.rotateX(-Math.PI / 2);
  const rings = [0, 0.35].map((lag) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicNodeMaterial({ color: RIPPLE.color, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    m.name = 'click-ripple'; m.visible = false; m.renderOrder = 5; m.frustumCulled = false; m.userData.lag = lag;
    scene.add(m); return m;
  });
  let age = Infinity, dist = 100;
  return {
    spawn(x, z, d) { age = 0; dist = d; for (const m of rings) m.position.set(x, RIPPLE.y, z); },
    update(dt, exposure = 1) {
      if (age === Infinity) return;
      age += dt;
      for (const m of rings) {
        m.material.color.setHex(RIPPLE.color).multiplyScalar(RIPPLE.gain / Math.max(0.05, exposure));
        const { r, alpha } = rippleAt(age, dist, m.userData.lag);
        m.scale.setScalar(Math.max(1e-3, r)); m.material.opacity = alpha; m.visible = alpha > 0;
      }
      if (age > RIPPLE.life) { age = Infinity; for (const m of rings) m.visible = false; }
    },
    get active() { return age < RIPPLE.life; },
    dispose() { for (const m of rings) { scene.remove(m); m.material.dispose(); } geo.dispose(); },
  };
}
