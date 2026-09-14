import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { camera } from './webgpuPagesTestScenes.ts';
import { twoCoarseQuadsScene } from './webgpuPagesTestOccluder.ts';

test('GPU camera jumps reclaim detail slots while preserving pinned coarse coverage', async () => {
  installGpuGlobals();
  const fixture = twoCoarseQuadsScene();
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const { device, draws } = mockGpu(undefined, packDagSelection(collected.roots));
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  });
  const cam = camera();
  try {
    await backend.prepare();
    for (const x of [0, 100, 0, 100]) {
      cam.position.set(x, 0, 5);
      cam.lookAt(x, 0, 0);
      cam.updateMatrixWorld();
      for (let step = 0; step < 3; step++) {
        draws.length = 0;
        backend.render(cam);
        assert.ok(
          draws.filter((draw) => draw.indirect).some((draw) => !!draw.instanceCount),
          'current cut must retain visible coverage',
        );
        await backend.flush();
        assert.equal(backend.metrics().submittedTriangles, 2);
      }
      assert.deepEqual(backend.selectedPageIds().sort(), x ? ['b0', 'b1'] : ['0', '1']);
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
    fixture = twoCoarseQuadsScene();
  // Six clusters share four rows, so every jump between the two primitives recycles rows on eviction.
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  });
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
    const table = buffers.find((buffer) => buffer.label === 'WG page table');
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
    const lastRowWrite = writes.filter((write) => write.label === 'WG page table').at(-1);
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
