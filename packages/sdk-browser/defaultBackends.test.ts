// #274: with no `backends` option the engine's own path renders, and a Three witness is only ever
// active because something said so. #298: while the engine's own WebGL2 path cannot draw (#297), a
// machine without WebGPU takes a stated degraded mode rather than showing nothing.
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
  assert.equal(choice.degraded, false);
  assert.equal(choice.renderer, 'webgpu-page-raster');
  assert.equal(choice.origin, 'default');
  assert.match(choice.reason, /WebGPU device/);
});

test('a WebGL2-only machine draws in a degraded mode that names its renderer and its cause', () => {
  for (const metadata of [cache('scene.gltf'), cache(null)]) {
    const choice = chooseBackends({}, metadata, undefined);
    assert.deepEqual(choice.factories, [exactPagesBackend]);
    assert.equal(choice.renderer, 'exact-cluster-pages');
    assert.equal(choice.degraded, true);
    assert.equal(choice.autonomous, false);
    assert.equal(choice.origin, 'default');
    assert.match(choice.reason, /no WebGPU device/);
    assert.match(choice.reason, /degraded mode/);
    assert.match(choice.reason, /AUTONOMOUS_COVERAGE_MISSING, #297/);
  }
  assert.equal(autonomousCacheReady(cache('scene.gltf')), true);
  assert.equal(autonomousCacheReady(cache(null)), false);
});

test('a witness renders only because the host opted into it', () => {
  const witnesses = [referenceBackend, exactPagesBackend];
  for (const gpu of [device, undefined]) {
    const choice = chooseBackends({ backends: witnesses }, cache('scene.gltf'), gpu);
    assert.deepEqual(choice.factories, witnesses);
    assert.equal(choice.origin, 'host');
    assert.equal(choice.autonomous, false);
    assert.equal(choice.degraded, false);
    assert.equal(choice.renderer, null);
  }
});

test('neither WebGPU nor WebGL2 fails by name: nothing at all can be drawn there', () => {
  assert.throws(
    () => chooseBackends({}, cache('scene.gltf'), undefined, false),
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
  assert.equal(choice.renderer, 'autonomous-pages-webgl');
  assert.equal(choice.degraded, false);
  assert.equal(choice.origin, 'host');
});
