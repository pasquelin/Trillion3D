import type { SubsurfaceScatteringSettings } from '../../../../sdk-core/src/contracts/subsurfaceScatteringOptions.ts'
import { clipToPreviousClip } from '../../../../math/src/matrix/matrix4Motion.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { TAA_VIEW } from '../../post/taa/bindingsWgsl.ts'
import { writeDepthTerms } from '../../post/taa/view.ts'
import { SUBSURFACE_KERNEL_SIZE } from '../../../../sdk-core/src/contracts/subsurfaceScatteringOptions.ts'
import { SSS_PARAMS } from './layout.ts'

/** What an image tells the kernels: the sizes (the drawn view and the textures', in the image's resolution and the scattering's), the
 *  tiles, the mips, the camera, the image's number and phase, the projection's jitter and the history's state. */
export interface SubsurfaceImage {
  drawn: readonly [number, number]
  allocated: readonly [number, number]
  sub: readonly [number, number]
  subDrawn: [number, number]
  tiles: [number, number]
  mips: number
  projection: ArrayLike<number>
  perspective: boolean
  viewProjection: ArrayLike<number>
  /** The view-projection of the image before, none where there is none. */
  before: Float64Array | undefined
  frame: number
  /** The projection's jitter in pixels of the drawn view, none zero. */
  jitter: [number, number]
  vectors: boolean
  historyValid: boolean
}

const TERMS = TAA_VIEW.at
const scratch = {
  terms: new Float32Array(TAA_VIEW.words),
  current: new Float64Array(16),
  inverse: new Float64Array(16),
  motion: new Float64Array(16),
}

/**
 * Writes the uniform of the kernels into `out` (`SSS_PARAMS`): the sizes, the scatter radius' scale over the projection and the
 * kernel (the projection's scale on x times the setting, over the kernel's range and two), the settings' counts and thresholds, the
 * image's words, the jitter, where this image's clip positions fell in the last image's and the depth terms. The matrix of motion is
 * the identity where there is no image before.
 */
export function writeSubsurfaceParams(
  out: Float32Array,
  settings: SubsurfaceScatteringSettings,
  neighborValidation: boolean,
  image: SubsurfaceImage,
) {
  const at = SSS_PARAMS.at
  const words = new Uint32Array(out.buffer, out.byteOffset, out.length)
  const reach = image.projection[0] * settings.scale
  putVec4(out, at.scene, image.drawn[0], image.drawn[1], image.allocated[0], image.allocated[1])
  putVec4(out, at.sub, image.subDrawn[0], image.subDrawn[1], image.sub[0], image.sub[1])
  putVec4(
    out,
    at.scatter,
    (reach / SUBSURFACE_KERNEL_SIZE) * 0.5,
    reach,
    settings.burleySamples,
    settings.mipsMinTileCount,
  )
  putVec4(out, at.tune, settings.subpixelThreshold)
  putVec4(
    words,
    at.words,
    image.frame >>> 0,
    image.frame & 7,
    image.frame,
    image.tiles[0] * image.tiles[1],
  )
  putVec4(words, at.tiles, image.tiles[0], image.tiles[1], image.mips, +neighborValidation)
  putVec4(
    out,
    at.jitter,
    (2 * image.jitter[0]) / image.drawn[0],
    (2 * image.jitter[1]) / image.drawn[1],
    +image.vectors,
    +image.historyValid,
  )
  const { current, inverse, motion, terms } = scratch
  clipToPreviousClip(motion, current, inverse, image.viewProjection, image.before)
  copyMatrix4(out, motion, at.clip)
  writeDepthTerms(terms, image.projection, image.perspective, image.drawn[0])
  for (let k = 0; k < 4; k++) {
    out[at.depth + k] = terms[TERMS.depth + k]
    out[at.radius + k] = terms[TERMS.radius + k]
  }
}
