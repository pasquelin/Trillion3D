// The fallback image (no visibility buffer) ends like the composed one: guides drawn over it and
// their revision recorded, else they vanish there and no frame is ever held again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, disposeQuadRun, quadBackend } from '../testScenes.fixture.ts';
import { createGuideSet } from '../../../guides/guideSet.ts';

test('the fallback image draws the guides last, as the composed one does', async () => {
  installGpuGlobals();
  const { device, passes } = mockGpu({ failVisPass: true });
  const guides = createGuideSet();
  guides.lines({ positions: [0, 0, 0, 1, 0, 0] });
  const { fixture, backend } = quadBackend(device, { guides });
  try {
    await backend.prepare();
    const cam = camera();
    backend.render(cam);
    await backend.flush?.();
    backend.render(cam);
    assert.ok(
      backend.capabilities.unsupported.includes('visibility buffer'),
      'witness: the image fell back',
    );
    const drawn = passes.length;
    guides.lines({ positions: [0, 1, 0, 1, 1, 0] });
    backend.render(cam);
    const labels = passes.slice(drawn).map((pass) => pass.label);
    assert.ok(labels.includes('Trillion3D guides'), 'the guides are drawn over the fallback');
    assert.equal(
      labels.at(-1),
      'Trillion3D guides',
      'after everything the image draws, before its copy',
    );
  } finally {
    disposeQuadRun(backend, fixture);
  }
});
