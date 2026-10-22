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
import type { SkyLightPipelines } from './pipelines.ts'

/** The dispatches of one capture frame that read a block at a dynamic offset: the whole capture
 *  runs the mips and the filter of every level, never more than twice the levels of the largest
 *  cube. */
const FILTER_SLOTS = 64

/**
 * WHAT THE CAPTURE WRITES INTO AND READS, made for a cube of side `width` and clouds traced at
 * `cloudSide`, and made again when either changes:
 * - the captured cube: the sky of the faces, then its mips;
 * - the two filtered cubes, one ready to be read while the other is written;
 * - the harmonics' buffer (`IRRADIANCE_VECTORS` vec4s), which the sun's light and the surfaces read;
 * - the clouds of a face: the traced colour and the two images the trace writes and the capture
 *   does not use, and the depth range (zero: nothing in front);
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
  const wholeCube = (texture: GPUTexture) => texture.createView({ dimension: 'cube' })
  const filteredCubes = [wholeCube(filtered[0]), wholeCube(filtered[1])] as const
  /** The cube's mip `mip`, written one slice a face. */
  const storageMip = (texture: GPUTexture, mip: number) =>
    texture.createView({
      dimension: '2d-array',
      baseMipLevel: mip,
      mipLevelCount: 1,
      baseArrayLayer: 0,
      arrayLayerCount: CUBE_FACES,
    })
  const harmonics = device.createBuffer({
    label: 'Trillion3D sky light harmonics',
    size: IRRADIANCE_VECTORS * 16,
    usage: GPUBufferUsage.STORAGE,
  })
  const block = (label: string, slots: number) =>
    device.createBuffer({
      label,
      size: slots * BLOCK_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  const blocks = {
    face: block('Trillion3D sky light faces', CUBE_FACES),
    frame: block('Trillion3D sky light cloud frames', CUBE_FACES),
    trace: block('Trillion3D sky light cloud traces', CUBE_FACES),
    filter: block('Trillion3D sky light filter blocks', FILTER_SLOTS),
    irradiance: block('Trillion3D sky light harmonics block', 1),
  }
  const cloudTexture = (label: string, format: GPUTextureFormat, usage: number) =>
    device.createTexture({ label, size: { width: cloudSide, height: cloudSide }, format, usage })
  const clouds = {
    colour: cloudTexture('Trillion3D sky light clouds', CLOUD_FORMAT, CLOUD_FACE_USAGE),
    secondary: cloudTexture(
      'Trillion3D sky light clouds secondary',
      CLOUD_FORMAT,
      CLOUD_FACE_USAGE,
    ),
    depth: cloudTexture('Trillion3D sky light clouds depth', CLOUD_FORMAT, CLOUD_FACE_USAGE),
    depthRange: cloudTexture('Trillion3D sky light depth range', CLOUD_DEPTH_RANGE_FORMAT, 4),
  }
  const cloudViews = {
    colour: clouds.colour.createView(),
    secondary: clouds.secondary.createView(),
    depth: clouds.depth.createView(),
    depthRange: clouds.depthRange.createView(),
  }
  const { filter: filterLayout, irradiance: irradianceLayout } = pipelines.layouts
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
    device.createBindGroup({
      layout: filterLayout,
      entries: [
        { binding: 0, resource: filterBlock },
        { binding: 1, resource: source },
        { binding: 2, resource: nearest },
        { binding: 3, resource: output },
      ],
    })
  const capturedCube = wholeCube(captured)
  const range = Array.from({ length: mips }, (_, mip) => mip)
  const groups = {
    /** The clouds of a face, read bilinearly by the composition. */
    clouds: device.createBindGroup({
      layout: pipelines.layouts.clouds,
      entries: [
        { binding: 0, resource: cloudViews.colour },
        { binding: 1, resource: cloudSampler },
      ],
    }),
    /** Mip `m` from mip `m - 1` of the captured cube (none for the top mip). */
    downsample: range.map((mip) =>
      mip === 0
        ? undefined
        : filterGroup(
            captured.createView({ dimension: 'cube', baseMipLevel: mip - 1, mipLevelCount: 1 }),
            storageMip(captured, mip),
          ),
    ),
    /** Mip `m` of filtered cube `w` from the captured cube. */
    convolve: filtered.map((texture) =>
      range.map((mip) => filterGroup(capturedCube, storageMip(texture, mip))),
    ),
    /** The harmonics from filtered cube `w`. */
    irradiance: filteredCubes.map((view) =>
      device.createBindGroup({
        layout: irradianceLayout,
        entries: [
          { binding: 0, resource: { buffer: blocks.irradiance } },
          { binding: 1, resource: view },
          { binding: 2, resource: nearest },
          { binding: 3, resource: { buffer: harmonics } },
        ],
      }),
    ),
  }
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
    faceTargets: Array.from({ length: CUBE_FACES }, (_, face) =>
      captured.createView({
        dimension: '2d',
        baseMipLevel: 0,
        mipLevelCount: 1,
        baseArrayLayer: face,
        arrayLayerCount: 1,
      }),
    ),
    destroy() {
      for (const texture of [captured, ...filtered, ...Object.values(clouds)]) texture.destroy()
      for (const buffer of [harmonics, ...Object.values(blocks)]) buffer.destroy()
    },
  }
}

/** What `createSkyLightTargets` made. */
export type SkyLightTargets = ReturnType<typeof createSkyLightTargets>
