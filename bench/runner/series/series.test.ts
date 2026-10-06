// "honest measurement harness counters" batch: `runSeries` reads submitted triangles, held
// image indicator and GPU selection fallback from the `metrics` object reported by the page,
// and publishes `null` without inferring zero when the engine does not count them.
// Hi-Z counters have their own file, `series/seriesHiz.test.ts`, to keep both under the line budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { runSeries } from './series.ts';
import { contexte, page, pose } from './seriesTestFixtures.ts';

test('runSeries publishes submittedTriangles, totalSubmittedTriangles, frameHeld and gpuSelectionFallback from metrics', async () => {
  const { ctx, side, OUT } = await contexte();
  try {
    const { row } = await runSeries(
      ctx,
      page({
        submittedTriangles: 1000,
        totalSubmittedTriangles: 1200,
        frameHeld: true,
        gpuSelectionFallback: false,
      }),
      side,
      'salon',
      1,
      pose,
      new Map(),
    );
    assert.equal(row.submittedTriangles, 1000);
    assert.equal(row.totalSubmittedTriangles, 1200);
    assert.equal(row.frameHeld, true);
    assert.equal(row.gpuSelectionFallback, false);
    assert.equal(
      row.recordedFrame,
      ctx.settings.frames - 1,
      'names the frame described by metrics',
    );
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
});

test('runSeries publishes null, never inferred 0 or false, when engine counts none of these', async () => {
  const { ctx, side, OUT } = await contexte();
  try {
    const { row } = await runSeries(ctx, page({}), side, 'salon', 1, pose, new Map());
    assert.equal(row.submittedTriangles, null);
    assert.equal(row.totalSubmittedTriangles, null);
    assert.equal(row.frameHeld, null);
    assert.equal(row.gpuSelectionFallback, null);
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
});

// Synchronous triangles batch: `drawnTriangles` is read from `metrics.drawnTriangles`, like
// other triangle counters — present when engine publishes it, `null` otherwise, never inferred.
test('runSeries publishes drawnTriangles from metrics, and null when engine does not count it', async () => {
  const { ctx, side, OUT } = await contexte();
  try {
    const { row: withCounter } = await runSeries(
      ctx,
      page({ selectedTriangles: 900, uncoveredTriangles: 100, drawnTriangles: 800 }),
      side,
      'salon',
      1,
      pose,
      new Map(),
    );
    assert.equal(withCounter.drawnTriangles, 800);
    const { row: withoutCounter } = await runSeries(
      ctx,
      page({}),
      side,
      'salon',
      1,
      pose,
      new Map(),
    );
    assert.equal(withoutCounter.drawnTriangles, null);
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
});
