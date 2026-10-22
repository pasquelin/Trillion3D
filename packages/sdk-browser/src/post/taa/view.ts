import {
  matrixAtRenderOrigin,
  inverseAtRenderOrigin,
} from '../../../../math/src/projection/renderOrigin.ts'

import { transformDirectionRow } from '../../../../math/src/vector/vector.ts'
import { TAA_VIEW, TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { MAX_HISTORY_SAMPLES } from './historyWgsl.ts'
import { THIN_GEOMETRY_PERIODS, flickerCountRate, flickerParallaxInverse } from './flickerWgsl.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { stochasticSlot, type TaaFrameState } from './frameState.ts'
import { TAA_LEVEL_KNOBS, type AnalysisWork, type TaaLevelKnobs } from './levels.ts'

const T = TAA_VIEW.at,
  anchored = new Float64Array(16),
  packed = new Float32Array(TAA_VIEW_BYTES / 4)

/** The exposure every measured colour of the pass is exposed by: the view's pre-exposure
 *  (`../exposure/applied.ts`), kept above zero so its ratio to the last image's stays finite. */
export const taaExposure = (exposure: number) => Math.max(exposure, 1e-6)

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
 * of `into`: `previous` and the inverse of `current`, both anchored at `eye`, then `grid`. The
 * temporal pass's uniform starts with it.
 */
function writeReprojection(
  into: Float32Array,
  previous: ArrayLike<number>,
  current: ArrayLike<number>,
  eye: ArrayLike<number>,
  grid: readonly number[],
) {
  matrixAtRenderOrigin(into, previous, eye, T.prevViewProj)
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

/** The device depth of a point on the view axis at distance `s`, `(a·s + b) / (c·s + d)`, for the
 *  perspective `projection` (column-major): the terms `(a, b, c, d)`, with `s` the distance ahead
 *  of the eye whichever way the projection looks (`a` and `c` carry the sign that puts it so). */
export function depthTermsAhead(projection: ArrayLike<number>) {
  const ahead = Math.sign(projection[11]) || 1
  return [projection[10] * ahead, projection[14], projection[11] * ahead, projection[15]] as const
}

/**
 * The pass's uniform for this frame (`TaaView`, `bindingsWgsl.ts`): both matrices at the eye, the
 * display grid the history has, whether the history describes nothing (a cut), the display layers'
 * history holds the last image's (`layers`), a placement moved (`moved`), the `render` grid the frame
 * was drawn in, its jitter and its rank, the eye and whether a GPU deformation moved (`deformed`);
 * the `exposure` every measured colour is exposed by (`taaExposure`), and its ratio to the last
 * image's; the flicker rates for a frame `frameIntervalMs` long; what the resolve outputs in place
 * of the accumulated colour (`output`, `taaViewCode`); the camera's parallax since the last image; the blend factor a whole shading history takes the image at (`MAX_HISTORY_SAMPLES`); the
 * projection's depth terms;
 * the last image's render grid and the render-resolution histories' allocated size (`analysisGrid`);
 * the level's `knobs`, the finest level's by default, and the `work` the image runs, the level's
 * by default (`AnalysisWork`).
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
  exposure = taaExposure(1),
  frameIntervalMs: number | null = null,
  output = 0,
  knobs: TaaLevelKnobs = TAA_LEVEL_KNOBS.max,
  work: AnalysisWork = knobs.work,
) {
  // Inverse of the view-projection WITHOUT jitter: the reprojected pixel is its unshifted centre,
  // with the depth read at the shifted sample. At a fixed camera, history is thus re-read exactly
  // on its texel — re-read to the jitter, it would be resampled bilinearly every image and would
  // soften without end.
  writeReprojection(packed, state.previousViewProjection, cam.viewProjection, cam.eye, display)
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
  packed[T.exposure] = exposure
  packed[T.exposure + 1] = state.hasHistory ? exposure / state.previousExposure : 1
  packed[T.exposure + 2] = flickerCountRate(frameIntervalMs)
  packed[T.exposure + 3] = flickerCountRate(frameIntervalMs, THIN_GEOMETRY_PERIODS)
  // The last projection of the eye's move since: `previous · (lastEye − eye, 0)`, its three first
  // columns, which anchoring at the eye leaves as they are.
  const last = state.previousViewProjection,
    { eye } = cam,
    dx = state.previousEye[0] - eye[0],
    dy = state.previousEye[1] - eye[1],
    dz = state.previousEye[2] - eye[2]
  for (let row = 0; row < 4; row++)
    packed[T.parallax + row] = transformDirectionRow(last, row, dx, dy, dz)
  packed[T.rates] = flickerParallaxInverse(render[0], frameIntervalMs)
  // The blend factor of a render pixel's history holding the image's samples, at this render scale.
  packed[T.rates + 1] = 1 / (1 + MAX_HISTORY_SAMPLES / (render[0] / display[0]) ** 2)
  packed.fill(0, T.rates + 2, T.rates + 4)
  writeDepthTerms(packed, cam.projection, cam.perspective !== 0, render[0])
  writeGrid(packed, T.prevRender, state.previousRender[0] > 0 ? state.previousRender : render)
  writeGrid(packed, T.analysisGrid, analysisGrid)
  packed[T.quality] = knobs.flicker ? 1 : 0
  packed[T.quality + 1] = knobs.antiAliasIterations
  packed[T.quality + 2] = knobs.movesFar ? 1 : 0
  packed[T.quality + 3] = Number(work.thin)
  device.queue.writeBuffer(uniform, 0, packed)
}
