// The engine's one way to a pipeline: compiled off the thread (`buildRenderPipeline`,
// `buildComputePipeline`) and, for one a frame binds, prepared before any frame needs it
// (`preparedPipeline`, `preparedComputePipeline`, `preparedPipelines`): asked at preparation or when
// what needs it enters the scene (`PreparedPipeline.ask`), it is waited for there — the frame is
// held on it (`pipelinesCompiling`, `../../webgpu/frame/deviceAnswer.ts`) — and a frame finds it
// compiled; one only started (`started`) holds no frame, and prepare's end waits for it. The
// deferred lighting and composition, the temporal resolve, the water composite and the blend stages
// build theirs here too. The compiles in flight are held in `compileLedger.ts`.

import { track, untrack } from './compileLedger.ts'

/** Builds a render pipeline, asynchronously when the device offers it. */
export const buildRenderPipeline = (device: GPUDevice, descriptor: GPURenderPipelineDescriptor) =>
  device.createRenderPipelineAsync
    ? device.createRenderPipelineAsync(descriptor)
    : Promise.resolve(device.createRenderPipeline(descriptor))

/** Builds a compute pipeline, asynchronously when the device offers it. */
export const buildComputePipeline = (
  device: GPUDevice,
  descriptor: GPUComputePipelineDescriptor,
) =>
  device.createComputePipelineAsync
    ? device.createComputePipelineAsync(descriptor)
    : Promise.resolve(device.createComputePipeline(descriptor))

/** The compute stages of one module on one layout, by entry point, compiled together off the thread
 *  (#1362): prepare never builds its pipelines one after another. */
export async function buildComputeStages<E extends string>(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  module: GPUShaderModule,
  entryPoints: readonly E[],
  constants?: Record<string, number>,
) {
  const built = await Promise.all(
    entryPoints.map((entryPoint) =>
      buildComputePipeline(device, {
        layout,
        compute: { module, entryPoint, ...(constants && { constants }) },
      }),
    ),
  )
  return Object.fromEntries(entryPoints.map((entry, at) => [entry, built[at]])) as Record<
    E,
    GPUComputePipeline
  >
}

/** A pipeline compiled off the frame, once. */
export type PreparedPipeline<P> = {
  /** Compiles it off the thread, once — nothing once it is made, the compile in flight when one
   *  is; a refused compile is asked again by the next call. */
  prepare(): Promise<void>
  /** Compiles it off the thread, once, the frames of its device waiting for it
   *  (`pipelinesCompiling`) — one `prepare` already started included: what needs it entered the
   *  scene, the next frame binds it. A refused compile is not asked again. */
  ask(): PreparedPipeline<P>
  /** Whether it is compiled. */
  readonly ready: boolean
  /** The compiled pipeline. One that nothing prepared nor asked is compiled at once, on the frame
   *  that binds it: the compile every site this module serves asks ahead instead. */
  get(): P
}

function prepared<D, P>(
  device: GPUDevice,
  descriptor: D,
  build: (d: D) => Promise<P>,
  create: (d: D) => P,
): PreparedPipeline<P> {
  let made: P | undefined,
    compiling: Promise<void> | undefined,
    refused = false
  const pipeline: PreparedPipeline<P> = {
    // One compile in flight, every asker sharing it; a build that throws at once — a device
    // without the stage — is a refused compile too.
    prepare() {
      if (made !== undefined) return Promise.resolve()
      if (!compiling) {
        compiling = (async () => build(descriptor))().then(
          (built) => void (made ??= built),
          (error: unknown) => {
            compiling = undefined
            refused = true
            throw error
          },
        )
        track(device, compiling, false)
      }
      return compiling
    },
    ask() {
      if (made === undefined && !refused) track(device, pipeline.prepare(), true)
      return pipeline
    },
    get ready() {
      return made !== undefined
    },
    get() {
      if (made !== undefined) return made
      made = create(descriptor)
      // Made here: nothing waits for its compile any more.
      if (compiling) untrack(device, compiling)
      return made
    },
  }
  return pipeline
}

/** A render pipeline prepared off the frame (`prepared`). */
export const preparedPipeline = (device: GPUDevice, descriptor: GPURenderPipelineDescriptor) =>
  prepared(
    device,
    descriptor,
    (d) => buildRenderPipeline(device, d),
    (d) => device.createRenderPipeline(d),
  )

/** A compute pipeline prepared off the frame (`prepared`). */
export const preparedComputePipeline = (
  device: GPUDevice,
  descriptor: GPUComputePipelineDescriptor,
) =>
  prepared(
    device,
    descriptor,
    (d) => buildComputePipeline(device, d),
    (d) => device.createComputePipeline(d),
  )

/** The pipelines of one program, keyed by what decides each: `of(key)` is the one `make(key)`
 *  describes, made once and prepared like any other (`PreparedPipeline`); two keys of the same
 *  `id` are the same pipeline. */
export function preparedPipelines<K, P>(
  make: (key: K) => PreparedPipeline<P>,
  id: (key: K) => unknown = (key) => key,
) {
  const held = new Map<unknown, { key: K; pipeline: PreparedPipeline<P> }>()
  return {
    of(key: K) {
      let entry = held.get(id(key))
      if (!entry) held.set(id(key), (entry = { key, pipeline: make(key) }))
      return entry.pipeline
    },
    /** The keys made so far. */
    *keys() {
      for (const { key } of held.values()) yield key
    },
  }
}
export type PreparedPipelines<K, P> = ReturnType<typeof preparedPipelines<K, P>>

/** `pipeline`, its compile started now off the thread with nothing awaiting it (#1362) but
 *  prepare's end (`pipelinesSettled`): no frame is held on it, and a use before it lands compiles
 *  it at once. */
export function started<P>(pipeline: PreparedPipeline<P>) {
  pipeline.prepare().catch(() => undefined)
  return pipeline
}

/** A fullscreen-triangle pipeline on one bind group layout or one per group, at the targets given. */
export function makeFullscreenPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  bind: GPUBindGroupLayout | readonly GPUBindGroupLayout[],
  entryPoint: string,
  targets: GPUColorTargetState[],
) {
  return buildRenderPipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [bind].flat() }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint, targets },
    primitive: { topology: 'triangle-list' },
  })
}
