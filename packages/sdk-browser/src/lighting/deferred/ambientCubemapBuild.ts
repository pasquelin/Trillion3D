import { ceilDiv, mipSize } from '../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import {
  AMBIENT_CUBEMAP_FACE_PERM,
  AMBIENT_CUBEMAP_FACE_SIGN,
  ambientCubemapLevelCone,
} from '../../../../sdk-core/src/lighting/ambientCubemapMips.ts'
import { cubemapMipCount } from '../../../../sdk-core/src/scene/core/fogCubemap.ts'
import type { SkyLightCubemap } from '../../../../sdk-core/src/modules/sky/skyLightCubemap.ts'
import { uploadCubeFloats } from '../../modules/sky/skyLight/cubeFloatUpload.ts'
import { CUBE_FACES } from '../../modules/sky/skyLight/layout.ts'
import {
  COMPUTE,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../gpu/core/computeStages.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { arrayLevelView } from '../../gpu/core/textureViews.ts'
import { uniformStride } from '../../session/memory/pools.ts'
import {
  CUBE_AVERAGE_BINDINGS,
  CUBE_AVERAGE_ENTRY,
  CUBE_FACES_WORDS,
  CUBE_FILTER_ENTRY,
  cubeAverageShader,
  cubeFilterShader,
} from './ambientCubemapFilterWgsl.ts'
import { CUBE_FILTER, CUBE_FILTER_BINDINGS } from './ambientCubemapFilterText.ts'

/**
 * THE AMBIENT CUBEMAP'S MIP CHAIN, MADE ON THE GPU (`ambientCubemapFilterWgsl.ts`), once for a cube: the cube's texels uploaded as full floats
 * face by face over the images that ask for them (`uploadCubeFloats`), their box-filtered mips made in one submit, then the angular filter run
 * over the texels of every mip, face by face, in chunks of rows within a budget of texels an image (`TEXELS_PER_IMAGE`, at least one chunk).
 * The chain is the cube's only once the last chunk is run; the source chain and the records are then handed to the retire list.
 */

/** `GPUTextureUsage`'s and `GPUBufferUsage`'s flags, written in the clear. */
const COPY_DST = 2,
  TEXTURE_BINDING = 4,
  STORAGE_BINDING = 8,
  UNIFORM = 64,
  BUFFER_COPY_DST = 8

/** The texels the angular filter writes in one image, at most, past the first chunk. A texel is a walk over the cone's blocks of the source. */
const TEXELS_PER_IMAGE = 1 << 18

/** The dispatches an image records at most: the records they read lie in slots of one buffer, at dynamic offsets. */
const SLOTS = 64

/** The workgroup's side, the kernels' (`@workgroup_size(8, 8, 1)`). */
const GROUP = 8

const storageEntry = (binding: number, format: GPUTextureFormat): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: COMPUTE,
  storageTexture: { access: 'write-only', format, viewDimension: '2d-array' },
})

/** The kernels of a device, compiled off the frame once, and the layouts they bind. */
const kernels = oncePerDevice((device: GPUDevice) => {
  const filterLayout = device.createBindGroupLayout({
    label: 'Trillion3D ambient cubemap filter',
    entries: [
      computeUniformEntry(CUBE_FILTER_BINDINGS.faces),
      computeUniformEntry(CUBE_FILTER_BINDINGS.record, {
        hasDynamicOffset: true,
        minBindingSize: CUBE_FILTER.words * 4,
      }),
      computeTextureEntry(CUBE_FILTER_BINDINGS.source, 'unfilterable-float', '2d-array'),
      storageEntry(CUBE_FILTER_BINDINGS.filtered, 'rgba16float'),
    ],
  })
  const averageLayout = device.createBindGroupLayout({
    label: 'Trillion3D ambient cubemap average',
    entries: [
      computeTextureEntry(CUBE_AVERAGE_BINDINGS.source, 'unfilterable-float', '2d-array'),
      storageEntry(CUBE_AVERAGE_BINDINGS.averaged, 'rgba32float'),
    ],
  })
  const filter = startedComputeStages(
    device,
    'Trillion3D ambient cubemap filter',
    device.createPipelineLayout({ bindGroupLayouts: [filterLayout] }),
    device.createShaderModule({
      label: 'Trillion3D ambient cubemap filter',
      code: cubeFilterShader(),
    }),
    [CUBE_FILTER_ENTRY],
  )
  const average = startedComputeStages(
    device,
    'Trillion3D ambient cubemap average',
    device.createPipelineLayout({ bindGroupLayouts: [averageLayout] }),
    device.createShaderModule({
      label: 'Trillion3D ambient cubemap average',
      code: cubeAverageShader(),
    }),
    [CUBE_AVERAGE_ENTRY],
  )
  return {
    filterLayout,
    averageLayout,
    filter,
    average,
    get ready() {
      return filter.ready && average.ready
    },
  }
})

/** What the build holds until the chain is whole, and then lets go of. */
interface Scratch {
  /** The cube as full floats, four channels a texel, with its box-filtered mips. */
  readonly source: GPUTexture
  readonly faces: GPUBuffer
  readonly records: GPUBuffer
  /** One face's texels as four channels, reused for every face while the upload is open, let go of once the six are up. */
  rgba: Float32Array<ArrayBuffer> | undefined
  /** The bind groups of the filter, by level of the chain. */
  readonly groups: GPUBindGroup[]
  /** The record of a dispatch, written into a slot, as words and as numbers. */
  readonly recordInts: Uint32Array<ArrayBuffer>
  readonly recordFloats: Float32Array
  /** The cube's faces uploaded so far, and whether the box-filtered mips are made. */
  uploaded: number
  averaged: boolean
}

/** The chain being made of a cube: its texture, the cursor of the filter and what it is made from. */
export interface CubeBuild {
  /** The chain, in half floats, of `cubemapMipCount` mips, `CUBE_FACES` faces. */
  readonly texture: GPUTexture
  readonly view: GPUTextureView
  /** The mip, the face and the row the filter goes on from. */
  level: number
  face: number
  row: number
  scratch: Scratch | undefined
}

/** The faces' permutations and signs as the filter's uniform holds them (`CUBE_FACES_WORDS`). */
function facesWords() {
  const words = new ArrayBuffer(CUBE_FACES_WORDS * 4)
  const ints = new Uint32Array(words),
    floats = new Float32Array(words)
  for (let face = 0; face < CUBE_FACES; face++)
    for (let k = 0; k < 3; k++) {
      ints[face * 4 + k] = AMBIENT_CUBEMAP_FACE_PERM[face][k]
      floats[24 + face * 4 + k] = AMBIENT_CUBEMAP_FACE_SIGN[face][k]
    }
  return words
}

/** The build of the chain of `data` begun: its textures and buffers made, its kernels asked of the compiler. Its source is `uploaded`, the float cube the peak was found over (`takeFloatCube`), or made empty, nothing uploaded. */
export function openCubeBuild(
  device: GPUDevice,
  data: SkyLightCubemap,
  label: string,
  uploaded?: GPUTexture,
): CubeBuild {
  const { size } = data
  kernels(device)
  const count = cubemapMipCount(size)
  const texture = device.createTexture({
    label,
    size: { width: size, height: size, depthOrArrayLayers: CUBE_FACES },
    mipLevelCount: count,
    format: 'rgba16float',
    usage: TEXTURE_BINDING | STORAGE_BINDING,
  })
  const source =
    uploaded ??
    device.createTexture({
      label: `${label} source`,
      size: { width: size, height: size, depthOrArrayLayers: CUBE_FACES },
      mipLevelCount: count,
      format: 'rgba32float',
      usage: TEXTURE_BINDING | STORAGE_BINDING | COPY_DST,
    })
  const faces = device.createBuffer({
    label: `${label} faces`,
    size: CUBE_FACES_WORDS * 4,
    usage: UNIFORM | BUFFER_COPY_DST,
  })
  device.queue.writeBuffer(faces, 0, facesWords())
  const records = device.createBuffer({
    label: `${label} records`,
    size: uniformStride(device.limits) * SLOTS,
    usage: UNIFORM | BUFFER_COPY_DST,
  })
  const recordInts = new Uint32Array(CUBE_FILTER.words)
  return {
    texture,
    view: texture.createView({ dimension: 'cube' }),
    level: 0,
    face: 0,
    row: 0,
    scratch: {
      source,
      faces,
      records,
      rgba: undefined,
      groups: [],
      recordInts,
      recordFloats: new Float32Array(recordInts.buffer),
      uploaded: uploaded ? CUBE_FACES : 0,
      averaged: false,
    },
  }
}

/** The box-filtered mips of the source made, one dispatch a mip, in one submit. */
function average(device: GPUDevice, size: number, scratch: Scratch) {
  const { averageLayout, average: stages } = kernels(device)
  const pipeline = stages.pipelineOf(CUBE_AVERAGE_ENTRY)
  const encoder = device.createCommandEncoder({ label: 'Trillion3D ambient cubemap average' })
  const pass = encoder.beginComputePass({ label: 'Trillion3D ambient cubemap average' })
  pass.setPipeline(pipeline)
  for (let level = 1; level < cubemapMipCount(size); level++) {
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: averageLayout,
        entries: [
          {
            binding: CUBE_AVERAGE_BINDINGS.source,
            resource: arrayLevelView(scratch.source, level - 1),
          },
          {
            binding: CUBE_AVERAGE_BINDINGS.averaged,
            resource: arrayLevelView(scratch.source, level),
          },
        ],
      }),
    )
    const side = mipSize(size, level)
    pass.dispatchWorkgroups(ceilDiv(side, GROUP), ceilDiv(side, GROUP), CUBE_FACES)
  }
  pass.end()
  device.queue.submit([encoder.finish()])
  scratch.averaged = true
}

/** The bind group of the filter writing mip `level` of the chain. */
function filterGroup(device: GPUDevice, build: CubeBuild, scratch: Scratch, level: number) {
  return (scratch.groups[level] ??= device.createBindGroup({
    layout: kernels(device).filterLayout,
    entries: [
      { binding: CUBE_FILTER_BINDINGS.faces, resource: { buffer: scratch.faces } },
      {
        binding: CUBE_FILTER_BINDINGS.record,
        resource: { buffer: scratch.records, size: CUBE_FILTER.words * 4 },
      },
      {
        binding: CUBE_FILTER_BINDINGS.source,
        resource: scratch.source.createView({ dimension: '2d-array' }),
      },
      { binding: CUBE_FILTER_BINDINGS.filtered, resource: arrayLevelView(build.texture, level) },
    ],
  }))
}

/** The next chunks of rows of the angular filter run, within the budget of this image and at least one chunk, in one submit. */
function filter(device: GPUDevice, data: SkyLightCubemap, build: CubeBuild, scale: number) {
  const scratch = build.scratch!
  const { size } = data
  const count = cubemapMipCount(size)
  const stride = uniformStride(device.limits)
  const at = CUBE_FILTER.at
  const { recordInts: ints, recordFloats: floats } = scratch
  const encoder = device.createCommandEncoder({ label: 'Trillion3D ambient cubemap filter' })
  const pass = encoder.beginComputePass({ label: 'Trillion3D ambient cubemap filter' })
  pass.setPipeline(kernels(device).filter.pipelineOf(CUBE_FILTER_ENTRY))
  let budget = TEXELS_PER_IMAGE
  for (let slot = 0; slot < SLOTS && build.level < count && (budget > 0 || slot === 0); slot++) {
    const side = mipSize(size, build.level)
    const rows = clamp(Math.floor(budget / side), 1, side - build.row)
    const { source, sin, cos, kernelCos, inverseWidth } = ambientCubemapLevelCone(size, build.level)
    ints[at.counts] = side
    ints[at.counts + 1] = mipSize(size, source)
    ints[at.counts + 2] = build.face
    ints[at.counts + 3] = build.row
    floats[at.cone] = sin
    floats[at.cone + 1] = cos
    floats[at.cone + 2] = kernelCos
    floats[at.cone + 3] = inverseWidth
    ints[at.span] = source
    ints[at.span + 1] = rows
    floats[at.scale] = scale
    device.queue.writeBuffer(scratch.records, slot * stride, ints)
    pass.setBindGroup(0, filterGroup(device, build, scratch, build.level), [slot * stride])
    pass.dispatchWorkgroups(ceilDiv(side, GROUP), ceilDiv(rows, GROUP))
    budget -= rows * side
    build.row += rows
    if (build.row === side) {
      build.row = 0
      if (++build.face === CUBE_FACES) {
        build.face = 0
        build.level++
      }
    }
  }
  pass.end()
  device.queue.submit([encoder.finish()])
}

/** Hands what the build was made from to the retire list. */
export function closeCubeBuild(device: GPUDevice, build: CubeBuild) {
  const { scratch } = build
  if (!scratch) return
  retire(device, scratch.source)
  retire(device, scratch.faces)
  retire(device, scratch.records)
  build.scratch = undefined
}

/**
 * The build of `data` taken one step further this image: its next faces uploaded, then its box-filtered mips made, then the next chunks of
 * the filter run, each once its kernels are compiled. `scale` is what the cube was fitted to a half float by. True once the chain is whole,
 * its source then let go of.
 */
export function advanceCubeBuild(
  device: GPUDevice,
  data: SkyLightCubemap,
  build: CubeBuild,
  scale: number,
) {
  const { scratch } = build
  if (!scratch) return true
  if (scratch.uploaded < CUBE_FACES && !uploadCubeFloats(device, scratch.source, data, scratch))
    return false
  if (!kernels(device).ready) return false
  if (!scratch.averaged) average(device, data.size, scratch)
  filter(device, data, build, scale)
  if (build.level < cubemapMipCount(data.size)) return false
  closeCubeBuild(device, build)
  return true
}
