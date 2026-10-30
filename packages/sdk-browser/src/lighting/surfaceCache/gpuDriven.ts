import { ceilDiv, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { CardLimits } from '../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import {
  GROUP_WORDS,
  MAX_SCENE_ADD_OPS,
  MAX_SCENE_REMOVE_OPS,
  writeGroupWords,
  type SceneOps,
} from '../../../../sdk-core/src/lighting/surfaceCache/gpuDriven.ts'
import type { SurfaceCache } from '../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import { SURFACE_CACHE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { uniformBlock } from '../../gpu/core/uniformBlock.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { createKernel } from './kernel.ts'
import {
  SCENE_UPDATE_BINDINGS as B,
  SCENE_UPDATE_ENTRY,
  SCENE_UPDATE_EYES,
  SCENE_UPDATE_PARAM_BYTES,
  SCENE_UPDATE_WGSL,
} from './gpuDrivenWgsl.ts'

/**
 * THE GPU'S UPDATE OF THE SCENE, on the device (`surfaceCacheGpuDrivenUpdate`, `gpuDrivenWgsl.ts`): the table of the placements
 * the pass reads (`GROUP_WORDS` words each, kept by the placement's number and written again only for the placements the cache
 * listed as changed, `cache.changes.groups`), the pass over it — the lists cleared, the placements tested, both lists copied to
 * a buffer of the ring —, and the read-back of the lists. No image waits: a copy maps when its image is submitted — the next
 * image's `begin` says it is —, and `begin` gives the newest lists that came back, once, for the cache's update to apply
 * (`applySceneOps`). Where all the buffers of the ring are in flight, the image runs no pass, as the reference's does not.
 */

/** Copies in flight at once. */
const IN_FLIGHT = 4

const ADD_BYTES = MAX_SCENE_ADD_OPS * 8
const REMOVE_BYTES = MAX_SCENE_REMOVE_OPS * 4

/** The records of the table at least. */
const LEAST_RECORDS = 64

const LABEL = 'Trillion3D surface cache scene update'

const storage = (device: GPUDevice, label: string, bytes: number, usage: number) =>
  device.createBuffer({
    label: `${LABEL} ${label}`,
    size: bytes,
    usage: GPUBufferUsage.STORAGE | usage,
  })

/** The surface cache's update decided by the GPU, on `device`. */
export function createGpuDrivenUpdate(device: GPUDevice) {
  const kernel = createKernel(
    device,
    'scene update',
    SCENE_UPDATE_WGSL,
    [SCENE_UPDATE_ENTRY],
    [
      computeBufferEntry(B.groups, 'read-only-storage'),
      computeBufferEntry(B.addOps, 'storage'),
      computeBufferEntry(B.removeOps, 'storage'),
    ],
    { parameterBytes: SCENE_UPDATE_PARAM_BYTES },
  )
  const params = uniformBlock(device, `${LABEL} parameters`, SCENE_UPDATE_PARAM_BYTES)
  const { u: paramU32, f: paramF32 } = params.words
  const copyOps = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  const addOps = storage(device, 'add ops', ADD_BYTES, copyOps)
  const removeOps = storage(device, 'remove ops', REMOVE_BYTES, copyOps)
  let latest: SceneOps | undefined
  /** Counts the times the update was reset: a copy taken before the last reset is forgotten when it maps. */
  let generation = 0
  const ring = createReadbackRing<number>(
    device,
    { label: `${LABEL} readback`, bytes: ADD_BYTES + REMOVE_BYTES, count: IN_FLIGHT },
    (mapped, _staging, taken) => {
      if (taken !== generation) return
      latest = {
        add: new Uint32Array(mapped.slice(0, ADD_BYTES)),
        remove: new Uint32Array(mapped.slice(ADD_BYTES, ADD_BYTES + REMOVE_BYTES)),
      }
    },
  )
  let table: GPUBuffer | undefined
  let words = new Uint32Array(0)
  let floats = new Float32Array(0)
  /** The records in use, and whether the table is written whole at the next sync. */
  let count = 0
  let fresh = true
  /** The images left before the lists are quiet: those a change of the table is followed by (the operations applied are changes of it). */
  let settling = 0

  /** The table made large enough for `wanted` records, written whole at the next sync where it grew. */
  function room(wanted: number) {
    const records = Math.max(LEAST_RECORDS, nextPow2(wanted))
    const made = sizedBuffer(
      device,
      table,
      records * GROUP_WORDS * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      `${LABEL} groups`,
    )
    if (made === table) return
    table = made
    words = resized(words, table.size / 4)
    floats = new Float32Array(words.buffer)
    fresh = true
  }

  /** The records of the placements the cache listed as changed written to the table, all of them where the table is new. */
  function sync(cache: SurfaceCache) {
    const { groups } = cache.changes
    let wanted = count
    for (let at = 0; at < groups.count; at++) wanted = Math.max(wanted, groups.list[at]! + 1)
    if (fresh) for (const id of cache.placements.keys()) wanted = Math.max(wanted, id + 1)
    room(wanted)
    count = wanted
    if (!table || (!fresh && !groups.count)) return
    const write = (id: number) =>
      writeGroupWords(floats, words, id * GROUP_WORDS, cache.placements.get(id))
    if (fresh) {
      words.fill(0)
      for (const id of cache.placements.keys()) write(id)
      device.queue.writeBuffer(table, 0, words, 0, count * GROUP_WORDS)
      fresh = false
    } else {
      const ids = Int32Array.from(groups.list.subarray(0, groups.count)).sort()
      for (let from = 0; from < ids.length;) {
        // A run of consecutive placements goes up in one write.
        let last = from
        while (last + 1 < ids.length && ids[last + 1] === ids[last]! + 1) last++
        for (let k = from; k <= last; k++) write(ids[k]!)
        device.queue.writeBuffer(
          table,
          ids[from]! * GROUP_WORDS * 4,
          words,
          ids[from]! * GROUP_WORDS,
          (last - from + 1) * GROUP_WORDS,
        )
        from = last + 1
      }
    }
    groups.clear()
    settling = IN_FLIGHT + 1
  }

  return {
    /** Whether the pass is compiled. */
    get ready() {
      return kernel.ready
    },
    /** Whether the lists are not quiet yet: the frame is not held while they are. */
    get settling() {
      return settling > 0
    },
    /** After the copy of the image before was submitted: it maps. The newest lists that came back, once. */
    begin(): SceneOps | undefined {
      ring.submitted()
      if (settling > 0) settling--
      const ops = latest
      latest = undefined
      return ops
    },
    /** The table brought level with `cache`, then on `encoder` the lists cleared, the placements tested against `origins`
     *  under `limits`, and the lists copied to the ring. */
    encode(
      encoder: GPUCommandEncoder,
      cache: SurfaceCache,
      origins: readonly (readonly number[])[],
      limits: CardLimits,
      addTranslucent = false,
    ) {
      sync(cache)
      if (!table || !count || !kernel.ready) return
      const staging = ring.take(generation, ADD_BYTES + REMOVE_BYTES)
      if (!staging) return
      const eyes = Math.min(origins.length, SCENE_UPDATE_EYES)
      paramU32[0] = count
      paramU32[1] = MAX_SCENE_ADD_OPS
      paramU32[2] = MAX_SCENE_REMOVE_OPS
      paramU32[3] = eyes
      paramF32[4] = limits.maxDistance * limits.maxDistance
      paramF32[5] = limits.texelDensity
      paramF32[6] = limits.minResolution
      paramU32[7] = addTranslucent ? 1 : 0
      for (let k = 0; k < eyes; k++) paramF32.set(origins[k]!.slice(0, 3), 8 + 4 * k)
      params.send()
      encoder.clearBuffer(addOps)
      encoder.clearBuffer(removeOps)
      const group = kernel.group([table, addOps, removeOps], () => [
        { binding: 0, resource: { buffer: params.buffer } },
        { binding: B.groups, resource: { buffer: table! } },
        { binding: B.addOps, resource: { buffer: addOps } },
        { binding: B.removeOps, resource: { buffer: removeOps } },
      ])
      const pass = encoder.beginComputePass({ label: SURFACE_CACHE_PASS })
      pass.setPipeline(kernel.pipeline(SCENE_UPDATE_ENTRY))
      pass.setBindGroup(0, group)
      dispatchRows(pass, ceilDiv(count, WORKGROUP_THREADS))
      pass.end()
      encoder.copyBufferToBuffer(addOps, 0, staging, 0, ADD_BYTES)
      encoder.copyBufferToBuffer(removeOps, 0, staging, ADD_BYTES, REMOVE_BYTES)
    },
    /** The cache is not asked to be GPU-driven, or is made again: the table is written whole when it is next asked, the lists in flight forgotten. */
    reset() {
      ring.submitted()
      generation++
      fresh = true
      count = 0
      settling = 0
      latest = undefined
    },
    dispose() {
      ring.destroy()
      params.buffer.destroy()
      addOps.destroy()
      removeOps.destroy()
      table?.destroy()
      table = undefined
    },
  }
}

/** The surface cache's GPU-driven update (`createGpuDrivenUpdate`). */
export type GpuDrivenUpdate = ReturnType<typeof createGpuDrivenUpdate>
