import { flagIf } from '../../../../math/src/scalar/bits.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import {
  eyeToPixelSpread,
  screenRelativeThickness,
  screenSlabInto,
} from '../../visibility/hiz/gpu/screenSlab.ts'
import type { HeldImage } from './litImage.ts'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import { usedAxis } from './grids.ts'
import { HIT_LIGHT, hitLightWord } from './hitLighting/constants.ts'
import {
  defaultReflections,
  type ReflectionSettings,
} from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { REFLECTION_COUNTS } from './constants.ts'

/** The frames the noise of the view repeats over. */
const NOISE_FRAMES = 8

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
  /** Whether the view was cut since the image the lit image was drawn in: nothing of it describes this image, the screen is not traced
   *  and no history is read (`ReflectionView.traced.x`). */
  historyCut?: boolean
  /** Whether the depth the last image kept (`ReflectionView.traced.y`) is that of the lit image held: a screen hit's depth in the last
   *  image is read there, else in this image's. */
  depthKept?: boolean
  /** Whether this image's trace answers the transparents' front surface (`frontLayer.ts`). */
  front?: boolean
  /** The reflections' turn (`ReflectionView.temporal`). */
  turn?: number
  /** The reflections' rank of the image, one more every image they stage (`stageReflectionImage`). */
  image?: number
  /** The engine's index of the frame, which the noise of the view turns with (`ReflectionView.temporal`: `y` modulo eight, `z` as it is): zero when absent. */
  frameIndex?: number
  /** The jitter the view-projection carries, in device units (`ReflectionView.jitter`): none when absent. */
  jitter?: readonly [number, number]
  /** The centimetres a texel of a card may lie from the point a ray through the scene's triangles hit (`ReflectionView.hardware.w`, the surface cache's
   *  sampling depth bias of the scene trace the image hands out, `SceneRays`): zero when absent. */
  cardDepthBias?: number
  /** Whether the hit lighting does not run in this image although its settings ask for it (its kernels are still compiling): the view then tells the scene stage so, and it meets the translucent surfaces no more than it lights. */
  hitUnlit?: boolean
  /** The sphere that holds the stand-ins of the first-person objects (`ReflectionView.firstPerson`, `firstPersonBounds.ts`): its centre in the world, then its radius; none
   *  when absent or its radius is 0. */
  firstPerson?: ArrayLike<number>
  /** What a ray may spend and which of its stages run (`reflectionOptions.ts`): the settings' defaults when absent. */
  settings?: ReflectionSettings
  /** The pre-exposure this image's light is written multiplied by: the ceiling of a ray's radiance, in the display's white, is divided by it,
   *  and the lit image that is held keeps it, the next image dividing the light it reads by it (1 when absent). */
  preExposure?: number
  /** The exposure the CPU knows for this image (`PreExposure.exposure`, this view's own): the hit lighting's lights are strengthened under it (`ReflectionView.radiance.z`, 1 when absent). */
  exposure?: number
}

/** The flags of what a trace does (`ReflectionView.scene.z`): each bit of `REFLECTION_COUNTS` its setting's, the switches a layer's flags differ in — its three denoising passes and its two traces — given;
 *  the front layer's (`scene.w`) take them from `frontTemporal` and the four after it. */
function flagsOf(
  trace: ReflectionSettings,
  temporal: boolean,
  reconstruction: boolean,
  bilateral: boolean,
  sceneTraces: boolean,
  distantTraces: boolean,
) {
  return (
    flagIf(sceneTraces, REFLECTION_COUNTS.REFLECTION_SCENE_TRACES) |
    flagIf(distantTraces, REFLECTION_COUNTS.REFLECTION_DISTANT_TRACES) |
    flagIf(trace.screenTraces, REFLECTION_COUNTS.REFLECTION_SCREEN_TRACES) |
    flagIf(temporal, REFLECTION_COUNTS.REFLECTION_TEMPORAL) |
    flagIf(reconstruction, REFLECTION_COUNTS.REFLECTION_RECONSTRUCTION) |
    flagIf(bilateral, REFLECTION_COUNTS.REFLECTION_BILATERAL) |
    flagIf(trace.sampleSceneColor, REFLECTION_COUNTS.REFLECTION_SCENE_COLOR) |
    flagIf(trace.heightFog, REFLECTION_COUNTS.REFLECTION_HEIGHT_FOG) |
    flagIf(trace.hiResSurface, REFLECTION_COUNTS.REFLECTION_HI_RES_SURFACE)
  )
}

/** The words of a lane of the staged view, as unsigned integers. */
const lanesOf = (staged: Float32Array, field: keyof typeof REFLECTION_VIEW_AT) =>
  new Uint32Array(staged.buffer, REFLECTION_VIEW_AT[field] * 4, 4)

/** Four floats at the lane `field` of the staged view `staged`. */
function putLane(
  staged: Float32Array,
  field: keyof typeof REFLECTION_VIEW_AT,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const at = REFLECTION_VIEW_AT[field]
  staged[at] = x
  staged[at + 1] = y
  staged[at + 2] = z
  staged[at + 3] = w
}

/** The float lanes of what a ray may spend and do (`reach` to `cacheTrace`), `t` the trace's settings. */
function putTraceLanes(
  staged: Float32Array,
  t: ReflectionSettings,
  cardDepthBias: number,
  preExposure: number,
) {
  putLane(
    staged,
    'reach',
    t.surfaceBias,
    t.distantDistance,
    t.maxRoughnessFoliage,
    t.bilateralDepthScale,
  )
  putLane(
    staged,
    'march',
    t.relativeThickness,
    t.distantTolerance,
    t.distantOffsetBias,
    t.traceDistance,
  )
  putLane(
    staged,
    'light',
    t.maxRayIntensity / preExposure,
    t.sampleDepthThickness,
    t.sampleFacing,
    t.fogSkyDistance,
  )
  putLane(staged, 'denoise', t.historyFrames, t.clampScale, t.historyDistance, t.tonemapRange)
  putLane(
    staged,
    'spread',
    t.reconstructionRadius,
    t.bilateralRadius,
    t.reconstructionMinWeight,
    t.disocclusionFrames,
  )
  putLane(staged, 'lobe', t.maxRoughness, t.roughnessFade, t.samplingBias, t.smoothBias)
  putLane(
    staged,
    'leak',
    t.skylightLeakColor[0],
    t.skylightLeakColor[1],
    t.skylightLeakColor[2],
    t.skylightLeakAlbedo,
  )
  putLane(
    staged,
    'hardware',
    t.hardwareBias,
    t.hardwareNormalBias,
    t.hardwarePullbackBias,
    cardDepthBias,
  )
  putLane(
    staged,
    'cache',
    t.radianceCacheMinRoughness,
    t.radianceCacheMaxRoughness,
    t.radianceCacheFade,
    t.radianceCacheRadiusScale,
  )
  putLane(
    staged,
    'cacheTrace',
    t.radianceCacheMaxDistance,
    t.radianceCacheMinDistance,
    t.radianceCacheStochastic ? 1 : 0,
    0,
  )
}

/** `ReflectionView.translucent.z`: the hit lighting runs (`HIT_LIGHT.on`) and lights every hit (`HIT_LIGHT.forced`). */
export const hitLightFlags = (hit: ReflectionSettings['hit']) =>
  (hit.on ? HIT_LIGHT.on : 0) | (hit.forced ? HIT_LIGHT.forced : 0)

/**
 * The writer of what a ray may spend and which of its stages run into the staged view `staged`
 * (`ReflectionView.grid`, `.scene`, `.reach`, `.march`, `.light`, `.denoise`, `.spread`, `.lobe`, `.taps`):
 * the lanes of `trace`, the grid's extent over a view of `size` pixels. Nothing is allocated by a call.
 */
function createTraceWriter(staged: Float32Array) {
  const [grid, scene, taps, frontLanes, translucent] = (
    ['grid', 'scene', 'taps', 'front', 'translucent'] as const
  ).map((field) => lanesOf(staged, field))
  return (
    trace: ReflectionSettings,
    size: readonly [number, number],
    cardDepthBias: number,
    preExposure: number,
    hitUnlit: boolean,
  ) => {
    // The grid holds the finer of the two layers' blocks along each axis; each layer reads its own (`reflectionBlock`).
    grid[0] = usedAxis(size[0], trace.block, trace.frontBlock[0])
    grid[1] = usedAxis(size[1], trace.blockY, trace.frontBlock[1])
    grid[2] = trace.block
    grid[3] = trace.blockY
    frontLanes[1] = trace.frontBlock[0]
    frontLanes[2] = trace.frontBlock[1]
    scene[0] = trace.screenSteps
    scene[1] = trace.distantSteps
    scene[2] = flagsOf(
      trace,
      trace.temporal,
      trace.reconstruction,
      trace.bilateral,
      trace.sceneTraces,
      trace.distantTraces,
    )
    scene[3] = flagsOf(
      trace,
      trace.frontTemporal,
      trace.frontReconstruction,
      trace.frontBilateral,
      trace.frontSceneTraces,
      trace.frontDistantTraces,
    )
    taps[0] = trace.reconstructionSamples
    taps[1] = trace.bilateralSamples
    taps[2] = trace.screenMinimumOccupancy
    translucent[0] = trace.translucencyScreenQuality
    translucent[1] = trace.translucencyCache ? 1 : 0
    translucent[2] = hitUnlit ? 0 : hitLightFlags(trace.hit)
    translucent[3] = hitLightWord(trace.hit)
    putTraceLanes(staged, trace, cardDepthBias, preExposure)
  }
}

/**
 * The writer of a view uniform `buffer`: it stages this image's view — the view-projection, the
 * lit image's view-projection and drawn size, the geometry of a
 * surface's thickness (`screenSlabInto`) with the world size of a
 * pixel at a unit clip `w` — 2 /
 * (height · |row y of the view-projection|), the projection's vertical scale —, whether the screen
 * is traced, whether the trace answers the transparents' front
 * surface, the reflections' turn, the grid's extent and what a ray may spend and do
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
    staged[REFLECTION_VIEW_AT.radiance + 2] = frame.exposure ?? 1
    staged[REFLECTION_VIEW_AT.radiance + 3] = 1 / held.preExposure
    screenSlabInto(staged, REFLECTION_VIEW_AT.slab, m, height, frame.eye)
    staged[REFLECTION_VIEW_AT.eyeSpread] = eyeToPixelSpread(m, height)
    traced[0] = frame.depthDrawn && held.valid && !frame.historyCut ? 1 : 0
    traced[1] = frame.depthKept ? 1 : 0
    front[0] = frame.front ? 1 : 0
    temporal[0] = frame.turn ?? 0
    temporal[1] = (frame.frameIndex ?? 0) % NOISE_FRAMES
    temporal[2] = frame.frameIndex ?? 0
    staged[REFLECTION_VIEW_AT.jitter] = frame.jitter?.[0] ?? 0
    staged[REFLECTION_VIEW_AT.jitter + 1] = frame.jitter?.[1] ?? 0
    staged[REFLECTION_VIEW_AT.jitter + 2] = held.jitter[0]
    staged[REFLECTION_VIEW_AT.jitter + 3] = held.jitter[1]
    for (let k = 0; k < 4; k++)
      staged[REFLECTION_VIEW_AT.firstPerson + k] = frame.firstPerson?.[k] ?? 0
    const trace = frame.settings ?? (defaults ??= defaultReflections())
    writeTrace(
      trace,
      frame.size,
      frame.cardDepthBias ?? 0,
      frame.preExposure ?? 1,
      frame.hitUnlit ?? false,
    )
    // The lit image is tested against the depth with the same per-projection scale as the march (orthographic views only).
    staged[REFLECTION_VIEW_AT.light + 1] = screenRelativeThickness(m, trace.sampleDepthThickness)
    staged[REFLECTION_VIEW_AT.thickness] = screenRelativeThickness(m, trace.relativeThickness)
    staged[REFLECTION_VIEW_AT.historyThickness] = screenRelativeThickness(
      m,
      trace.historyDepthThickness,
    )
    staged[REFLECTION_VIEW_AT.reconstructionScale] = trace.reconstructionRoughnessScale
    staged[REFLECTION_VIEW_AT.firstPersonMinimum] = trace.firstPersonMinimumHitDistance
    writeChanged(device, buffer, words, 0, REFLECTION_VIEW_WORDS)
  }
}
