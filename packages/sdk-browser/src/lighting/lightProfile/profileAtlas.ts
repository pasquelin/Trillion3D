import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { PROFILE_SIDE } from './profileFile.ts'
import { createProfileSlots, PROFILE_ATLAS_MAX_SLICES } from './profileSlots.ts'

/** The format of the atlas: one half-float channel, which every device samples with filtering. */
export const PROFILE_ATLAS_FORMAT = 'r16float'

/**
 * The light profiles on the GPU: a 2D array texture of the reference's capacity (`maxSlices`, one slice
 * of `PROFILE_SIDE` × `PROFILE_SIDE` texels for each distinct profile, `createProfileSlots`), made once at the
 * first ask and never grown, and the bilinear, clamped sampler the profiles are read with. A light's
 * profile is held by its id (`slots.add`, `slots.remove`) and read at its slice (`slots.sliceOf`, −1 for none).
 * The texture is written when profiles were added or freed (`sync`), never otherwise.
 */
export function createLightProfileAtlas(device: GPUDevice, maxSlices = PROFILE_ATLAS_MAX_SLICES) {
  const slots = createProfileSlots(maxSlices)
  let texture: GPUTexture | undefined
  let view: GPUTextureView | undefined

  const made = () => {
    texture = device.createTexture({
      label: 'light profile atlas',
      size: [PROFILE_SIDE, PROFILE_SIDE, maxSlices],
      format: PROFILE_ATLAS_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    view = texture.createView({ dimension: '2d-array' })
  }

  return {
    slots,
    /** The sampler profiles are read with: the bilinear one clamping to the edge. */
    sampler: postSamplers(device).clamped,
    /** The atlas's view (a 2D array), made on first use. */
    get view() {
      if (!view) made()
      return view!
    },
    /** Writes the profiles added since the last sync into their slices. Returns whether the texture
     *  was made by it (a bind group of an earlier view is stale). */
    sync() {
      const first = !texture
      if (first) made()
      for (const { slice, data } of slots.plan())
        device.queue.writeTexture(
          { texture: texture!, origin: [0, 0, slice] },
          data.texels,
          { bytesPerRow: 2 * PROFILE_SIDE, rowsPerImage: PROFILE_SIDE },
          [PROFILE_SIDE, PROFILE_SIDE, 1],
        )
      return first
    },
    /** Hands the texture to the frame's retire list: an encoder of this image may still name it. */
    destroy() {
      if (texture) retire(device, texture)
      texture = undefined
      view = undefined
    },
  }
}

/** The light profiles on the GPU. */
export type LightProfileAtlas = ReturnType<typeof createLightProfileAtlas>
