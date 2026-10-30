import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import {
  ALPHA_ONLY,
  COLOUR_ONLY,
  KEEP_ALPHA,
  LIGHT_THROUGH,
  SCALED_BY_ALPHA,
} from '../../../materials/surface/materialBlending.ts'
import { composeScale, type CloudSetup } from './cloudModes.ts'
import {
  COMPOSE_BINDING,
  COMPOSE_AIR_BINDINGS,
  COMPOSE_VIEW,
  composeProgram,
} from './composeWgsl.ts'
import {
  RECONSTRUCT_SAMPLER,
  writeSafeBounds,
  type ImageSize,
  type Size,
} from './reconstructLayout.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
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
  /** Times fewer pixels a side the scene copy behind the water is drawn at (`'behindWater'`); 0 for the image itself. */
  readonly waterFactor?: number
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
  putVec4(out, at.textureSize, texture.width, texture.height, 1 / texture.width, 1 / texture.height)
  writeSafeBounds(out, at.bounds, input.image)
  putVec4(
    out,
    at.distances,
    nearestStartKm,
    cloudDisocclusionMaxDistanceKm,
    input.setup.lateFog ? 1 : 0,
    input.frameIndex % 8,
  )
  putVec4(out, at.scale, toImage, toView, input.preExposure ?? 1, input.waterFactor ?? 0)
  return out
}

const imageEntries = new Map<string, GPUBindGroupLayoutEntry[]>()

/** The cloud images' group (group 1): the uniform, the colour, secondary (two surfaces) and depth
 *  images, the scene's depth, the sampler (`RECONSTRUCT_SAMPLER`) and the water's surface, made once for each kind and
 *  shared: not to be changed. */
function composeEntries(setup: CloudSetup, under: boolean) {
  const kind = `${setup.minMaxDepth}${under}`
  let entries = imageEntries.get(kind)
  if (!entries) {
    const stage = GPUShaderStage.FRAGMENT,
      b = COMPOSE_BINDING
    entries = [
      computeUniformEntry(b.view, {}, stage),
      computeTextureEntry(b.colour, 'float', '2d', stage),
      ...(setup.minMaxDepth ? [computeTextureEntry(b.secondary, 'float', '2d', stage)] : []),
      computeTextureEntry(b.depth, 'float', '2d', stage),
      // Behind the water the depth is the water pass's linear copy (a float texture read by load alone), else the scene's own.
      computeTextureEntry(b.sceneDepth, under ? 'unfilterable-float' : 'depth', '2d', stage),
      computeSamplerEntry(b.sampler, 'filtering', stage),
      computeTextureEntry(b.water, 'float', '2d', stage),
    ]
    imageEntries.set(kind, entries)
  }
  return entries
}

/** The blend over the HDR image: the cloud's luminance added to the image multiplied by its
 *  transmittance (the output's alpha), the image's alpha, the share of the background left visible,
 *  multiplied by it as well. */
const COMPOSE_TARGET: GPUColorTargetState = {
  format: HDR_FORMAT,
  blend: {
    color: LIGHT_THROUGH,
    alpha: SCALED_BY_ALPHA,
  },
}

/** The alpha holdout's second draw: the coverage the clouds, the haze and the fog in front
 *  of them hold out, as the trace wrote it, the output's alpha, added to the image's alpha — the alpha alone is written
 *  (`GPUColorWrite.ALPHA`), after the first draw multiplied it by the clouds' transmittance. */
const COMPOSE_HELD_TARGET: GPUColorTargetState = {
  format: HDR_FORMAT,
  writeMask: ALPHA_ONLY,
  blend: {
    // The write mask is the alpha alone: the colour component is never written, `KEEP_ALPHA` only fills the field.
    color: KEEP_ALPHA,
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  },
}

/** A debug view of a direct trace (`cloudDebugView`) replaces the lit image's colour with the view's: no blend, the image's alpha kept. */
const COMPOSE_REPLACE_TARGET: GPUColorTargetState = {
  format: HDR_FORMAT,
  writeMask: COLOUR_ONLY,
}

/** What a composition draws: the clouds over the lit image, the coverage the alpha holdout adds to its alpha, a debug view
 *  of a direct trace in place of it, or the clouds over the scene copy behind the water. */
export type ComposeKind = 'over' | 'holdout' | 'replace' | 'behindWater'

/** The clouds laid into the scene copy behind the water: as `over`, the copy's colour alone (its alpha is not the cloud's). */
const COMPOSE_BEHIND_TARGET: GPUColorTargetState = {
  format: HDR_FORMAT,
  writeMask: COLOUR_ONLY,
  blend: { color: LIGHT_THROUGH, alpha: KEEP_ALPHA },
}

export const COMPOSE_TARGETS: Record<ComposeKind, GPUColorTargetState> = {
  behindWater: COMPOSE_BEHIND_TARGET,
  over: COMPOSE_TARGET,
  holdout: COMPOSE_HELD_TARGET,
  replace: COMPOSE_REPLACE_TARGET,
}

const groupsByKind = new Map<string, GPUBindGroupLayoutEntry[][]>()

/** The composition's layouts: group 0 the air's, group 1 the cloud images'. */
const composeGroups = (setup: CloudSetup, under: boolean) => {
  const kind = `${setup.minMaxDepth}${under}`
  let groups = groupsByKind.get(kind)
  if (!groups) {
    groups = [
      airLayoutEntries(COMPOSE_AIR_BINDINGS, GPUShaderStage.FRAGMENT),
      composeEntries(setup, under),
    ]
    groupsByKind.set(kind, groups)
  }
  return groups
}

/** What the pass draws for `setup`: a full-screen triangle over the `view` pixels of the HDR image,
 *  its layouts (group 0 the air's, group 1 the cloud images'), its two entries and its blend. */
export function describeCompose(
  view: Size,
  setup: CloudSetup,
  localFog = true,
  kind: ComposeKind = 'over',
) {
  return {
    code: composeProgram(setup, localFog, kind === 'holdout', kind === 'behindWater'),
    vertexEntry: 'fullscreen',
    fragmentEntry: 'composeMain',
    groups: composeGroups(setup, kind === 'behindWater'),
    target: COMPOSE_TARGETS[kind],
    viewport: view,
    uniformFloats: COMPOSE_VIEW.words,
    sampler: RECONSTRUCT_SAMPLER,
  }
}
