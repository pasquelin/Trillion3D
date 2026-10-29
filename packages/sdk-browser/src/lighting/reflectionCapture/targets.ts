import { postSamplers } from '../../gpu/core/postSamplers.ts'
import {
  BLOCK_STRIDE,
  CAPTURED_CUBE_USAGE,
  CUBE_FACES,
  FILTERED_CUBE_USAGE,
  IRRADIANCE_VECTORS,
  SKY_LIGHT_CUBE_FORMAT,
  capturedIrradianceMip,
} from '../../modules/sky/skyLight/layout.ts'
import {
  cubeFaceTargets,
  cubeMipView,
  filterBindGroup,
  storageMip,
  wholeCube,
  wholeCubeArray,
} from '../../modules/sky/skyLight/cubeViews.ts'
import {
  CAPTURE_DIFFUSE_REFERENCE_MIP,
  CAPTURE_DIFFUSE_RESULT_MIPS,
  captureMipCount,
} from './layout.ts'
import type { ReflectionCapturePipelines } from './pipelines.ts'

/** The dispatches of one capture that read the filter block at a dynamic offset: the mips and the filter of every level. */
const FILTER_SLOTS = 64

/** The side of the cube the diffuse light is convolved into before it is copied to the mips: the reference's temporary cube. */
const TEMPORARY_SIDE = 1 << (CAPTURE_DIFFUSE_RESULT_MIPS - 1)

const uniform = (
  device: GPUDevice,
  label: string,
  data: ArrayBufferView,
  size = data.byteLength,
) => {
  const buffer = device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength)
  return buffer
}

/** The array view of mip `mip` of the six faces of `texture`. */
const arrayMip = (texture: GPUTexture, mip: number) =>
  texture.createView({ dimension: '2d-array', baseMipLevel: mip, mipLevelCount: 1 })

/**
 * WHAT THE CAPTURES WRITE INTO AND READ, for cubes of side `side` and room for `capacity` captures, made again when either changes:
 * - the captured cube, one scratch cube: the faces of the capture being made, then its mips;
 * - the filtered cubes, one texture of `capacity` cubes (the reference's cube array), a capture's layer written by the roughness filter
 *   and, with the diffuse light on, its four smallest mips by the diffuse programs;
 * - the temporary cube of 8 texels the exhaustive diffuse light is convolved into and halved in, before it is copied;
 * - the capture's harmonics, seven vectors, and the blocks of the passes;
 * and the bind groups of the filter and the diffuse passes over them. The filter's are the sky light's (`filterBindGroup`).
 */
export function createCaptureTargets(
  device: GPUDevice,
  own: ReflectionCapturePipelines,
  side: number,
  capacity: number,
) {
  const mips = captureMipCount(side)
  const cube = (label: string, usage: number, layers: number, size = side, count = mips) =>
    device.createTexture({
      label,
      size: { width: size, height: size, depthOrArrayLayers: CUBE_FACES * layers },
      mipLevelCount: count,
      format: SKY_LIGHT_CUBE_FORMAT,
      usage,
    })
  const captured = cube('Trillion3D reflection capture scratch cube', CAPTURED_CUBE_USAGE, 1)
  const filtered = cube(
    'Trillion3D reflection captures',
    FILTERED_CUBE_USAGE | GPUTextureUsage.COPY_DST,
    capacity,
  )
  const temporary = cube(
    'Trillion3D reflection capture diffuse',
    FILTERED_CUBE_USAGE | GPUTextureUsage.COPY_SRC,
    1,
    TEMPORARY_SIDE,
    CAPTURE_DIFFUSE_RESULT_MIPS,
  )
  const harmonics = device.createBuffer({
    label: 'Trillion3D reflection capture harmonics',
    size: IRRADIANCE_VECTORS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM,
  })
  const filterBlock = device.createBuffer({
    label: 'Trillion3D reflection capture filter blocks',
    size: FILTER_SLOTS * BLOCK_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const copyBlock = device.createBuffer({
    label: 'Trillion3D reflection capture copy blocks',
    size: CUBE_FACES * BLOCK_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const { clamped: bilinear, mipped: trilinear } = postSamplers(device)
  const filterGroup = (source: GPUTextureView, sampler: GPUSampler, output: GPUTextureView) =>
    filterBindGroup(
      device,
      own.cube.layouts.filter,
      { buffer: filterBlock, size: 16 },
      source,
      sampler,
      output,
    )
  const range = Array.from({ length: mips }, (_, mip) => mip)
  const capturedCube = wholeCube(captured)
  const diffuseGroup = (block: GPUBuffer, source: GPUTextureView, output: GPUTextureView) =>
    device.createBindGroup({
      layout: own.layouts.diffuse,
      entries: [
        { binding: 0, resource: { buffer: block } },
        { binding: 1, resource: { buffer: harmonics, size: IRRADIANCE_VECTORS * 16 } },
        { binding: 2, resource: source },
        { binding: 3, resource: output },
      ],
    })
  // The block's `sides`: the source mip's side minus one, its inverse and the output's inverse.
  const sidesOf = (source: number, output: number) =>
    new Float32Array([source - 1, 1 / source, 1 / output, 0])
  const resultMips = Array.from(
    { length: Math.min(CAPTURE_DIFFUSE_RESULT_MIPS, mips) },
    (_, l) => l,
  )
  const sourceMip = mips - 1 - Math.min(CAPTURE_DIFFUSE_REFERENCE_MIP, mips - 1)
  const sourceSide = side >> sourceMip
  const referenceBlock = uniform(
    device,
    'Trillion3D reflection capture irradiance block',
    sidesOf(sourceSide, TEMPORARY_SIDE),
  )
  const shBlocks = resultMips.map((l) =>
    uniform(device, 'Trillion3D reflection capture harmonics block', sidesOf(1, 1 << l)),
  )
  const mipBlock = uniform(
    device,
    'Trillion3D reflection capture harmonics mip',
    new Uint32Array([capturedIrradianceMip(mips)]),
  )
  const anyArray = arrayMip(captured, 0)
  return {
    side,
    /** The filter's name for the side. */
    width: side,
    mips,
    capacity,
    captured,
    filtered,
    temporary,
    harmonics,
    blocks: { filter: filterBlock, copy: copyBlock },
    /** The cube array the lighting reads. */
    cubes: wholeCubeArray(filtered),
    faceTargets: cubeFaceTargets(captured),
    groups: {
      downsample: range.map((mip) =>
        mip === 0
          ? undefined
          : filterGroup(cubeMipView(captured, mip - 1), bilinear, storageMip(captured, mip)),
      ),
      /** Mip `m` of capture layer `layer`, from the captured cube. */
      convolve: Array.from({ length: capacity }, (_, layer) =>
        range.map((mip) => filterGroup(capturedCube, trilinear, storageMip(filtered, mip, layer))),
      ),
      /** The captured cube's harmonics (the sky light's sum, `capturedIrradianceMain`). */
      harmonics: device.createBindGroup({
        layout: own.cube.layouts.irradiance,
        entries: [
          { binding: 0, resource: { buffer: mipBlock } },
          { binding: 1, resource: capturedCube },
          { binding: 2, resource: bilinear },
          { binding: 3, resource: { buffer: harmonics } },
        ],
      }),
      /** The cube's small mips from the harmonics, mip `l` of the result of capture layer `layer`. */
      sh: Array.from({ length: capacity }, (_, layer) =>
        resultMips.map((l) =>
          diffuseGroup(shBlocks[l], anyArray, storageMip(filtered, mips - 1 - l, layer)),
        ),
      ),
      /** The exhaustive convolution of the captured cube's mip of 8 texels, into the temporary cube. */
      reference: diffuseGroup(
        referenceBlock,
        arrayMip(captured, sourceMip),
        storageMip(temporary, 0),
      ),
      /** The temporary cube's mip `m` from the one above. */
      halve: resultMips
        .slice(1)
        .map((m) =>
          diffuseGroup(referenceBlock, arrayMip(temporary, m - 1), storageMip(temporary, m)),
        ),
    },
    resultMips,
    destroy() {
      for (const texture of [captured, filtered, temporary]) texture.destroy()
      for (const buffer of [
        harmonics,
        filterBlock,
        copyBlock,
        referenceBlock,
        mipBlock,
        ...shBlocks,
      ])
        buffer.destroy()
    },
  }
}

/** What `createCaptureTargets` made. */
export type CaptureTargets = ReturnType<typeof createCaptureTargets>
