import test from 'node:test';
import assert from 'node:assert/strict';
import { stageQuantiles, stageLabel, disabledStageProfile } from './stageProfile.ts';

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
  const profile = disabledStageProfile('webgl2', 'profil par étape non demandé par l’hôte');
  assert.equal(profile.enabled, false);
  assert.equal(profile.backend, 'webgl2');
  assert.equal(profile.cpuFrames, 0);
  assert.equal(profile.gpuSamples, 0);
  assert.equal(profile.windowFrames, 0);
  assert.equal(profile.gpuMethod, null);
  assert.equal(profile.gpuReason, 'profil par étape non demandé par l’hôte');
  assert.equal(profile.gpuImageMs, null);
  assert.equal(profile.overheadMs, null);
  assert.deepEqual(profile.stages, []);
});
