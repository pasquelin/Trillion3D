/**
 * THE RADIANCE PYRAMID OF A VIEW (`radianceWgsl.ts`): its kernels' layouts, what it holds, its
 * bytes, and the turn its two HDR targets take (`adoptRadianceImage`); its build is
 * `radianceBuild.ts`.
 */
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { RADIANCE_BINDINGS } from './radianceWgsl.ts'
import {
  HDR_FORMAT,
  hdrAttachmentView,
  hdrTargetDescriptor,
  hdrTargetShape,
  radianceLevels,
} from '../../../scene/targetFormats.ts'

/** The radiance pyramid's two layouts (`RADIANCE_SHADER`): a level read through its sampler and the
 *  two levels a dispatch writes, and for the first the lighting's view, whose drawn size it reads. */
export function radianceLayouts(device: GPUDevice) {
  const B = RADIANCE_BINDINGS
  const levels = [
    computeTextureEntry(B.finer, 'float'),
    computeStorageTextureEntry(B.coarser, HDR_FORMAT),
    computeStorageTextureEntry(B.coarsest, HDR_FORMAT),
    computeSamplerEntry(B.halves),
  ]
  return {
    firstLayout: device.createBindGroupLayout({
      entries: [...levels, computeBufferEntry(B.view, 'uniform')],
    }),
    downLayout: device.createBindGroupLayout({ entries: levels }),
  }
}

/** What the pyramid's build needs of the compiled kernels. */
export type RadianceStages = ReturnType<typeof radianceLayouts> & {
  firstPipeline: GPUComputePipeline
  downPipeline: GPUComputePipeline
}

/** What a view's radiance pyramid holds: whether it holds an image of this view, and the
 *  view-projection and drawn size that image was drawn with — the next image reprojects its hits
 *  with them. */
export type HeldImage = {
  valid: boolean
  viewProjection: Float64Array
  size: [number, number]
}

/** Bytes of the pyramid of a view at `width × height`: the other HDR target whole, and the levels
 *  past level 0 of the frame's, whose level 0 the frame's targets count (`frameTargetBytes`). */
export function radianceBytes(width: number, height: number) {
  const whole = textureBytesOf(hdrTargetShape(width, height))!,
    first = textureBytesOf({ size: [width, height], format: HDR_FORMAT })!
  return 2 * whole - first
}

/**
 * The radiance pyramid of a view at `width × height`: the lit image it holds (`image`, the HDR
 * target the last image lit, `adoptRadianceImage`), its levels from 1 on in that target's mips
 * (`hdrTargetDescriptor`, level `k` at mip `k`), the sampler of its reads, what it holds, and the
 * build's bind groups, kept for each of the two HDR targets that take turns.
 */
export function createRadiancePyramid(device: GPUDevice, width: number, height: number) {
  const levels = radianceLevels(width, height)
  // The other HDR target: the frame's, the one before's turn about (`adoptRadianceImage`).
  const image = device.createTexture(hdrTargetDescriptor(width, height))
  return {
    width,
    height,
    image: { texture: image, view: hdrAttachmentView(image) },
    /** The pyramid was built this image from the frame's HDR target, which is to become its
     *  level 0 once the image is encoded (`adoptRadianceImage`). */
    fresh: false,
    levels,
    sampler: device.createSampler({
      label: 'Trillion3D reflection radiance',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    }),
    // None held yet: not valid, no view-projection, no size.
    held: {
      valid: false,
      viewProjection: new Float64Array(16),
      size: [0, 0],
    } as HeldImage,
    /** The build's groups (`buildGroups`) for each of the HDR targets it was made over, by the
     *  slot of their identity: the two take turns, each finds its groups held. */
    build: {
      identity: createWebgpuBindIdentity(2),
      slots: [] as (GPUBindGroup[] | undefined)[],
    },
  }
}
export type RadiancePyramid = ReturnType<typeof createRadiancePyramid>

/** The HDR target of a frame and the reflection it lights (`WebgpuGpuState`'s). */
type LitTargets = {
  hdrTexture?: GPUTexture
  hdrView?: GPUTextureView
  reflection?: { radiance: RadiancePyramid }
}

/**
 * The image is encoded: the HDR target its pyramid was built from (`fresh`) becomes the pyramid's
 * level 0, which the next image's reflections read, and the one that was level 0 becomes the HDR
 * target the next image lights. References traded, nothing copied, nothing made: what every pass
 * of this image recorded stays on the textures it named. Called once every pass of the image that
 * reads or writes the HDR target is encoded (`encodeSurfaceLighting`).
 */
export function adoptRadianceImage(gpu: LitTargets) {
  const radiance = gpu.reflection?.radiance
  if (!radiance?.fresh || !gpu.hdrTexture || !gpu.hdrView) return
  const { image } = radiance,
    texture = image.texture,
    view = image.view
  image.texture = gpu.hdrTexture
  image.view = gpu.hdrView
  gpu.hdrTexture = texture
  gpu.hdrView = view
  radiance.fresh = false
}
