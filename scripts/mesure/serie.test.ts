// "honest measurement harness counters" batch: `runSerie` reads submitted triangles, held
// image indicator, GPU selection fallback, and Hi-Z counters from contract (`hizTestedClusters`…,
// never `hiZTested`… which never existed) from the `metrics` object reported by the page, and
// publishes `null` without inferring zero when the engine does not count them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSerie } from './serie.ts';

/** A mock Playwright `page`: `evaluate` directly returns the metrics provided to it, without
 *  ever entering a page — `measureView` (`pageEclairage.ts`) does not run there. */
function page(metrics) {
  return {
    evaluate: async () => ({
      cpuFrameMs: [],
      cpuSelectMs: [],
      gpuFrameMs: [],
      stageProfile: null,
      importedLights: null,
      lampesTemoin: null,
      shadowAtlas: null,
      movingNode: null,
      selection: { source: null, ids: [] },
      metrics,
      size: { width: 8, height: 8 },
      lost: [],
      captureStatus: 200,
    }),
  };
}

async function contexte() {
  const OUT = await mkdtemp(join(tmpdir(), 'wg-serie-test-'));
  const ctx = {
    MANIFEST: 'manifest.json',
    OUT,
    settings: { frames: 4, warmup: 1, maxPages: 32, width: 8, height: 8 },
    lights: null,
    poses: null,
  };
  const side = { name: 'a', engine: { backend: 'creerMoteur', id: 'moteur-test' } };
  return { ctx, side, OUT };
}

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
      { position: [0, 0, 0] },
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
    const { row } = await runSerie(
      ctx,
      page({}),
      side,
      'salon',
      1,
      { position: [0, 0, 0] },
      new Map(),
    );
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
      { position: [0, 0, 0] },
      new Map(),
    );
    assert.equal(avecCompteur.drawnTriangles, 800);
    const { row: sansCompteur } = await runSerie(
      ctx,
      page({}),
      side,
      'salon',
      1,
      { position: [0, 0, 0] },
      new Map(),
    );
    assert.equal(sansCompteur.drawnTriangles, null);
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
});

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
      { position: [0, 0, 0] },
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
      { position: [0, 0, 0] },
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
