import test from 'node:test';
import { MANIFEST_IDENTITY } from '../../backend/pagesBackend.fixture.ts';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './pages.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { drawnPageIds, installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { camera } from './testScenes.fixture.ts';
import { twoCoarseQuadsScene } from './testOccluder.fixture.ts';
import { type ClusterManifest, type Primitive } from '../../../../sdk-core/src/index.ts';

/** The mock GPU always builds the full backend; these tests reach the WebGPU-only members the
 *  general `RenderBackend` contract leaves optional or omits. */
type PagesBackend = ReturnType<typeof webgpuPagesBackend> & {
  flush(): Promise<void>;
  selectedPageIds(): string[];
};

/** `twoCoarseQuadsScene`, its manifest completed with the cache-identity fields the fixture
 *  omits — unread by the backends under test. Its second primitive's `pages` carry every `Page`
 *  field at runtime (`...page` spread in the fixture); only the inline callback annotation
 *  there narrows the static type to `{ url: string }`, which this cast corrects. */
function scene() {
  const raw = twoCoarseQuadsScene();
  const metadata: ClusterManifest = {
    ...raw.metadata,
    ...MANIFEST_IDENTITY,
    primitives: raw.metadata.primitives as Primitive[],
  };
  return { ...raw, metadata };
}

test('GPU camera jumps reclaim detail slots while preserving pinned coarse coverage', async () => {
  installGpuGlobals();
  const fixture = scene();
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const packed = packDagSelection(collected.roots);
  const { device, draws, buffers } = mockGpu({ packed });
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  }) as PagesBackend;
  const cam = camera();
  try {
    await backend.prepare();
    for (const x of [0, 100, 0, 100]) {
      cam.position.set(x, 0, 5);
      cam.lookAt(x, 0, 0);
      cam.updateMatrixWorld();
      const expected = x ? ['b0', 'b1'] : ['0', '1'];
      // Selection readback, residency upload and adoption are asynchronous. Stop on the
      // requested detail cut; the finite cap detects a stalled pipeline, not a frame deadline.
      for (let step = 0; step < 32; step++) {
        draws.length = 0;
        backend.render(cam);
        assert.ok(
          drawnPageIds(buffers, packed.nodeCount, packed.pageCount).length > 0,
          'current cut must retain visible coverage',
        );
        await backend.flush();
        assert.equal(backend.metrics().submittedTriangles, 2);
        const selected = backend.selectedPageIds().sort();
        if (selected.length === expected.length && selected.every((id, i) => id === expected[i]))
          break;
      }
      assert.deepEqual(backend.selectedPageIds().sort(), expected, 'detail cut must converge');
    }
    assert.ok(backend.metrics().cacheEvictions! > 0);
  } finally {
    await backend.dispose();
    fixture.dispose();
  }
});

test('a recycled page-table row describes its new cluster and reaches the GPU before the image reads it', async () => {
  installGpuGlobals();
  const { device, writes, buffers, submits } = mockGpu(),
    fixture = scene();
  // Six clusters share four rows, so every jump between the two primitives recycles rows on eviction.
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  }) as PagesBackend;
  const view = camera(),
    words = PAGE_INFO_STRIDE / 4;
  const look = (x: number) => {
    view.position.set(x, 0, 5);
    view.lookAt(x, 0, 0);
    view.updateMatrixWorld();
    backend.render(view);
  };
  try {
    await backend.prepare();
    for (let round = 0; round < 6; round++) {
      look(round % 2 ? 100 : 0);
      await backend.flush();
      look(round % 2 ? 100 : 0);
    }
    assert.ok(backend.metrics().cacheEvictions! > 0, 'the run has to recycle rows');
    const table = buffers.find((buffer) => buffer.label === 'Trillion3D page table');
    assert.ok(table, 'the page table is allocated once');
    const rows = new Uint32Array(
      table.data.buffer,
      table.data.byteOffset,
      table.data.byteLength / 4,
    );
    const seen = new Set<number>(),
      slots = new Set<number>();
    for (let row = 0; row < table.size / PAGE_INFO_STRIDE; row++) {
      const base = row * words,
        indexCount = rows[base + 25];
      if (!indexCount) continue;
      // A live row names itself, so a recycled row cannot be read through the identifier of its predecessor.
      assert.equal(rows[base + 27], (row + 1) << 8, `row ${row} identifier`);
      // Its index range is one of the fixture's clusters, and no two live rows claim the same cluster or
      // the same GPU slot: a row still describing the cluster it was recycled from would do both.
      assert.ok(indexCount === 3 || indexCount === 6, `row ${row} index count ${indexCount}`);
      assert.equal(
        seen.has(rows[base + 47]),
        false,
        `row ${row} duplicates cluster ${rows[base + 47]}`,
      );
      assert.equal(
        slots.has(rows[base + 24]),
        false,
        `row ${row} duplicates slot ${rows[base + 24]}`,
      );
      seen.add(rows[base + 47]);
      slots.add(rows[base + 24]);
    }
    // A leaked row would show up as a live row beyond the four the table holds, and a lost row as fewer
    // live rows than the image drew.
    assert.ok(
      seen.size <= 4 && seen.size >= backend.metrics().residentPages!,
      `live rows ${seen.size}`,
    );
    const lastRowWrite = writes.filter((write) => write.label === 'Trillion3D page table').at(-1);
    assert.ok(lastRowWrite, 'rows are uploaded');
    assert.ok(
      lastRowWrite.seq < submits.at(-1)!,
      'a row is uploaded before the image that reads it is submitted',
    );
  } finally {
    backend.dispose();
    fixture.dispose();
  }
});
