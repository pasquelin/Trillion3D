// #216: a grow on a lit scene grows the shadow pass's own tables with the rows — the cull's kept
// lists and their region offsets, the occlusion test's visible lists, the spheres, the mobility
// words and the tested half's work buffer —, all under the growth's one scope: no image after it
// makes any of them again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setWebgpuMemoryBudgets } from './memory.ts';
import { SUN, coarseSession } from './memoryGrowth.fixture.ts';
import { createShadowOcclusion } from '../../../gpu/shadow/occlusion.ts';
import { MAX_SHADOW_REGIONS } from '../../../gpu/shadow/recordPack.ts';
import { restSlotCount } from '../../../gpu/draw/contract.ts';
import { keptRows, poolPairs } from '../../shadow/pairRows.ts';

test('after a grow on a lit scene, the shadow lists, offsets, spheres and words have the new size', async () => {
  const { rt, gpu, draw, dispose } = await coarseSession(SUN);
  try {
    const { lights, vis, layout } = rt;
    // The occlusion test is made with the static layer, at the table's size: one is made here.
    lights.occlusion = await createShadowOcclusion(gpu.device, layout.rows.casterSlots);
    await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 });
    const rows = layout.rows.casterSlots;
    assert.equal(rows, 4);
    // The kept lists hold the pool's fixed pairs past the table's rows (`poolPairs`, #831).
    const listRows = keptRows(rows, poolPairs(lights.plan.pool.pages), gpu.device.limits);
    assert.equal(lights.cull!.kept.size, MAX_SHADOW_REGIONS * listRows * 4);
    assert.equal(lights.occlusion.visible.size, MAX_SHADOW_REGIONS * listRows * 4);
    // Each region's place in the list is `listRows` apart, the list's rows, unmoved by the grow.
    const offsets = gpu.writes
      .filter(({ bytes }) => bytes.byteLength === (MAX_SHADOW_REGIONS + 1) * 4)
      .at(-1)!;
    const words = new Uint32Array(offsets.bytes.slice().buffer);
    assert.deepEqual(
      Array.from(words),
      Array.from({ length: MAX_SHADOW_REGIONS + 1 }, (_, region) => region * listRows),
    );
    const made = {
      spheres: lights.spheres!.buffer,
      mobility: lights.mobilityRows!,
      work: vis.gpuRestCompact!.work!,
    };
    assert.equal(lights.spheres!.rows, rows);
    assert.equal(made.spheres.size, rows * 4 * 4);
    assert.equal(made.mobility.size, rows * 4);
    const restSlots = restSlotCount(vis.drawLayerSlots);
    assert.equal(made.work.size, (layout.drawSlots + restSlots * 2) * 4, 'at its bound');
    // The images after the grow keep what it made.
    await draw(2);
    assert.deepEqual(
      {
        spheres: lights.spheres!.buffer,
        mobility: lights.mobilityRows,
        work: vis.gpuRestCompact!.work,
      },
      made,
    );
  } finally {
    dispose();
  }
});
