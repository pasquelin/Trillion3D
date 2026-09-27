// A blended item copies its colour and opacity at prepare. A surface the host rewrites in place
// (`setMaterial`, #267) must reach its item record at the values refresh, not only at a move.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { webgpuPagesBackend } from '../pages.ts';
import { refreshWebgpuMaterials } from './refreshMaterials.ts';
import { FLAG_MASK, PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import { ROW_FLAGS_WORD, ROW_INDEX_WORDS } from '../../row/pageRow.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera } from '../testScenes.fixture.ts';

test('a blended surface rewritten in place reaches its item record at the values refresh', async () => {
  installGpuGlobals();
  const fixture = quadScene(),
    { device, writes } = mockGpu();
  fixture.metadata.primitives[0].pass = 'shared-blend';
  fixture.material.transparent = true;
  fixture.material.opacity = 0.5;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  const rgba = () => {
    const last = writes.filter((w) => w.label === 'Trillion3D blend item records').at(-1)!;
    return [...new Float32Array(last.bytes.slice().buffer).subarray(16, 20)];
  };
  try {
    await backend.prepare();
    backend.render(camera());
    assert.deepEqual(rgba(), [1, 0, 0, 0.5]);
    (fixture.material.color as G.Color).setRGB(0, 0.5, 1);
    fixture.material.opacity = 0.25;
    fixture.material.needsUpdate = true;
    backend.refreshMaterials?.(true);
    backend.render(camera());
    assert.deepEqual(rgba(), [0, 0.5, 1, 0.25]);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

// A material moved between opaque and masked inside the session (#846): the visibility passes
// draw both, told apart by the row's cutout flag.
test('an opaque surface turned masked cuts every row of its material', async () => {
  installGpuGlobals();
  const fixture = quadScene(),
    { device, buffers } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  });
  const masked = () => {
    const table = buffers.find((buffer) => buffer.label === 'Trillion3D page table')!;
    const ints = new Uint32Array(table.data.buffer, table.data.byteOffset, table.size / 4);
    const words = PAGE_INFO_STRIDE / 4;
    const rows = Array.from({ length: table.size / PAGE_INFO_STRIDE }, (_, row) => row * words);
    const drawn = rows.filter((base) => ints[base + ROW_INDEX_WORDS] > 0);
    assert.ok(drawn.length, 'the quad has rows');
    return drawn.every((base) => (ints[base + ROW_FLAGS_WORD] & FLAG_MASK) !== 0);
  };
  try {
    await backend.prepare();
    backend.render(camera());
    assert.equal(masked(), false);
    fixture.material.alphaTest = 0.5;
    fixture.material.needsUpdate = true;
    backend.refreshMaterials?.(true, { surfaces: [fixture.material], from: 'opaque', to: 'mask' });
    backend.render(camera());
    assert.equal(masked(), true, 'every row of the material cuts at its cutoff');
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

// #572: under a light that casts, a cutoff moved in place leaves a few shadowed pixels off the
// image a session opened on it draws once temporal antialiasing settles: the refresh asks the
// owner for a new session there, and takes the move in place where nothing casts.
test('an alpha move asks for a new session once a light casts, never before', () => {
  const { material } = quadScene();
  const alpha = { surfaces: [material], from: 'opaque', to: 'mask' } as const;
  const runtime = (shadows: object | undefined) =>
    ({
      lights: { store: { count: 0 }, shadows },
      layout: { rows: { tableEpoch: 1 } },
      run: { gate: { sceneMoved() {} } },
      vis: {},
    }) as unknown as Parameters<typeof refreshWebgpuMaterials>[0];
  assert.equal(refreshWebgpuMaterials(runtime(undefined), true, alpha), true, 'nothing casts');
  assert.equal(refreshWebgpuMaterials(runtime({}), true, alpha), false, 'a light casts');
  assert.equal(refreshWebgpuMaterials(runtime({}), true), true, 'values alone stay in place');
});
