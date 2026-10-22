import { depthScale, CAPTURE_CLOUD_SETUP } from '../clouds/cloudModes.ts'
import { CLOUD_FORMAT } from '../clouds/reconstructLayout.ts'
import { CLOUD_DEPTH_RANGE_FORMAT } from '../clouds/traceWgsl.ts'
import {
  BLOCK_STRIDE,
  CAPTURED_CUBE_USAGE,
  CLOUD_FACE_USAGE,
  CUBE_FACES,
  FILTERED_CUBE_USAGE,
  IRRADIANCE_VECTORS,
  SKY_LIGHT_CUBE_FORMAT,
} from './layout.ts'
import { skyLightMipCount } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import {
  cubeFaceTargets,
  cubeMipView,
  filterBindGroup,
  storageMip,
  wholeCube,
} from './cubeViews.ts'
import type { SkyLightPipelines } from './pipelines.ts'

/** The dispatches of one capture frame that read a block at a dynamic offset: the whole capture
 *  runs the mips and the filter of every level, never more than twice the levels of the largest
 *  cube. */
const FILTER_SLOTS = 64

/** The captured cube and the two filtered cubes, of side `width`, with their mips. */
function createCubes(device: GPUDevice, width: number, mips: number) {
  const cube = (label: string, usage: number) =>
    device.createTexture({
      label,
      size: { width, height: width, depthOrArrayLayers: CUBE_FACES },
      mipLevelCount: mips,
      format: SKY_LIGHT_CUBE_FORMAT,
      usage,
    })
  const captured = cube('Trillion3D sky light captured cube', CAPTURED_CUBE_USAGE)
  const filtered = [
    cube('Trillion3D sky light filtered cube 0', FILTERED_CUBE_USAGE),
    cube('Trillion3D sky light filtered cube 1', FILTERED_CUBE_USAGE),
  ] as const
  return { captured, filtered }
}

/** The blocks the passes read, a slot to a face or a dispatch, `BLOCK_STRIDE` bytes apart. */
function createBlocks(device: GPUDevice) {
  const block = (label: string, slots: number) =>
    device.createBuffer({
      label,
      size: slots * BLOCK_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  return {
    face: block('Trillion3D sky light faces', CUBE_FACES),
    frame: block('Trillion3D sky light cloud frames', CUBE_FACES),
    trace: block('Trillion3D sky light cloud traces', CUBE_FACES),
    filter: block('Trillion3D sky light filter blocks', FILTER_SLOTS),
    irradiance: block('Trillion3D sky light harmonics block', 1),
    /** A specified cubemap's copy: a slot to a face, the 16-bit cube's then the 32-bit float
     *  one's. */
    copy: block('Trillion3D sky light cubemap copies', 2 * CUBE_FACES),
  }
}

/** The textures of a face's clouds: the traced colour and depth at `cloudSide`, and the depth
 *  range at the side the trace reads it at (`depthScale` of the capture's setup). */
function createCloudImages(device: GPUDevice, cloudSide: number) {
  const cloudTexture = (label: string, format: GPUTextureFormat, usage: number, side: number) =>
    device.createTexture({ label, size: { width: side, height: side }, format, usage })
  return {
    colour: cloudTexture('Trillion3D sky light clouds', CLOUD_FORMAT, CLOUD_FACE_USAGE, cloudSide),
    depth: cloudTexture(
      'Trillion3D sky light clouds depth',
      CLOUD_FORMAT,
      CLOUD_FACE_USAGE,
      cloudSide,
    ),
    depthRange: cloudTexture(
      'Trillion3D sky light depth range',
      CLOUD_DEPTH_RANGE_FORMAT,
      4,
      cloudSide * depthScale(CAPTURE_CLOUD_SETUP),
    ),
  }
}

/** What the bind groups are made over. */
interface GroupSources {
  readonly mips: number
  readonly captured: GPUTexture
  readonly filtered: readonly [GPUTexture, GPUTexture]
  readonly filteredCubes: readonly [GPUTextureView, GPUTextureView]
  readonly blocks: ReturnType<typeof createBlocks>
  readonly harmonics: GPUBuffer
  /** The clouds' traced colour. */
  readonly clouds: GPUTextureView
}

/** The bind groups of the clouds' composition, the mips, the filter and the harmonics. */
function createGroups(device: GPUDevice, pipelines: SkyLightPipelines, over: GroupSources) {
  const { mips, captured, filtered, filteredCubes, blocks, harmonics } = over
  const { layouts } = pipelines
  const cloudSampler = device.createSampler({
    label: 'Trillion3D sky light clouds',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  const nearest = device.createSampler({
    label: 'Trillion3D sky light cube',
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipmapFilter: 'nearest',
  })
  const filterBlock = { buffer: blocks.filter, size: 16 }
  const filterGroup = (source: GPUTextureView, output: GPUTextureView) =>
    filterBindGroup(device, layouts.filter, filterBlock, source, nearest, output)
  const capturedCube = wholeCube(captured)
  const range = Array.from({ length: mips }, (_, mip) => mip)
  return {
    /** The clouds of a face, read bilinearly by the composition. */
    clouds: device.createBindGroup({
      layout: layouts.clouds,
      entries: [
        { binding: 0, resource: over.clouds },
        { binding: 1, resource: cloudSampler },
      ],
    }),
    /** Mip `m` from mip `m - 1` of the captured cube (none for the top mip). */
    downsample: range.map((mip) =>
      mip === 0
        ? undefined
        : filterGroup(cubeMipView(captured, mip - 1), storageMip(captured, mip)),
    ),
    /** Mip `m` of filtered cube `w` from the captured cube. */
    convolve: filtered.map((texture) =>
      range.map((mip) => filterGroup(capturedCube, storageMip(texture, mip))),
    ),
    /** The harmonics from filtered cube `w`. */
    irradiance: filteredCubes.map((view) =>
      device.createBindGroup({
        layout: layouts.irradiance,
        entries: [
          { binding: 0, resource: { buffer: blocks.irradiance } },
          { binding: 1, resource: view },
          { binding: 2, resource: nearest },
          { binding: 3, resource: { buffer: harmonics } },
        ],
      }),
    ),
  }
}

/**
 * WHAT THE CAPTURE WRITES INTO AND READS, made for a cube of side `width` and clouds traced at
 * `cloudSide`, and made again when either changes:
 * - the captured cube: the sky of the faces, then its mips;
 * - the two filtered cubes, one ready to be read while the other is written;
 * - the harmonics' buffer (`IRRADIANCE_VECTORS` vec4s), which the sun's light and the surfaces read;
 * - the clouds of a face: the traced colour and the two images the trace writes and the capture
 *   does not use, and the depth range (zero: nothing in front), as large as the trace reads it;
 * - the blocks the passes read, a slot to a face or a dispatch, `BLOCK_STRIDE` bytes apart;
 * and the bind groups of the filter and the harmonics over them.
 */
export function createSkyLightTargets(
  device: GPUDevice,
  pipelines: SkyLightPipelines,
  width: number,
  cloudSide: number,
) {
  const mips = skyLightMipCount(width)
  const { captured, filtered } = createCubes(device, width, mips)
  const harmonics = device.createBuffer({
    label: 'Trillion3D sky light harmonics',
    size: IRRADIANCE_VECTORS * 16,
    usage: GPUBufferUsage.STORAGE,
  })
  const blocks = createBlocks(device)
  const clouds = createCloudImages(device, cloudSide)
  const cloudViews = {
    colour: clouds.colour.createView(),
    depth: clouds.depth.createView(),
    depthRange: clouds.depthRange.createView(),
  }
  const filteredCubes = [wholeCube(filtered[0]), wholeCube(filtered[1])] as const
  const groups = createGroups(device, pipelines, {
    mips,
    captured,
    filtered,
    filteredCubes,
    blocks,
    harmonics,
    clouds: cloudViews.colour,
  })
  return {
    width,
    cloudSide,
    mips,
    captured,
    filtered,
    harmonics,
    blocks,
    cloudViews,
    groups,
    /** The views the lighting reads the filtered cubes through. */
    filteredCubes,
    /** Face `face` of the captured cube, mip 0, as a colour target. */
    faceTargets: cubeFaceTargets(captured),
    destroy() {
      for (const texture of [captured, ...filtered, ...Object.values(clouds)]) texture.destroy()
      for (const buffer of [harmonics, ...Object.values(blocks)]) buffer.destroy()
    },
  }
}

/** What `createSkyLightTargets` made. */
export type SkyLightTargets = ReturnType<typeof createSkyLightTargets>
