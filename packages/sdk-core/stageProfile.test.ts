import test from 'node:test';
import assert from 'node:assert/strict';
import { stageQuantiles, stageLabel, disabledStageProfile } from './stageProfile.ts';

const REASON = 'profil par étape non demandé par l’hôte';

test('stageQuantiles renvoie null pour une série vide : non mesuré, pas zéro', () => {
  assert.equal(stageQuantiles([]), null);
});

test('stageQuantiles distingue un zéro mesuré du non-mesuré', () => {
  assert.deepEqual(stageQuantiles([0, 0, 0]), { p50: 0, p95: 0 });
});

test('stageQuantiles calcule p50 et p95 à partir de la série', () => {
  assert.deepEqual(stageQuantiles([10, 20, 30, 40, 60]), { p50: 30, p95: 60 });
});

test('stageLabel renvoie le libellé connu et l’étape telle quelle si elle est inconnue', () => {
  assert.equal(stageLabel('hiZ'), 'Hi-Z (occultation)');
  assert.equal(stageLabel('etapeInconnue'), 'etapeInconnue');
});

test('disabledStageProfile ne mesure rien : compteurs à zéro, quantiles et méthode à null', () => {
  const p = disabledStageProfile('webgl2', REASON);
  assert.deepEqual([p.version, p.enabled, p.backend, p.gpuReason], [1, false, 'webgl2', REASON]);
  assert.deepEqual([p.cpuFrames, p.gpuSamples, p.windowFrames], [0, 0, 0]);
  assert.deepEqual([p.gpuMethod, p.gpuImageMs, p.overheadMs, p.stages], [null, null, null, []]);
});
