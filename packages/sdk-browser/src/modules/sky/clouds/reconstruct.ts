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
import {
  BOUNDS_FIELD,
  CLOUD_FORMAT,
  cloudSizes,
  nextCycleRank,
  put4,
  traceOffset,
  writeSafeBounds,
  writeViewScale,
  type ImageSize,
  type Size,
} from './reconstructLayout.ts'
import { RECONSTRUCT_BINDING, RECONSTRUCT_VIEW, reconstructProgram } from './reconstructWgsl.ts'

/**
 * THE CLOUDS' RECONSTRUCTION, described: what the pass binds, writes and draws, and the state it
 * keeps from one image to the next. Nothing here touches the GPU; the pass's owner makes the
 * textures (`reconstructLayout.ts`) and the pipeline from the description.
 */

/** What the reconstruction keeps between images, for one view. */
export interface CloudViewState {
  /** The rank of the last image in the 2×2 cycle. */
  rank: number
  /** Which of the two reconstructed images the next one is written to. */
  current: 0 | 1
  /** The target size the images were made for: none before the first image, which is how a view
   *  with no image yet is known. */
  allocated: Size | null
  /** Each reconstructed image's texture and the part of it its image filled. */
  images: [ImageSize | null, ImageSize | null]
  /** The last image's view-projection without jitter, which its history describes. */
  previousViewProjection: Float64Array
}

/** What a view holds before an image and after a reset: the first image is written to image 0. */
const emptyView = () => ({
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
export const resetCloudView = (state: CloudViewState) => void Object.assign(state, emptyView())

const sameSize = (a: Size | null, b: Size) => a?.width === b.width && a?.height === b.height

/** What one image does: the sizes, its place in the cycle, which image it is written to and which
 *  one is its history, and what is to be made again. */
export interface CloudFramePlan {
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
 * The next image of a view drawn in a target allocated at `allocated`, its view `view` pixels: the
 * cycle moves on (restarting at a first image or a `cut`), the two reconstructed images swap, the
 * traced images are made again when the target's size changed, the destination when its texture is
 * not the size. The history is the other image, unless a cut.
 */
export function advanceCloudView(
  state: CloudViewState,
  allocated: Size,
  view: Size,
  cut: boolean,
): CloudFramePlan {
  const sizes = cloudSizes(allocated, view)
  state.rank = nextCycleRank(state.rank, state.allocated === null || cut)
  state.current = state.current === 0 ? 1 : 0
  const tracedStale = !sameSize(state.allocated, allocated)
  state.allocated = allocated
  const destinationStale = !sameSize(
    state.images[state.current]?.texture ?? null,
    sizes.reconstructed.texture,
  )
  state.images[state.current] = sizes.reconstructed
  const history = cut ? null : state.images[state.current === 0 ? 1 : 0]
  return {
    sizes,
    rank: state.rank,
    offset: traceOffset(state.rank),
    destination: state.current,
    history,
    tracedStale,
    destinationStale,
  }
}

/** After the pass: the image's view-projection without jitter is the next one's history. */
export const commitCloudView = (state: CloudViewState, viewProjection: ArrayLike<number>) =>
  void state.previousViewProjection.set(viewProjection)

const anchored = new Float64Array(16),
  inverse = new Float64Array(16)

/** What the uniform is written from. */
export interface ReconstructInput {
  readonly plan: CloudFramePlan
  /** The eye, and the image's view-projection without jitter. */
  readonly eye: ArrayLike<number>
  readonly viewProjection: ArrayLike<number>
  /** The projection (column-major): its depth terms, a perspective's. */
  readonly projection: ArrayLike<number>
  readonly state: CloudViewState
}

/** The reconstruction's uniform (`RECONSTRUCT_VIEW`) into `out`, `RECONSTRUCT_VIEW.words` floats.
 *  The history's matrix is the last image's, at this image's eye; the part's `gpu` values give the
 *  two distances. A frame with no history leaves the history's bounds empty: its program does not
 *  read them. */
export function writeReconstructView(out: Float32Array, input: ReconstructInput, part: CloudPart) {
  const { plan, eye, projection, state } = input
  const at = RECONSTRUCT_VIEW.at
  matrixAtRenderOrigin(out, state.previousViewProjection, eye, at.previousViewProj)
  out.set(inverseAtRenderOrigin(inverse, anchored, input.viewProjection, eye), at.inverseViewProj)
  const { view } = plan.sizes.reconstructed
  put4(out, at.destination, view.width, view.height, 1 / view.width, 1 / view.height)
  put4(out, at.offset, plan.offset[0], plan.offset[1], 0, 0)
  // The device depth of a point on the view axis at distance `s`: (a·s + b) / (c·s + d).
  const ahead = Math.sign(projection[11]) || 1
  put4(
    out,
    at.depthTerms,
    projection[10] * ahead,
    projection[14],
    projection[11] * ahead,
    projection[15],
  )
  const { cloudReprojectionMinDistanceKm, cloudDisocclusionMaxDistanceKm } = part.quality
  put4(out, at.distances, cloudReprojectionMinDistanceKm, cloudDisocclusionMaxDistanceKm, 0, 0)
  writeSafeBounds(out, at.traced, plan.sizes.traced)
  const past = plan.history
  if (past) writeSafeBounds(out, at.history, past)
  else out.fill(0, at.history, at.history + BOUNDS_FIELD.words)
  writeViewScale(out, at.uvScales, plan.sizes.traced)
  if (past) writeViewScale(out, at.uvScales + 2, past)
  else out.fill(1, at.uvScales + 2, at.uvScales + 4)
  return out
}

const entriesByHistory = new Map<boolean, GPUBindGroupLayoutEntry[]>()

/** The bind group layout entries of the pass, with or without a history (`RECONSTRUCT_BINDING`),
 *  made once for each and shared: they are not to be changed. */
export function reconstructEntries(history: boolean) {
  let entries = entriesByHistory.get(history)
  if (!entries) {
    const stage = GPUShaderStage.FRAGMENT,
      b = RECONSTRUCT_BINDING
    const images = history
      ? [b.colour, b.secondary, b.depth, b.historyColour, b.historySecondary, b.historyDepth]
      : [b.colour, b.secondary, b.depth]
    entries = [
      computeUniformEntry(b.view, {}, stage),
      ...images.map((binding) => computeTextureEntry(binding, 'float', '2d', stage)),
      computeSamplerEntry(b.sampler, 'filtering', stage),
    ]
    entriesByHistory.set(history, entries)
  }
  return entries
}

/** The three targets of the pass: the colour, the secondary colour, the depth. */
const TARGETS: GPUTextureFormat[] = [CLOUD_FORMAT, CLOUD_FORMAT, CLOUD_FORMAT]

/** What the pass draws: a full-screen triangle over the reconstructed view, into three targets of
 *  `CLOUD_FORMAT` (the colour, the secondary colour, the depth), the whole pixel written. */
export function describeReconstruct(plan: CloudFramePlan) {
  const history = plan.history !== null
  return {
    history,
    code: reconstructProgram(history),
    vertexEntry: 'fullscreen',
    fragmentEntry: 'reconstructMain',
    entries: reconstructEntries(history),
    targets: TARGETS,
    viewport: plan.sizes.reconstructed.view,
    uniformFloats: RECONSTRUCT_VIEW.words,
  }
}
