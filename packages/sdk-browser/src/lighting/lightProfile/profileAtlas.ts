import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { textureLimits } from '../../gpu/core/textureLimits.ts'
import { PROFILE_SIDE } from './profileCodec.ts'
import { resampleProfile } from './profileResample.ts'
import { createProfileSlots } from './profileSlots.ts'

/** The format of the atlas: one half-float channel, which every device samples with filtering. */
export const PROFILE_ATLAS_FORMAT = 'r16float'

/** The side of the one-slice texture a view asked before any sync is made at, a sync then making the atlas as the settings say. */
const PLACEHOLDER_SIDE = 16

/** The texture of `slices` layers, `side` texels a side, and its 2D array view. */
function makeAtlasTexture(device: GPUDevice, side: number, slices: number) {
  const texture = device.createTexture({
    label: 'light profile atlas',
    size: [side, side, Math.max(1, slices)],
    format: PROFILE_ATLAS_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  })
  return { texture, view: texture.createView({ dimension: '2d-array' }) }
}

/** The texels of each profile laid on the atlas's side, kept while the atlas is that side: an atlas made again for more profiles
 *  writes the held ones again without resampling them. */
function createLaidProfiles() {
  let laid = new WeakMap<Uint16Array<ArrayBuffer>, Uint16Array<ArrayBuffer>>()
  return {
    /** `texels` on `side` texels a side: as they are on the profile's own side, else resampled once. */
    on(texels: Uint16Array<ArrayBuffer>, side: number) {
      if (side === PROFILE_SIDE) return texels
      let out = laid.get(texels)
      if (!out) laid.set(texels, (out = resampleProfile(texels, PROFILE_SIDE, side)))
      return out
    },
    /** Forgets what was laid: the atlas's side moved. */
    reset() {
      laid = new WeakMap()
    },
  }
}

/** Each planned profile written into its slice of `texture`, laid on its `side`. */
function writeProfiles(
  device: GPUDevice,
  texture: GPUTexture,
  side: number,
  plan: ReturnType<ReturnType<typeof createProfileSlots>['plan']>,
  laid: ReturnType<typeof createLaidProfiles>,
) {
  for (const { slice, data } of plan) {
    device.queue.writeTexture(
      { texture, origin: [0, 0, slice] },
      laid.on(data.texels, side),
      { bytesPerRow: 2 * side, rowsPerImage: side },
      [side, side, 1],
    )
  }
}

/**
 * The light profiles on the GPU: a 2D array texture of `resolution` texels a side (`lightProfileAtlasResolution`), a slice
 * for each distinct profile the lights ask, up to `maxProfiles` (`lightProfileAtlasMaxProfiles`; `createProfileSlots`),
 * and the bilinear, clamped sampler the profiles are read with. A light's profile is held by its id (`slots.add`,
 * `slots.remove`) and read at its slice (`slots.sliceOf`, −1 for none). The texture is made at the first sync with the slices
 * asked and made again, every profile written into it again, when more are asked than it was made with or a setting moved;
 * profiles freed leave it as it is. A profile of another side than the atlas's is resampled when it is written
 * (`resampleProfile`). It is handed back when no light names a profile (`destroy`) and made again by the next sync.
 */
export function createLightProfileAtlas(device: GPUDevice) {
  const slots = createProfileSlots()
  let texture: GPUTexture | undefined
  let view: GPUTextureView | undefined
  /** What the texture was made with: its side, the slices asked of it and the most profiles allowed. */
  let side = 0,
    asked = 0,
    allowed = 0
  /** The count of the times the texels of the texture changed (made, or a profile written): what a copy of it compares. */
  let writes = 0

  const laid = createLaidProfiles()
  const held = { texture: undefined as unknown as GPUTexture, side: 0, slices: 0, writes: 0 }

  const made = () => {
    ;({ texture, view } = makeAtlasTexture(device, side, asked))
  }

  return {
    slots,
    /** The sampler profiles are read with: the bilinear one clamping to the edge. */
    sampler: postSamplers(device).clamped,
    /** The atlas's view (a 2D array); one slice, until a sync makes the atlas, if asked before. */
    get view() {
      if (!view) {
        side = PLACEHOLDER_SIDE
        made()
      }
      return view!
    },
    /**
     * Makes the atlas for the profiles held, `resolution` texels a side and at most `maxProfiles` slices, where it is not
     * made, a setting moved or more profiles are held than it was made with, and writes the profiles added since the last
     * sync into their slices; with `forceUpdate`, every profile held is written again into a slice. Returns whether the texture was
     * made by it (a bind group of an earlier view is stale).
     */
    sync(resolution: number, maxProfiles: number, forceUpdate = false) {
      // Nothing held and nothing made: nothing to make.
      if (!texture && slots.size === 0) return false
      const requested = Math.min(maxProfiles, slots.size)
      // A side past what the device makes a texture of is held to it.
      const wanted = Math.min(resolution, textureLimits(device.limits).side)
      const remade = !texture || wanted !== side || maxProfiles !== allowed || requested > asked
      if (remade) {
        if (texture) retire(device, texture)
        if (wanted !== side) laid.reset()
        side = wanted
        allowed = maxProfiles
        asked = requested
        made()
        slots.relayout(requested)
      } else if (forceUpdate) slots.relayout(asked)
      const plan = slots.plan()
      writeProfiles(device, texture!, side, plan, laid)
      if (remade || plan.length) writes++
      return remade
    },
    /** What the debug view draws: the texture, its side and slices, which slices hold a profile and the count of the times its texels changed (`writes`); none while the atlas is not made. */
    debugFigures() {
      if (!texture) return undefined
      const slices = texture.depthOrArrayLayers
      return {
        texture,
        view: view!,
        side,
        slices,
        used: slots.usedSlices(slices),
        held: slots.size,
        writes,
      }
    },
    /** The texture, side, slices and `writes` of the atlas, for a copy of it each image (`blend/objectShadow`): one record, held and refilled, none allocated; none while the atlas is not made. */
    figures() {
      if (!texture) return undefined
      held.texture = texture
      held.side = side
      held.slices = texture.depthOrArrayLayers
      held.writes = writes
      return held
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

/** What the debug view draws of the atlas. */
export type LightProfileDebugFigures = NonNullable<ReturnType<LightProfileAtlas['debugFigures']>>
