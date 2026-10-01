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
import { surfaceOf } from '../../../page/surface.ts';

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

// #838: a cutoff moved in place under a casting light drew a few shadowed pixels off the image of a
// session opened on it (#572): its redrawn shadow pages land in other pool slots, and a shadow read
// depended on the slot. Read texel-exact wherever a page lies (#1010), they draw that session's
// image: the move is taken in place, the shadow over its rows drawn again.
test('an alpha move is taken in place under a casting light, the shadow over its rows drawn again', () => {
  const { material } = quadScene();
  const worlds: number[][] = [];
  const cutout = {
    material: surfaceOf(material),
    min: [-1, -1, 0],
    max: [1, 1, 0],
  };
  const runtime = {
    lights: {
      store: { count: 1 },
      shadows: {},
      mobility: { moves: () => false },
      plan: { worldChanged: (min: number[], max: number[]) => worlds.push([...min, ...max]) },
    },
    layout: {
      rows: {
        tableEpoch: 1,
        rowCount: 1,
        blendFirst: 1,
        casterSlots: 1,
        pageTableInts: new Uint32Array(PAGE_INFO_STRIDE / 4),
        packedRecs: [cutout],
        packedPageIndex: new Int32Array([0]),
      },
      selectionRoots: [{ world: new G.Matrix4() }],
      placement: {
        baseOfRoot: Int32Array.from([0]),
        rootOfPacked: Int32Array.from([0]),
      },
    },
    run: { gate: { sceneMoved() {} } },
    vis: {},
  } as unknown as Parameters<typeof refreshWebgpuMaterials>[0];
  const alpha = { surfaces: [material], from: 'mask', to: 'mask' } as const;
  assert.equal(refreshWebgpuMaterials(runtime, true, alpha), true, 'no new session');
  assert.equal(worlds.length, 1, 'the shadow pages over the cutout drawn again');
  assert.equal(refreshWebgpuMaterials(runtime, true), true, 'values alone stay in place');
  assert.equal(worlds.length, 1, 'and stale no shadow');
});
