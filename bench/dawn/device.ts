// The bench's GPU: Dawn in Node (`webgpu`, the WebGPU implementation Chrome runs) on the machine's
// own GPU, with no browser. Every command the engine gives it is counted per frame, and every pass
// is timed (`passTimer.ts`), at the GPU's full timestamp precision (Dawn's quantization off).
import { create, globals } from 'webgpu'
import { writeBitmap } from './imageCopy.ts'
import { guardMaps } from './mapGuard.ts'
import { createPassTimer } from './passTimer.ts'
import { profiledAdapter } from './profiles.ts'

/** What one frame asked of the GPU: passes (timed or not), copies, bytes written, objects made
 *  (render bundles recorded included). */
export const COUNTS = [
  'submits',
  'renderPasses',
  'computePasses',
  'timedPasses',
  'copies',
  'writes',
  'writtenBytes',
  'clears',
  'clearedBytes',
  'buffersMade',
  'bufferBytesMade',
  'texturesMade',
  'bindGroupsMade',
  'pipelinesMade',
  'bundlesMade',
] as const
export type Counts = Record<(typeof COUNTS)[number], number>
const zero = () => Object.fromEntries(COUNTS.map((key) => [key, 0])) as Counts

type Proto = Record<string, (...args: unknown[]) => unknown>
/** Counts every call of `name` on `proto` into `counts`, through `count`. */
function counted(proto: Proto, name: string, count: (args: unknown[], self: unknown) => void) {
  const original = proto[name]
  if (!original) return
  proto[name] = function (this: unknown, ...args: unknown[]) {
    const made = original.apply(this, args)
    count(args, this)
    return made
  }
}

/** Opens Dawn and installs its WebGPU globals (`navigator.gpu`, `GPUBufferUsage`, …) on this
 *  process, as a browser holds them, with what Dawn in Node lacks of a browser: an image copied to
 *  a texture (`imageCopy.ts`) and a buffer destroyed while it maps (`mapGuard.ts`). What the bench
 *  and the GPU proofs run on. */
export function installDawn(): GPU {
  Object.assign(globalThis, globals)
  writeBitmap(GPUQueue.prototype)
  guardMaps(GPUBuffer.prototype)
  // A browser rounds GPU timestamps against timing attacks; a bench reads them whole.
  const gpu = create(['disable-dawn-features=timestamp_quantization'])
  Object.defineProperty(globalThis.navigator, 'gpu', { value: gpu, configurable: true })
  return gpu
}

/** Opens Dawn (`installDawn`) and returns the per-frame counts, the device the engine opens (once
 *  it does) and the adapter's name. */
export function installGpu(profile: {
  limits: Record<string, number> | null
  featuresOff: readonly string[]
}) {
  const gpu = installDawn()
  const counts = zero()
  let quietNow = false,
    found: (device: GPUDevice) => void = () => {}
  const held: {
    /** Every device the engine opened (a probe may open one). */
    devices: GPUDevice[]
    /** The one whose queue took the last frame's commands — the one the frames wait for. */
    device: GPUDevice | null
    /** Resolves to it once the engine first submits to it. */
    ready: Promise<GPUDevice>
    adapter: string
  } = {
    devices: [],
    device: null,
    ready: new Promise((resolve) => (found = resolve)),
    adapter: '',
  }
  const add = (key: keyof Counts, value = 1) => void (quietNow || (counts[key] += value))
  /** Runs `work`, the bench's own commands (its calibration, timer, captures): no frame counts them. */
  const quiet = <T>(work: () => T): T => {
    const was = quietNow
    quietNow = true
    try {
      return work()
    } finally {
      quietNow = was
    }
  }
  const timer = createPassTimer(quiet)
  const g = globals as unknown as Record<string, { prototype: Proto }>
  counted(g.GPUQueue.prototype, 'submit', (_args, queue) => {
    if (quietNow) return
    add('submits')
    if (held.device?.queue !== queue) {
      held.device = held.devices.find((device) => device.queue === queue) ?? held.device
      if (held.device) found(held.device)
    }
  })
  counted(g.GPUQueue.prototype, 'writeBuffer', (a) => {
    const data = a[2] as ArrayBufferView | ArrayBuffer
    const unit = 'BYTES_PER_ELEMENT' in data ? (data.BYTES_PER_ELEMENT as number) : 1
    add('writes')
    add(
      'writtenBytes',
      a[4] !== undefined
        ? (a[4] as number) * unit
        : data.byteLength - ((a[3] as number) ?? 0) * unit,
    )
  })
  counted(g.GPUQueue.prototype, 'writeTexture', () => add('writes'))
  const encoder = g.GPUCommandEncoder.prototype
  for (const [name, kind] of [
    ['beginRenderPass', 'render'],
    ['beginComputePass', 'compute'],
  ] as const) {
    const begin = encoder[name]
    encoder[name] = function (this: GPUCommandEncoder, ...args: unknown[]) {
      const descriptor = args[0] as GPURenderPassDescriptor | undefined
      if (quietNow) return begin.call(this, descriptor)
      add(kind === 'render' ? 'renderPasses' : 'computePasses')
      if (descriptor?.timestampWrites) add('timedPasses')
      return begin.call(this, timer.wrap(kind, descriptor, this.label))
    }
  }
  for (const copy of [
    'copyBufferToBuffer',
    'copyBufferToTexture',
    'copyTextureToBuffer',
    'copyTextureToTexture',
  ])
    counted(encoder, copy, () => add('copies'))
  counted(encoder, 'clearBuffer', (a) => {
    add('clears')
    add(
      'clearedBytes',
      (a[2] as number | undefined) ?? (a[0] as GPUBuffer).size - ((a[1] as number) ?? 0),
    )
  })
  const device = g.GPUDevice.prototype
  counted(
    device,
    'createBuffer',
    (a) => (add('buffersMade'), add('bufferBytesMade', (a[0] as GPUBufferDescriptor).size)),
  )
  counted(device, 'createTexture', () => add('texturesMade'))
  counted(device, 'createBindGroup', () => add('bindGroupsMade'))
  // A render bundle is recorded on the frame its inputs moved, replayed by the others.
  counted(device, 'createRenderBundleEncoder', () => add('bundlesMade'))
  for (const make of [
    'createRenderPipeline',
    'createComputePipeline',
    'createRenderPipelineAsync',
    'createComputePipelineAsync',
  ])
    counted(device, make, () => add('pipelinesMade'))
  const requestAdapter = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = async (options?: GPURequestAdapterOptions) => {
    const adapter = await requestAdapter(options)
    if (!adapter) return adapter
    held.adapter = adapter.info.description || `${adapter.info.vendor} ${adapter.info.architecture}`
    return profiledAdapter(adapter, profile.limits, profile.featuresOff, (device) =>
      held.devices.push(device),
    )
  }
  return {
    counts,
    held,
    timer,
    quiet,
    /** This frame's counts, and the next frame's start from zero. */
    take(): Counts {
      const taken = zero()
      for (const key of COUNTS) {
        taken[key] = counts[key]
        counts[key] = 0
      }
      return taken
    },
  }
}

export type BenchGpu = ReturnType<typeof installGpu>
