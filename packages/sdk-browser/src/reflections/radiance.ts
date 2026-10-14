import { COMPUTE, computeBufferEntry, computeTextureEntry } from '../gpu/core/computeBindings.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import {
  HDR_FORMAT,
  hdrAttachmentView,
  hdrTargetDescriptor,
  hdrTargetShape,
  radianceLevels,
} from '../scene/targetFormats.ts'
import { storageEntry } from './bindings.ts'

/**
 * THE RADIANCE PYRAMID OF A VIEW (`radianceWgsl.ts`): its kernels' layouts, what it holds, its
 * bytes, and the turn its two HDR targets take (`adoptRadianceImage`); its build is
 * `radianceBuild.ts`.
 */

/** The radiance pyramid's three layouts (`RADIANCE_SHADER`): a level read through its sampler, the
 *  two levels a dispatch writes, and for the first the image before it (its level 0, which a still
 *  image after a moving one hashes), the lighting's view, whose drawn size it reads, and the
 *  image's hash; for the roll, the hash alone. */
export function radianceLayouts(device: GPUDevice) {
  const finer = computeTextureEntry(0, 'float')
  const halves = { binding: 3, visibility: COMPUTE, sampler: { type: 'filtering' } } as const
  const view = computeBufferEntry(5, 'uniform')
  const hash = computeBufferEntry(6, 'storage')
  return {
    firstLayout: device.createBindGroupLayout({
      entries: [
        finer,
        storageEntry(1, HDR_FORMAT),
        storageEntry(2, HDR_FORMAT),
        halves,
        computeTextureEntry(4, 'float'),
        view,
        hash,
      ],
    }),
    downLayout: device.createBindGroupLayout({
      entries: [finer, storageEntry(1, HDR_FORMAT), storageEntry(2, HDR_FORMAT), halves],
    }),
    rollLayout: device.createBindGroupLayout({ entries: [hash] }),
  }
}

/** What the pyramid's build needs of the compiled kernels. */
export type RadianceStages = ReturnType<typeof radianceLayouts> & {
  /** The first dispatch: moving, hashing nothing; still, hashing the image; still after a moving
   *  image, hashing the image and the one before it. */
  firstPipeline: GPUComputePipeline
  firstHashedPipeline: GPUComputePipeline
  firstBothPipeline: GPUComputePipeline
  downPipeline: GPUComputePipeline
  rollPipeline: GPUComputePipeline
}

/** What a view's radiance pyramid holds: whether it holds an image of this view, the
 *  view-projection and drawn size that image was drawn with — the next image reprojects its hits
 *  with them —, whether the image before it was drawn with the same view-projection and size: an
 *  image traced on it reads the view it is drawn from (`reflectionsSettled`) — (`still`); its build
 *  hashed it then, unless the view was settled (`RadiancePyramid.hashed`). */
export type HeldImage = {
  valid: boolean
  viewProjection: Float64Array
  size: [number, number]
  still: boolean
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
    /** Whether the last build hashed its image (`encodeRadiancePyramid`). */
    hashed: false,
    levels,
    sampler: device.createSampler({
      label: 'Trillion3D reflection radiance',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    }),
    held: {
      valid: false,
      viewProjection: new Float64Array(16),
      size: [0, 0],
      still: false,
    } as HeldImage,
    /** The build's groups (`buildGroups`) for each of the HDR targets it was made over, by the
     *  slot of their identity: the two take turns, each finds its groups held. */
    build: {
      identity: createWebgpuBindIdentity(2),
      slots: [] as ({ groups: GPUBindGroup[]; roll: GPUBindGroup } | undefined)[],
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
