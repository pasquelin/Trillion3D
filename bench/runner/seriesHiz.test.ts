// "honest measurement harness counters" batch: `runSerie` reads the six Hi-Z counters under
// their contract names (`hizTestedClusters`…, never the old `hiZTested`… which never existed),
// and publishes `null` without inferring zero when the engine does not count them.
// Split from `series.test.ts` to keep both files under the line budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { runSerie } from './series.ts';
import { contexte, page, pose } from './seriesTestFixtures.ts';

test('runSerie reads the six Hi-Z counters under contract names, with frame described', async () => {
  const { ctx, side, OUT } = await contexte();
  try {
    const { row } = await runSerie(
      ctx,
      page({
        hizTestedClusters: 300,
        hizRejectedClusters: 70,
        hizOversizedClusters: 4,
        hizTestedTriangles: 90000,
        hizRejectedTriangles: 21000,
        hizOversizedTriangles: 1200,
        hizCountedFrame: 17,
        // Old names, never read by contract: if they were, these distinct values
        // would propagate to `row.hiZ` and the next test would detect them.
        hiZTested: 999,
        hiZRejected: 999,
        hiZBeyond16Texels: 999,
      }),
      side,
      'salon',
      1,
      pose,
      new Map(),
    );
    assert.deepEqual(row.hiZ, {
      tested: 300,
      rejected: 70,
      beyond16Texels: 4,
      testedTriangles: 90000,
      rejectedTriangles: 21000,
      beyond16TexelsTriangles: 1200,
      image: 17,
    });
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
});

test('runSerie no longer reads old Hi-Z names: without contract names, everything remains null', async () => {
  const { ctx, side, OUT } = await contexte();
  try {
    const { row } = await runSerie(
      ctx,
      page({ hiZTested: 5, hiZRejected: 5, hiZBeyond16Texels: 5 }),
      side,
      'salon',
      1,
      pose,
      new Map(),
    );
    assert.deepEqual(row.hiZ, {
      tested: null,
      rejected: null,
      beyond16Texels: null,
      testedTriangles: null,
      rejectedTriangles: null,
      beyond16TexelsTriangles: null,
      image: null,
    });
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
});
