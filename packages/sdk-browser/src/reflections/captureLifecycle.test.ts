import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts';
import { webgpuPagesBackend } from '../webgpu/pages/pages.ts';
import { quadScene, camera } from '../webgpu/pages/testScenes.fixture.ts';

// A capture may be the first view to select a mirror: initial targets have no source yet.
test('first mirror capture waits for its late target grant and draws before returning owned surfaces', async () => {
  installGpuGlobals();
  const gpu = mockGpu(),
    fixture = quadScene();
  const mirror = new G.GraphSurface('standard', { roughness: 0, metalness: 1 });
  (fixture.source.children[0] as G.Mesh).material = mirror;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    const surface = await backend.captureSurfaceView!(camera(), { width: 16, height: 16 });
    assert.equal(surface.selectedTriangles, 2);
    const targets = gpu.textures.filter(
      (texture) => texture.label === 'Trillion3D unfogged reflection source',
    );
    assert.ok(
      targets.some((texture) => texture.width === 16 && texture.height === 16),
      'capture allocated its reflective view',
    );
    assert.ok(
      gpu.draws.some((draw) => draw.fragment === 'lightSurface'),
      'capture submitted lighting before return',
    );
    assert.ok(
      targets.filter((texture) => texture.width === 16).every((texture) => texture.destroyed),
      'capture releases only its view',
    );
    surface.dispose();
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
    mirror.dispose();
  }
});
