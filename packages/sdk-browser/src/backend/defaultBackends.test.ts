// #274: with no `backends` option the engine's own path renders, and a Three witness is only ever
// active because something said so. #297: a machine without WebGPU takes the engine's own
// autonomous WebGL2 path, which draws; the temporary witness fallback of #298 is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { autonomousCacheReady, chooseBackends } from './defaultBackends.ts';
import { autonomousPagesBackend } from './autonomous/pages.ts';
import { webgpuPagesBackend } from '../webgpu/pages/pages.ts';
import { exactPagesBackend } from '../../../../bench/witnesses/exact/backend.ts';
import { referenceBackend } from '../../../../bench/witnesses/referenceBackend.ts';
import { EngineError, type ClusterManifest } from '../../../sdk-core/src/index.ts';

const cache = (autonomousScene: string | null) =>
  ({ autonomousScene, primitives: [] }) as unknown as ClusterManifest;
const device = {} as GPUDevice;

test('a WebGPU machine renders through the engine page raster by default', () => {
  const choice = chooseBackends({}, cache('scene.gltf'), device);
  assert.deepEqual(choice.factories, [webgpuPagesBackend]);
  assert.equal(choice.autonomous, false);
  assert.equal(choice.renderer, 'webgpu-page-raster');
  assert.equal(choice.origin, 'default');
  assert.match(choice.reason, /WebGPU device/);
});

test("a WebGL2-only machine renders through the engine's own autonomous path", () => {
  const choice = chooseBackends({}, cache('scene.gltf'), undefined);
  assert.deepEqual(choice.factories, [autonomousPagesBackend]);
  assert.equal(choice.renderer, 'autonomous-pages-webgl');
  assert.equal(choice.autonomous, true);
  assert.equal(choice.origin, 'default');
  assert.match(choice.reason, /no WebGPU device/);
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
    assert.equal(choice.renderer, null);
  }
});

test('a cache without a prepared scene still draws, through source.gltf', () => {
  const choice = chooseBackends({}, cache(null), undefined);
  assert.deepEqual(choice.factories, [autonomousPagesBackend]);
  assert.equal(choice.renderer, 'autonomous-pages-webgl');
  // The same path, reading the source scene: an image, not autonomy and not a refusal.
  assert.equal(choice.autonomous, false);
  assert.equal(choice.origin, 'default');
  assert.match(choice.reason, /source\.gltf/);
});

test('no engine path fails by name only when the machine offers neither API', () => {
  for (const scene of ['scene.gltf', null])
    assert.throws(
      () => chooseBackends({}, cache(scene), undefined, false),
      (error: unknown) =>
        error instanceof EngineError &&
        error.code === 'NO_ENGINE_BACKEND' &&
        /neither a WebGPU device nor a WebGL2/.test(error.message),
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
  assert.equal(choice.origin, 'host');
});
