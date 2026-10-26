import { CLOUD_SHADOW_BLOCK } from '../../../lighting/atmosphere/cloudShadowRead.ts'
import { uniformBlock } from '../../../gpu/core/uniformBlock.ts'
import { standInTexture } from '../../../gpu/core/standIns.ts'
import { createCloudShadowPasses } from './shadow.ts'
import { createCloudShadowEncoders, createCloudShadowSlots } from './shadowRunPasses.ts'
import {
  encodeCloudShadows,
  type CloudShadowParts,
  type CloudShadowRunInput,
} from './shadowRunLight.ts'
import { createSkyOcclusionRun } from './skyOcclusionRun.ts'
import {
  CLOUD_SHADOW_FORMAT,
  CLOUD_SHADOW_LAYOUT,
  CLOUD_SHADOW_TEMPORAL_LAYOUT,
} from './shadowLayout.ts'
import { postSamplers } from '../../../gpu/core/postSamplers.ts'

/**
 * THE CLOUD SHADOW MAPS IN A FRAME: for each of the air's two lights that casts cloud shadows
 * (`cloudShadowWanted`), the trace into a map, the temporal filter into the whole map the view keeps
 * for the next image, then the spatial filters, one pass a halving; the last map is the one the
 * lookups read (`CloudShadowSet`, `lighting/atmosphere/cloudShadowRead.ts`) with the block of its
 * matrices and strengths. A light with no map answers a stand-in of no cloud and a strength of 0.
 * Where the sky light asks for it (`CloudShadowRunInput.skyLight`) the clouds' sky occlusion map is
 * built after them (`./skyOcclusionRun.ts`) and is the set's `ao`, with its matrix in the block;
 * else `ao` is the stand-in and the block says there is none.
 *
 * The temporal filter runs where the weight of the current image is under 1 and the view keeps
 * state (`CloudShadowRunInput.keepsState`); a view that keeps none traces the half-size map and
 * filters it spatially. The textures are made again where a side, the passes or the filter change.
 */

export type { CloudShadowLightInput, CloudShadowRunInput } from './shadowRunLight.ts'

/**
 * The shadow maps' run: `encode` builds the maps of an image on `encoder` and returns what the
 * lookups read; `dispose` releases the textures.
 */
export function createCloudShadowRun(device: GPUDevice, failed: (error: unknown) => void) {
  const made = createCloudShadowPasses(device, failed)
  const lookup = postSamplers(device).clamped
  const passes = createCloudShadowEncoders(device, made, lookup)
  const occlusion = createSkyOcclusionRun(device, passes, lookup, failed)
  const block = uniformBlock(
    device,
    'Trillion3D cloud shadow lookups',
    CLOUD_SHADOW_BLOCK.words * 4,
  )
  const standIn = standInTexture(device, 'Trillion3D cloud shadow none', CLOUD_SHADOW_FORMAT, {
    storage: true,
  })
  const none = standIn.createView()
  const { slots, slotFor, release } = createCloudShadowSlots(device)
  const parts: CloudShadowParts = {
    device,
    passes,
    occlusion,
    slots,
    slotFor,
    release,
    lookup,
    block,
    none,
    trace: new Float32Array(CLOUD_SHADOW_LAYOUT.words),
    blend: new Float32Array(CLOUD_SHADOW_TEMPORAL_LAYOUT.words),
  }

  return {
    /** Whether every pipeline is compiled: until then no map is made. */
    get ready() {
      return made.trace.ready && made.filtering.ready && made.blending.ready
    },
    /** The maps of this image on `encoder`, for the lookups. */
    encode: (encoder: GPUCommandEncoder, input: CloudShadowRunInput) =>
      encodeCloudShadows(parts, encoder, input),
    dispose() {
      release(0)
      release(1)
      occlusion.release()
      block.buffer.destroy()
      standIn.destroy()
    },
  }
}

/** The shadow maps' run (`createCloudShadowRun`). */
export type CloudShadowRun = ReturnType<typeof createCloudShadowRun>
