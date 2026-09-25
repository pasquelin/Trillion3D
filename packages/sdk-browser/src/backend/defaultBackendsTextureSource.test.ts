import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { chooseBackends, resolveTextureSource } from './defaultBackends.ts';
import { autonomousPagesBackend } from './autonomous/pages.ts';
import { webgpuPagesBackend } from '../webgpu/pages/pages.ts';
import { exactPagesBackend } from '../../../../bench/witnesses/exact/backend.ts';
import type { ClusterManifest } from '../../../sdk-core/src/index.ts';

/**
 * Behaviour: skipping the source images follows what will DRAW, never the option alone. Only
 * the WebGPU page raster reads the levels the compiler baked; the engine's own WebGL2 page
 * path — the default on a machine that grants no WebGPU device — and the Three witnesses
 * sample `texture.image`, and a session that skipped its images would draw the one-pixel
 * placeholder. No machine loses its textures, so `'cache'` resolves back to `'host'` there.
 */
const metadata = {
  autonomousScene: 'scene.gltf',
  textures: { url: 'textures/v5' },
} as unknown as ClusterManifest;
const { device } = fakeDevice();

/** Runs `body` on a runtime that reads bitmaps, or on one that has no `createImageBitmap` at
 *  all — node has none of its own, so both states are installed here and then withdrawn. */
function onRuntime(bitmaps: boolean, body: () => void) {
  const held = Reflect.get(globalThis, 'createImageBitmap') as unknown;
  if (bitmaps) Reflect.set(globalThis, 'createImageBitmap', () => Promise.resolve({}));
  else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  try {
    body();
  } finally {
    if (held === undefined) Reflect.deleteProperty(globalThis, 'createImageBitmap');
    else Reflect.set(globalThis, 'createImageBitmap', held);
  }
}

test('the images the loader opens follow the backend the engine chose', () => {
  onRuntime(true, () => {
    const withGpu = chooseBackends({}, metadata, device);
    assert.deepEqual(withGpu.factories, [webgpuPagesBackend]);
    assert.equal(resolveTextureSource(undefined, withGpu.factories), 'cache');

    // No device: #297's degraded default is the engine's own WebGL2 page path, which samples
    // the host images — they are read, default option or not.
    const withoutGpu = chooseBackends({}, metadata, undefined);
    assert.deepEqual(withoutGpu.factories, [autonomousPagesBackend]);
    assert.equal(resolveTextureSource(undefined, withoutGpu.factories), 'host');
    assert.equal(resolveTextureSource('cache', withoutGpu.factories), 'host');
  });
});

test('a host list that draws the host scene keeps its images, and an empty list too', () => {
  onRuntime(true, () => {
    assert.equal(resolveTextureSource('cache', [exactPagesBackend]), 'host');
    assert.equal(resolveTextureSource('cache', [webgpuPagesBackend, exactPagesBackend]), 'host');
    assert.equal(resolveTextureSource(undefined, []), 'host');
  });
});

test('a host asking for the source images is obeyed under the WebGPU page raster', () => {
  onRuntime(true, () => {
    assert.equal(resolveTextureSource('host', [webgpuPagesBackend]), 'host');
  });
});

test('without createImageBitmap no level can be read, so the images are', () => {
  onRuntime(false, () => {
    assert.equal(resolveTextureSource('cache', [webgpuPagesBackend]), 'host');
  });
});
