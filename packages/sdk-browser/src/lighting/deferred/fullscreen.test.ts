// The engine's one way to a pipeline (`fullscreen.ts`): a pipeline a frame binds is compiled off the
// thread before the frame, which waits for it held rather than compiling it; and no new module of
// the source makes one synchronously.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  pipelinesCompiling,
  pipelinesSettled,
  preparedComputePipeline,
  preparedPipeline,
  preparedPipelines,
  started,
} from './fullscreen.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { gatedDevice } from './gatedDevice.fixture.ts';

const triangle = (label: string): GPURenderPipelineDescriptor => ({
  label,
  layout: 'auto',
  vertex: { module: {} as GPUShaderModule, entryPoint: 'vs' },
});

test('an asked pipeline compiles off the thread once, the frames waiting until it landed', async () => {
  const { device, compiled, land, renderPipelines } = gatedDevice();
  const pipeline = preparedPipeline(device, triangle('asked'));
  assert.equal(pipelinesCompiling(device), false, 'nothing asked, nothing awaited');
  assert.equal(started(pipeline), pipeline);
  assert.equal(pipelinesCompiling(device), false, 'started: no frame waits for it');
  assert.ok(pipelinesSettled(device), 'prepare does');
  assert.equal(pipelinesSettled(device, true), undefined);
  pipeline.ask();
  void pipeline.prepare();
  assert.equal(pipelinesCompiling(device), true, 'the frames of its device wait for it');
  assert.equal(pipeline.ready, false);
  const settled = pipelinesSettled(device);
  assert.ok(settled);
  await land();
  await settled;
  assert.equal(pipelinesCompiling(device), false);
  assert.equal(pipeline.ready, true);
  assert.equal(pipeline.get(), renderPipelines[0], 'the frame binds the one compiled off it');
  assert.deepEqual(compiled, { sync: 0, async: 1 }, 'one compile, none on the frame');
  assert.equal(pipelinesSettled(device), undefined);
});

test('a refused compile is said once to the frames, never asked again by them', async () => {
  const { device } = fakeDevice();
  let asked = 0;
  device.createComputePipelineAsync = async () => (asked++, Promise.reject(new Error('NO')));
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  });
  pipeline.ask();
  await pipelinesSettled(device);
  pipeline.ask();
  assert.equal(pipelinesCompiling(device), false, 'a refusal holds no frame');
  assert.equal(asked, 1);
  await assert.rejects(pipeline.prepare(), /NO/, 'prepare asks it again, and hears it');
  assert.equal(asked, 2);
});

test('a device without the stage refuses the compile, never throws at the one asking', async () => {
  const { device } = fakeDevice({ compute: false });
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  });
  assert.doesNotThrow(() => started(pipeline));
  await pipelinesSettled(device);
  assert.equal(pipeline.ready, false);
});

test('a program keyed by what decides each pipeline makes each once, on its own descriptor', async () => {
  const { device, compiled, land, renderPipelines } = gatedDevice();
  const made: string[] = [];
  const program = preparedPipelines((key: string) => {
    made.push(key);
    return preparedPipeline(device, triangle(key));
  });
  assert.equal(program.of('a'), program.of('a'));
  program.of('b').ask();
  program.of('b').ask();
  const both = Promise.all([program.of('a').prepare(), pipelinesSettled(device)]);
  await land();
  await both;
  assert.deepEqual(made, ['a', 'b']);
  assert.deepEqual([...program.keys()], ['a', 'b']);
  assert.deepEqual(
    renderPipelines.map(({ label }) => label),
    ['b', 'a'],
  );
  assert.deepEqual(compiled, { sync: 0, async: 2 });
});

test('a pipeline the frame made itself holds no frame on the compile asked of it', async () => {
  const { device, compiled, land } = gatedDevice();
  const pipeline = preparedPipeline(device, triangle('made'));
  pipeline.ask();
  pipeline.get();
  assert.equal(pipelinesCompiling(device), false, 'made: nothing to wait for');
  await pipeline.prepare();
  await land();
  assert.deepEqual(compiled, { sync: 1, async: 1 }, 'prepare compiles nothing once it is made');
});

test('every asker of a pipeline in flight shares its one compile', async () => {
  const { device, compiled, land } = gatedDevice();
  const pipeline = preparedPipeline(device, triangle('shared'));
  const first = pipeline.prepare(),
    second = pipeline.prepare();
  pipeline.ask();
  assert.equal(first, second, 'one promise in flight, reused');
  await land();
  await Promise.all([first, second]);
  assert.deepEqual(compiled, { sync: 0, async: 1 });
});

/** The modules that still make a pipeline synchronously, beside the one way: the translucent
 *  casters' transmission pass, which its owner moves onto it. A module may leave this list, never
 *  join it. */
const STILL_SYNCHRONOUS = ['lighting/deferred/fullscreen.ts', 'vsm/transmissionPass.ts'];
const SYNC_CREATE = /\.create(?:Render|Compute)Pipeline\(/;

test('no new module makes a pipeline synchronously', () => {
  const root = new URL('../../', import.meta.url);
  const sources = (readdirSync(root, { recursive: true }) as string[]).filter(
    (file) => file.endsWith('.ts') && !/\.(test|fixture|perf|browser)\.ts$/.test(file),
  );
  const making = sources.filter((file) =>
    SYNC_CREATE.test(readFileSync(new URL(file, root), 'utf8')),
  );
  assert.deepEqual(
    making.filter((file) => !STILL_SYNCHRONOUS.includes(file)),
    [],
  );
});
