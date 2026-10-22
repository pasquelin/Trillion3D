import { createLightningVolume } from './lightning.ts'
import { createGlobalMask } from './mask.ts'
import { createNoiseVolume } from './noiseVolume.ts'
import { createLayoutPattern } from './pattern.ts'
import { createHeightProfile } from './profile.ts'

/**
 * THE CLOUD MATERIAL'S TEXTURES, generated once when the clouds part starts: the noise volume (3D,
 * 128 texels a side), the layout pattern (1024²), the height profile (256²), the global mask
 * (1024²) and the lightning volume (3D, 64 texels a side), all `rgba16float`, the lightning volume
 * with its mip chain and the others at mip 0 only. They are made by compute passes, not read
 * from any file.
 */

/** The one sampler the material reads every cloud texture through: repeating on u, v and w,
 *  trilinear, its level range open. The lightning volume's chain is read at an explicit level; the
 *  others have the one level, so the filter across levels changes nothing for them. */
export const CLOUD_SAMPLER: GPUSamplerDescriptor = {
  label: 'Trillion3D cloud textures',
  magFilter: 'linear',
  minFilter: 'linear',
  mipmapFilter: 'linear',
  addressModeU: 'repeat',
  addressModeV: 'repeat',
  addressModeW: 'repeat',
}

/** The five textures, generated; the caller releases them with `destroy`. */
export async function createCloudTextures(device: GPUDevice) {
  const [noise, pattern, profile, mask, lightning] = await Promise.all([
    createNoiseVolume(device),
    createLayoutPattern(device),
    createHeightProfile(device),
    createGlobalMask(device),
    createLightningVolume(device),
  ])
  return {
    noise,
    pattern,
    profile,
    mask,
    lightning,
    destroy() {
      for (const texture of [noise, pattern, profile, mask, lightning]) texture.destroy()
    },
  }
}

/** What `createCloudTextures` made. */
export type CloudTextures = Awaited<ReturnType<typeof createCloudTextures>>
