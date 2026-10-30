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

import { createDeferred } from '../../../../sdk-core/src/runtime/deferred.ts'
import { isPipelineError, madeChecked } from '../../gpu/core/errorScope.ts'
import { backoffMs } from '../../gpu/core/backoff.ts'
import { deviceLost } from '../../gpu/core/deviceOwners.ts'
import { pipelineLabel, refuse, retryAfter, retryLanded, track } from './compileLedger.ts'

/** Whether a refusal of a compile is final: a lost device is (`deviceLost`, checked where it is read); of the rest only what may pass is tried again — a pipeline the device failed to make for no fault of its own (`GPUPipelineError` that is not `validation`: the error scope reports it `internal`, `madeChecked`) and a `DOMException` (a scope popped out of turn, a device lost mid-compile). A validation refusal (the shader, entry point, layout or limits: the same answer each time), a creation the device cannot start (a missing feature: `TypeError`) and any other class (a `ReferenceError`, a `RangeError`, a plain `Error`: a programming bug) are refused for good, whether the creation rejects or throws at the call (a call inside an async function turns a throw into a rejection). */
const refusedForGood = (error: unknown) =>
  isPipelineError(error) ? error.reason === 'validation' : !(error instanceof DOMException)

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
   *  scene, the next frame binds it. A refused compile is not waited for: it is tried again, no frame held, once its wait is over. */
  ask(): PreparedPipeline<P>
  /** Compiles it off the thread once, no frame waiting for it (a candidate compiled ahead of the pass that will bind it): nothing once it is made or in flight; a refused compile is tried again once its wait is over, by its timer (`retryAfter`) while the pipeline is still referenced. */
  start(): PreparedPipeline<P>
  /** Whether it is compiled: a pure read, it starts nothing. */
  readonly ready: boolean
  /** Whether its compile is in flight: neither compiled nor refused. */
  readonly pending: boolean
  /** Whether its compile was refused and it has not landed since: a retry may be in flight or waiting (`unavailable` says there is none). */
  readonly refused: boolean
  /** Whether the device refused its compile for good (`refusedForGood`): it will never be compiled. */
  readonly unavailable: boolean
  /** The compiled pipeline, none while it compiles: a use before it landed never compiles it on the
   *  frame — one that nothing prepared nor asked is asked now (the frames wait for it), a refused
   *  one left to its retry timer —, and the draw that binds it
   *  is skipped meanwhile. A step that writes what a later one reads is not skipped alone: its
   *  chain is asked whole (`chainReady`). */
  get(): P | undefined
}

/** What settles a retry nobody names any more (`retryAfter`): the refusal it waited out. Made apart from the pipeline's scope, so as to hold neither it nor its state. */
const refusedWith = (wait: ReturnType<typeof createDeferred<void>>, error: unknown) => () =>
  wait.reject(error)

function prepared<D, P>(
  device: GPUDevice,
  descriptor: D,
  build: (d: D) => Promise<P>,
): PreparedPipeline<P> {
  let made: P | undefined,
    compiling: Promise<void> | undefined,
    refused = false,
    refusals = 0,
    final = false,
    refusal: unknown,
    /** Whether a refusal that is not final is still within its wait (its retry is scheduled, `retryAfter`; the wait is the backoff's, `backoffMs`); no compile starts meanwhile. */
    waiting = false,
    /** What a `prepare` asked within the wait of a refused compile holds: the settling of the retry that is scheduled, made with the refusal. It is not followed in the ledger: preparation goes on with the stand-in meanwhile (`pipelinesSettled`), only the caller waits. */
    retryWait: ReturnType<typeof createDeferred<void>> | undefined
  const label = pipelineLabel(descriptor as object)
  /** Whether the compile is refused for good: by its error, or because its device was lost (read at each use, as the loss may be heard after the refusal). */
  const isFinal = () => (final ||= refused && made === undefined && deviceLost(device))
  /** A refused compile tried again off the thread, no frame waiting for it, once its wait is over; never one the device refused for good. Called by the retry's timer: reading `ready` starts nothing. */
  const retryRefused = () => {
    waiting = false
    if (!refused || compiling || made !== undefined) return
    if (isFinal()) {
      retryWait?.reject(refusal)
      retryWait = undefined
    } else pipeline.prepare().catch(() => undefined)
  }
  const pipeline: PreparedPipeline<P> = {
    // One compile in flight, every asker sharing it; a build that throws at once — a device
    // without the stage — is a compile refused like a rejected one (`refusedForGood`).
    prepare() {
      if (made !== undefined) return Promise.resolve()
      // Refused for good: no build, the refusal again. Within the wait of a refusal that may pass: no build either, and no stale refusal — the asker waits for the retry scheduled by the timer, which lands or is refused anew.
      if (isFinal()) return Promise.reject(refusal)
      if (!compiling && waiting) {
        // Not held, nor followed in the ledger: the frames wait for no retry, and preparation does not wait for it; the caller does.
        return retryWait!.promise
      }
      if (!compiling) {
        let building: Promise<P>
        try {
          building = build(descriptor)
        } catch (error) {
          building = Promise.reject(error)
        }
        compiling = building.then(
          (built) => {
            made ??= built
            // A pipeline that landed after a refusal: the view lent a stand-in meanwhile and may be at rest.
            if (refused) retryLanded(device)
          },
          (error: unknown) => {
            compiling = undefined
            // Said once: a retry that is refused again is the same refusal.
            if (!refused) refuse(device, label)
            refused = true
            refusals++
            refusal = error
            if (refusedForGood(error) || deviceLost(device)) final = true
            else {
              waiting = true
              retryWait = createDeferred<void>()
              // The asker handles it; a settling nobody holds is no unhandled rejection.
              retryWait.promise.catch(() => undefined)
              retryAfter(retryRefused, backoffMs(refusals), refusedWith(retryWait, error))
            }
            throw error
          },
        )
        track(device, compiling, false, label)
        if (retryWait) {
          compiling.then(retryWait.resolve, retryWait.reject)
          retryWait = undefined
        }
      }
      return compiling
    },
    start() {
      if (made === undefined && compiling === undefined && !refused)
        pipeline.prepare().catch(() => undefined)
      return pipeline
    },
    ask() {
      if (made === undefined && !refused) track(device, pipeline.prepare(), true, label)
      return pipeline
    },
    get ready() {
      return made !== undefined
    },
    get pending() {
      return made === undefined && compiling !== undefined
    },
    get refused() {
      return refused && made === undefined
    },
    get unavailable() {
      return isFinal()
    },
    get() {
      if (made !== undefined) return made
      pipeline.ask()
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

/** Whether every pipeline of a chain is compiled, each started now where it was not (`PreparedPipeline.start`) and none asked: no frame waits for it. The chain a pass will bind later, compiled ahead of it. */
export function chainCompiled(...chain: readonly (PreparedPipeline<unknown> | undefined)[]) {
  let ready = true
  for (const stage of chain) if (stage && !stage.start().ready) ready = false
  return ready
}

/** Whether the compile of any pipeline of a chain is in flight. */
export const chainPending = (...chain: readonly (PreparedPipeline<unknown> | undefined)[]) =>
  chain.some((stage) => stage?.pending)

/** `pipeline`, its compile started now off the thread with nothing awaiting it but
 *  prepare's end (`pipelinesSettled`): no frame is held on it, and a use before it lands asks it
 *  (`PreparedPipeline.get`). */
export const started = <P>(pipeline: PreparedPipeline<P>) => pipeline.start()

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

/** A fullscreen pass's colour target named `label`, cleared before the first draw writes every pixel of it; its view is set at each draw. */
export function clearedColourTarget(label: string) {
  const target: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  }
  const descriptor: GPURenderPassDescriptor = { label, colorAttachments: [target] }
  return { target, descriptor }
}
