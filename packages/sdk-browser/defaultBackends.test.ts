// #274: with no `backends` option the engine's own path renders — the WebGPU page raster where a
// device was granted, the autonomous WebGL2 path otherwise — and a Three witness is only ever
// active because the host named it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { autonomousCacheReady, chooseBackends } from './defaultBackends.ts';
import { autonomousPagesBackend } from './autonomousPages.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { exactPagesBackend } from './exactPagesBackend.ts';
import { referenceBackend } from './referenceBackend.ts';
import { EngineError, type ClusterManifest } from '../sdk-core/index.ts';

const cache = (autonomousScene: string | null) =>
  ({ autonomousScene, primitives: [] }) as unknown as ClusterManifest;
const device = {} as GPUDevice;

test('a WebGPU machine renders through the engine page raster by default', () => {
  const choice = chooseBackends({}, cache('scene.gltf'), device);
  assert.deepEqual(choice.factories, [webgpuPagesBackend]);
  assert.equal(choice.autonomous, false);
  assert.equal(choice.origin, 'default');
  assert.match(choice.reason, /WebGPU device/);
});

test('a WebGL2-only machine renders through the autonomous path, not a witness', () => {
  const choice = chooseBackends({}, cache('scene.gltf'), undefined);
  assert.deepEqual(choice.factories, [autonomousPagesBackend]);
  assert.equal(choice.autonomous, true);
  assert.equal(choice.origin, 'default');
  assert.equal(autonomousCacheReady(cache('scene.gltf')), true);
});

test('a witness renders only because the host opted into it', () => {
  const witnesses = [referenceBackend, exactPagesBackend];
  for (const gpu of [device, undefined]) {
    const choice = chooseBackends({ backends: witnesses }, cache('scene.gltf'), gpu);
    assert.deepEqual(choice.factories, witnesses);
    assert.equal(choice.origin, 'host');
    assert.equal(choice.autonomous, false);
  }
});

test('no WebGPU and no prepared scene fails by name instead of falling back to a witness', () => {
  assert.throws(
    () => chooseBackends({}, cache(null), undefined),
    (error: unknown) => error instanceof EngineError && error.code === 'NO_ENGINE_BACKEND',
  );
});

test('an explicit autonomous request still refuses a cache without a prepared scene', () => {
  assert.throws(
    () => chooseBackends({ autonomousGeometry: true }, cache(null), undefined),
    (error: unknown) =>
      error instanceof EngineError && error.code === 'AUTONOMOUS_SCENE_UNAVAILABLE',
  );
  const choice = chooseBackends({ autonomousGeometry: true }, cache('scene.gltf'), undefined);
  assert.deepEqual(choice.factories, [autonomousPagesBackend]);
  assert.equal(choice.origin, 'host');
});
