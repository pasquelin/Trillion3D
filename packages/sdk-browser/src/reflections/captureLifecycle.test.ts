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
  const mirror = new G.GraphSurface('standard', { roughness: 1, metalness: 1 });
  const mesh = fixture.associations.keys().next().value;
  assert.ok(mesh);
  mesh.material = mirror;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush!();
    const drawsBeforeCapture = gpu.draws.length;
    const createTexture = gpu.device.createTexture.bind(gpu.device);
    let changed = false;
    gpu.device.createTexture = (descriptor) => {
      const texture = createTexture(descriptor);
      if (!changed && descriptor.label?.startsWith('Trillion3D unfogged reflection source')) {
        // Change after the capture's initial non-reflective target grant. Row refresh must
        // request and await a second grant, then render it before returning the capture.
        changed = true;
        mirror.roughness = 0;
        mirror.needsUpdate = true;
      }
      return texture;
    };
    const surface = await backend.captureSurfaceView!(camera(), { width: 16, height: 16 });
    assert.ok(changed, 'capture encountered the late material update');
    assert.equal(surface.selectedTriangles, 2);
    const targets = gpu.textures.filter(
      (texture) => texture.label === 'Trillion3D unfogged reflection source',
    );
    assert.ok(
      targets.some((texture) => texture.width === 16 && texture.height === 16),
      'capture allocated its reflective view',
    );
    assert.ok(
      gpu.draws.slice(drawsBeforeCapture).some((draw) => draw.fragment === 'lightSurface'),
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
