import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import {
  matrixAtRenderOrigin,
  inverseAtRenderOrigin,
} from '../../../../math/src/projection/renderOrigin.ts'

import { transformDirectionRow } from '../../../../math/src/vector/vector.ts'
import { TAA_VIEW, TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { historySampleLaws } from './historyWgsl.ts'
import { THIN_GEOMETRY_PERIODS, flickerCountRate, flickerParallaxInverse } from './flickerRates.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { stochasticSlot, type TaaFrameState } from './frameState.ts'
import { TAA_LEVEL_KNOBS, type AnalysisWork, type TaaLevelKnobs } from './levels.ts'
import {
  TEMPORAL_DEFAULTS,
  type TemporalValues,
} from '../../../../sdk-core/src/contracts/temporalOptions.ts'

const T = TAA_VIEW.at,
  anchored = new Float64Array(16),
  packed = new Float32Array(TAA_VIEW_BYTES / 4),
  packedWords = new Uint32Array(packed.buffer)

/** What the pass's uniform says of its history (`writeTaaView`): its size and its size over the
 *  display's, whether the level reprojects by the field and the speed from which the field
 *  anti-aliases its dilation, whether this image may resurrect a pixel from the frame the
 *  frames' walk names (`FrameSlices`), and the pass's settings, which its laws, its flicker
 *  measure and its thin geometry detection take (`TemporalValues`). */
export interface TaaHistoryTerms {
  readonly width: number
  readonly height: number
  /** The history's size over the display's per axis, 1 to 2. */
  readonly scale: number
  readonly field: boolean
  /** The speed, in display pixels an image, from which the field anti-aliases. */
  readonly fieldSpeed: number
  readonly resurrects: boolean
  readonly settings: TemporalValues
}

/** The speed floor of the field's anti-aliasing, in render pixels an image: a 64th. */
const FIELD_SPEED_FLOOR = 1 / 64

/** Writes `(width, height, 1/width, 1/height)` of `grid` at `at`. */
function writeGrid(into: Float32Array, at: number, grid: ArrayLike<number>) {
  const width = grid[0],
    height = grid[1]
  into[at] = width
  into[at + 1] = height
  into[at + 2] = 1 / width
  into[at + 3] = 1 / height
}

/**
 * The header `TAA_REPROJECT_WGSL` reads (`prevViewProj`, `invViewProj`, `viewport`), floats 0 to 35
 * of `into`: `previous` and the inverse of `current`, both anchored at `eye`, then `grid`; and, at
 * the end of the uniform, the inverse of `previous` (`prevInvViewProj`). The temporal pass's
 * uniform starts with the header.
 */
function writeReprojection(
  into: Float32Array,
  previous: ArrayLike<number>,
  current: ArrayLike<number>,
  eye: ArrayLike<number>,
  grid: readonly number[],
) {
  matrixAtRenderOrigin(into, previous, eye, T.prevViewProj)
  into.set(inverseAtRenderOrigin(anchored, anchored, previous, eye), T.prevInvViewProj)
  into.set(inverseAtRenderOrigin(anchored, anchored, current, eye), T.invViewProj)
  writeGrid(into, T.viewport, grid)
}

/**
 * The projection's depth terms (`view.depth`, `view.radius`, `depthWgsl.ts`) from the column-major
 * `projection`, whether it is a `perspective` one (`EngineCamera.perspective`), and the render
 * width: a view point `(0, 0, t)` projects to `z = p₁₀·t + p₁₄`,
 * `w = p₁₁·t + p₁₅`; its scene depth is `|t|`, `t` of the sign that puts it ahead (`radius.z`). A
 * render pixel's world radius is `1 / (|p₀| · width)` per unit of depth under a perspective, at any
 * depth under an orthographic projection (`radius.w`).
 */
function writeDepthTerms(
  into: Float32Array,
  projection: ArrayLike<number>,
  perspective: boolean,
  renderWidth: number,
) {
  into[T.depth] = projection[10]
  into[T.depth + 1] = projection[14]
  into[T.depth + 2] = projection[11]
  into[T.depth + 3] = projection[15]
  const radius = 1 / ((Math.abs(projection[0]) || 1) * renderWidth)
  into[T.radius] = perspective ? radius : 0
  into[T.radius + 1] = perspective ? 0 : radius
  into[T.radius + 2] = perspective ? Math.sign(projection[11]) : -Math.sign(projection[10]) || 1
  into[T.radius + 3] = perspective ? 0 : 1
}

/** `writeDepthTerms` through `terms` (a block of `TAA_VIEW.words`), then the two vectors a pass's
 *  uniform takes of them, `depth` and `radius`, copied to `out` at the words `at` names. */
export function putDepthTerms(
  out: Float32Array,
  at: { readonly depth: number; readonly radius: number },
  terms: Float32Array,
  projection: ArrayLike<number>,
  perspective: boolean,
  renderWidth: number,
) {
  writeDepthTerms(terms, projection, perspective, renderWidth)
  for (let k = 0; k < 4; k++) {
    out[at.depth + k] = terms[T.depth + k]
    out[at.radius + k] = terms[T.radius + k]
  }
}

/** The device depth of a point on the view axis at distance `s`, `(a·s + b) / (c·s + d)`, for the
 *  perspective `projection` (column-major): the terms `(a, b, c, d)`, with `s` the distance ahead
 *  of the eye whichever way the projection looks (`a` and `c` carry the sign that puts it so). */
export function depthTermsAhead(
  projection: ArrayLike<number>,
): readonly [number, number, number, number]
/** The same terms written in place at `out[offset..offset + 4]`, with no array made. */
export function depthTermsAhead(
  projection: ArrayLike<number>,
  out: Float32Array,
  offset: number,
): void
export function depthTermsAhead(projection: ArrayLike<number>, out?: Float32Array, offset = 0) {
  const ahead = Math.sign(projection[11]) || 1
  const a = projection[10] * ahead
  const c = projection[11] * ahead
  if (!out) return [a, projection[14], c, projection[15]] as const
  out[offset] = a
  out[offset + 1] = projection[14]
  out[offset + 2] = c
  out[offset + 3] = projection[15]
}

/** Whether the flicker measure runs: the level (or `temporalShadingRejectionFlickering`) rejects by
 *  it and the period is not 0. */
const flickers = (knobs: TaaLevelKnobs, settings: TemporalValues) =>
  knobs.flicker && settings.temporalFlickeringPeriod > 0

/** Whether the detection tells the foliage from the other lit surfaces (`thinFade.w`): the varying
 *  shading range, with the flicker measure running or the line contrast not 0. Else only the foliage
 *  counts and every texel takes the dilation. */
const varyingRange = (knobs: TaaLevelKnobs, settings: TemporalValues) =>
  settings.temporalThinGeometryShadingRange === 'varying' &&
  (flickers(knobs, settings) || settings.temporalThinGeometryMinKeepLineContrast !== 0)

/** The thin geometry detection's words (`thin`, `thinFade`) from the settings: the depth step in
 *  pixel depth errors is the multiplier, at its twentieth and one at least where the range varies. */
function writeThin(knobs: TaaLevelKnobs, settings: TemporalValues) {
  const varying = varyingRange(knobs, settings)
  packed[T.thin] = varying
    ? Math.max(settings.temporalThinGeometryErrorMultiplier * 0.05, 1)
    : settings.temporalThinGeometryErrorMultiplier
  packed[T.thin + 1] = settings.temporalThinGeometryMinKeepLineContrast
  packed[T.thin + 2] = settings.temporalThinGeometryLineWeight
  packed[T.thin + 3] = settings.temporalThinGeometryRejectTranslucency
  packed[T.thinFade] = settings.temporalThinGeometryLineFadeRate
  packed[T.thinFade + 1] = settings.temporalThinGeometryLineFadeRateInsideRegion
  packed[T.thinFade + 2] = settings.temporalThinGeometryMaxRelaxationWeight
  packed[T.thinFade + 3] = varying ? 1 : 0
}

/** The uniform's pre-exposure words: the ratio of the pre-exposures of this image and the last,
 *  which brings the histories kept in an exposed space, and the history's light, to this image's (1
 *  with no history), the factor the shading rejection's measures are lifted by, and the flicker
 *  count's two fade-in rates. */
function writePreExposure(
  state: TaaFrameState,
  preExposureRatio: number,
  frameIntervalMs: number | null,
  settings: TemporalValues,
) {
  packed[T.preExposure] = state.hasHistory ? preExposureRatio : 1
  packed[T.preExposure + 1] = 2 ** settings.temporalShadingExposureOffset
  packed[T.preExposure + 2] = flickerCountRate(frameIntervalMs, 1, settings)
  packed[T.preExposure + 3] = flickerCountRate(frameIntervalMs, THIN_GEOMETRY_PERIODS, settings)
}

/**
 * The history's words of the pass's uniform: its grid (`viewport`), its sample laws and speed's
 * scale (`history`, `fraction`: `historySampleLaws` of its size over the display's), the field's
 * squared speed threshold in render pixels, whether the level reprojects by it, and, where this
 * image may resurrect a pixel, the frame it may resurrect from (`state.slices.resurrection`): its
 * grid, the ratio of this image's light to its, and this frame's clip space at this
 * eye to its (`resurrection`, `resurrectGrid`, `toResurrection`). The display's grid and none of the
 * rest where the pass has no history yet.
 */
function writeHistory(
  state: TaaFrameState,
  render: readonly number[],
  display: readonly number[],
  pre: number,
  eye: ArrayLike<number>,
  terms?: TaaHistoryTerms,
) {
  const scale = terms?.scale ?? 1
  const laws = historySampleLaws(scale, terms?.settings)
  writeGrid(packed, T.viewport, terms ? [terms.width, terms.height] : display)
  packed[T.history] = laws.samples
  packed[T.history + 1] = laws.hysteresis
  packed[T.history + 2] = laws.rejectedDrop
  packed[T.history + 3] = laws.movingDrop
  packed[T.fraction] = laws.speedInverse
  packed[T.fraction + 1] = scale
  const speed = Math.max((terms?.fieldSpeed ?? 0) / (render[0] / display[0]), FIELD_SPEED_FLOOR)
  packed[T.fraction + 2] = speed * speed
  packed[T.fraction + 3] = terms?.field ? 1 : 0
  const from = terms?.resurrects ? state.ring.frames[state.slices.resurrection] : undefined
  packed[T.resurrection] = from ? 1 : 0
  if (!from) {
    // Nothing to resurrect from: the words that describe that frame hold no earlier image's.
    packed[T.resurrection + 1] = 0
    packed.fill(0, T.resurrectGrid, T.resurrectGrid + 4)
    packed.fill(0, T.toResurrection, T.toResurrection + 16)
    return
  }
  const light = pre / from.preExposure
  packed[T.resurrection + 1] = light
  writeGrid(packed, T.resurrectGrid, from.render)
  matrixAtRenderOrigin(packed, from.viewProjection, eye, T.toResurrection)
}

/** The last projection of the eye's move since: `previous · (lastEye − eye, 0)`, its three first
 *  columns, which anchoring at the eye leaves as they are. */
function writeParallax(state: TaaFrameState, cam: EngineCamera) {
  const last = state.before.viewProjection,
    { eye } = cam,
    dx = state.before.eye[0] - eye[0],
    dy = state.before.eye[1] - eye[1],
    dz = state.before.eye[2] - eye[2]
  for (let row = 0; row < 4; row++)
    packed[T.parallax + row] = transformDirectionRow(last, row, dx, dy, dz)
}

/** What the level runs: the flicker measure, the anti-aliaser's iterations, the far neighbour's
 *  move, and the thin geometry detection. */
function writeQuality(knobs: TaaLevelKnobs, work: AnalysisWork, settings: TemporalValues) {
  packed[T.quality] = flickers(knobs, settings) ? 1 : 0
  packed[T.quality + 1] = knobs.antiAliasIterations
  packed[T.quality + 2] = knobs.movesFar ? 1 : 0
  packed[T.quality + 3] = Number(work.thin)
}

/**
 * The pass's uniform for this frame (`TaaView`, `bindingsWgsl.ts`): both matrices at the eye, the
 * display grid the history has, whether the history describes nothing (a cut), the display layers'
 * history holds the last image's (`layers`), a placement moved (`moved`), the `render` grid the frame
 * was drawn in, its jitter and its rank, the eye — and in doubles — and whether a GPU deformation moved (`deformed`);
 * the ratio of the pre-exposures of this image and the last (`preExposureRatio`); the flicker rates for a frame `frameIntervalMs` long; what the resolve outputs in place
 * of the accumulated colour (`output`, `taaViewCode`); the camera's parallax since the last image; the blend factor a whole shading history takes the image at (`temporalHistorySampleCount`); the
 * projection's depth terms;
 * the last image's render grid and the render-resolution histories' allocated size (`analysisGrid`);
 * the level's `knobs`, the finest level's by default, and the `work` the image runs, the level's
 * by default (`AnalysisWork`); the history's size and laws and what of the frame a pixel may be
 * resurrected from the uniform holds (`history`, `TaaHistoryTerms`: the display's size and no
 * resurrection by default), `pre` this image's pre-exposure.
 */
export function writeTaaView(
  device: GPUDevice,
  uniform: GPUBuffer,
  state: TaaFrameState,
  cam: EngineCamera,
  render: readonly number[],
  display: readonly number[],
  analysisGrid: readonly number[],
  moved: boolean,
  layers = false,
  deformed = false,
  frameIntervalMs: number | null = null,
  output = 0,
  knobs: TaaLevelKnobs = TAA_LEVEL_KNOBS.max,
  work: AnalysisWork = knobs.work,
  preExposureRatio = 1,
  history?: TaaHistoryTerms,
  pre = 1,
) {
  // Inverse of the view-projection WITHOUT jitter: the reprojected pixel is its unshifted centre,
  // with the depth read at the shifted sample. At a fixed camera, history is thus re-read exactly
  // on its texel — re-read to the jitter, it would be resampled bilinearly every image and would
  // soften without end.
  writeReprojection(packed, state.before.viewProjection, cam.viewProjection, cam.eye, display)
  writeHistory(state, render, display, pre, cam.eye, history)
  // A view cut or no history yet: every history is off screen, the image taken whole.
  packed[T.params] = state.hasHistory ? 0 : 1
  packed[T.params + 1] = layers ? 1 : 0
  packed[T.params + 2] = moved ? 1 : 0
  packed[T.params + 3] = output
  writeGrid(packed, T.render, render)
  packed[T.jitter] = state.jitter[0]
  packed[T.jitter + 1] = state.jitter[1]
  packed[T.jitter + 2] = state.stochasticSample
  packed[T.jitter + 3] = stochasticSlot(state)
  packed.set(cam.eye, T.eye)
  packed[T.eye + 3] = deformed ? 1 : 0
  packDoubles(packedWords, T.exactEye, cam.eye, 0, 3)
  const settings = history?.settings ?? TEMPORAL_DEFAULTS
  writePreExposure(state, preExposureRatio, frameIntervalMs, settings)
  writeParallax(state, cam)
  packed[T.rates] = flickerParallaxInverse(render[0], frameIntervalMs, settings)
  packed[T.rates + 2] = settings.temporalShadingRejectionMode === 'responsive' ? 1 : 0
  packed[T.rates + 3] = settings.temporalThinGeometryAntiFlickering ? 1 : 0
  // The blend factor of a render pixel's history holding the image's samples, at this render scale.
  packed[T.rates + 1] =
    1 / (1 + settings.temporalHistorySampleCount / (render[0] / display[0]) ** 2)
  writeThin(knobs, settings)
  writeDepthTerms(packed, cam.projection, cam.perspective !== 0, render[0])
  writeGrid(packed, T.prevRender, state.previousRender[0] > 0 ? state.previousRender : render)
  writeGrid(packed, T.analysisGrid, analysisGrid)
  writeQuality(knobs, work, settings)
  device.queue.writeBuffer(uniform, 0, packed)
}
