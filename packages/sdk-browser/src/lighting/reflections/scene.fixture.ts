// The reflection's shipped WGSL over synthetic views, for its tests: the shipped `reflectionSeen`
// and march run in JavaScript (`reflectionRunner`) over a depth pyramid (`depthField.fixture.ts`)
// of boxes seen by a camera (`boxes.fixture.ts`).
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { depthField, depthLoads, HIZ_DEPTH_READERS, type DepthField } from './depthField.fixture.ts'
import { reflectionStagesWgsl } from './wgsl.ts'
import { reflectionSceneTraceWgsl } from './sceneTrace.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'
import { reflectionLightViewWgsl, REFLECTION_GROUP, REFLECTION_VIEW_AT } from './viewLayout.ts'
import {
  eyeToPixelSpread,
  screenRelativeThickness,
  screenSlabInto,
} from '../../visibility/hiz/gpu/screenSlab.ts'
import { REFLECTION_CONSTANTS, REFLECTION_COUNTS } from './constants.ts'
import { hitLightWord } from './hitLighting/constants.ts'
import { hitLightFlags } from './viewWrite.ts'
import { defaultReflections } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { Camera } from './boxes.fixture.ts'
import { HIZ_DEPTH_LAYERS } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'

type Seen = { color: number[]; hit: boolean }
/** A screen ray as `reflectionRaySpan` returns it: its origin and direction in pixels and depth, how far its march goes,
 *  the clip `w` of its two ends, where it starts along the ray and how long it is. */
type Ray = {
  o: number[]
  d: number[]
  end: number
  wb: number
  we: number
  start: number
  span: number
}
/** A pixel's reflection lobe, as the shipped `reflectionLobeOf` returns it. */
type Lobe = { R: Vec3; rough: number }
/** The reflection's view uniform, its fields the layout's (`REFLECTION_VIEW_AT`): its matrices
 *  as the run reads them, every other field four numbers; the tests write them. */
type ReflectionView = {
  -readonly [F in keyof typeof REFLECTION_VIEW_AT]: F extends 'viewProj' | 'radianceViewProj'
    ? Mat
    : F extends
          | 'thickness'
          | 'historyThickness'
          | 'reconstructionScale'
          | 'eyeSpread'
          | 'firstPersonMinimum'
      ? number
      : number[]
}
/** The views of a still view: the reflection's own (`ReflectionView`, its lit image the
 *  depth's own) and the deferred lighting's (the pixel's world point, the eye, the drawn size). */
type Views = { reflectionView: ReflectionView; view: object }
export function viewOf(
  m: Iterable<number>,
  inverse: Iterable<number>,
  eye: number[],
  size: number[],
): Views {
  const trace = defaultReflections()
  const slab = [0, 0, 0, 0]
  screenSlabInto(slab, 0, [...m], size[1], eye)
  return {
    reflectionView: {
      viewProj: new Mat([...m]),
      radianceViewProj: new Mat([...m]),
      radiance: [size[0], size[1], 0, 1],
      slab,
      thickness: screenRelativeThickness([...m], trace.relativeThickness),
      historyThickness: screenRelativeThickness([...m], trace.historyDepthThickness),
      reconstructionScale: trace.reconstructionRoughnessScale,
      eyeSpread: eyeToPixelSpread([...m], size[1]),
      traced: [1, 0, 0, 0],
      front: [0, 0, 0, 0],
      temporal: [0, 0, 0, 0],
      jitter: [0, 0, 0, 0],
      grid: [
        Math.ceil(size[0] / trace.block),
        Math.ceil(size[1] / trace.blockY),
        trace.block,
        trace.blockY,
      ],
      scene: [
        trace.screenSteps,
        trace.distantSteps,
        REFLECTION_COUNTS.REFLECTION_SCREEN_TRACES | REFLECTION_COUNTS.REFLECTION_SCENE_COLOR,
        0,
      ],
      reach: [
        trace.surfaceBias,
        trace.distantDistance,
        trace.maxRoughnessFoliage,
        trace.bilateralDepthScale,
      ],
      march: [
        trace.relativeThickness,
        trace.distantTolerance,
        trace.distantOffsetBias,
        trace.traceDistance,
      ],
      // The lit image reads as the texel it is read at (below): no ceiling on its "colours".
      light: [
        Number.MAX_VALUE,
        trace.sampleDepthThickness,
        trace.sampleFacing,
        trace.fogSkyDistance,
      ],
      denoise: [trace.historyFrames, trace.clampScale, trace.historyDistance, trace.tonemapRange],
      spread: [
        trace.reconstructionRadius,
        trace.bilateralRadius,
        trace.reconstructionMinWeight,
        trace.disocclusionFrames,
      ],
      lobe: [trace.maxRoughness, trace.roughnessFade, trace.samplingBias, trace.smoothBias],
      taps: [trace.reconstructionSamples, trace.bilateralSamples, 0, 0],
      leak: [...trace.skylightLeakColor, trace.skylightLeakAlbedo],
      hardware: [trace.hardwareBias, trace.hardwareNormalBias, trace.hardwarePullbackBias, 0],
      firstPerson: [0, 0, 0, 0],
      firstPersonMinimum: trace.firstPersonMinimumHitDistance,
      cache: [
        trace.radianceCacheMinRoughness,
        trace.radianceCacheMaxRoughness,
        trace.radianceCacheFade,
        trace.radianceCacheRadiusScale,
      ],
      cacheTrace: [
        trace.radianceCacheMaxDistance,
        trace.radianceCacheMinDistance,
        trace.radianceCacheStochastic ? 1 : 0,
        0,
      ],
      translucent: [0, 0, hitLightFlags(trace.hit), hitLightWord(trace.hit)],
    },
    view: {
      inverseViewProjection: new Mat([...inverse]),
      camera: eye,
      viewport: [size[0], size[1], 0, 0],
    },
  }
}

/** The shipped functions the runner calls, by name. */
type ReflectionFunctions = {
  reflectionLobeOf: (R: Vec3, alpha: number) => Lobe
  reflectionSeen: (
    P: Vec3,
    N: Vec3,
    lobe: Lobe,
    bias: number,
    coord: number[],
  ) => { answer: Seen & { distance: number }; left: number }
  reflectionDistant: (P: Vec3, N: Vec3, lobe: Lobe, coord: number[]) => Seen & { distance: number }
  reflectionRayBias: (P: Vec3, N: Vec3) => number
  gdfClipRayOutside: (
    origin: Vec3,
    dir: Vec3,
    span: number,
    steps: number,
  ) => { start: number; length: number }
  reflectionRaySpan: (
    P: Vec3,
    N: Vec3,
    lobe: Lobe,
    bias: number,
    start: number,
    stop: number,
  ) => Ray
  reflectionRayDistance: (ray: Ray, t: number) => number
  screenMarch: (
    o: number[],
    d: number[],
    end: number,
    pixels: number,
    relative: number,
    slab: number[],
    cap: number,
    full: boolean,
  ) => { t: number; plane: number[]; pixel: number[]; front: boolean; steps: number; above: number }
  screenMarchEnd: (o: number[], d: number[], size: number[]) => number
  reflectionThickness: () => number
  reflectionClampRay: (c: Vec3) => Vec3
  reflectionHeld: (at: Vec3, N: Vec3, noise: number) => number[]
}

/** The functions of the program the runner reaches: the interpreter follows the library's alone. */
const REFLECTION_NAMES = [
  'reflectionLobeOf',
  'reflectionSeen',
  'reflectionSeenAnswer',
  'reflectionDistant',
  'gdfClipRayOutside',
  'reflectionLinearTrace',
  'reflectionFarthest',
  'reflectionThickness',
  'reflectionClampRay',
  'reflectionHeld',
  'reflectionPast',
  'reflectionPastTexel',
  'reflectionPastAgrees',
  'surfacePast',
  'hasOwnMotion',
  'decodeVector',
  'depthStepOf',
  'pixelToNdc',
  'uvToNdc',
  'ndcToPixel',
  'ndcToUv',
  'reflectionDone',
  'reflectionFar',
  'reflectionReach',
  'reflectionRaySpan',
  'reflectionRayDistance',
  'reflectionRayBias',
  'screenMarch',
  ...HIZ_DEPTH_READERS,
  'screenMarchEnd',
  'screenBack',
  'worldAt',
  'viewToEye',
  'screenEdgeVignette',
  'reflectionHitVignette',
  'reflectionEdgeNoise',
  'reflectionThickness',
]

/**
 * The shipped reflection functions over the depth `depth` and the view uniform `reflectionView`:
 * a read of the lit image gives, as its colour, the texel it reads, `[x, y, 0, 1]`; `counter` counts the cells the
 * march reads (one load of the nearest layer each: a cell's nearest, or a pixel's slopes) and lists
 * the reads; `overrides` stand in for shipped functions.
 */
export function reflectionRunner(
  depth: DepthField,
  { reflectionView, view }: Views,
  overrides: object = {},
) {
  const counter = { loads: 0, cells: [] as number[][] }
  const token = {
    depth: { layers: HIZ_DEPTH_LAYERS },
    pyramid: {},
    image: {},
    vectors: {},
    history: {},
  }
  // The lit image reads as the texel it is read at: its colour the point, its alpha one.
  const load = depthLoads(depth, token, (cell) => {
    counter.loads++
    counter.cells.push(cell)
  })
  const run = shaderRun<ReflectionFunctions>(
    wgslModule(reflectionStagesWgsl(1, reflectionSceneTraceWgsl(WORD_LIGHT_FORMAT, false)), reflectionLightViewWgsl(REFLECTION_GROUP)),
    REFLECTION_NAMES.filter((name) => !(name in overrides)),
    {
      reflectionView,
      view,
      hizDepth: token.depth,
      hizPyramid: token.pyramid,
      hizLevels: depth.levels,
      reflectionImage: token.image,
      // No surface moves by itself, and the last image kept no depth of its own.
      temporalVectors: token.vectors,
      reflectionDepthHistory: token.history,
      textureDimensions: () => [reflectionView.radiance[0], reflectionView.radiance[1]],
      textureLoad: (t: object, cell: number[], layer: number) =>
        t === token.image
          ? [cell[0], cell[1], 0, 1]
          : t === token.vectors || t === token.history
            ? [0, 0, 0, 0]
            : load(t, cell, layer),
      ...overrides,
    },
  )
  return {
    ...run,
    counter,
    levels: depth.levels.count[0],
    slab: reflectionView.slab,
    thickness: REFLECTION_CONSTANTS.REFLECTION_THICKNESS,
    relativeThickness: reflectionView.thickness,
  }
}

/** The depth `depth` seen by `view`, and its views: what the shipped reflection runs over. */
export function sceneFromDepth(view: Camera, depth: ArrayLike<number>) {
  return [
    depthField(view.width, view.height, depth),
    viewOf(view.m, view.inverse, [...view.eye, 1], [view.width, view.height]),
  ] as const
}
