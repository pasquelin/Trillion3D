import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import {
  COMPOSE_BINDING,
  COMPOSE_AIR_BINDINGS,
  COMPOSE_VIEW,
  composeProgram,
} from './composeWgsl.ts'
import {
  put4,
  RECONSTRUCT_SAMPLER,
  writeSafeBounds,
  type ImageSize,
  type Size,
} from './reconstructLayout.ts'

/**
 * THE CLOUDS' COMPOSITION, described: what the pass binds, draws and blends. Nothing here touches
 * the GPU. The pass reads the image the reconstruction wrote last (`CloudFramePlan.destination`) and
 * the scene's depth, and draws over the HDR image.
 */

/** What the composition's uniform is written from. */
export interface ComposeInput {
  /** The reconstructed image the pass reads: its texture, and the part of it filled. */
  readonly image: ImageSize
}

/** The composition's uniform (`COMPOSE_VIEW`) into `out`, `COMPOSE_VIEW.words` floats; the part's
 *  `gpu` values give the start distance (`nearestStartKm`), and its `quality` the distance that
 *  stops the disocclusion and whether the fog is laid on the cloud here. */
export function writeComposeView(out: Float32Array, input: ComposeInput, part: CloudPart) {
  const { texture } = input.image
  const at = COMPOSE_VIEW.at
  const { nearestStartKm } = part.gpu
  const { cloudDisocclusionMaxDistanceKm, cloudFogLate } = part.quality
  put4(out, at.textureSize, texture.width, texture.height, 1 / texture.width, 1 / texture.height)
  writeSafeBounds(out, at.bounds, input.image)
  put4(out, at.distances, nearestStartKm, cloudDisocclusionMaxDistanceKm, cloudFogLate ? 1 : 0, 0)
  return out
}

let imageEntries: GPUBindGroupLayoutEntry[] | undefined

/** The cloud images' group (group 1): the uniform, the colour, secondary and depth images, the scene's
 *  depth, and the sampler (`RECONSTRUCT_SAMPLER`), made once and shared: not to be changed. */
export function composeEntries() {
  if (!imageEntries) {
    const stage = GPUShaderStage.FRAGMENT,
      b = COMPOSE_BINDING
    imageEntries = [
      computeUniformEntry(b.view, {}, stage),
      computeTextureEntry(b.colour, 'float', '2d', stage),
      computeTextureEntry(b.secondary, 'float', '2d', stage),
      computeTextureEntry(b.depth, 'float', '2d', stage),
      computeTextureEntry(b.sceneDepth, 'depth', '2d', stage),
      computeSamplerEntry(b.sampler, 'filtering', stage),
    ]
  }
  return imageEntries
}

/** `GPUColorWrite`'s flags, written in the clear. */
const RED = 1,
  GREEN = 2,
  BLUE = 4

/** The blend over the HDR image: the cloud's luminance added to the image multiplied by its
 *  transmittance (the output's alpha), the colour written and the image's alpha left as it is. */
export const COMPOSE_TARGET: GPUColorTargetState = {
  format: HDR_FORMAT,
  blend: {
    color: { srcFactor: 'one', dstFactor: 'src-alpha', operation: 'add' },
    alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
  },
  writeMask: RED | GREEN | BLUE,
}

let groups: GPUBindGroupLayoutEntry[][] | undefined

/** What the pass draws: a full-screen triangle over the `view` pixels of the HDR image, its layouts
 *  (group 0 the air's, group 1 the cloud images'), its two entries and its blend. */
export function describeCompose(view: Size) {
  groups ??= [airLayoutEntries(COMPOSE_AIR_BINDINGS, GPUShaderStage.FRAGMENT), composeEntries()]
  return {
    code: composeProgram.code,
    vertexEntry: 'fullscreen',
    fragmentEntry: 'composeMain',
    groups,
    target: COMPOSE_TARGET,
    viewport: view,
    uniformFloats: COMPOSE_VIEW.words,
    sampler: RECONSTRUCT_SAMPLER,
  }
}
