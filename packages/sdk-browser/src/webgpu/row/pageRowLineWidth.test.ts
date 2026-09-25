import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from '../pages/pages.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera } from '../pages/testScenes.fixture.ts';

/** The `PageInfo.lineWidth` word of every drawn row, after one frame of `scene`. */
async function rowLineWidths(lineWidth: number | undefined) {
  installGpuGlobals();
  const scene = quadScene();
  if (lineWidth !== undefined) scene.material.lineWidth = lineWidth;
  const { device, buffers } = mockGpu();
  const backend = webgpuPagesBackend({
    ...scene,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush?.();
    const table = buffers.find((buffer) => buffer.label === 'Trillion3D page table')!;
    const words = PAGE_INFO_STRIDE / 4;
    const floats = new Float32Array(table.data.buffer, table.data.byteOffset, table.size / 4);
    const ints = new Uint32Array(table.data.buffer, table.data.byteOffset, table.size / 4);
    const widths: number[] = [];
    for (let row = 0; row < table.size / PAGE_INFO_STRIDE; row++)
      if (ints[row * words + 25]) widths.push(floats[row * words + 61]);
    return widths;
  } finally {
    await backend.dispose();
    scene.geometry.dispose();
    scene.material.dispose();
  }
}

// #348: the row carries the width a line page's quads widen to (`PageInfo.lineWidth`, word 61),
// and zero on a surface that draws triangles.
test('a page row carries its surface line width, zero for triangles', async () => {
  const lines = await rowLineWidths(2.5);
  assert.ok(lines.length > 0);
  for (const width of lines) assert.equal(width, 2.5);
  for (const width of await rowLineWidths(undefined)) assert.equal(width, 0);
});
