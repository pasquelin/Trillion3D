// Lot triangles synchrones : `drawnTriangles` entre dans `BACKEND_METRIC_KEYS`, donc `fillMetrics`
// le recopie comme toute autre mesure du moteur — `null` avant la première image (aucune coupe),
// jamais `null` une fois qu'un moteur a publié une coupe et son compte de triangles dessinés.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerMetrics } from './explorerMetrics.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import type { createPageStreamer } from './streamingPages.ts';

const streamer = {
  stats: () => ({
    evictions: 0,
    loaded: 0,
    bytesRead: 0,
    requested: 0,
    loading: 0,
    hits: 0,
    misses: 0,
  }),
} as unknown as ReturnType<typeof createPageStreamer>;
const state = () => ({ loaded: 0, pageBytesRead: 0, streamingError: null });

function harnais() {
  return createExplorerMetrics({} as ClusterManifest, {} as ExplorerOptions, streamer, 0, 0, state);
}

test('drawnTriangles vaut null avant toute image relevée : aucune coupe n’a encore été publiée', () => {
  const { metricsScratch } = harnais();
  assert.equal(metricsScratch.drawnTriangles, null);
});

test('drawnTriangles reprend la valeur du moteur dès qu’une image publie une coupe', () => {
  const { metricsScratch, fillMetrics } = harnais();
  const backend = {
    metrics: () => ({ drawnTriangles: 777, clusters: 3, selectedTriangles: 900 }),
  } as unknown as RenderBackend;
  fillMetrics(backend);
  assert.equal(metricsScratch.drawnTriangles, 777);
});

test('drawnTriangles retombe à null quand le moteur ne le publie plus (moteur qui ne le tient pas)', () => {
  const { metricsScratch, fillMetrics } = harnais();
  fillMetrics({ metrics: () => ({ drawnTriangles: 42 }) } as unknown as RenderBackend);
  assert.equal(metricsScratch.drawnTriangles, 42);
  fillMetrics({ metrics: () => ({}) } as unknown as RenderBackend);
  assert.equal(
    metricsScratch.drawnTriangles,
    null,
    'jamais la valeur de l’image précédente conservée',
  );
});
