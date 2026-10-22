import { LUMINANCE_FORMAT } from './copyWgsl.ts'
import type { CubemapPipelines } from './cubemapPipelines.ts'
import {
  cubeFaceTargets,
  cubeMipView,
  filterBindGroup,
  storageMip,
  wholeCube,
} from './cubeViews.ts'
import { CUBE_FACES } from './layout.ts'

/** `GPUTextureUsage`'s and `GPUBufferUsage`'s flags, written in the clear. */
const TEXTURE_BINDING = 4,
  STORAGE_BINDING = 8,
  RENDER_ATTACHMENT = 16
const MAP_READ = 1,
  COPY_SRC = 4,
  COPY_DST = 8,
  STORAGE = 128

/** The cube with its mips, the buffer the peak is written into and the one it is read through. */
function measureResources(device: GPUDevice, width: number, mips: number) {
  const cube = device.createTexture({
    label: 'Trillion3D sky light cubemap brightness cube',
    size: { width, height: width, depthOrArrayLayers: CUBE_FACES },
    mipLevelCount: mips,
    format: LUMINANCE_FORMAT,
    usage: TEXTURE_BINDING | STORAGE_BINDING | RENDER_ATTACHMENT,
  })
  const peak = device.createBuffer({
    label: 'Trillion3D sky light cubemap brightness',
    size: 4,
    usage: STORAGE | COPY_SRC,
  })
  const read = device.createBuffer({
    label: 'Trillion3D sky light cubemap brightness read',
    size: 4,
    usage: MAP_READ | COPY_DST,
  })
  return { cube, peak, read }
}

/**
 * WHAT FINDING A 32-BIT FLOAT CUBEMAP'S BRIGHTEST VALUE WRITES INTO AND READS, made for a cube of
 * side `width` and released when the value is read: the 32-bit float cube with its mips (the
 * cube's copy at its top, each mip the largest of four texels of the one above), the buffer the
 * last mip's largest channel is written into and the buffer it is read back through.
 */
export function createCubemapMeasure(
  device: GPUDevice,
  made: CubemapPipelines,
  width: number,
  mips: number,
  filterBlock: GPUBuffer,
) {
  const { cube, peak, read } = measureResources(device, width, mips)
  const nearest = device.createSampler({
    label: 'Trillion3D sky light cubemap brightness',
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipmapFilter: 'nearest',
  })
  const block = { buffer: filterBlock, size: 16 }
  const { layouts } = made
  return {
    /** Face `face` of the top mip, as a colour target. */
    faceTargets: cubeFaceTargets(cube),
    /** Mip `m` from mip `m - 1` (none for the top mip). */
    downsample: Array.from({ length: mips }, (_, mip) =>
      mip === 0
        ? undefined
        : filterBindGroup(
            device,
            layouts.downsample,
            block,
            cubeMipView(cube, mip - 1),
            nearest,
            storageMip(cube, mip),
          ),
    ),
    gather: device.createBindGroup({
      layout: layouts.gather,
      entries: [
        { binding: 0, resource: block },
        { binding: 1, resource: wholeCube(cube) },
        { binding: 2, resource: nearest },
        { binding: 4, resource: { buffer: peak } },
      ],
    }),
    peak,
    read,
    /** The value, read back; the buffers and the cube are released. */
    async value() {
      await read.mapAsync(1)
      const value = new Float32Array(read.getMappedRange().slice(0))[0]
      read.unmap()
      this.destroy()
      return value
    },
    destroy() {
      cube.destroy()
      peak.destroy()
      read.destroy()
    },
  }
}

/** What `createCubemapMeasure` made. */
export type CubemapMeasure = ReturnType<typeof createCubemapMeasure>
