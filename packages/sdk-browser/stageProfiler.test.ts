import test from 'node:test';
import assert from 'node:assert/strict';
import { createStageProfiler, type StageAdd } from './stageProfiler.ts';
import { addCpuSteps } from './stageMapping.ts';

/** Un profileur sans mesure carte graphique : c'est le profil processeur qu'on éprouve ici. */
const profiler = (stages: readonly string[], window?: number) =>
  createStageProfiler({ backend: 'webgpu', stages, gpuMethod: null, window });

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
  const profile = profiler(['lights', 'geometry']).profile();
  assert.deepEqual([profile.cpuFrames, profile.gpuSamples], [0, 0]);
  assert.deepEqual([profile.gpuImageMs, profile.overheadMs], [null, null]);
  for (const entry of profile.stages) assert.deepEqual([entry.cpuMs, entry.gpuMs], [null, null]);
});

test('deux dépôts de la même étape dans une image se somment avant d’entrer dans l’anneau', () => {
  const p = profiler(['lights']);
  p.frameCpu((add) => {
    add('lights', 1);
    add('lights', 2);
  });
  assert.deepEqual(p.profile().stages[0].cpuMs, { p50: 3, p95: 3 });
  assert.equal(p.profile().cpuFrames, 1);
});

test('l’anneau ne garde que la fenêtre : les valeurs les plus anciennes sont oubliées', () => {
  const p = profiler(['lights'], 8);
  for (let i = 1; i <= 10; i++) p.frameCpu((add) => add('lights', i));
  // Ne restent que 3..10 : la médiane vaut 6, elle vaudrait 5 sans oubli. Le p95 ne prouverait
  // rien, la dernière valeur le porte dans les deux cas.
  assert.deepEqual(p.profile().stages[0].cpuMs, { p50: 6, p95: 10 });
});

test('reset oublie la fenêtre et les compteurs, tout redevient non mesuré', () => {
  const p = profiler(['lights']);
  p.frameCpu((add) => add('lights', 5));
  p.frameGpu((add) => add('lights', 7));
  p.pushImageGpu(9);
  p.reset();
  const profile = p.profile();
  assert.deepEqual([profile.cpuFrames, profile.gpuSamples, profile.gpuImageMs], [0, 0, null]);
  assert.deepEqual([profile.stages[0].cpuMs, profile.stages[0].gpuMs], [null, null]);
});

test('setReason ne renseigne la raison que pour la colonne restée non mesurée', () => {
  const p = profiler(['shadows']);
  p.frameCpu((add) => add('shadows', 1));
  p.setReason('shadows', { cpu: 'jamais vu', gpu: 'appareil sans horodatage' });
  const entry = p.profile().stages[0];
  assert.deepEqual([entry.cpuReason, entry.gpuReason], [undefined, 'appareil sans horodatage']);
});

test('setCounts attache des compteurs à l’étape, en plus des durées', () => {
  const p = profiler(['shadows']);
  p.setCounts('shadows', { facesRedessinees: 12 });
  assert.deepEqual(p.profile().stages[0].counts, { facesRedessinees: 12 });
});

test('setGpuMethod change la méthode et la raison publiées par le profil', () => {
  const p = profiler([]);
  p.setGpuMethod('timestamp-query', null);
  assert.equal(p.profile().gpuMethod, 'timestamp-query');
  p.setGpuMethod(null, 'appareil non compatible');
  assert.equal(p.profile().gpuReason, 'appareil non compatible');
});

test('les durées négatives ou non finies sont ignorées, jamais déposées comme un zéro', () => {
  const p = profiler(['frame']);
  p.frameCpu((add) => add('frame', -1));
  p.pushImageGpu(NaN);
  assert.deepEqual([p.profile().stages[0].cpuMs, p.profile().gpuImageMs], [null, null]);
});
