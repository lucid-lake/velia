// Fly (a dev mode; the default while there is no ?mode): the camera rig (T1c) drifts on autopilot; any input takes
// over (WASD, mouse under pointer lock, gamepad), 20 s idle hands back. With ?cam=<preset> the camera holds the
// preset and only the scene clock runs. Captures (?headless) keep the fixed presets, or ?drive=<t> (the core) poses
// the autopilot at time t. ?debug=input shows what the page receives. The mode interface: src/modes/README.md.
import { CameraRig, attachInput } from '../../../../src/camera.js';

export async function start(core) {
  const { flags, headless, renderer, camera, terrain, lod, msg, T0 } = core;
  if (headless) return { update() {}, dispose() {} };

  if (flags.cam != null) {   // a fixed preset, live: the clock runs (wind, water, clouds)
    const start = performance.now();
    return {
      update() { core.setTime(T0 + (performance.now() - start) / 1000); },
      dispose() {},
    };
  }

  const applyPose = (p) => {
    camera.position.set(...p.pos);
    const c = Math.cos(p.pitch);
    camera.lookAt(p.pos[0] + Math.sin(p.yaw) * c, p.pos[1] + Math.sin(p.pitch), p.pos[2] - Math.cos(p.yaw) * c);
    camera.fov = p.fov; camera.updateProjectionMatrix();
  };
  const rig = new CameraRig({ heightAt: terrain.heightAt, t0: T0 });
  const input = attachInput(renderer.domElement);
  const DEBUG_INPUT = flags.debug === 'input';
  const off = new AbortController(), signal = off.signal;
  let fpsAvg = 60; const lastKeys = new Set();
  addEventListener('keydown', (e) => { lastKeys.add(`${e.code}${e.isComposing || e.keyCode === 229 ? '(IME)' : ''}`); }, { signal });
  addEventListener('keyup', (e) => { lastKeys.delete(e.code); lastKeys.delete(`${e.code}(IME)`); }, { signal });
  const start = performance.now();
  return {
    update(dtS) {
      const inp = input.poll();
      const pose = rig.update(Math.min(0.1, dtS), inp); applyPose(pose);
      if (DEBUG_INPUT) {   // ?debug=input: what the page actually receives, to diagnose controls on a real browser
        fpsAvg = fpsAvg * 0.95 + (1 / Math.max(dtS, 1e-3)) * 0.05;
        msg.textContent = `fps ${fpsAvg.toFixed(0)} · mode ${rig.mode} · keys [${[...lastKeys].join(' ')}] · move ${inp.move.map((v) => v.toFixed(1)).join(',')} rise ${inp.rise} · speed ${Math.hypot(...rig.vel).toFixed(1)} m/s · pos ${camera.position.toArray().map((v) => v.toFixed(0)).join(', ')} · focus ${document.hasFocus()}`;
      }
      lod.update(camera.position);
      core.setTime(T0 + (performance.now() - start) / 1000);
    },
    dispose() { off.abort(); input.dispose(); },
  };
}
