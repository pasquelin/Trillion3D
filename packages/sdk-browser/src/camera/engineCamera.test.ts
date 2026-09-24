// The engine camera written without a host camera gives the bits `readCameraWorld` gives from
// one: the default camera of the oracles and a posed test camera, both formerly built with Three.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { assertBits } from '../../../../tests/kit/assert/bits.ts';
import {
  createEngineCamera,
  defaultEngineCamera,
  writeEngineCamera,
  type EngineCamera,
} from './engineCamera.ts';
import { readCameraWorld } from './world.ts';

const FIELDS = ['world', 'projection', 'view', 'viewProjection', 'planes', 'eye'] as const;
function assertSameCamera(engine: EngineCamera, host: EngineCamera) {
  for (const field of FIELDS) assertBits(engine[field], host[field]);
  for (const field of ['near', 'far', 'fov', 'aspect'] as const)
    assert.ok(Object.is(engine[field], host[field]), field);
}

test('defaultEngineCamera: the bits of a fresh host camera read through the contract', () => {
  const host = readCameraWorld(createEngineCamera(), G.perspectiveCamera());
  assertSameCamera(defaultEngineCamera(), host);
  assert.equal(defaultEngineCamera(), defaultEngineCamera(), 'allocated once');
});

test('writeEngineCamera: a posed world and declared optics give the bits of the posed host camera', () => {
  const hostCamera = G.perspectiveCamera(55, 1, 0.1, 100);
  hostCamera.position.z = 5;
  hostCamera.zoom = 1.5;
  const host = readCameraWorld(createEngineCamera(), hostCamera);
  const engine = createEngineCamera();
  engine.world.set(IDENTITY_MATRIX4);
  engine.world[14] = 5;
  writeEngineCamera(engine, { fov: 55, aspect: 1, near: 0.1, far: 100, zoom: 1.5 });
  assertSameCamera(engine, host);
});
