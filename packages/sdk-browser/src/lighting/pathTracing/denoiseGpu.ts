import { DN_FINGERPRINT_BYTES } from './denoiseResolveWgsl.ts'
import { DN_MIPS, DN_SLICES, denoiseMips } from './denoiseParams.ts'

const F32 = 'rgba32float' as const
const H16 = 'rgba16float' as const
/** The room of a uniform slot (the device's offset alignment) and the slots a patch of the motion estimate uses at most, with the ones the rest of the denoiser uses. */
const DN_SLOT_BYTES = 256
/** The stride of the parameter slots on a device: its offset alignment, 256 at least. */
export const slotBytesOf = (device: GPUDevice) =>
  Math.max(DN_SLOT_BYTES, device.limits.minUniformBufferOffsetAlignment)
const SLOTS_PER_PATCH = 240
const SLOTS_FIXED = 64

/** What a denoiser view keeps beyond the variance and the denoised images: the temporal stage's pyramids, the history of the features, the fusion of the variances, the sum of patches. */
export interface DenoiseNeeds {
  readonly temporal: boolean
  readonly feature: boolean
  readonly fusion: boolean
  readonly patches: number
}

/** The key that tells whether the resources made fit the needs. */
export const denoiseKey = (size: readonly [number, number], needs: DenoiseNeeds) =>
  [size[0], size[1], needs.temporal, needs.feature, needs.fusion, needs.patches].join('|')

/** The bytes the denoiser's resources of a view ask of the device. */
export function denoiseBytes(
  device: GPUDevice,
  size: readonly [number, number],
  needs: DenoiseNeeds,
) {
  const pixels = size[0] * size[1]
  const chain = needs.temporal && denoiseMips(size) === DN_MIPS ? 4 / 3 : 0
  let bytes = pixels * (2 * DN_FINGERPRINT_BYTES + 16 + 16 + 16 * (needs.temporal ? 3 : 2))
  if (needs.feature) bytes += pixels * (16 + 8 + 8)
  if (chain) {
    // Offsets, the merge and the image's own, the two pyramids and the blur's room, the seven distances, the reject map.
    bytes += pixels * 16 * (6 * chain + DN_SLICES * chain + 1)
    if (needs.fusion) bytes += pixels * 32
    bytes += pixels * 16 * Math.min(needs.patches - 1, 2)
    bytes += (SLOTS_FIXED + SLOTS_PER_PATCH * needs.patches) * slotBytesOf(device)
  } else bytes += SLOTS_FIXED * slotBytesOf(device)
  return Math.ceil(bytes)
}

/** The textures of the temporal stage's motion estimate, the pyramids with a level each for the 7 steps down to the quarter of the view's smaller side. */
export interface DenoiseMotion {
  /** The motion, its distance to the match and its total variation, written level by level. */
  readonly offsets: GPUTexture
  /** The merge before the image's own motion is taken off, and that motion. */
  readonly merged: GPUTexture
  readonly own: GPUTexture
  /** The two images of the estimate, each with its levels. */
  readonly older: GPUTexture
  readonly newer: GPUTexture
  /** The distances of the 25 shifts, 4 to a layer, with their levels, and the room of the blur. */
  readonly distances: GPUTexture
  readonly blur: GPUTexture
  readonly reject: GPUTexture
  /** The sums of the patches, two where more than two patches take turns reading one and writing the other. */
  readonly sums: readonly GPUTexture[]
  readonly fusedOlder: GPUTexture | undefined
  readonly fusedNewer: GPUTexture | undefined
}

/** The resources of the denoiser of a view of `size`, made for `needs`, remade where either moves. */
export class DenoiseGpu {
  readonly key: string
  readonly size: readonly [number, number]
  /** The running mean and deviations of the pixels: one is worked on while the other holds the last finished run. */
  readonly varianceMaps: readonly [GPUBuffer, GPUBuffer]
  readonly varianceTexture: GPUTexture
  /** The spatial filter's room between its passes. */
  readonly scratch: GPUTexture
  /** The denoised images: the last one, the one the spatial stage writes and (with the temporal stage) the one it blends into, in turn. */
  readonly frames: readonly GPUTexture[]
  /** A texture of zeros, for the motion before there is one. */
  readonly empty: GPUTexture
  readonly history: { radiance: GPUTexture; albedo: GPUTexture; normal: GPUTexture } | undefined
  readonly motion: DenoiseMotion | undefined
  readonly params: GPUBuffer
  /** The view of the motion's drawing: its size, origin and exposure. */
  readonly view: GPUBuffer
  readonly slots: number
  readonly slotBytes: number
  /** The words of the parameters, kept between images. */
  readonly words: ArrayBuffer
  readonly device: GPUDevice
  private readonly made: { destroy(): void }[] = []

  constructor(device: GPUDevice, size: readonly [number, number], needs: DenoiseNeeds) {
    this.device = device
    this.size = size
    this.key = denoiseKey(size, needs)
    const [width, height] = size
    const usage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST
    const texture = (
      label: string,
      format: GPUTextureFormat,
      mips = 1,
      layers = 1,
      w = width,
      h = height,
    ) => {
      const made = device.createTexture({
        label: `Trillion3D path tracer denoiser ${label}`,
        size: [w, h, layers],
        format,
        mipLevelCount: mips,
        usage,
      })
      this.made.push(made)
      return made
    }
    const buffer = (label: string, bytes: number, usage: GPUBufferUsageFlags) => {
      const made = device.createBuffer({
        label: `Trillion3D path tracer denoiser ${label}`,
        size: Math.max(16, bytes),
        usage,
      })
      this.made.push(made)
      return made
    }
    const storage = GPUBufferUsage.STORAGE
    this.varianceMaps = [
      buffer('variance 0', width * height * DN_FINGERPRINT_BYTES, storage),
      buffer('variance 1', width * height * DN_FINGERPRINT_BYTES, storage),
    ]
    this.varianceTexture = texture('variance', F32)
    this.scratch = texture('spatial scratch', F32)
    this.frames = Array.from({ length: needs.temporal ? 3 : 2 }, (_, at) =>
      texture(`image ${at}`, F32),
    )
    this.empty = texture('empty', F32, 1, 1, 1, 1)
    this.history = needs.feature
      ? {
          radiance: texture('last radiance', F32),
          albedo: texture('last albedo', H16),
          normal: texture('last normal', H16),
        }
      : undefined
    this.view = buffer('views', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
    const mips = denoiseMips(size)
    this.slotBytes = slotBytesOf(device)
    const motionOn = needs.temporal && mips === DN_MIPS
    this.slots = SLOTS_FIXED + (motionOn ? SLOTS_PER_PATCH * needs.patches : 0)
    this.words = new ArrayBuffer(this.slots * this.slotBytes)
    this.params = buffer(
      'parameters',
      this.slots * this.slotBytes,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    )
    this.motion = motionOn
      ? {
          offsets: texture('motion', F32, mips),
          merged: texture('merged motion', F32, mips),
          own: texture('own motion', F32, mips),
          older: texture('older pyramid', F32, mips),
          newer: texture('newer pyramid', F32, mips),
          distances: texture('distances', F32, mips, DN_SLICES),
          blur: texture('blur', F32, mips),
          reject: texture('rejection', F32),
          sums: Array.from({ length: Math.min(needs.patches - 1, 2) }, (_, at) =>
            texture(`patch sum ${at}`, F32),
          ),
          fusedOlder: needs.fusion ? texture('fused older', F32) : undefined,
          fusedNewer: needs.fusion ? texture('fused newer', F32) : undefined,
        }
      : undefined
  }

  destroy() {
    for (const resource of this.made) resource.destroy()
    this.made.length = 0
  }
}
