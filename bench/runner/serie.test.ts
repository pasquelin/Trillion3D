// "honest measurement harness counters" batch: `runSerie` reads submitted triangles, held
// image indicator and GPU selection fallback from the `metrics` object reported by the page,
// and publishes `null` without inferring zero when the engine does not count them.
// Hi-Z counters have their own file, `serieHiZ.test.ts`, to keep both under the line budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { runSerie } from './serie.ts';
import { contexte, page, pose } from './serieTestFixtures.ts';

test('runSerie publishes submittedTriangles, totalSubmittedTriangles, imageTenue and repliSelectionGpu from metrics', async () => {
  const { ctx, side, OUT } = await contexte();
  try {
    const { row } = await runSerie(
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
    assert.equal(row.imageTenue, true);
    assert.equal(row.repliSelectionGpu, false);
    assert.equal(
      row.imageDuReleve,
      ctx.settings.frames - 1,
      'names the frame described by metrics',
    );
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
});

test('runSerie publishes null, never inferred 0 or false, when engine counts none of these', async () => {
  const { ctx, side, OUT } = await contexte();
  try {
    const { row } = await runSerie(ctx, page({}), side, 'salon', 1, pose, new Map());
    assert.equal(row.submittedTriangles, null);
    assert.equal(row.totalSubmittedTriangles, null);
    assert.equal(row.imageTenue, null);
    assert.equal(row.repliSelectionGpu, null);
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
});

// Synchronous triangles batch: `drawnTriangles` is read from `metrics.drawnTriangles`, like
// other triangle counters — present when engine publishes it, `null` otherwise, never inferred.
test('runSerie publishes drawnTriangles from metrics, and null when engine does not count it', async () => {
  const { ctx, side, OUT } = await contexte();
  try {
    const { row: avecCompteur } = await runSerie(
      ctx,
      page({ selectedTriangles: 900, uncoveredTriangles: 100, drawnTriangles: 800 }),
      side,
      'salon',
      1,
      pose,
      new Map(),
    );
    assert.equal(avecCompteur.drawnTriangles, 800);
    const { row: sansCompteur } = await runSerie(ctx, page({}), side, 'salon', 1, pose, new Map());
    assert.equal(sansCompteur.drawnTriangles, null);
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
});
