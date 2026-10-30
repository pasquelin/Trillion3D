// The engine's one way to a pipeline (`fullscreen.ts`): a pipeline a frame binds is compiled off the
// thread before the frame, which waits for it held rather than compiling it; and no new module of
// the source makes one synchronously.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import {
  chainCompiled,
  chainPending,
  preparedComputePipeline,
  preparedPipeline,
  started,
} from './fullscreen.ts'
import { JITTER, MAX_RETRY_MS, RETRY_MS } from '../../gpu/core/backoff.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import {
  onRetryLanded,
  pipelinesCompiling,
  pipelinesSettled,
  retryAfter,
  takeRefusals,
} from './compileLedger.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { deviceOwner } from '../../../../../tests/kit/fakeDevice/fakeWebgpuDevice.ts'
import { claimGpuDevice } from '../../gpu/core/deviceOwners.ts'
import { gatedDevice } from './gatedDevice.fixture.ts'
import { TILE_CLASSIFICATION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createTileClassification } from './classify.ts'
import { TILE_ARGS_BYTES, TILE_CLASSES, tileArgsAt, tileListBytes } from './tileClass.ts'
import { drawTileClasses } from './tilePass.ts'

/** Time advanced by hand, for the test's length: a refused compile's retry is a timer (`retryAfter`), its wait spread by `random` (the middle of the spread, no spread, unless the test gives its own). */
const fakeClock = (t: TestContext, random = 0.5) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(Math, 'random', () => random)
  return (ms: number) => t.mock.timers.tick(ms)
}

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

test('a refused compile is said once to the frames, never asked again by them', async (t) => {
  const tick = fakeClock(t)
  const { device } = fakeDevice()
  let asked = 0
  device.createComputePipelineAsync = async () => (
    asked++,
    Promise.reject(new GPUPipelineError('NO', { reason: 'internal' }))
  )
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  })
  pipeline.ask()
  await pipelinesSettled(device)
  pipeline.ask()
  assert.equal(pipelinesCompiling(device), false, 'a refusal holds no frame')
  assert.equal(asked, 1)
  // Within its wait, prepare is no stale refusal: it settles with the scheduled retry.
  const within = pipeline.prepare()
  let settledEarly = false
  within.then(
    () => (settledEarly = true),
    () => (settledEarly = true),
  )
  assert.equal(pipeline.prepare(), within, 'every asker shares the scheduled retry')
  await Promise.resolve()
  assert.equal(settledEarly, false, 'nothing is heard before the retry')
  assert.equal(asked, 1, 'and nothing is built')
  tick(RETRY_MS)
  await assert.rejects(within, /NO/, 'the retry refused anew')
  assert.equal(asked, 2)
})

test('a prepare asked within the wait of a refusal is resolved by the retry that lands', async (t) => {
  const tick = fakeClock(t)
  const { device } = fakeDevice()
  let asked = 0
  device.createComputePipelineAsync = async (descriptor) => {
    if (asked++ === 0) throw new GPUPipelineError('NO', { reason: 'internal' })
    return device.createComputePipeline(descriptor)
  }
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  })
  await assert.rejects(pipeline.prepare(), /NO/, 'the first refusal is heard')
  const within = pipeline.prepare()
  tick(RETRY_MS)
  await within
  assert.equal(pipeline.ready, true)
  assert.equal(asked, 2)
})

test('a host without the pipeline error class classifies a refusal by its name, and never throws', async () => {
  const { device } = fakeDevice()
  const real = globalThis.GPUPipelineError
  const refusal = Object.assign(new Error('NO'), { name: 'GPUPipelineError', reason: 'validation' })
  let asked = 0
  device.createComputePipelineAsync = async () => (asked++, Promise.reject(refusal))
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  })
  delete (globalThis as { GPUPipelineError?: unknown }).GPUPipelineError
  try {
    await assert.rejects(pipeline.prepare(), /NO/)
    assert.equal(pipeline.unavailable, true, 'a validation refusal by name is for good')
  } finally {
    globalThis.GPUPipelineError = real
  }
  assert.equal(asked, 1)
})

test('started is the pipeline start: a refused pipeline within its wait is not built again', async () => {
  const { device } = fakeDevice()
  let asked = 0
  device.createComputePipelineAsync = async () => (
    asked++,
    Promise.reject(new GPUPipelineError('NO', { reason: 'internal' }))
  )
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  })
  assert.equal(started(pipeline), pipeline)
  await pipelinesSettled(device)
  started(pipeline)
  await pipelinesSettled(device)
  assert.equal(asked, 1)
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

test('a started pipeline holds no frame and is pending until it lands; refused, it is skipped by the frames and tried again by a timer', async (t) => {
  const tick = fakeClock(t)
  const { device } = fakeDevice()
  let asked = 0
  device.createComputePipelineAsync = async () => (
    asked++,
    Promise.reject(new GPUPipelineError('NO', { reason: 'internal' }))
  )
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  })
  assert.equal(pipeline.pending, false)
  assert.equal(chainPending(pipeline), false)
  assert.equal(chainCompiled(pipeline), false, 'started now, not compiled')
  assert.equal(pipeline.pending, true, 'in flight')
  assert.equal(pipelinesCompiling(device), false, 'no frame waits for a started pipeline')
  await pipelinesSettled(device)
  assert.equal(pipeline.pending, false, 'refused: neither compiled nor in flight')
  assert.equal(pipeline.ready, false)
  assert.equal(pipeline.get(), undefined, 'a frame skips it')
  assert.equal(pipeline.start(), pipeline)
  await pipelinesSettled(device)
  assert.equal(asked, 1, 'a refused pipeline is not started again at once')
  tick(RETRY_MS)
  assert.equal(pipeline.pending, true, 'the timer tried it again')
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

test('a refused compile is tried again after a growing wait, and never one the device refused for what the pipeline is', async (t) => {
  const tick = fakeClock(t)
  const descriptor = {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  } as const
  const refusedBy = (error: unknown, atOnce = false) => {
    const { device } = fakeDevice()
    const counted = { asked: 0 }
    device.createComputePipelineAsync = (() => {
      counted.asked++
      if (atOnce) throw error
      return Promise.reject(error)
    }) as typeof device.createComputePipelineAsync
    return { device, counted, pipeline: preparedComputePipeline(device, descriptor) }
  }
  const waiting = async ({ device, pipeline }: ReturnType<typeof refusedBy>, ms: number) => {
    // A frame binds the pipeline meanwhile: it is in use, the timer tries it.
    pipeline.get()
    tick(ms)
    await pipelinesSettled(device)
  }
  for (const [what, error, atOnce] of [
    [
      'a pipeline refused for validation',
      new GPUPipelineError('NO', { reason: 'validation' }),
      false,
    ],
    ['a missing feature', new TypeError('NO'), false],
    ['a build that throws a TypeError at once', new TypeError('NO'), true],
    ['a ReferenceError', new ReferenceError('NO'), false],
    ['a RangeError', new RangeError('NO'), false],
    ['a plain Error', new Error('NO'), false],
    ['a plain Error thrown at once', new Error('NO'), true],
  ] as const) {
    const validation = refusedBy(error, atOnce)
    validation.pipeline.start()
    await pipelinesSettled(validation.device)
    await waiting(validation, RETRY_MS)
    await waiting(validation, MAX_RETRY_MS)
    assert.equal(validation.counted.asked, 1, `${what} is the device answer: not tried again`)
    await assert.rejects(validation.pipeline.prepare(), error as Error, `${what}: refused again`)
    assert.equal(
      validation.counted.asked,
      1,
      `${what}: prepare builds nothing once refused for good`,
    )
  }
  const internal = refusedBy(new GPUPipelineError('NO', { reason: 'internal' }))
  internal.pipeline.start()
  await pipelinesSettled(internal.device)
  await waiting(internal, RETRY_MS)
  assert.equal(internal.counted.asked, 2, 'tried again after the first wait')
  await waiting(internal, RETRY_MS)
  assert.equal(internal.counted.asked, 2, 'the wait doubled')
  await waiting(internal, RETRY_MS)
  assert.equal(internal.counted.asked, 3)
  for (let at = 0; at < 10; at++) await waiting(internal, MAX_RETRY_MS)
  assert.ok(
    internal.counted.asked >= 10,
    'a refusal that keeps coming is tried on, at a long interval',
  )
  assert.equal(takeRefusals(internal.device)?.length, 1, 'said once')
})

test('a creation thrown at once gets the verdict of a rejected one, on the async path and at the call alike: a TypeError is final, a DOMException is tried again', async (t) => {
  const tick = fakeClock(t)
  const descriptor = {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  } as const
  const asked = async (asyncPipelines: boolean, fail: () => Promise<never>) => {
    const { device } = fakeDevice({ asyncPipelines })
    let count = 0
    const counting = () => (count++, fail())
    if (asyncPipelines) device.createComputePipelineAsync = counting
    else device.createComputePipeline = counting as never
    const pipeline = preparedComputePipeline(device, descriptor)
    pipeline.start()
    await pipelinesSettled(device)
    pipeline.get()
    tick(RETRY_MS)
    await pipelinesSettled(device)
    return count
  }
  const thrown = (error: Error) => () => {
    throw error
  }
  for (const asyncPipelines of [true, false]) {
    assert.equal(
      await asked(asyncPipelines, thrown(new TypeError('NO'))),
      1,
      `async ${asyncPipelines}: final`,
    )
    assert.equal(
      await asked(asyncPipelines, thrown(new DOMException('NO', 'OperationError'))),
      2,
      `async ${asyncPipelines}: a DOMException thrown at the call is tried again, as a rejected one`,
    )
  }
  assert.equal(
    await asked(true, () => Promise.reject(new DOMException('NO', 'OperationError'))),
    2,
    'a scope popped out of turn is no verdict on the pipeline',
  )
})

test('reading ready starts nothing: a refused compile is tried again by a timer once a frame used its pipeline', async (t) => {
  const tick = fakeClock(t)
  const { device } = fakeDevice()
  let asked = 0
  device.createComputePipelineAsync = (() => {
    asked++
    return Promise.reject(new GPUPipelineError('NO', { reason: 'internal' }))
  }) as typeof device.createComputePipelineAsync
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  })
  pipeline.start()
  await pipelinesSettled(device)
  for (let read = 0; read < 1000; read++) void pipeline.ready
  assert.equal(asked, 1, 'reading ready, however often, asks nothing')
  assert.equal(pipeline.get(), undefined, 'a frame skips it, and the pipeline is in use')
  tick(RETRY_MS - 1)
  assert.equal(asked, 1, 'the wait is not over')
  tick(1)
  assert.equal(asked, 2, 'the timer ends the wait with a try')
  await pipelinesSettled(device)
})

test('a refused compile that lands on a retry is heard, a first compile is not: a view at rest is redrawn with the pipeline that landed', async (t) => {
  const tick = fakeClock(t)
  const { device } = fakeDevice()
  let refuse = true,
    heard = 0
  device.createComputePipelineAsync = (() =>
    refuse
      ? Promise.reject(new GPUPipelineError('NO', { reason: 'internal' }))
      : Promise.resolve({})) as unknown as typeof device.createComputePipelineAsync
  const stop = onRetryLanded(device, () => heard++)
  const make = () =>
    preparedComputePipeline(device, {
      layout: 'auto',
      compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
    })
  const first = make()
  refuse = false
  first.start()
  await pipelinesSettled(device)
  assert.equal(first.ready, true)
  assert.equal(heard, 0, 'a first compile redraws through the frames waiting for it, not here')
  refuse = true
  const retried = make().start()
  await pipelinesSettled(device)
  assert.equal(retried.refused, true)
  retried.get()
  refuse = false
  tick(RETRY_MS)
  await pipelinesSettled(device)
  assert.equal(retried.ready, true, 'the retry landed')
  assert.equal(heard, 1, 'and it is heard once')
  stop()
  takeRefusals(device)
})

test('the wait of a refused compile is time, not frames: frames entering retry nothing, a still view is retried by the timer alone', async (t) => {
  const tick = fakeClock(t)
  const { device } = fakeDevice()
  let asked = 0
  device.createComputePipelineAsync = (() => {
    asked++
    return Promise.reject(new GPUPipelineError('NO', { reason: 'internal' }))
  }) as typeof device.createComputePipelineAsync
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  }).start()
  await pipelinesSettled(device)
  pipeline.get()
  for (let frame = 0; frame < 5000; frame++) pipeline.get()
  assert.equal(asked, 1, 'any number of frames entering is no time passing')
  tick(RETRY_MS)
  assert.equal(asked, 2, 'the time passing is, with no frame entering')
  await pipelinesSettled(device)
  assert.equal(pipeline.refused, true)
  takeRefusals(device)
})

test('a prepare asked within the wait is not followed by pipelinesSettled: preparation goes on, the caller alone waits for the retry, resolved by one that lands and rejected by one refused anew', async (t) => {
  const tick = fakeClock(t)
  const { device } = fakeDevice()
  let refuse = true
  device.createComputePipelineAsync = (() =>
    refuse
      ? Promise.reject(new GPUPipelineError('NO', { reason: 'internal' }))
      : Promise.resolve({})) as unknown as typeof device.createComputePipelineAsync
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  }).start()
  await pipelinesSettled(device)
  assert.equal(pipelinesSettled(device), undefined, 'a refusal nobody awaits is settled')
  const first = pipeline.prepare()
  assert.equal(
    pipelinesSettled(device),
    undefined,
    'a prepare waiting for the retry is no compile preparation waits for',
  )
  assert.equal(pipelinesCompiling(device), false, 'and holds no frame')
  tick(RETRY_MS)
  await assert.rejects(first, /NO/, 'the retry refused anew rejects it')
  const second = pipeline.prepare()
  refuse = false
  tick(2 * RETRY_MS)
  await second
  assert.equal(pipeline.ready, true, 'the retry that lands resolves it')
  takeRefusals(device)
})

test('a refused pipeline still referenced is retried by its timer whatever its use, nobody getting it: the retry lands and redraws', async (t) => {
  const tick = fakeClock(t)
  for (const first of ['prepare', 'start', 'ask', 'get'] as const) {
    const { device } = fakeDevice()
    let refuse = true,
      count = 0
    device.createComputePipelineAsync = (() => {
      count++
      return refuse
        ? Promise.reject(new GPUPipelineError('NO', { reason: 'internal' }))
        : Promise.resolve({})
    }) as unknown as typeof device.createComputePipelineAsync
    const pipeline = preparedComputePipeline(device, {
      layout: 'auto',
      compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
    })
    let redraws = 0
    const stop = onRetryLanded(device, () => redraws++)
    if (first === 'prepare') void pipeline.prepare().catch(() => undefined)
    else pipeline[first]()
    await pipelinesSettled(device)
    assert.equal(count, 1, `${first}: nothing retries it before its timer`)
    refuse = false
    tick(10 * MAX_RETRY_MS)
    await pipelinesSettled(device)
    assert.equal(count, 2, `${first}: the timer retried it with no use since`)
    assert.equal(pipeline.ready, true, `${first}: and it landed`)
    assert.equal(redraws, 1, `${first}: the view is told to redraw`)
    stop()
    takeRefusals(device)
  }
})

test('a pipeline refused at rest after its last use is retried by its timer and lands', async (t) => {
  const tick = fakeClock(t)
  const { device } = fakeDevice()
  let refuse = true
  device.createComputePipelineAsync = (() =>
    refuse
      ? Promise.reject(new GPUPipelineError('NO', { reason: 'internal' }))
      : Promise.resolve({})) as unknown as typeof device.createComputePipelineAsync
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  }).start()
  await pipelinesSettled(device)
  let heard = 0
  const stop = onRetryLanded(device, () => heard++)
  refuse = false
  tick(RETRY_MS)
  await pipelinesSettled(device)
  assert.equal(pipeline.ready, true, 'retried with no use since the refusal')
  assert.equal(heard, 1, 'and the view at rest is told to redraw')
  stop()
  takeRefusals(device)
})

test('the wait is spread by a quarter either way, so that refusals of one moment do not come back together', async (t) => {
  const tick = fakeClock(t, 0)
  const { device } = fakeDevice()
  let asked = 0
  device.createComputePipelineAsync = (() => {
    asked++
    return Promise.reject(new GPUPipelineError('NO', { reason: 'internal' }))
  }) as typeof device.createComputePipelineAsync
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  }).start()
  await pipelinesSettled(device)
  pipeline.get()
  tick(RETRY_MS * (1 - JITTER) - 1)
  assert.equal(asked, 1)
  tick(1)
  assert.equal(asked, 2, 'the shortest wait of the spread')
  await pipelinesSettled(device)
  takeRefusals(device)
})

test('a lost device refuses for good: no retry on a dead device, none heard, a prepare refused again', async (t) => {
  const tick = fakeClock(t)
  const gpu = fakeDevice()
  const { device } = gpu
  claimGpuDevice(device, deviceOwner())
  let asked = 0,
    heard = 0
  device.createComputePipelineAsync = (() => {
    asked++
    return Promise.reject(new DOMException('NO', 'OperationError'))
  }) as typeof device.createComputePipelineAsync
  const stop = onRetryLanded(device, () => heard++)
  const pipeline = preparedComputePipeline(device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  }).start()
  await pipelinesSettled(device)
  assert.equal(pipeline.unavailable, false, 'a DOMException is tried again while the device lives')
  const waiting = pipeline.prepare()
  gpu.lose()
  await Promise.resolve()
  assert.equal(pipeline.unavailable, true, 'the loss makes the refusal final')
  tick(MAX_RETRY_MS)
  await assert.rejects(waiting, /NO/, 'who waited for the retry is not left waiting')
  assert.equal(asked, 1, 'nothing is tried on a dead device')
  await assert.rejects(pipeline.prepare(), /NO/)
  assert.equal(asked, 1)
  stop()
  takeRefusals(device)
  // A device lost before the refusal: final at once.
  const dead = fakeDevice()
  claimGpuDevice(dead.device, deviceOwner())
  dead.lose()
  await Promise.resolve()
  dead.device.createComputePipelineAsync = (() =>
    Promise.reject(
      new DOMException('NO', 'OperationError'),
    )) as typeof device.createComputePipelineAsync
  const late = preparedComputePipeline(dead.device, {
    layout: 'auto',
    compute: { module: {} as GPUShaderModule, entryPoint: 'main' },
  })
  late.start()
  await pipelinesSettled(dead.device)
  await Promise.resolve()
  assert.equal(late.unavailable, true, 'a device lost before the refusal: final')
  takeRefusals(dead.device)
})

test('a retry nobody names any more settles the prepare that waits for it with the refusal, never leaving it pending', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const real = globalThis.WeakRef
  globalThis.WeakRef = class {
    deref() {
      return undefined
    }
  } as unknown as typeof WeakRef
  let lost = 0,
    retried = 0
  try {
    retryAfter(
      () => retried++,
      RETRY_MS,
      () => lost++,
    )
  } finally {
    globalThis.WeakRef = real
  }
  t.mock.timers.tick(RETRY_MS)
  assert.deepEqual([retried, lost], [0, 1])
})
