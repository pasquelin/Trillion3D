import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import {
  inverseAtRenderOrigin,
  matrixAtRenderOrigin,
} from '../../../../../math/src/projection/renderOrigin.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import { depthTermsAhead } from '../../../post/taa/view.ts'
import {
  DEFAULT_CLOUD_SETUP,
  cloudLayoutKey,
  composeScale,
  nextCycleRank,
  scaledTarget,
  traceOffset,
  type CloudSetup,
} from './cloudModes.ts'
import { COMPOSE_AIR_BINDINGS } from './composeWgsl.ts'
import {
  BOUNDS_FIELD,
  CLOUD_FORMAT,
  cloudSizes,
  writeSafeBounds,
  writeTracingJitter,
  writeViewScale,
  type ImageSize,
  type Size,
} from './reconstructLayout.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import {
  RECONSTRUCT_BINDING,
  RECONSTRUCT_VIEW,
  readsHalfDepth,
  reconstructKind,
  reconstructProgram,
} from './reconstructWgsl.ts'

/**
 * THE CLOUDS' RECONSTRUCTION, described: what the pass binds, writes and draws, and the state it
 * keeps from one image to the next. Nothing here touches the GPU; the pass's owner makes the
 * textures (`reconstructLayout.ts`) and the pipeline from the description.
 */

/** What the reconstruction keeps between images, for one view. */
export interface CloudViewState {
  /** The images' layout (`cloudLayoutKey`), none before the first image: a change of it starts the
   *  view again. */
  layout: string | null
  /** The rank of the last image in the cycle. */
  rank: number
  /** Which of the two reconstructed images the next one is written to. */
  current: 0 | 1
  /** The target size (on the target's scale) the images were made for: none before the first
   *  image, which is how a view with no image yet is known. */
  allocated: Size | null
  /** Each reconstructed image's texture and the part of it its image filled. */
  images: [ImageSize | null, ImageSize | null]
  /** The last image's view-projection without jitter, which its history describes. */
  previousViewProjection: Float64Array
}

/** What a view holds before an image and after a reset: the first image is written to image 0. */
const emptyView = () => ({
  layout: null,
  rank: 0,
  current: 1 as const,
  allocated: null,
  images: [null, null] as [ImageSize | null, ImageSize | null],
})

export const createCloudViewState = (): CloudViewState => ({
  ...emptyView(),
  previousViewProjection: new Float64Array(16),
})

/** The state with nothing kept: the clouds are not drawn, and every image is to be freed. */
const resetCloudView = (state: CloudViewState) => void Object.assign(state, emptyView())

const sameSize = (a: Size | null, b: Size) => a?.width === b.width && a?.height === b.height

/** What one image does: the sizes, its place in the cycle, which image it is written to and which
 *  one is its history, and what is to be made again. */
export interface CloudFramePlan {
  /** What the image is made with; the part's own when none is given (the sky light's capture). */
  readonly setup?: CloudSetup
  readonly sizes: ReturnType<typeof cloudSizes>
  readonly rank: number
  readonly offset: readonly [number, number]
  readonly destination: 0 | 1
  /** The image written last, when it describes this one: none after a cut. */
  readonly history: ImageSize | null
  /** The traced images are made again, at their size. */
  readonly tracedStale: boolean
  /** The destination image is made again, at its size. */
  readonly destinationStale: boolean
}

/**
 * The next image of a view drawn in a target allocated at `allocated`, its view `view` pixels, with
 * `setup`: the sizes are those of the setup's target (mode 2 scales it); the cycle moves on
 * (restarting at a first image or a `cut`), the two reconstructed images swap, the traced images
 * are made again when the target's size changed, the destination when its texture is not the size.
 * The history is the other image, unless a cut; a mode that does not reconstruct (1 and 3) has no
 * reconstructed image, so no destination and no history. A change of the images' layout (mode, two
 * surfaces or one) starts the view again.
 */
export function advanceCloudView(
  state: CloudViewState,
  allocated: Size,
  view: Size,
  cut: boolean,
  setup: CloudSetup,
): CloudFramePlan {
  const { mode } = setup
  const layout = cloudLayoutKey(setup)
  if (state.layout !== layout) resetCloudView(state)
  state.layout = layout
  const target = scaledTarget(setup, allocated)
  const sizes = cloudSizes(target, scaledTarget(setup, view), mode)
  state.rank = nextCycleRank(mode, state.rank, state.allocated === null || cut)
  state.current = state.current === 0 ? 1 : 0
  const tracedStale = !sameSize(state.allocated, target)
  state.allocated = target
  const base = { setup, sizes, rank: state.rank, offset: traceOffset(mode, state.rank) }
  if (!mode.reconstructs) {
    return { ...base, destination: 0, history: null, tracedStale, destinationStale: false }
  }
  const destinationStale = !sameSize(
    state.images[state.current]?.texture ?? null,
    sizes.reconstructed.texture,
  )
  state.images[state.current] = sizes.reconstructed
  const history = cut ? null : state.images[state.current === 0 ? 1 : 0]
  return { ...base, destination: state.current, history, tracedStale, destinationStale }
}

/** After the pass: the image's view-projection without jitter is the next one's history. */
export const commitCloudView = (state: CloudViewState, viewProjection: ArrayLike<number>) =>
  void state.previousViewProjection.set(viewProjection)

const anchored = new Float64Array(16),
  inverse = new Float64Array(16)

/** The setup of a plan: its own, the default's (mode 0, two surfaces) when it has none. */
export const setupOfPlan = (plan: CloudFramePlan) => plan.setup ?? DEFAULT_CLOUD_SETUP

/** What the uniform is written from. */
export interface ReconstructInput {
  readonly plan: CloudFramePlan
  /** The eye, and the image's view-projection without jitter. */
  readonly eye: ArrayLike<number>
  readonly viewProjection: ArrayLike<number>
  /** The projection (column-major): its depth terms, a perspective's. */
  readonly projection: ArrayLike<number>
  readonly state: CloudViewState
  /** The ratio of this image's pre-exposure to the history's (`PreExposure`; 1 when absent): the
   *  history's light was written multiplied by the history's. */
  readonly preExposureRatio?: number
  /** The pre-exposure the image's light is written multiplied by (`PreExposure.now`): the fog laid on
   *  the image is, like the cloud's own luminance. 1 when absent. */
  readonly preExposure?: number
}

/** The reconstruction's uniform (`RECONSTRUCT_VIEW`) into `out`, `RECONSTRUCT_VIEW.words` floats.
 *  The history's matrix is the last image's, at this image's eye; the part's `gpu` values give the
 *  two distances; the fog laid on the image takes the pre-exposure and the view's pixels a texel
 *  stands for. A frame with no history leaves the history's bounds empty: its program does not
 *  read them. */
export function writeReconstructView(out: Float32Array, input: ReconstructInput, part: CloudPart) {
  const { plan, eye, projection, state } = input
  const at = RECONSTRUCT_VIEW.at
  matrixAtRenderOrigin(out, state.previousViewProjection, eye, at.previousViewProj)
  out.set(inverseAtRenderOrigin(inverse, anchored, input.viewProjection, eye), at.inverseViewProj)
  const { view } = plan.sizes.reconstructed
  putVec4(out, at.destination, view.width, view.height, 1 / view.width, 1 / view.height)
  putVec4(out, at.offset, plan.offset[0], plan.offset[1], 0, 0)
  writeTracingJitter(out, at.offset + 2, plan.offset, view, setupOfPlan(plan).mode)
  // The device depth of a point on the view axis at distance `s`: (a·s + b) / (c·s + d).
  depthTermsAhead(projection, out, at.depthTerms)
  const { cloudReprojectionMinDistanceKm, cloudDisocclusionMaxDistanceKm } = part.quality
  putVec4(out, at.distances, cloudReprojectionMinDistanceKm, cloudDisocclusionMaxDistanceKm, 0, 0)
  writeSafeBounds(out, at.traced, plan.sizes.traced)
  const past = plan.history
  if (past) writeSafeBounds(out, at.history, past)
  else out.fill(0, at.history, at.history + BOUNDS_FIELD.words)
  writeViewScale(out, at.uvScales, plan.sizes.traced)
  if (past) writeViewScale(out, at.uvScales + 2, past)
  else out.fill(1, at.uvScales + 2, at.uvScales + 4)
  putVec4(out, at.exposure, past ? (input.preExposureRatio ?? 1) : 1, 0, 0, 0)
  putVec4(out, at.fog, input.preExposure ?? 1, 1 / composeScale(setupOfPlan(plan))[0], 0, 0)
  return out
}

const entriesByKey = new Map<string, GPUBindGroupLayoutEntry[]>()

/** The bind group layout entries of the pass for `setup`, with or without a history
 *  (`RECONSTRUCT_BINDING`), made once for each and shared: they are not to be changed. The traced
 *  images are the colour, the secondary colour (two surfaces) and the depth, the history's the
 *  same; the half-size depth is bound by the path that reads the pixel's own. */
function reconstructEntries(setup: CloudSetup, history: boolean) {
  const kind = reconstructKind(setup, history)
  const key = `${history}${setup.minMaxDepth}${readsHalfDepth(kind)}`
  let entries = entriesByKey.get(key)
  if (!entries) {
    const stage = GPUShaderStage.FRAGMENT,
      b = RECONSTRUCT_BINDING
    const surfaces = (colour: number, secondary: number, depth: number) =>
      setup.minMaxDepth ? [colour, secondary, depth] : [colour, depth]
    const images = [
      ...surfaces(b.colour, b.secondary, b.depth),
      ...(history ? surfaces(b.historyColour, b.historySecondary, b.historyDepth) : []),
      ...(readsHalfDepth(kind) ? [b.halfDepth] : []),
    ]
    entries = [
      computeUniformEntry(b.view, {}, stage),
      ...images.map((binding) => computeTextureEntry(binding, 'float', '2d', stage)),
      computeSamplerEntry(b.sampler, 'filtering', stage),
    ]
    entriesByKey.set(key, entries)
  }
  return entries
}

/** The targets of the pass: the colour, the secondary colour (two surfaces), the depth and, with the
 *  fog laid on the image (`lateFogOnTranslucent`), that colour fogged. Four of the cloud format are
 *  32 bytes, the most a pass's targets may hold on any device (`maxColorAttachmentBytesPerSample`). */
const TARGETS = {
  true: {
    true: [CLOUD_FORMAT, CLOUD_FORMAT, CLOUD_FORMAT, CLOUD_FORMAT],
    false: [CLOUD_FORMAT, CLOUD_FORMAT, CLOUD_FORMAT],
  },
  false: {
    true: [CLOUD_FORMAT, CLOUD_FORMAT, CLOUD_FORMAT],
    false: [CLOUD_FORMAT, CLOUD_FORMAT],
  },
} as const satisfies Record<string, Record<string, GPUTextureFormat[]>>

/**
 * What the pass draws: a full-screen triangle over the reconstructed view, into the targets of
 * `CLOUD_FORMAT` (the colour, the secondary colour with two surfaces, the depth, the fogged colour
 * where the translucent surfaces read it), the whole pixel written. With the fog laid on the image
 * the pass's program is of the air's family: `air` is its group 0's layout, `entries` its group 1's.
 * None for a mode that does not reconstruct: the composition reads the traced images.
 */
export function describeReconstruct(plan: CloudFramePlan, localFog = true) {
  const setup = setupOfPlan(plan)
  if (!setup.mode.reconstructs) return null
  const history = plan.history !== null
  return {
    history,
    code: reconstructProgram(setup, history, localFog),
    vertexEntry: 'fullscreen',
    fragmentEntry: 'reconstructMain',
    air: setup.lateFogOnTranslucent
      ? airLayoutEntries(COMPOSE_AIR_BINDINGS, GPUShaderStage.FRAGMENT)
      : undefined,
    entries: reconstructEntries(setup, history),
    targets: TARGETS[`${setup.lateFogOnTranslucent}`][`${setup.minMaxDepth}`],
    viewport: plan.sizes.reconstructed.view,
    uniformFloats: RECONSTRUCT_VIEW.words,
  }
}
