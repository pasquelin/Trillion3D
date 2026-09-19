import test from 'node:test';
import assert from 'node:assert/strict';
import { createStageProfiler, type StageAdd } from './stageProfiler.ts';
import { addCpuSteps } from './stageMapping.ts';

test('addCpuSteps deposits only indices whose stage is not null', () => {
  const deposits: Array<[string, number]> = [];
  const add: StageAdd = (stage, ms) => deposits.push([stage, ms]);
  addCpuSteps(['animations', null, 'uploads'], [1, 2, 3], add);
  assert.deepEqual(deposits, [
    ['animations', 1],
    ['uploads', 3],
  ]);
});

test('a never-fed profile costs nothing: everything stays unmeasured', () => {
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

test('two deposits of the same stage in a frame sum before entering the ring', () => {
  const profiler = createStageProfiler({ backend: 'webgpu', stages: ['lights'], gpuMethod: null });
  profiler.frameCpu((add) => {
    add('lights', 1);
    add('lights', 2);
  });
  const entry = profiler.profile().stages[0];
  assert.deepEqual(entry.cpuMs, { p50: 3, p95: 3 });
  assert.equal(profiler.profile().cpuFrames, 1);
});

test('the ring keeps only the window: the oldest values are forgotten', () => {
  const profiler = createStageProfiler({
    backend: 'webgpu',
    stages: ['lights'],
    gpuMethod: null,
    window: 8,
  });
  for (let i = 1; i <= 10; i++) profiler.frameCpu((add) => add('lights', i));
  const entry = profiler.profile().stages[0];
  // Window of 8: only 3..10 remain, whose median is 6.5 rounded by summarize.
  assert.equal(entry.cpuMs?.p95, 10);
  assert.notEqual(entry.cpuMs?.p95, 2);
});

test('reset forgets the window and the counters, everything is unmeasured again', () => {
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

test('setReason fills the reason only for the column that stayed unmeasured', () => {
  const profiler = createStageProfiler({ backend: 'webgpu', stages: ['shadows'], gpuMethod: null });
  profiler.frameCpu((add) => add('shadows', 1));
  profiler.setReason('shadows', { cpu: 'never seen', gpu: 'device without timestamps' });
  const entry = profiler.profile().stages[0];
  assert.equal(entry.cpuReason, undefined);
  assert.equal(entry.gpuReason, 'device without timestamps');
});

test('setCounts attaches counters to the stage, on top of the durations', () => {
  const profiler = createStageProfiler({ backend: 'webgl2', stages: ['shadows'], gpuMethod: null });
  profiler.setCounts('shadows', { facesRedessinees: 12 });
  assert.deepEqual(profiler.profile().stages[0].counts, { facesRedessinees: 12 });
});

test('setGpuMethod changes the method and reason the profile publishes', () => {
  const profiler = createStageProfiler({ backend: 'webgpu', stages: [], gpuMethod: null });
  profiler.setGpuMethod('timestamp-query', null);
  assert.equal(profiler.profile().gpuMethod, 'timestamp-query');
  profiler.setGpuMethod(null, 'incompatible device');
  assert.equal(profiler.profile().gpuReason, 'incompatible device');
});

test('negative or non-finite durations are ignored, never deposited as a zero', () => {
  const profiler = createStageProfiler({ backend: 'webgl2', stages: ['frame'], gpuMethod: null });
  profiler.frameCpu((add) => add('frame', -1));
  profiler.pushImageGpu(NaN);
  const profile = profiler.profile();
  assert.equal(profile.stages[0].cpuMs, null);
  assert.equal(profile.gpuImageMs, null);
});
