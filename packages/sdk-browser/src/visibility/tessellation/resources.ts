import type { DisplacementRecords } from '../../materials/table/displacementRecord.ts'
import { HIZ_LEVELS } from '../hiz/gpu/pyramidTexture.ts'
import { PASS_ARG_WORDS, PASS_DISPATCH_WORDS, PATCH_WORDS, TABLE_DATA_WORD } from './contract.ts'
import { buildTessellationTable } from './table/build.ts'
import {
  TESS_CHAINS,
  TESS_UNIFORM_BYTES,
  fitCapacity,
  tessLayout,
  type TessellationCapacity,
} from './uniform.ts'

/** The table, built the first time a displaced surface is drawn and kept for the session. */
let table: ReturnType<typeof buildTessellationTable> | undefined

/**
 * The tessellation's buffers, made once a frame draws a displaced surface and given back when none
 * is: `tess`, the table, the displaced surfaces' records, each chain's state, the splitting queue
 * and the visible lists in the one storage buffer (`tessLayout`) — the table written once, the
 * records when the table's version moves (`follow`), the rest by the passes —; `dispatch`, the
 * workgroups the levels and the dicing are launched with, a buffer only the arguments' kernels write
 * and only the dispatches read; a uniform for each pass of the cut (`uniform.ts`); the buffer that
 * keeps the patches the main pass's occlusion test hid for the post pass (`occluded`), a stand-in
 * of a patch's size until a pass tests against a pyramid, then as large as the queue; and what the
 * splitting binds where there is no pyramid to test against (`standIn`). `asked` is the capacity
 * the settings name, the buffer's what the device lets it be (`fitCapacity`).
 */
/** What a pass that tests no pyramid binds: a texel and a levels uniform that holds no level, which
 *  `pyramidShows` answers as it answers a level past the pyramid's. */
function standInPyramid(device: GPUDevice) {
  const texture = device.createTexture({
    label: 'Trillion3D tessellation stand-in pyramid',
    size: [1, 1, 1],
    format: 'r32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const levels = device.createBuffer({
    label: 'Trillion3D tessellation stand-in levels',
    size: HIZ_LEVELS.words * 4,
    usage: GPUBufferUsage.UNIFORM,
  })
  return {
    pyramid: texture.createView({ dimension: '2d-array' }),
    levels,
    dispose() {
      levels.destroy()
      texture.destroy()
    },
  }
}

/** A uniform for each chain of the tessellation. */
const chainUniforms = (device: GPUDevice) =>
  Array.from({ length: TESS_CHAINS }, () =>
    device.createBuffer({
      label: 'Trillion3D tessellation uniform',
      size: TESS_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  )

/** The buffer that keeps the patches the main pass's occlusion test hid for the post pass: a
 *  stand-in of a patch's size until a pass tests against a pyramid (`keep`), then as large as the
 *  queue's `capacity`. */
function occludedStore(device: GPUDevice, capacity: number) {
  const make = (patches: number) =>
    device.createBuffer({
      label: 'Trillion3D tessellation occluded patches',
      size: patches * PATCH_WORDS * 4,
      usage: GPUBufferUsage.STORAGE,
    })
  let buffer = make(1),
    patches = 0
  return {
    get buffer() {
      return buffer
    },
    /** The patches `buffer` holds: none until a pass keeps them. */
    get patches() {
      return patches
    },
    keep() {
      if (patches) return
      buffer.destroy()
      buffer = make((patches = capacity))
    },
  }
}

/**
 * The tessellation's buffers, made once a frame draws a displaced surface and given back when none
 * is: `tess`, the table, the displaced surfaces' records, each chain's state, the splitting queue
 * and the visible lists in the one storage buffer (`tessLayout`) — the table written once, the
 * records when the table's version moves (`follow`), the rest by the passes —; `dispatch`, the
 * workgroups the levels and the dicing are launched with, a buffer only the arguments' kernels write
 * and only the dispatches read; a uniform for each chain (`uniform.ts`); the patches the main pass's
 * occlusion test hid (`occluded`); and what the splitting binds where there is no pyramid to test
 * against (`standIn`). `asked` is the capacity the settings name, the buffer's what the device lets
 * it be (`fitCapacity`).
 */
export function createTessellationResources(device: GPUDevice, asked: TessellationCapacity) {
  table ??= buildTessellationTable()
  const tableWords = TABLE_DATA_WORD + table.data.length
  const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
  const capacity = fitCapacity(limit, tableWords, asked)
  const layout = tessLayout(tableWords, capacity.records, capacity.candidate, capacity.visible)
  const tess = device.createBuffer({
    label: 'Trillion3D tessellation',
    size: layout.words * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(tess, 0, table.offsets)
  device.queue.writeBuffer(tess, TABLE_DATA_WORD * 4, table.data)
  const dispatch = device.createBuffer({
    label: 'Trillion3D tessellation dispatch',
    size: TESS_CHAINS * PASS_DISPATCH_WORDS * 4,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const standIn = standInPyramid(device),
    occluded = occludedStore(device, capacity.candidate)
  const uniforms = chainUniforms(device)
  let recordsVersion = -1
  return {
    capacity,
    layout,
    tess,
    dispatch,
    uniforms,
    standIn,
    /** The patches the post pass takes up that the main pass hid. */
    get occluded() {
      return occluded.buffer
    },
    /** The patches `occluded` holds: none until a pass keeps them. */
    get maxOccluded() {
      return occluded.patches
    },
    /** Makes `occluded` as large as the queue, the first time a pass tests against a pyramid. */
    keepOccluded: occluded.keep,
    /** Sends the displaced surfaces' records again when the table's version moved; they fit the room
     *  the capacity names (`recordRoom`, which a held instance is made again over). */
    follow(records: Pick<DisplacementRecords, 'ints' | 'version'>) {
      if (recordsVersion === records.version) return
      const words = Math.min(records.ints.length, capacity.records)
      device.queue.writeBuffer(tess, layout.disp * 4, records.ints, 0, words)
      recordsVersion = records.version
    },
    /** The bytes of the arguments of `chain`, which the chain's seeding clears. */
    argsRange: (chain: number) => [layout.args[chain]! * 4, PASS_ARG_WORDS * 4] as const,
    dispose() {
      tess.destroy()
      dispatch.destroy()
      for (const uniform of uniforms) uniform.destroy()
      occluded.buffer.destroy()
      standIn.dispose()
    },
  }
}
export type TessellationResources = ReturnType<typeof createTessellationResources>
