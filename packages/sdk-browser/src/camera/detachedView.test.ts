// The second view a capture renders from: the same host camera, read at the aspect ratio of the
// surface written into. Under a rig it must describe the view the frame is drawn from, not the
// camera's local pose, and reading it must leave the main view untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { createEngineCamera, readCameraWorld } from './world.ts';

test('a capture view keeps the resolved world pose and takes the aspect it is drawn at', () => {
  const rig = new G.GraphGroup();
  rig.position.set(3, -2, 7);
  rig.rotation.set(0.4, -1.2, 0.3);
  const camera = G.perspectiveCamera(48, 16 / 9, 0.25, 640);
  camera.position.set(-1, 2, 0.5);
  rig.add(camera);
  const capture = readCameraWorld(createEngineCamera(), camera, 1);
  const main = readCameraWorld(createEngineCamera(), camera);
  assert.deepEqual([...capture.world], [...main.world], 'the world pose is the rig-resolved one');
  assert.deepEqual([capture.fov, capture.near, capture.far], [48, 0.25, 640]);
  assert.equal(capture.aspect, 1, 'the capture declares the aspect of its own target');
  assert.equal(main.aspect, 16 / 9, 'the main view keeps the aspect the host declared');
  assert.notDeepEqual([...capture.projection], [...main.projection]);
});
