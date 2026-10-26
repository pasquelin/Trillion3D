import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { screenRelativeThickness, screenSlabInto } from '../../visibility/hiz/gpu/screenSlab.ts'
import type { HeldImage } from './litImage.ts'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import { gridSide } from './grids.ts'
import {
  defaultReflections,
  type ReflectionSettings,
} from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { REFLECTION_CONSTANTS, REFLECTION_COUNTS } from './constants.ts'

/** What an image tells its reflection view (`createReflectionViewWriter`). */
export type ReflectionFrame = {
  /** The render view-projection the depth was drawn with, jitter included. */
  viewProjection: ArrayLike<number>
  /** The eye, in the world the view-projection takes (`screenSlabInto`). */
  eye: ArrayLike<number>
  /** The drawn size. */
  size: readonly [number, number]
  /** Whether the depth pyramid holds this image's whole depth. */
  depthDrawn: boolean
  /** Whether this image's trace answers the transparents' front surface (`frontLayer.ts`). */
  front?: boolean
  /** The reflections' turn (`ReflectionView.temporal`). */
  turn?: number
  /** The reflections' rank of the image, one more every image they stage (`stageReflectionImage`). */
  image?: number
  /** The jitter the view-projection carries, in device units (`ReflectionView.jitter`): none when absent. */
  jitter?: readonly [number, number]
  /** The hard bound of a ray the scene walks (`ReflectionView.reach.z`): the bounce cascades' reach, `REFLECTION_FAR` when absent. */
  sceneReach?: number
  /** The radiance a ray that leaves the scene reaches (`createSurroundings`): zero when absent. */
  surroundings?: ArrayLike<number>
  /** What a ray may spend and which of its stages run (`reflectionOptions.ts`): the settings' defaults when absent. */
  settings?: ReflectionSettings
  /** The pre-exposure this image's light is written multiplied by: the lit image that is held
   *  keeps it, and the next image divides the light it reads by it (1 when absent). */
  preExposure?: number
}

/** The switches a layer's flags differ in: its denoising passes and its scene trace. */
type FlagSwitches = Pick<
  ReflectionSettings,
  'temporal' | 'reconstruction' | 'bilateral' | 'sceneTraces' | 'distantTraces'
>

/** The flags of what a trace does (`ReflectionView.scene.z`): each bit of `REFLECTION_COUNTS` its setting's;
 *  the front layer's (`scene.w`) take their three denoising switches and the two traces' from `frontTemporal` and the four after it. */
function flagsOf(
  trace: ReflectionSettings,
  { temporal, reconstruction, bilateral, sceneTraces, distantTraces }: FlagSwitches = trace,
) {
  const bit = (on: boolean, flag: number) => (on ? flag : 0)
  return (
    bit(sceneTraces, REFLECTION_COUNTS.REFLECTION_SCENE_TRACES) |
    bit(distantTraces, REFLECTION_COUNTS.REFLECTION_DISTANT_TRACES) |
    bit(trace.screenTraces, REFLECTION_COUNTS.REFLECTION_SCREEN_TRACES) |
    bit(temporal, REFLECTION_COUNTS.REFLECTION_TEMPORAL) |
    bit(reconstruction, REFLECTION_COUNTS.REFLECTION_RECONSTRUCTION) |
    bit(bilateral, REFLECTION_COUNTS.REFLECTION_BILATERAL) |
    bit(trace.sampleSceneColor, REFLECTION_COUNTS.REFLECTION_SCENE_COLOR) |
    bit(trace.heightFog, REFLECTION_COUNTS.REFLECTION_HEIGHT_FOG) |
    bit(trace.hiResSurface, REFLECTION_COUNTS.REFLECTION_HI_RES_SURFACE)
  )
}

/** The words of a lane of the staged view, as unsigned integers. */
const lanesOf = (staged: Float32Array, field: keyof typeof REFLECTION_VIEW_AT) =>
  new Uint32Array(staged.buffer, REFLECTION_VIEW_AT[field] * 4, 4)

/**
 * The writer of what a ray may spend and which of its stages run into the staged view `staged`
 * (`ReflectionView.grid`, `.scene`, `.reach`, `.march`, `.light`, `.denoise`, `.spread`, `.lobe`, `.taps`):
 * the lanes of `trace`, the grid's extent over a view of `size` pixels. Nothing is allocated by a call.
 */
function createTraceWriter(staged: Float32Array) {
  const [grid, scene, taps, frontLanes] = (['grid', 'scene', 'taps', 'front'] as const).map(
    (field) => lanesOf(staged, field),
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
  return (trace: ReflectionSettings, size: readonly [number, number], sceneReach: number) => {
    // The grid holds the finer of the two layers' blocks along each axis; each layer reads its own (`reflectionBlock`).
    grid[0] = gridSide(size[0], Math.min(trace.block, trace.frontBlock[0]))
    grid[1] = gridSide(size[1], Math.min(trace.block, trace.frontBlock[1]))
    grid[2] = trace.block
    grid[3] = trace.block
    frontLanes[1] = trace.frontBlock[0]
    frontLanes[2] = trace.frontBlock[1]
    scene[0] = trace.screenSteps
    scene[1] = trace.distantSteps
    scene[2] = flagsOf(trace)
    scene[3] = flagsOf(trace, {
      temporal: trace.frontTemporal,
      reconstruction: trace.frontReconstruction,
      bilateral: trace.frontBilateral,
      sceneTraces: trace.frontSceneTraces,
      distantTraces: trace.frontDistantTraces,
    })
    taps[0] = trace.reconstructionSamples
    taps[1] = trace.bilateralSamples
    taps[2] = trace.rayDirections
    const t = trace
    put('reach', t.surfaceBias, t.distantDistance, sceneReach, 0)
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
    put('leak', t.skylightLeak[0], t.skylightLeak[1], t.skylightLeak[2], 0)
  }
}

/**
 * The writer of a view uniform `buffer`: it stages this image's view — the view-projection, the
 * lit image's view-projection and drawn size, the geometry of a
 * surface's thickness (`screenSlabInto`) with the world size of a
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
  return (frame: ReflectionFrame, held: HeldImage) => {
    const m = frame.viewProjection
    copyMatrix4(staged, m, REFLECTION_VIEW_AT.viewProj)
    copyMatrix4(staged, held.viewProjection, REFLECTION_VIEW_AT.radianceViewProj)
    const [, height] = frame.size
    staged[REFLECTION_VIEW_AT.radiance] = held.size[0]
    staged[REFLECTION_VIEW_AT.radiance + 1] = held.size[1]
    staged[REFLECTION_VIEW_AT.radiance + 3] = 1 / held.preExposure
    screenSlabInto(staged, REFLECTION_VIEW_AT.slab, m, height, frame.eye)
    traced[0] = frame.depthDrawn && held.valid ? 1 : 0
    front[0] = frame.front ? 1 : 0
    temporal[0] = frame.turn ?? 0
    staged[REFLECTION_VIEW_AT.jitter] = frame.jitter?.[0] ?? 0
    staged[REFLECTION_VIEW_AT.jitter + 1] = frame.jitter?.[1] ?? 0
    staged[REFLECTION_VIEW_AT.jitter + 2] = held.jitter[0]
    staged[REFLECTION_VIEW_AT.jitter + 3] = held.jitter[1]
    const trace = frame.settings ?? (defaults ??= defaultReflections())
    writeTrace(trace, frame.size, frame.sceneReach ?? REFLECTION_CONSTANTS.REFLECTION_FAR)
    staged[REFLECTION_VIEW_AT.thickness] = screenRelativeThickness(m, trace.relativeThickness)
    if (frame.surroundings) staged.set(frame.surroundings, REFLECTION_VIEW_AT.surroundings)
    else staged.fill(0, REFLECTION_VIEW_AT.surroundings, REFLECTION_VIEW_AT.surroundings + 4)
    writeChanged(device, buffer, words, 0, REFLECTION_VIEW_WORDS)
  }
}
