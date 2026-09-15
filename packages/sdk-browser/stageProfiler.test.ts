import test from 'node:test';
import assert from 'node:assert/strict';
import { createStageProfiler, type StageAdd } from './stageProfiler.ts';
import { addCpuSteps } from './stageMapping.ts';

test('addCpuSteps ne dépose que les indices dont l’étape n’est pas null', () => {
  const deposits: Array<[string, number]> = [];
  const add: StageAdd = (stage, ms) => deposits.push([stage, ms]);
  addCpuSteps(['animations', null, 'uploads'], [1, 2, 3], add);
  assert.deepEqual(deposits, [
    ['animations', 1],
    ['uploads', 3],
  ]);
});

test('un profil jamais alimenté ne coûte rien : tout reste non mesuré', () => {
  const profiler = createStageProfiler({
    backend: 'webgpu',
    stages: ['lights', 'geometry'],
    gpuMethod: null,
  });
  const profile = profiler.profile();
  assert.equal(profile.cpuFrames, 0);
  assert.equal(profile.gpuSamples, 0);
  assert.equal(profile.gpuImageMs, null);
  assert.equal(profile.overheadMs, null);
  for (const entry of profile.stages) {
    assert.equal(entry.cpuMs, null);
    assert.equal(entry.gpuMs, null);
  }
});

test('deux dépôts de la même étape dans une image se somment avant d’entrer dans l’anneau', () => {
  const profiler = createStageProfiler({ backend: 'webgpu', stages: ['lights'], gpuMethod: null });
  profiler.frameCpu((add) => {
    add('lights', 1);
    add('lights', 2);
  });
  const profile = profiler.profile();
  assert.deepEqual(profile.stages[0].cpuMs, { p50: 3, p95: 3 });
  assert.equal(profile.cpuFrames, 1);
});

test('l’anneau ne garde que la fenêtre : les valeurs les plus anciennes sont oubliées', () => {
  const profiler = createStageProfiler({
    backend: 'webgpu',
    stages: ['lights'],
    gpuMethod: null,
    window: 8,
  });
  for (let i = 1; i <= 10; i++) profiler.frameCpu((add) => add('lights', i));
  // Fenêtre de 8 : ne restent que 3..10, dont la médiane vaut 6. Elle vaudrait 5 sans oubli — c'est
  // là que l'anneau se prouve, pas sur le p95, que la dernière valeur porte dans les deux cas.
  assert.deepEqual(profiler.profile().stages[0].cpuMs, { p50: 6, p95: 10 });
});

test('reset oublie la fenêtre et les compteurs, tout redevient non mesuré', () => {
  const profiler = createStageProfiler({ backend: 'webgpu', stages: ['lights'], gpuMethod: null });
  profiler.frameCpu((add) => add('lights', 5));
  profiler.frameGpu((add) => add('lights', 7));
  profiler.pushImageGpu(9);
  profiler.reset();
  const profile = profiler.profile();
  assert.equal(profile.cpuFrames, 0);
  assert.equal(profile.gpuSamples, 0);
  assert.equal(profile.gpuImageMs, null);
  assert.equal(profile.stages[0].cpuMs, null);
  assert.equal(profile.stages[0].gpuMs, null);
});

test('setReason ne renseigne la raison que pour la colonne restée non mesurée', () => {
  const profiler = createStageProfiler({ backend: 'webgpu', stages: ['shadows'], gpuMethod: null });
  profiler.frameCpu((add) => add('shadows', 1));
  profiler.setReason('shadows', { cpu: 'jamais vu', gpu: 'appareil sans horodatage' });
  const entry = profiler.profile().stages[0];
  assert.equal(entry.cpuReason, undefined);
  assert.equal(entry.gpuReason, 'appareil sans horodatage');
});

test('setCounts attache des compteurs à l’étape, en plus des durées', () => {
  const profiler = createStageProfiler({ backend: 'webgl2', stages: ['shadows'], gpuMethod: null });
  profiler.setCounts('shadows', { facesRedessinees: 12 });
  assert.deepEqual(profiler.profile().stages[0].counts, { facesRedessinees: 12 });
});

test('setGpuMethod change la méthode et la raison publiées par le profil', () => {
  const profiler = createStageProfiler({ backend: 'webgpu', stages: [], gpuMethod: null });
  profiler.setGpuMethod('timestamp-query', null);
  assert.equal(profiler.profile().gpuMethod, 'timestamp-query');
  profiler.setGpuMethod(null, 'appareil non compatible');
  assert.equal(profiler.profile().gpuReason, 'appareil non compatible');
});

test('les durées négatives ou non finies sont ignorées, jamais déposées comme un zéro', () => {
  const profiler = createStageProfiler({ backend: 'webgl2', stages: ['frame'], gpuMethod: null });
  profiler.frameCpu((add) => add('frame', -1));
  profiler.pushImageGpu(NaN);
  const profile = profiler.profile();
  assert.equal(profile.stages[0].cpuMs, null);
  assert.equal(profile.gpuImageMs, null);
});
