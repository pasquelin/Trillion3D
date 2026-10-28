// The engine's one way to a pipeline: compiled off the thread (`buildRenderPipeline`,
// `buildComputePipeline`) and, for one a frame binds, prepared before any frame needs it
// (`preparedPipeline`, `preparedComputePipeline`, by key in `../../gpu/core/preparedPipelines.ts`):
// asked at preparation or when what needs it enters the scene (`PreparedPipeline.ask`), it is
// waited for there — the frame is held on it (`pipelinesCompiling`,
// `../../frame/loop/deviceAnswer.ts`) — and a frame finds it compiled; one only started
// (`started`) holds no frame, and prepare's end waits for it. The deferred lighting and
// composition, the temporal resolve, the distortion and the blend stages build theirs here
// too; compute stages by entry point are built on it in `../../gpu/core/computeStages.ts`. The
// compiles in flight are held in `compileLedger.ts`.

import { madeChecked } from '../../gpu/core/errorScope.ts'
import { UNNAMED, framesOf, refuse, track } from './compileLedger.ts'

/** The frames a refused compile waits before a use asks it again (a device or a settings change
 *  makes new pipelines, which are asked at once). */
const RETRY_FRAMES = 240

/** Builds a render pipeline, asynchronously when the device offers it; else at the call, on a
 *  scope of its own (`madeChecked`), a refusal of the device rejecting the promise. */
export const buildRenderPipeline = (device: GPUDevice, descriptor: GPURenderPipelineDescriptor) =>
  device.createRenderPipelineAsync
    ? device.createRenderPipelineAsync(descriptor)
    : madeChecked(
        device,
        () => device.createRenderPipeline(descriptor),
        (pipeline) => Promise.resolve(pipeline),
      )

/** Builds a compute pipeline, asynchronously when the device offers it; else at the call, on a
 *  scope of its own (`madeChecked`), a refusal of the device rejecting the promise. */
export const buildComputePipeline = (
  device: GPUDevice,
  descriptor: GPUComputePipelineDescriptor,
) =>
  device.createComputePipelineAsync
    ? device.createComputePipelineAsync(descriptor)
    : madeChecked(
        device,
        () => device.createComputePipeline(descriptor),
        (pipeline) => Promise.resolve(pipeline),
      )

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
  /** The compiled pipeline, none while it compiles: a use before it landed never compiles it on the
   *  frame — one that nothing prepared nor asked is asked now (the frames wait for it), a refused
   *  one tried again off the thread once every `RETRY_FRAMES` frames —, and the draw that binds it
   *  is skipped meanwhile. A step that writes what a later one reads is not skipped alone: its
   *  chain is asked whole (`chainReady`). */
  get(): P | undefined
}

function prepared<D, P>(
  device: GPUDevice,
  descriptor: D,
  build: (d: D) => Promise<P>,
): PreparedPipeline<P> {
  let made: P | undefined,
    compiling: Promise<void> | undefined,
    refused = false,
    refusedAt = 0
  const label = (descriptor as { label?: string }).label ?? UNNAMED
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
            // Said once: a retry that is refused again is the same refusal.
            if (!refused) refuse(device, label)
            refused = true
            refusedAt = framesOf(device)
            throw error
          },
        )
        track(device, compiling, false, label)
      }
      return compiling
    },
    ask() {
      if (made === undefined && !refused) track(device, pipeline.prepare(), true, label)
      return pipeline
    },
    get ready() {
      return made !== undefined
    },
    get() {
      if (made !== undefined) return made
      if (!refused) pipeline.ask()
      else if (framesOf(device) - refusedAt >= RETRY_FRAMES) {
        refusedAt = framesOf(device)
        pipeline.prepare().catch(() => undefined)
      }
    },
  }
  return pipeline
}

/** A render pipeline prepared off the frame (`prepared`). */
export const preparedPipeline = (device: GPUDevice, descriptor: GPURenderPipelineDescriptor) =>
  prepared(device, descriptor, (d) => buildRenderPipeline(device, d))

/** A compute pipeline prepared off the frame (`prepared`). */
export const preparedComputePipeline = (
  device: GPUDevice,
  descriptor: GPUComputePipelineDescriptor,
) => prepared(device, descriptor, (d) => buildComputePipeline(device, d))

/** Whether every pipeline of a chain is compiled, each not yet asked now — the frames wait for
 *  them (`pipelinesCompiling`): a chain whose steps write what the next read runs none of them
 *  while one is missing, and leaves its outputs, history and flags as the last frame left them. */
export function chainReady(...chain: readonly (PreparedPipeline<unknown> | undefined)[]) {
  let ready = true
  for (const stage of chain)
    if (stage && !stage.ready) {
      stage.get()
      ready = false
    }
  return ready
}

/** `pipeline`, its compile started now off the thread with nothing awaiting it but
 *  prepare's end (`pipelinesSettled`): no frame is held on it, and a use before it lands asks it
 *  (`PreparedPipeline.get`). */
export function started<P>(pipeline: PreparedPipeline<P>) {
  pipeline.prepare().catch(() => undefined)
  return pipeline
}

type LayoutNode = { next: WeakMap<GPUBindGroupLayout, LayoutNode>; layout?: GPUPipelineLayout }
const layoutRoots = new WeakMap<GPUDevice, LayoutNode>()
/** The pipeline layout of the bind group layouts `bind`, group by group: made once for a list,
 *  shared by every pipeline on it. */
export function pipelineLayoutOf(device: GPUDevice, bind: readonly GPUBindGroupLayout[]) {
  let node: LayoutNode = layoutRoots.get(device) ?? { next: new WeakMap() }
  layoutRoots.set(device, node)
  for (const group of bind) {
    const child: LayoutNode = node.next.get(group) ?? { next: new WeakMap() }
    node.next.set(group, child)
    node = child
  }
  return (node.layout ??= device.createPipelineLayout({ bindGroupLayouts: [...bind] }))
}

/** The descriptor of a fullscreen-triangle pipeline on one bind group layout or one per group, at
 *  the targets given, named `label` when it is, its fragment program's override `constants` set
 *  when they are: the one every fullscreen pass is described by. */
export function fullscreenDescriptor(
  device: GPUDevice,
  module: GPUShaderModule,
  bind: GPUBindGroupLayout | readonly GPUBindGroupLayout[],
  entryPoint: string,
  targets: GPUColorTargetState[],
  label?: string,
  constants?: Record<string, number>,
): GPURenderPipelineDescriptor {
  return {
    ...(label !== undefined && { label }),
    layout: pipelineLayoutOf(device, [bind].flat()),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint, targets, ...(constants && { constants }) },
    primitive: { topology: 'triangle-list' },
  }
}

/** A fullscreen-triangle pipeline on one bind group layout or one per group, at the targets given. */
export function makeFullscreenPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  bind: GPUBindGroupLayout | readonly GPUBindGroupLayout[],
  entryPoint: string,
  targets: GPUColorTargetState[],
) {
  return buildRenderPipeline(
    device,
    fullscreenDescriptor(device, module, bind, entryPoint, targets),
  )
}
