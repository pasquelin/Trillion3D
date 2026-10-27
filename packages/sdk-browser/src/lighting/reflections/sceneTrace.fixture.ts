// The reflection's scene stage (`reflectionSceneTrace`, `sceneTrace.ts`) run in JavaScript, its march through the field
// and its read of the surface cache standing in as the test says.
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { defaultReflections } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import {
  packEnvironment,
  SCENE_ENVIRONMENT_FLOATS,
} from '../../../../sdk-core/src/scene/core/environment.ts'
import { FOG_SLOTS } from '../../../../sdk-core/src/scene/core/fog.ts'
import { ATMOSPHERE_SLOTS } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { AIR_BUFFER_STRUCT } from '../atmosphere/layout.ts'
import { FOG_VIEW_SLOTS } from '../fog/viewSlots.ts'
import { REFLECTION_FATES } from './censusWgsl.ts'
import { REFLECTION_COUNTS } from './constants.ts'
import { REFLECTION_SCENE_TRACE_WGSL } from './sceneTrace.ts'

/** The light buffer's blocks a program reads the fog from (`directLights`): the fog `fog` as the scene packs it (none
 *  where it is undefined), no atmosphere, no volume. */
export function fogLights(fog: object | undefined) {
  const zero = (count: number) => Array.from({ length: count }, () => [0, 0, 0, 0])
  const packed = packEnvironment(
    { exposure: 1, fog } as never,
    new Float32Array(SCENE_ENVIRONMENT_FLOATS),
  )
  const at = SCENE_ENVIRONMENT_FLOATS - FOG_SLOTS * 4
  const view = Number(/atmosphereView:array<vec4f,(\d+)>/.exec(AIR_BUFFER_STRUCT)![1])
  return {
    fog: Array.from({ length: FOG_SLOTS }, (_, k) =>
      Array.from(packed.subarray(at + 4 * k, at + 4 * k + 4)),
    ),
    atmosphere: zero(ATMOSPHERE_SLOTS),
    atmosphereView: zero(view),
    fogView: zero(FOG_VIEW_SLOTS),
  }
}

/** What `sceneStage` is run with: the hit of the march through the field in metres from the point the ray leaves
 *  the surface at (none: the march meets nothing) and the steps it takes, the half-extent in centimetres of the clipmap
 *  that holds the ray (252 voxels across), the flags of the stages that run, the metres a ray leaves a surface by
 *  along itself, the longest ray, and what the surface cache gives the hit. */
export type SceneStage = {
  hit?: number
  steps?: number
  extent?: number
  /** The clipmaps the field holds: none, a scene whose rays answer nothing. */
  clipmaps?: number
  traced?: boolean
  bias?: number
  longest?: number
  /** The light the cache gives the hit, none where no card gives any. */
  light?: Vec3 | null
  /** Whether the hit is read on the finest pages (`reflectionHiResSurface`, on by default). */
  hiRes?: boolean
}

/** The ray the march was given (`GdfTraceInput`), as the fake field saw it. */
type MarchInput = {
  start: Vec3
  dir: Vec3
  minTrace: number
  maxTrace: number
  stepFactor: number
  minStepFactor: number
  expandByTime: boolean
}

/** What the read of the cache was asked: the ray's origin and direction (centimetres), the march's hit, the cone's
 *  tangent and the pixel the feedback is for. */
type SurfaceRead = {
  origin: Vec3
  R: Vec3
  hitTime: number
  spread: number
  coord: number[]
  fade: boolean
  startedInside: number
  hiRes: boolean
}

/**
 * The scene stage's march and hit (`reflectionSceneTrace`, the shipped WGSL): a ray from `origin` along `direction`,
 * which the screen stopped knowing at `left`, answered, with how it ended (`fate`) and the steps its march took (`work`).
 * The march itself (`gdfTrace`) is the stage's `hit` and `steps`, the field's own proof being `globalTraceWgsl.test.ts`'s,
 * and the light of the hit (`scGlobalHit`) is the stage's `light`, its own proof being `hitWgsl.test.ts`'s;
 * `marches` lists the rays the march was given, `reads` the hits the cache was asked about.
 */
export function sceneStage(stage: SceneStage = {}) {
  const {
    hit,
    steps = 0,
    extent = 2500,
    clipmaps = 1,
    traced = true,
    bias = 0,
    longest = 200,
    light = [1, 0.5, 0.25],
    hiRes = true,
  } = stage
  const text = `${wgslModule(REFLECTION_SCENE_TRACE_WGSL)}
fn testFate()->u32{return reflectionFate;}
fn testWork()->u32{return reflectionWork;}`
  const flags =
    (traced ? REFLECTION_COUNTS.REFLECTION_SCENE_TRACES : 0) |
    (hiRes ? REFLECTION_COUNTS.REFLECTION_HI_RES_SURFACE : 0)
  const marches: MarchInput[] = []
  const reads: SurfaceRead[] = []
  const run = shaderRun<{
    reflectionSceneTrace: (
      P: Vec3,
      N: Vec3,
      lobe: object,
      begin: number,
      pixel: number[],
      cone: number,
      firstPerson: boolean,
    ) => { answer: { color: Vec3; hit: boolean; distance: number }; open: boolean }
    reflectionLobeOf: (R: Vec3, alpha: number, lobe: number[]) => object
    testFate: () => number
    testWork: () => number
  }>(text, ['reflectionSceneTrace', 'reflectionLobeOf', 'testFate', 'testWork'], {
    gdfView: {
      clipmaps,
      centerExtent: [[0, 0, 0, extent]],
      texel: 1 / 252,
      translation: [0, 0, 0],
    },
    gdfClipmapAt: () => 0,
    gdfTraceRay: (
      start: Vec3,
      dir: Vec3,
      minTrace: number,
      maxTrace: number,
      stepFactor: number,
      expandByTime: boolean,
    ) => {
      marches.push({ start, dir, minTrace, maxTrace, stepFactor, minStepFactor: 1, expandByTime })
      return { hitTime: hit === undefined ? -1 : hit * 100, clipmap: 0, steps, expand: 0 }
    },
    reflectionView: {
      slab: [0.01, 0, 0, 1],
      scene: [defaultReflections().screenSteps, 16, flags, 0],
      reach: [bias, 2000, 0, 0],
      march: [0.005, 2, 0, longest],
      temporal: [0, 0, 0, 0],
    },
    reflectionDone: (bit: number) => (flags & bit) !== 0,
    reflectionFate: 0,
    reflectionWork: 0,
    reflectionOrigin: [0, 0, 0],
    // The cone the cache is read with is the ray's cone angle itself, as `reflectionHitSpread`'s own test says what it makes of it.
    reflectionHitSpread: (cone: number) => cone,
    scGlobalHit: (
      origin: Vec3,
      R: Vec3,
      marched: { hitTime: number },
      spread: number,
      fade: boolean,
      startedInside: number,
      hiRes: boolean,
      coord: number[],
    ) => {
      reads.push({ origin, R, hitTime: marched.hitTime, spread, coord, fade, startedInside, hiRes })
      return { radiance: light ?? [0, 0, 0], face: [0, 1, 0], valid: light !== null }
    },
    reflectionSeenAt: (radiance: Vec3) => radiance,
  })
  const walk = (origin: Vec3, direction: Vec3, pixel = [0, 0], begin = 0, cone = 0) => {
    const lobe = run.reflectionLobeOf(direction, 0, [0, 0, 0, 0])
    const out = run.reflectionSceneTrace(origin, [0, 1, 0], lobe, begin, pixel, cone, false)
    return { ...out, fate: REFLECTION_FATES[run.testFate()], work: run.testWork() }
  }
  return Object.assign(walk, { marches, reads })
}
