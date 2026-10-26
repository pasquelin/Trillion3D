import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HardwareBenchmarkResult } from '../../../../sdk-core/src/runtime/hardwareBenchmark.ts'
import { runHardwareBenchmark } from './hardwareBenchmark.ts'
import { worldBenchmark } from './benchmarkSource.ts'
import { worldSwitches } from './switches.ts'
import type { MeasuredWorld } from '../explorer.ts'

const INFO = { vendor: 'v', architecture: 'a', device: 'd', description: 'x' }

/** A worker that answers each run `seconds`, or fails at its first message. */
function fakeWorker(seconds: number | 'fails') {
  const worker = {
    terminated: false,
    posted: 0,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: { preventDefault(): void }) => void) | null,
    onmessageerror: null as unknown,
    postMessage() {
      worker.posted++
      queueMicrotask(() =>
        seconds === 'fails'
          ? worker.onerror?.({ preventDefault() {} })
          : worker.onmessage?.({ data: { total: seconds } }),
      )
    },
    terminate: () => void (worker.terminated = true),
  }
  return worker
}

/** A device with no GPU timestamps, which counts its own destruction. */
function fakeDevice() {
  const device = {
    destroyed: false,
    features: new Set<string>(),
    adapterInfo: INFO,
    queue: { onSubmittedWorkDone: async () => {} },
    destroy: () => void (device.destroyed = true),
  }
  return device
}

const needs = (worker: ReturnType<typeof fakeWorker>, device = fakeDevice()) => ({
  worker: () => worker as unknown as Worker,
  device: async () => device as unknown as GPUDevice,
})

test('the processor tests run in the worker, each run timed there, and its index is weighted', async () => {
  const worker = fakeWorker(0.05),
    device = fakeDevice()
  const { result, adapter } = await runHardwareBenchmark(
    { workScale: 2 },
    undefined,
    needs(worker, device),
  )
  assert.equal(worker.posted, 4, 'two runs of each test')
  const steps = [(100 * 0.02561) / 0.05, (100 * 0.0286) / 0.05]
  assert.deepEqual(result.cpuSteps, steps)
  assert.ok(Math.abs(result.cpuIndex! - (steps[0] + 1.5 * steps[1]) / 2.5) < 1e-9)
  assert.equal(result.gpuIndex, null, 'no GPU timestamps: no graphics index')
  assert.equal(adapter, 'v|a|d|x')
  assert.ok(worker.terminated && device.destroyed, 'the worker and the device given back')
})

test('a worker that fails, or none, leaves the processor index out: nothing runs on the page', async () => {
  const failing = fakeWorker('fails')
  const { result } = await runHardwareBenchmark({}, undefined, needs(failing))
  assert.equal(result.cpuIndex, null)
  assert.equal(failing.posted, 1, 'no second run, no run on the page')
  const none = { ...needs(fakeWorker(1)), worker: () => assert.fail('refused') as never }
  assert.equal((await runHardwareBenchmark({}, undefined, none)).result.cpuIndex, null)
})

test('a stopped run is refused, its worker given back, no device asked', async () => {
  const worker = fakeWorker(0.05),
    stop = new AbortController()
  let asked = false
  const run = runHardwareBenchmark({}, stop.signal, {
    worker: () => worker as unknown as Worker,
    device: async () => ((asked = true), fakeDevice() as unknown as GPUDevice),
  })
  stop.abort(new Error('disposed'))
  await assert.rejects(run, /disposed/)
  assert.ok(worker.terminated)
  assert.equal(asked, false)
  await assert.rejects(runHardwareBenchmark({ workScale: 2.5 }), /HARDWARE_BENCHMARK_OPTIONS/)
})

const kept: HardwareBenchmarkResult = {
  cpuIndex: 40,
  gpuIndex: 90,
  cpuSteps: [],
  gpuSteps: [],
  workScale: 10,
  gpuWorkScale: 1000,
  gpuMultiplier: 1,
}

/** A store in memory, or one that refuses every access. */
function memoryStore(refuses = false) {
  const items = new Map<string, string>()
  const refuse = () => {
    throw new Error('SecurityError')
  }
  return {
    items,
    getItem: (key: string) => (refuses ? refuse() : (items.get(key) ?? null)),
    setItem: (key: string, value: string) => void (refuses ? refuse() : items.set(key, value)),
  }
}

test('a run keeps its result for its adapter; another adapter, a refused store or a disposed world reads none', async () => {
  const store = memoryStore()
  let flushed = 0
  const device = { ...fakeDevice(), queue: { onSubmittedWorkDone: async () => void flushed++ } }
  const load = async () => async () => ({ result: kept, adapter: 'v|a|d|x' })
  /** The benchmark of a world drawing on `drawing`, kept in `kept`, stopped by `signal`. */
  const made = (drawing: unknown, into = store, signal = new AbortController().signal) =>
    worldBenchmark(
      { pending: Promise.resolve(), gpuDevice: drawing as GPUDevice | undefined },
      () => into,
      load,
    )(signal)
  const source = made(device)
  assert.equal(await source.saved(), null, 'nothing kept yet')
  assert.deepEqual(await source.run(), kept)
  assert.equal(flushed, 1, 'the world’s device has finished its work first')
  assert.deepEqual(await source.saved(), kept)
  const other = { ...device, adapterInfo: { ...INFO, device: 'e' } }
  assert.equal(await made(other).saved(), null, 'another GPU measures again')
  const refused = made(device, memoryStore(true))
  assert.equal(await refused.saved(), null)
  assert.deepEqual(await refused.run(), kept, 'a refused store keeps nothing, the run answers')
  const stop = new AbortController()
  stop.abort()
  assert.equal(await made(device, store, stop.signal).saved(), null, 'a disposed world')
  assert.equal(await made(undefined).saved(), null, 'no device granted')
})

test('the benchmark writes no scale: the display’s default stays, a page’s scale holds; dispose stops its run', async () => {
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  let signal: AbortSignal | undefined
  const source = (given: AbortSignal) => {
    signal = given
    return { saved: async () => kept, run: async () => kept }
  }
  const made = (options: Parameters<typeof worldSwitches>[0]) =>
    worldSwitches(options, () => runtime, { last: null }, source)
  const free = made({ quality: { preset: 'auto' } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(free.held.renderScale, undefined, 'graphics 90: the display’s default, as before it')
  free.quality.preset = 'max'
  assert.equal(free.held.renderScale, undefined, 'out of auto, the same default')
  const asked = made({ renderScale: 0.6, quality: { preset: 'auto' } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(asked.held.renderScale, 0.6, 'the page’s scale holds')
  const later = made({})
  later.renderScale = 0.5
  await later.quality.benchmark()
  assert.equal(later.held.renderScale, 0.5, 'a scale written since holds too')
  later.dispose()
  assert.equal(signal?.aborted, true)
})
