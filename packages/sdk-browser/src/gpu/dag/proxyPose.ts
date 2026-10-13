/**
 * THE POSE OF THE DEFORMED PLACEMENTS' PROXIES, on the GPU (`bounce/runtimePoseWgsl.ts`): each frame a record
 * moved, the corners of every posed copy are moved by it and the copy's bounds fitted again, level by level
 * from the deepest to the root. This module owns the program, its small tables — one entry a pose, the node
 * levels of each mesh (`bounce/runtimePoseLevels.ts`), one parameter block a level — and the dispatches; the
 * proxy's buffer, its layout and what each copy is belong to `proxyInstances.ts`.
 */
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import { createCheckedShaderModule } from '../core/shaderModule.ts'
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { nodeLevels } from '../../bounce/runtimePoseLevels.ts'
import { POSE_LANES, POSE_WORDS, RUNTIME_POSE_SHADER } from '../../bounce/runtimePoseWgsl.ts'
import { PROXY_POSE_PASS } from '../../stage/passLabels.ts'

/** Levels a fit serves at most: a wide tree of 16384 triangles is under a dozen deep. */
const MAX_LEVELS = 32
/** Bytes between two levels' parameters: a uniform offset's alignment. */
const PARAM_STRIDE = 256

/** A pose: the copy of a mesh's proxy that stands at the pose of one placement. */
export type PoseEntry = {
  /** The mesh's rest proxy, and where it lies in the arena. */
  cut: RuntimeCutProxy
  restTriangle: number
  posedTriangle: number
  posedNode: number
  /** The first word of the mesh's corner table, in the proxy's buffer (the header counted). */
  corners: number
  /** The placement's record in the float pool plus one, or zero. */
  record: number
}

export function createProxyPose(device: GPUDevice) {
  let program:
    { corners: GPUComputePipeline; fit: GPUComputePipeline; layout: GPUBindGroupLayout } | undefined
  let building = false
  const orders = new Map<RuntimeCutProxy, number>()
  let orderWords = new Uint32Array(0)
  let orderBuffer: GPUBuffer | undefined
  let orderSent = 0
  let poseBuffer: GPUBuffer | undefined
  let poseCapacity = 0
  const params = device.createBuffer({
    label: 'Trillion3D proxy pose steps',
    size: MAX_LEVELS * PARAM_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const groups = new Map<string, { key: unknown[]; group: GPUBindGroup }>()

  /** The program, built the first time a pose is asked and ready some frames after. */
  function ready() {
    if (program) return program
    if (building) return undefined
    building = true
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 },
        },
      ],
    })
    void (async () => {
      const module = await createCheckedShaderModule(device, RUNTIME_POSE_SHADER, 'PROXY_POSE')
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
      const [corners, fit] = await Promise.all([
        buildComputePipeline(device, {
          layout: pipelineLayout,
          compute: { module, entryPoint: 'poseCorners' },
        }),
        buildComputePipeline(device, {
          layout: pipelineLayout,
          compute: { module, entryPoint: 'fitNodes' },
        }),
      ])
      program = { corners, fit, layout }
    })()
    return undefined
  }

  /** Where a mesh's node levels lie among the order words, appended the first time. */
  function orderOf(cut: RuntimeCutProxy) {
    let at = orders.get(cut)
    if (at !== undefined) return at
    const levels = nodeLevels(cut.nodeChildren)
    at = orderWords.length
    const grown = new Uint32Array(at + levels.length)
    grown.set(orderWords)
    grown.set(levels, at)
    orderWords = grown
    orders.set(cut, at)
    return at
  }

  /** `buffer` grown to hold `bytes`, made again when it cannot. */
  function sized(buffer: GPUBuffer | undefined, bytes: number, label: string) {
    if (buffer && buffer.size >= bytes) return buffer
    buffer?.destroy()
    return device.createBuffer({
      label,
      size: Math.max(256, 2 * bytes),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }

  return {
    /**
     * Poses `entries` in `encoder`: the corners moved by the records, the bounds fitted again. Whether it was
     * encoded — the program is built off the thread and answers some frames after the first ask.
     */
    run(
      encoder: GPUCommandEncoder,
      arena: GPUBuffer,
      pool: GPUBuffer,
      entries: readonly PoseEntry[],
    ) {
      const built = ready()
      if (!built || !entries.length) return false
      const table = new Uint32Array(entries.length * POSE_WORDS)
      let corners = 0,
        nodes = 0,
        levels = 0
      entries.forEach((entry, k) => {
        const triangles = entry.cut.triangles.length / 9,
          count = entry.cut.nodeChildren.length / 12
        const place = orderOf(entry.cut)
        table.set(
          [
            entry.restTriangle,
            entry.posedTriangle,
            triangles,
            entry.posedNode,
            count,
            entry.corners,
            place,
            entry.record,
          ],
          k * POSE_WORDS,
        )
        corners = Math.max(corners, triangles * 3)
        nodes = Math.max(nodes, count)
        levels = Math.max(levels, orderWords[place])
      })
      if (levels > MAX_LEVELS) throw new Error('PROXY_POSE_LEVELS')
      poseBuffer = sized(poseBuffer, table.byteLength, 'Trillion3D proxy pose entries')
      device.queue.writeBuffer(poseBuffer, 0, table)
      if (orderSent !== orderWords.length || !orderBuffer) {
        orderBuffer = sized(orderBuffer, orderWords.byteLength, 'Trillion3D proxy pose levels')
        device.queue.writeBuffer(orderBuffer, 0, orderWords)
        orderSent = orderWords.length
      }
      for (let level = 0; level < levels; level++)
        device.queue.writeBuffer(
          params,
          level * PARAM_STRIDE,
          Uint32Array.of(level, entries.length, 0, 0),
        )
      const key = [arena, pool, poseBuffer, orderBuffer]
      let held = groups.get('pose')
      if (!held || held.key.some((resource, k) => resource !== key[k])) {
        held = {
          key,
          group: device.createBindGroup({
            layout: built.layout,
            entries: [
              { binding: 0, resource: { buffer: arena } },
              { binding: 1, resource: { buffer: pool } },
              { binding: 2, resource: { buffer: poseBuffer } },
              { binding: 3, resource: { buffer: orderBuffer } },
              { binding: 4, resource: { buffer: params, size: 16 } },
            ],
          }),
        }
        groups.set('pose', held)
      }
      const pass = encoder.beginComputePass({ label: PROXY_POSE_PASS })
      pass.setPipeline(built.corners)
      pass.setBindGroup(0, held.group, [0])
      pass.dispatchWorkgroups(ceilDiv(corners, POSE_LANES), entries.length)
      pass.setPipeline(built.fit)
      // The deepest level first: a node reads its children's bounds, which the level below fitted.
      for (let level = levels - 1; level >= 0; level--) {
        pass.setBindGroup(0, held.group, [level * PARAM_STRIDE])
        pass.dispatchWorkgroups(ceilDiv(nodes, POSE_LANES), entries.length)
      }
      pass.end()
      return true
    },
    dispose() {
      params.destroy()
      poseBuffer?.destroy()
      orderBuffer?.destroy()
    },
  }
}
export type ProxyPose = ReturnType<typeof createProxyPose>
