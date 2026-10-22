import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { screenRelativeThickness, screenSlab } from '../../visibility/hiz/gpu/screenSlab.ts'
import type { HeldImage } from './radiance/radiance.ts'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import { gridSide } from './grids.ts'
import {
  defaultReflections,
  type ReflectionSettings,
} from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { REFLECTION_COUNTS } from './constants.ts'

/** What an image tells its reflection view (`createReflectionViewWriter`). */
export type ReflectionFrame = {
  /** The render view-projection the depth was drawn with, jitter included. */
  viewProjection: ArrayLike<number>
  /** The eye, in the world the view-projection takes (`screenSlab`). */
  eye: ArrayLike<number>
  /** The drawn size. */
  size: readonly [number, number]
  /** Whether the depth pyramid holds this image's whole depth. */
  depthDrawn: boolean
  /** Whether this image's trace answers the transparents' front surface (`frontLayer.ts`). */
  front?: boolean
  /** The reflections' turn (`ReflectionView.temporal`). */
  turn?: number
  /** The radiance a ray that leaves the scene reaches (`createSurroundings`): zero when absent. */
  surroundings?: ArrayLike<number>
  /** What a ray may spend and which of its stages run (`reflectionOptions.ts`): the settings' defaults when absent. */
  settings?: ReflectionSettings
  /** The pre-exposure this image's light is written multiplied by: the radiance image that is held
   *  keeps it, and the next image divides the light it reads by it (1 when absent). */
  preExposure?: number
}

/** The flags of what a trace does (`ReflectionView.scene.w`): each bit of `REFLECTION_COUNTS` its setting's. */
function flagsOf(trace: ReflectionSettings) {
  const bit = (on: boolean, flag: number) => (on ? flag : 0)
  return (
    bit(trace.sceneTraces, REFLECTION_COUNTS.REFLECTION_SCENE_TRACES) |
    bit(trace.meshTraces, REFLECTION_COUNTS.REFLECTION_DETAIL_TRACES) |
    bit(trace.distantTraces, REFLECTION_COUNTS.REFLECTION_DISTANT_TRACES) |
    bit(trace.screenTraces, REFLECTION_COUNTS.REFLECTION_SCREEN_TRACES) |
    bit(trace.temporal, REFLECTION_COUNTS.REFLECTION_TEMPORAL) |
    bit(trace.reconstruction, REFLECTION_COUNTS.REFLECTION_RECONSTRUCTION) |
    bit(trace.bilateral, REFLECTION_COUNTS.REFLECTION_BILATERAL) |
    bit(trace.sampleSceneColor, REFLECTION_COUNTS.REFLECTION_SCENE_COLOR) |
    bit(trace.heightFog, REFLECTION_COUNTS.REFLECTION_HEIGHT_FOG)
  )
}

/** The words of a lane of the staged view, as unsigned integers. */
const lanesOf = (staged: Float32Array, field: keyof typeof REFLECTION_VIEW_AT) =>
  new Uint32Array(staged.buffer, REFLECTION_VIEW_AT[field] * 4, 4)

/**
 * The writer of what a ray may spend and which of its stages run into the staged view `staged`
 * (`ReflectionView.grid`, `.scene`, `.detail`, `.reach`, `.march`, `.light`, `.denoise`, `.spread`, `.lobe`, `.taps`):
 * the lanes of `trace`, the grid's extent over a view of `size` pixels. Nothing is allocated by a call.
 */
function createTraceWriter(staged: Float32Array) {
  const [grid, scene, detail, taps] = (['grid', 'scene', 'detail', 'taps'] as const).map((field) =>
    lanesOf(staged, field),
  )
  /** Four floats at the lane `field` of the staged view. */
  const put = (
    field: keyof typeof REFLECTION_VIEW_AT,
    x: number,
    y: number,
    z: number,
    w: number,
  ) => {
    const at = REFLECTION_VIEW_AT[field]
    staged[at] = x
    staged[at + 1] = y
    staged[at + 2] = z
    staged[at + 3] = w
  }
  return (trace: ReflectionSettings, size: readonly [number, number]) => {
    grid[0] = gridSide(size[0], trace.block)
    grid[1] = gridSide(size[1], trace.block)
    grid[2] = trace.block
    scene[0] = trace.screenSteps
    scene[1] = trace.ringWork
    scene[2] = trace.ringTests
    scene[3] = flagsOf(trace)
    detail[0] = trace.detailWork
    detail[1] = trace.detailTests
    detail[2] = trace.distantSteps
    detail[3] = trace.ringResolution
    taps[0] = trace.reconstructionSamples
    taps[1] = trace.bilateralSamples
    taps[2] = trace.rayDirections
    const t = trace
    put('reach', t.meshDistance, t.meshEndDistance, t.surfaceBias, t.distantDistance)
    put('march', t.relativeThickness, t.distantTolerance, t.distantOffsetBias, t.traceDistance)
    put('light', t.maxRayIntensity, t.sampleDepthThickness, t.sampleFacing, t.fogSkyDistance)
    put('denoise', t.historyFrames, t.clampScale, t.historyDistance, t.tonemapRange)
    put(
      'spread',
      t.reconstructionRadius,
      t.bilateralRadius,
      t.reconstructionMinWeight,
      t.disocclusionFrames,
    )
    put('lobe', t.maxRoughness, t.roughnessFade, t.samplingBias, 0)
  }
}

/**
 * The writer of a view uniform `buffer`: it stages this image's view — the view-projection, the
 * radiance image's view-projection, drawn size and top level (`levels` − 1), the geometry of a
 * surface's thickness (`screenSlab`) with the world size of a
 * pixel at a unit clip `w` — 2 /
 * (height · |row y of the view-projection|), the projection's vertical scale —, whether the screen
 * is traced, whether the trace answers the transparents' front
 * surface, the reflections' turn, the grid's extent, the surroundings and what a ray may spend and do
 * (`createTraceWriter`). The words
 * that differ from those it sent go up (`writeChanged`). Nothing is allocated by a call.
 */
export function createReflectionViewWriter(device: GPUDevice, buffer: GPUBuffer) {
  const staged = new Float32Array(REFLECTION_VIEW_WORDS)
  const words = new Uint32Array(staged.buffer)
  const traced = lanesOf(staged, 'traced')
  const front = lanesOf(staged, 'front')
  const temporal = lanesOf(staged, 'temporal')
  const writeTrace = createTraceWriter(staged)
  let defaults: ReflectionSettings | undefined
  return (frame: ReflectionFrame, held: HeldImage, levels: number) => {
    const m = frame.viewProjection
    copyMatrix4(staged, m, REFLECTION_VIEW_AT.viewProj)
    copyMatrix4(staged, held.viewProjection, REFLECTION_VIEW_AT.radianceViewProj)
    const [, height] = frame.size
    staged[REFLECTION_VIEW_AT.radiance] = held.size[0]
    staged[REFLECTION_VIEW_AT.radiance + 1] = held.size[1]
    staged[REFLECTION_VIEW_AT.radiance + 2] = levels - 1
    staged[REFLECTION_VIEW_AT.radiance + 3] = 1 / held.preExposure
    staged.set(screenSlab(m, height, frame.eye), REFLECTION_VIEW_AT.slab)
    traced[0] = frame.depthDrawn && held.valid ? 1 : 0
    front[0] = frame.front ? 1 : 0
    temporal[0] = frame.turn ?? 0
    const trace = frame.settings ?? (defaults ??= defaultReflections())
    writeTrace(trace, frame.size)
    staged[REFLECTION_VIEW_AT.thickness] = screenRelativeThickness(m, trace.relativeThickness)
    if (frame.surroundings) staged.set(frame.surroundings, REFLECTION_VIEW_AT.surroundings)
    else staged.fill(0, REFLECTION_VIEW_AT.surroundings, REFLECTION_VIEW_AT.surroundings + 4)
    writeChanged(device, buffer, words, 0, REFLECTION_VIEW_WORDS)
  }
}
