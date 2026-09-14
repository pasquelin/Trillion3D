import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';
import { depthLayerBias } from '../sdk-core/index.ts';

// Comportement 22 : writePageRow écrit le biais en unités positives à l'emplacement depthBias de
// la ligne de table ; une ligne de couche 0 garde ce champ à zéro.
test('writePageRow writes the layer bias in positive units at the table row depthBias slot', async () => {
  installGpuGlobals();
  const scene = quadScene();
  // Le second cluster du quad porte la couche que l'étape coplanaire lui aurait attribuée ; le
  // premier reste à sa couche 0 (le champ absent équivaut à 0, comme le décodage le laisse).
  (scene.metadata.primitives[0].pages[1] as { depthLayer?: number }).depthLayer = 5;
  const { device, buffers } = mockGpu();
  const backend = webgpuPagesBackend({
    ...scene,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  });
  const view = camera();
  try {
    await backend.prepare();
    backend.render(view);
    await backend.flush();
    const table = buffers.find((buffer) => buffer.label === 'WG page table');
    assert.ok(table, 'the page table is allocated once');
    const words = PAGE_INFO_STRIDE / 4;
    const rows = new Uint32Array(
      table!.data.buffer,
      table!.data.byteOffset,
      table!.data.byteLength / 4,
    );
    let sawPositiveBias = false,
      sawZeroBias = false;
    for (let row = 0; row < table!.size / PAGE_INFO_STRIDE; row++) {
      const base = row * words,
        indexCount = rows[base + 25];
      if (!indexCount) continue;
      const bias = rows[base + 60];
      if (bias === 0) {
        sawZeroBias = true;
        continue;
      }
      assert.equal(
        bias,
        -depthLayerBias(5),
        'row depthBias equals the positive form of the layer bias',
      );
      assert.ok(bias > 0, 'writePageRow stores the bias in positive units');
      sawPositiveBias = true;
    }
    assert.ok(sawPositiveBias, 'the layered cluster wrote a positive depthBias');
    assert.ok(sawZeroBias, 'the untouched cluster kept depthBias at zero');
  } finally {
    await backend.dispose();
    scene.geometry.dispose();
    scene.material.dispose();
  }
});
