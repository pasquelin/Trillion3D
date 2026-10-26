// The engine's one way to a pipeline (`fullscreen.ts`): a pipeline a frame binds is compiled off the
// thread before the frame, which waits for it held rather than compiling it; and no new module of
// the source makes one synchronously.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { preparedComputePipeline, preparedPipeline, started } from './fullscreen.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import {
  pipelinesCompiling,
  pipelinesSettled,
  takeRefusals,
  tickCompiles,
} from './compileLedger.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { gatedDevice } from './gatedDevice.fixture.ts'
import { TILE_CLASSIFICATION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createTileClassification } from './classify.ts'
import { TILE_ARGS_BYTES, TILE_CLASSES, tileArgsAt, tileListBytes } from './tileClass.ts'
import { drawTileClasses } from './tilePass.ts'

const triangle = (label: string): GPURenderPipelineDescriptor => ({
  label,
  layout: 'auto',
  vertex: { module: {} as GPUShaderModule, entryPoint: 'vs' },
})

test('an asked pipeline compiles off the thread once, the frames waiting until it landed', async () => {
  const { device, compiled, land, renderPipelines } = gatedDevice()
  const pipeline = preparedPipeline(device, triangle('asked'))
  assert.equal(pipelinesCompiling(device), false, 'nothing asked, nothing awaited')
  assert.equal(started(pipeline), pipeline)
  assert.equal(pipelinesCompiling(device), false, 'started: no frame waits for it')
  assert.ok(pipelinesSettled(device), 'prepare does')
  assert.equal(pipelinesSettled(device, true), undefined)
  pipeline.ask()
  void pipeline.prepare()
  assert.equal(pipelinesCompiling(device), true, 'the frames of its device wait for it')
  assert.equal(pipeline.ready, false)
  const settled = pipelinesSettled(device)
  assert.ok(settled)
  await land()
  await settled
  assert.equal(pipelinesCompiling(device), false)
  assert.equal(pipeline.ready, true)
  assert.equal(pipeline.get(), renderPipelines[0], 'the frame binds the one compiled off it')
  assert.deepEqual(compiled, { sync: 0, async: 1 }, 'one compile, none on the frame')
  assert.equal(pipelinesSettled(device), undefined)
})

test('a refused compile is said once to the frames, never asked again by them', async () => {
  const { device } = fakeDevice()
  let asked = 0
  device.createComputePipelineAsync = async () => (asked++, Promise.reject(new Error('NO')))
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  })
  pipeline.ask()
  await pipelinesSettled(device)
  pipeline.ask()
  assert.equal(pipelinesCompiling(device), false, 'a refusal holds no frame')
  assert.equal(asked, 1)
  await assert.rejects(pipeline.prepare(), /NO/, 'prepare asks it again, and hears it')
  assert.equal(asked, 2)
})

test('a device that refuses the stage refuses the compile, never throws at the one asking', async () => {
  const { device } = fakeDevice({ failCompute: true })
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  })
  assert.doesNotThrow(() => started(pipeline))
  await pipelinesSettled(device)
  assert.equal(pipeline.ready, false)
})

test('a program keyed by what decides each pipeline makes each once, on its own descriptor', async () => {
  const { device, compiled, land, renderPipelines } = gatedDevice()
  const made: string[] = []
  const program = preparedPipelines((key: string) => {
    made.push(key)
    return preparedPipeline(device, triangle(key))
  })
  assert.equal(program.of('a'), program.of('a'))
  program.of('b').ask()
  program.of('b').ask()
  const both = Promise.all([program.of('a').prepare(), pipelinesSettled(device)])
  await land()
  await both
  assert.deepEqual(made, ['a', 'b'])
  assert.deepEqual([...program.keys()], ['a', 'b'])
  assert.deepEqual(
    renderPipelines.map(({ label }) => label),
    ['b', 'a'],
  )
  assert.deepEqual(compiled, { sync: 0, async: 2 })
})

test('a frame that gets there first skips the pipeline, never compiling it nor a twin of the compile in flight', async () => {
  const { device, compiled, land } = gatedDevice()
  const asked = preparedPipeline(device, triangle('asked'))
  asked.ask()
  assert.equal(asked.get(), undefined, 'compiling: skipped')
  const never = preparedPipeline(device, triangle('never asked'))
  assert.equal(never.get(), undefined, 'nothing asked it: skipped, and asked now')
  assert.equal(pipelinesCompiling(device), true, 'the frames wait for both')
  await land()
  await pipelinesSettled(device)
  assert.equal(pipelinesCompiling(device), false)
  assert.ok(asked.get() && never.get())
  assert.deepEqual(compiled, { sync: 0, async: 2 }, 'two compiles, none on the frame')
})

test('a refused compile is tried again off the thread by a frame that needs it, skipped meanwhile', async () => {
  const { device } = fakeDevice()
  let asked = 0
  device.createComputePipelineAsync = async () => (asked++, Promise.reject(new Error('NO')))
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  })
  pipeline.ask()
  await pipelinesSettled(device)
  assert.equal(pipeline.get(), undefined)
  await pipelinesSettled(device)
  assert.equal(asked, 1, 'a refused compile waits frames before it is tried again')
  for (let frame = 0; frame < 240; frame++) tickCompiles(device)
  assert.equal(pipeline.get(), undefined)
  await pipelinesSettled(device)
  assert.equal(asked, 2, 'tried again, off the thread')
  assert.equal(takeRefusals(device)?.length, 1, 'said once')
  assert.equal(pipelinesCompiling(device), false, 'a refusal holds no frame')
})

test('every asker of a pipeline in flight shares its one compile', async () => {
  const { device, compiled, land } = gatedDevice()
  const pipeline = preparedPipeline(device, triangle('shared'))
  const first = pipeline.prepare(),
    second = pipeline.prepare()
  pipeline.ask()
  assert.equal(first, second, 'one promise in flight, reused')
  await land()
  await Promise.all([first, second])
  assert.deepEqual(compiled, { sync: 0, async: 1 })
})

/** The modules that still make a pipeline synchronously: the one way itself. A module may leave this
 *  list, never join it. */
const STILL_SYNCHRONOUS = ['lighting/deferred/fullscreen.ts']
const SYNC_CREATE = /\.create(?:Render|Compute)Pipeline\(/

test('no new module makes a pipeline synchronously', () => {
  const root = new URL('../../', import.meta.url)
  const sources = (readdirSync(root, { recursive: true }) as string[]).filter(
    (file) => file.endsWith('.ts') && !/\.(test|fixture|perf|browser)\.ts$/.test(file),
  )
  const making = sources.filter((file) =>
    SYNC_CREATE.test(readFileSync(new URL(file, root), 'utf8')),
  )
  assert.deepEqual(
    making.filter((file) => !STILL_SYNCHRONOUS.includes(file)),
    [],
  )
})

/** The words of one indirect draw, four bytes each. */
const DRAW_BYTES = 16

test('the tile lists hold a word a tile for each class, and each class has the draw of its own', () => {
  assert.equal(tileListBytes(1921, 1081), 3 * 241 * 136 * 4, 'a tile cut by the edge is a tile')
  assert.equal(tileListBytes(1920, 1080), 3 * 240 * 135 * 4)
  assert.deepEqual(TILE_CLASSES.map(tileArgsAt), [0, DRAW_BYTES, 2 * DRAW_BYTES])
  assert.equal(TILE_ARGS_BYTES, 3 * DRAW_BYTES)
  // A class with no pipeline (the program holds nothing for it) is not drawn.
  const calls: [string, unknown, number?][] = []
  const pass = {
    setPipeline: (pipeline: unknown) => calls.push(['pipeline', pipeline]),
    drawIndirect: (_: unknown, offset: number) => calls.push(['draw', undefined, offset]),
  } as unknown as GPURenderPassEncoder
  const [simple, , complex] = [{}, {}, {}] as GPURenderPipeline[]
  assert.equal(drawTileClasses(pass, [simple, undefined, complex], {} as GPUBuffer), 2)
  assert.deepEqual(calls, [
    ['pipeline', simple],
    ['draw', undefined, 0],
    ['pipeline', complex],
    ['draw', undefined, 2 * DRAW_BYTES],
  ])
})

test('the classification clears its draws, dispatches a workgroup a tile and grows its lists for the image, never shrinks them', async () => {
  const gpu = fakeDevice()
  const failures: unknown[] = []
  const classification = createTileClassification(gpu.device, (error) => failures.push(error))
  assert.throws(() => classification.lists, /TILE_LISTS_UNSIZED/)
  classification.ensure(1920, 1080)
  const lists = classification.lists
  assert.equal(lists.size, tileListBytes(1920, 1080))
  classification.ensure(640, 360)
  assert.equal(classification.lists, lists, 'a smaller image keeps the lists')
  classification.ensure(3840, 2160)
  assert.equal(classification.lists.size, tileListBytes(3840, 2160))
  assert.ok(
    !gpu.destroyed.includes(lists),
    'the lists it grew out of live until the frame is submitted',
  )
  destroyRetired(gpu.device)
  assert.ok(gpu.destroyed.includes(lists), 'the lists it grew out of are released after the submit')
  await pipelinesSettled(gpu.device)
  const encoder = gpu.device.createCommandEncoder()
  const view = gpu.device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM })
  classification.encode(encoder, {} as GPUTextureView, view, 3840, 2160)
  assert.deepEqual(failures, [])
  assert.deepEqual(
    gpu.clears.map(({ buffer }) => buffer),
    [classification.draws],
    'the counts of instances start at zero',
  )
  assert.deepEqual(
    gpu.dispatches.map(({ entryPoint, direct, rows }) => [entryPoint, direct, rows]),
    [['classifyMain', 480, 270]],
    'a workgroup of 8 × 8 pixels is a tile',
  )
  assert.equal(gpu.passDescriptors.at(-1)?.label, TILE_CLASSIFICATION_PASS)
  classification.dispose()
})
