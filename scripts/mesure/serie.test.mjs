// Lot « compteurs honnêtes du harnais de mesure » : `runSerie` lit les triangles soumis, le témoin
// d'image tenue, le repli de sélection GPU et les compteurs Hi-Z du contrat (`hizTestedClusters`…,
// jamais `hiZTested`… qui n'a jamais existé) depuis l'objet `metrics` que la page a relevé, et
// publie `null` sans en déduire zéro quand ce moteur ne les compte pas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSerie } from './serie.mjs';

/** Un `page` Playwright de doublure : `evaluate` rend directement le relevé qu'on lui donne, sans
 *  jamais entrer dans une page — `measureView` (`pageEclairage.mjs`) n'y tourne pas. */
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

test('runSerie publie submittedTriangles, totalSubmittedTriangles, imageTenue et repliSelectionGpu depuis les métriques', async () => {
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
    assert.equal(row.imageDuReleve, ctx.settings.frames - 1, 'nomme l’image que le relevé décrit');
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
});

test('runSerie publie null, jamais 0 ou false déduits, quand ce moteur ne compte rien de tout cela', async () => {
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

test('runSerie lit les six compteurs Hi-Z sous leurs noms de contrat, avec l’image qu’ils décrivent', async () => {
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
        // Les anciens noms, jamais lus par le contrat : s'ils l'étaient, ces valeurs distinctes
        // remonteraient dans `row.hiZ` et le test suivant les détecterait.
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

test('runSerie ne lit plus les anciens noms Hi-Z : sans les noms de contrat, tout reste null', async () => {
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
