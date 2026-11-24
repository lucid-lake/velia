// The companionway portal (boat detail step 1; plan 41's b-beam-low bug): the cabin, the portal and the hull draw in that
// order with the portal depth-tested, so from outside the topsides hide the cabin. Plain JS, no GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { applyCockpitLook, HULL_ORDER } from '../src/boat/cockpitLook.js';

test('the companionway portal draws after the cabin and before the hull, with the depth test on (no cabin through the topsides)', () => {
  const root = new THREE.Group();
  const portal = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardNodeMaterial()); portal.name = 'companion_portal';
  const cabin = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardNodeMaterial()); cabin.name = 'companion_interior';
  root.add(portal, cabin);
  applyCockpitLook(root);
  assert.ok(cabin.renderOrder < portal.renderOrder && portal.renderOrder < HULL_ORDER, `cabin ${cabin.renderOrder} < portal ${portal.renderOrder} < hull ${HULL_ORDER}`);
  // the portal is hidden where the hull is in front of it: its depth is tested, its own depth written, no colour
  assert.notEqual(portal.material.depthFunc, THREE.AlwaysDepth);
  assert.equal(portal.material.depthTest, true); assert.equal(portal.material.depthWrite, true); assert.equal(portal.material.colorWrite, false);
});
