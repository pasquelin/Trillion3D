import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { composeScale, type CloudSetup } from './cloudModes.ts'
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
import { setupOfPlan, type CloudFramePlan } from './reconstruct.ts'

/**
 * THE CLOUDS' COMPOSITION, described: what the pass binds, draws and blends. Nothing here touches
 * the GPU. The pass reads the image the reconstruction wrote last (`CloudFramePlan.destination`),
 * or, in the modes that do not reconstruct, the traced image (`composedImage`), and the scene's
 * depth, and draws over the HDR image.
 */

/** The image the composition reads for a frame: the reconstructed one in the modes that rebuild
 *  it, else the traced one. */
export const composedImage = (plan: CloudFramePlan): ImageSize =>
  setupOfPlan(plan).mode.reconstructs ? plan.sizes.reconstructed : plan.sizes.traced

/** What the composition's uniform is written from. */
export interface ComposeInput {
  /** The image the pass reads (`composedImage`): its texture, and the part of it filled. */
  readonly image: ImageSize
  readonly setup: CloudSetup
  /** The index of the frame: the jitter of the ways that jitter changes with it, modulo 8. */
  readonly frameIndex: number
  /** The pre-exposure the image's light is written multiplied by (`PreExposure.now`): the fog laid
   *  on the cloud here is, like the cloud's own luminance. 1 when absent. */
  readonly preExposure?: number
}

/** The composition's uniform (`COMPOSE_VIEW`) into `out`, `COMPOSE_VIEW.words` floats; the part's
 *  `gpu` values give the start distance (`nearestStartKm`), its `quality` the distance that stops
 *  the disocclusion, and the setup whether the fog is laid on the cloud here and the scales. */
export function writeComposeView(out: Float32Array, input: ComposeInput, part: CloudPart) {
  const { texture } = input.image
  const at = COMPOSE_VIEW.at
  const { nearestStartKm } = part.gpu
  const { cloudDisocclusionMaxDistanceKm } = part.quality
  const [toImage, toView] = composeScale(input.setup)
  put4(out, at.textureSize, texture.width, texture.height, 1 / texture.width, 1 / texture.height)
  writeSafeBounds(out, at.bounds, input.image)
  put4(
    out,
    at.distances,
    nearestStartKm,
    cloudDisocclusionMaxDistanceKm,
    input.setup.lateFog ? 1 : 0,
    input.frameIndex % 8,
  )
  put4(out, at.scale, toImage, toView, input.preExposure ?? 1, 0)
  return out
}

const imageEntries = new Map<boolean, GPUBindGroupLayoutEntry[]>()

/** The cloud images' group (group 1): the uniform, the colour, secondary (two surfaces) and depth
 *  images, the scene's depth, and the sampler (`RECONSTRUCT_SAMPLER`), made once for each kind and
 *  shared: not to be changed. */
export function composeEntries(setup: CloudSetup) {
  let entries = imageEntries.get(setup.minMaxDepth)
  if (!entries) {
    const stage = GPUShaderStage.FRAGMENT,
      b = COMPOSE_BINDING
    entries = [
      computeUniformEntry(b.view, {}, stage),
      computeTextureEntry(b.colour, 'float', '2d', stage),
      ...(setup.minMaxDepth ? [computeTextureEntry(b.secondary, 'float', '2d', stage)] : []),
      computeTextureEntry(b.depth, 'float', '2d', stage),
      computeTextureEntry(b.sceneDepth, 'depth', '2d', stage),
      computeSamplerEntry(b.sampler, 'filtering', stage),
    ]
    imageEntries.set(setup.minMaxDepth, entries)
  }
  return entries
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

const groupsByKind = new Map<boolean, GPUBindGroupLayoutEntry[][]>()

/** What the pass draws for `setup`: a full-screen triangle over the `view` pixels of the HDR image,
 *  its layouts (group 0 the air's, group 1 the cloud images'), its two entries and its blend. */
export function describeCompose(view: Size, setup: CloudSetup) {
  let groups = groupsByKind.get(setup.minMaxDepth)
  if (!groups) {
    groups = [
      airLayoutEntries(COMPOSE_AIR_BINDINGS, GPUShaderStage.FRAGMENT),
      composeEntries(setup),
    ]
    groupsByKind.set(setup.minMaxDepth, groups)
  }
  return {
    code: composeProgram(setup),
    vertexEntry: 'fullscreen',
    fragmentEntry: 'composeMain',
    groups,
    target: COMPOSE_TARGET,
    viewport: view,
    uniformFloats: COMPOSE_VIEW.words,
    sampler: RECONSTRUCT_SAMPLER,
  }
}
