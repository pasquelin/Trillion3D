// The second view a capture renders from: detached from the host camera, at its own aspect.
// Under a rig it must describe the view the frame is drawn from, not the camera's local pose.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEngineCamera, detachedHostView, readCameraWorld } from './cameraWorld.ts';

test('the detached capture view keeps the resolved world pose and takes its own aspect', () => {
  const rig = new THREE.Group();
  rig.position.set(3, -2, 7);
  rig.rotation.set(0.4, -1.2, 0.3);
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.25, 640);
  camera.position.set(-1, 2, 0.5);
  rig.add(camera);
  const view = detachedHostView(camera, 1);
  const detached = readCameraWorld(createEngineCamera(), view);
  const source = readCameraWorld(createEngineCamera(), camera);
  assert.deepEqual(
    [...detached.world],
    [...source.world],
    'the world pose is the rig-resolved one',
  );
  assert.deepEqual([detached.fov, detached.near, detached.far], [48, 0.25, 640]);
  assert.equal(detached.aspect, 1, 'the capture declares the aspect of its own target');
  assert.notDeepEqual([...detached.projection], [...source.projection]);
  // Moving the source afterwards leaves the capture view alone: it holds its own sixteen floats.
  rig.position.set(0, 0, 0);
  assert.deepEqual([...readCameraWorld(createEngineCamera(), view).world], [...detached.world]);
});
