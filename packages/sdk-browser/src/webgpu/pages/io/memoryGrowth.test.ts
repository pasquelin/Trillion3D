// #216: a geometry pool set above the ceiling the tables were sized for grows them in place, the
// session going on — and tables the device refuses keep the pool and every table as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { coarseQuadContext, frontCamera } from '../../../backend/pagesBackendScenes.fixture.ts';
import { createWebgpuPagesRuntime } from '../runtime.ts';
import { prepareWebgpuBackend } from '../prepare/prepare.ts';
import { renderWebgpuPages } from '../render/render.ts';
import { flushWebgpuPages } from '../render/flush.ts';
import { fallbackToCpuCut } from './drops.ts';
import { disposeWebgpuPages } from './metrics.ts';
import { setWebgpuMemoryBudgets } from './memory.ts';

/** The quad's root over its two finer clusters, on a pool that holds the root alone and tables
 *  sized for it, the CPU cut drawing at full detail. The device answers out-of-memory scopes, and
 *  refuses the page table while `refusing.on`. */
async function coarseSession() {
  installGpuGlobals();
  const scene = coarseQuadContext(0);
  const { device } = mockGpu({ compute: true });
  const refusing = { on: false },
    scopes: Array<{ message: string } | null> = [];
  const create = device.createBuffer.bind(device);
  Object.assign(device, {
    pushErrorScope: () => void scopes.push(null),
    popErrorScope: async () => scopes.pop() ?? null,
    createBuffer(descriptor: GPUBufferDescriptor) {
      if (refusing.on && descriptor.label === 'Trillion3D page table' && scopes.length)
        scopes[scopes.length - 1] = { message: 'Out of memory' };
      return create(descriptor);
    },
  });
  const rt = createWebgpuPagesRuntime({
    ...scene.context,
    gpuDevice: device,
    geometryPoolBytes: 1,
    viewport: [32, 32],
  });
  const draw = async (images = 1) => {
    for (let image = 0; image < images; image++) {
      renderWebgpuPages(rt, frontCamera());
      await flushWebgpuPages(rt);
    }
  };
  const dispose = () => {
    disposeWebgpuPages(rt);
    scene.geometry.dispose();
    scene.material.dispose();
  };
  try {
    await prepareWebgpuBackend(rt, device);
    fallbackToCpuCut(rt, 'the rows follow the CPU cut');
    await draw(3);
  } catch (error) {
    dispose();
    throw error;
  }
  const drawn = () =>
    rt.layout.rows.packedRecs.slice(0, rt.layout.rows.packedCount).map((rec) => rec!.url);
  return { rt, refusing, draw, drawn, dispose };
}

test('a live setMemoryBudgets above the old ceiling grows the pool and the tables in place', async () => {
  const { rt, draw, drawn, dispose } = await coarseSession();
  try {
    const { layout, vis } = rt,
      cache = rt.gpu.cache!;
    assert.deepEqual([rt.setup.slots, rt.setup.cap, layout.drawSlots], [1, 1, 1]);
    assert.deepEqual(drawn(), ['2'], 'the root alone, for want of room');
    const report = await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 });
    assert.deepEqual([report.geometryPool.slots, report.geometryPool.clamp], [3, 'scene']);
    assert.deepEqual(
      [report.tables?.drawSlots, report.tables?.casterSlots, report.tables?.refused],
      [3, 3, false],
    );
    assert.ok(report.tables!.bytes > 0 && report.tables!.durationMs >= 0);
    assert.equal(report.transientBytes, 4 * rt.setup.pageBytes, 'the old pool beside the new');
    // The same session: its pool resized, its tables grown, nothing prepared again.
    assert.equal(rt.gpu.cache, cache);
    assert.deepEqual([rt.setup.cap, layout.drawSlots], [3, 3]);
    assert.equal(vis.pageTable!.size, layout.rows.pageTableFloats!.byteLength);
    await draw(4);
    assert.deepEqual(drawn().sort(), ['0', '1'], 'the finer clusters, once resident');
  } finally {
    dispose();
  }
});

test('an allocation refusal during a grow leaves the pool and every table in place', async () => {
  const { rt, refusing, draw, drawn, dispose } = await coarseSession();
  try {
    const { layout, vis, gpu } = rt;
    const tables = () => ({
      drawSlots: layout.drawSlots,
      casterSlots: layout.rows.casterSlots,
      table: layout.rows.pageTableFloats,
      pageTable: vis.pageTable,
      zeroFlags: vis.zeroFlags,
      items: vis.gpuDraw?.itemsBuffer,
      flags: vis.gpuHiz?.flags,
      corners: layout.cornerPacked,
      pool: rt.setup.geometryPool,
      cap: rt.setup.cap,
      cache: gpu.cache,
    });
    const before = tables();
    assert.ok(before.table && before.items && before.flags, 'the GPU tables the grow replaces');
    refusing.on = true;
    const report = await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 });
    assert.equal(report.tables?.refused, true);
    assert.equal(report.geometryPool.slots, 1, 'the pool in place is kept');
    assert.equal(report.evictedPages, 0);
    assert.deepEqual(tables(), before);
    assert.equal(layout.rows.generation, 0);
    // The session draws on, from what it holds.
    await draw();
    assert.deepEqual(drawn(), ['2']);
  } finally {
    dispose();
  }
});
