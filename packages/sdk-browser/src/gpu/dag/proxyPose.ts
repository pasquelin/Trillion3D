/**
 * THE POSE OF THE DEFORMED PLACEMENTS' PROXIES, on the GPU (`bounce/runtimePoseWgsl.ts`): each frame a record
 * moved, the corners of every posed copy are moved by it and the copy's bounds fitted again by the engine's
 * one refit level loop (`treeRefitLevels.ts`), level by level from the deepest to the root. This module owns
 * the program, its small tables — one entry a pose, the (pose, node) pairs of each level
 * (`bounce/runtimePoseLevels.ts`), one parameter slot a level — and the dispatches; the proxy's buffer, its
 * layout and what each copy is belong to `proxyInstances.ts`.
 */
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import { PROXY_NODE_WORDS, PROXY_TRIANGLE_FLOATS } from '../../../../sdk-core/src/index.ts'
import { preparedComputePipeline, started } from '../../lighting/deferred/fullscreen.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { oncePerDevice } from '../core/oncePerDevice.ts'
import { heldBuffers } from '../core/heldBuffers.ts'
import { writeChanged } from '../core/writeChanged.ts'
import {
  computeBufferEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts'
import { poseLevels, poseSchedule } from '../../bounce/runtimePoseLevels.ts'
import {
  POSE_ENTRY,
  POSE_LANES,
  POSE_STEP_WORDS,
  POSE_WORDS,
  RUNTIME_POSE_SHADER,
} from '../../bounce/runtimePoseWgsl.ts'
import { createRefitLevels, type RefitLevels } from './treeRefitLevels.ts'
import { PROXY_POSE_PASS } from '../../stage/passLabels.ts'

/** Levels a fit serves at most: a wide tree of 16384 triangles is under a dozen deep. */
const MAX_LEVELS = 32
/** The usage of the pose buffers, read when a buffer is made: the module loads without a GPU. */
const storage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST

/** A pose: the copy of a mesh's proxy that stands at the pose of one placement. */
export type PoseEntry = {
  /** The mesh's rest proxy, and where it lies in the arena. */
  cut: RuntimeCutProxy
  restTriangle: number
  posedTriangle: number
  posedNode: number
  /** The first word of the mesh's corner table, among the proxy's words past its header. */
  corners: number
  /** The placement's record in the float pool plus one, or zero. */
  record: number
}

/** The pose's program on a device: its layout and its two kernels, compiled off the frame. */
const posePrograms = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'storage'),
      computeBufferEntry(1, 'read-only-storage'),
      computeBufferEntry(2, 'read-only-storage'),
      computeBufferEntry(3, 'read-only-storage'),
      computeUniformEntry(4, { hasDynamicOffset: true, minBindingSize: POSE_STEP_WORDS * 4 }),
    ],
  })
  const module = device.createShaderModule({ label: PROXY_POSE_PASS, code: RUNTIME_POSE_SHADER })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const kernel = (entryPoint: string) =>
    started(
      preparedComputePipeline(device, {
        label: PROXY_POSE_PASS,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      }),
    )
  return { layout, corners: kernel('poseCorners'), fit: kernel('fitNodes') }
})

export function createProxyPose(device: GPUDevice) {
  // Its own hold: the buffers are this pose's, grown by the engine's one grower.
  const held = heldBuffers()
  const levelsOf = new Map<RuntimeCutProxy, Uint32Array[]>()
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  // Made with the first pose, as the other buffers are: a scene with no deformed placement holds none.
  let steps: RefitLevels | undefined
  let table = new Uint32Array(0),
    poses: GPUBuffer | undefined,
    ids: GPUBuffer | undefined,
    idsSent: GPUBuffer | undefined,
    laid = NaN,
    schedule = poseSchedule([]),
    corners = 0
  const extra = new Uint32Array(1)

  /** A mesh's node levels, found the first time a pose wears it. */
  function levelsOfCut(cut: RuntimeCutProxy) {
    let levels = levelsOf.get(cut)
    if (!levels) levelsOf.set(cut, (levels = poseLevels(cut.nodeChildren)))
    return levels
  }

  /** The poses' levels and their largest corner count, laid again when the poses did (`layout`). */
  function lay(entries: readonly PoseEntry[], layout: number) {
    if (layout === laid) return
    laid = layout
    schedule = poseSchedule(entries.map((entry) => levelsOfCut(entry.cut)))
    if (schedule.depth > MAX_LEVELS) throw new Error('PROXY_POSE_LEVELS')
    corners = 0
    for (const entry of entries)
      corners = Math.max(corners, (entry.cut.triangles.length / PROXY_TRIANGLE_FLOATS) * 3)
    ids = held.grow(
      device,
      'Trillion3D proxy pose levels',
      Math.max(16, schedule.ids.byteLength),
      storage(),
    )
    idsSent = undefined
  }

  return {
    /**
     * Poses `entries` in `encoder`: the corners moved by the records, the bounds fitted again. `layout`
     * moves when the poses or where they lie did. Whether it was encoded — the program is built off the
     * thread and answers some frames after the first ask.
     */
    run(
      encoder: GPUCommandEncoder,
      arena: GPUBuffer,
      pool: GPUBuffer,
      entries: readonly PoseEntry[],
      layout: number,
    ) {
      const program = posePrograms(device)
      if (!program.corners.ready || !program.fit.ready || !entries.length) return false
      lay(entries, layout)
      if (table.length !== entries.length * POSE_WORDS)
        table = new Uint32Array(entries.length * POSE_WORDS)
      entries.forEach((entry, k) => {
        const at = k * POSE_WORDS
        table[at + POSE_ENTRY.rest] = entry.restTriangle
        table[at + POSE_ENTRY.posed] = entry.posedTriangle
        table[at + POSE_ENTRY.triangles] = entry.cut.triangles.length / PROXY_TRIANGLE_FLOATS
        table[at + POSE_ENTRY.node] = entry.posedNode
        table[at + POSE_ENTRY.nodes] = entry.cut.nodeChildren.length / PROXY_NODE_WORDS
        table[at + POSE_ENTRY.corners] = entry.corners
        table[at + POSE_ENTRY.record] = entry.record
      })
      poses = held.grow(
        device,
        'Trillion3D proxy pose entries',
        Math.max(16, table.byteLength),
        storage(),
      )
      writeChanged(device, poses, table, 0, table.length)
      if (idsSent !== ids) {
        device.queue.writeBuffer(ids!, 0, schedule.ids)
        idsSent = ids
      }
      steps ??= createRefitLevels(
        device,
        'Trillion3D proxy pose steps',
        MAX_LEVELS,
        POSE_STEP_WORDS,
      )
      extra[0] = entries.length
      for (let step = 0; step < schedule.depth; step++) {
        const first = schedule.starts[step]
        steps.set(step, first, schedule.starts[step + 1] - first, extra)
      }
      const { next } = identity
      next[0] = program.layout
      next[1] = arena
      next[2] = pool
      next[3] = poses
      next[4] = ids
      next.length = 5
      if (identity.moved() || !group)
        group = device.createBindGroup({
          layout: program.layout,
          entries: sequentialEntries([
            { buffer: arena },
            { buffer: pool },
            { buffer: poses },
            { buffer: ids! },
            { buffer: steps.params, size: POSE_STEP_WORDS * 4 },
          ]),
        })
      const bound = group,
        { slots } = steps
      const pass = encoder.beginComputePass({ label: PROXY_POSE_PASS })
      pass.setPipeline(program.corners.get())
      pass.setBindGroup(0, bound, slots.offset(0))
      pass.dispatchWorkgroups(ceilDiv(corners, POSE_LANES), entries.length)
      // The deepest level first: a node reads its children's bounds, which the level below fitted.
      pass.setPipeline(program.fit.get())
      steps.encode(pass, schedule.depth, (open, step) =>
        open.setBindGroup(0, bound, slots.offset(step)),
      )
      pass.end()
      return true
    },
    dispose() {
      steps?.dispose()
      poses?.destroy()
      ids?.destroy()
    },
  }
}
