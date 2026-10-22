// The reflection's shipped WGSL over synthetic views, for its tests: the shipped `reflectionSeen`
// and march run in JavaScript (`reflectionRunner`) over a depth pyramid (`depthField.fixture.ts`)
// of boxes seen by a camera (`boxes.fixture.ts`).
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { depthField, depthLoads, HIZ_DEPTH_READERS, type DepthField } from './depthField.fixture.ts'
import { reflectionStagesWgsl } from './wgsl.ts'
import { reflectionLightViewWgsl, REFLECTION_GROUP, REFLECTION_VIEW_AT } from './viewLayout.ts'
import { screenSlab } from '../../visibility/hiz/gpu/screenSlab.ts'
import { REFLECTION_CONSTANTS } from './constants.ts'
import { REFLECTION_RULES } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { rasterize, type Box, type Camera } from './boxes.fixture.ts'
import { HIZ_DEPTH_LAYERS } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { radianceLevels } from '../../scene/targetFormats.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'

type Seen = { color: number[]; confidence: number }
/** A pixel's reflection lobe, as the shipped `reflectionLobeOf` returns it. */
export type Lobe = { R: Vec3; T: Vec3; bands: number[]; tangents: number[] }
type Cone = { short: number; long: number; level: number }
/** The reflection's view uniform, its fields the layout's (`REFLECTION_VIEW_AT`): its matrices
 *  as the run reads them, every other field four numbers. */
type ReflectionView = {
  [F in keyof typeof REFLECTION_VIEW_AT]: F extends 'viewProj' | 'radianceViewProj' ? Mat : number[]
}
/** The views of a still view: the reflection's own (`ReflectionView`, its radiance image the
 *  depth's own) and the deferred lighting's (the pixel's world point, the eye, the drawn size). */
type Views = { reflectionView: ReflectionView; view: object }
export function viewOf(
  m: Iterable<number>,
  inverse: Iterable<number>,
  eye: number[],
  size: number[],
): Views {
  return {
    reflectionView: {
      viewProj: new Mat([...m]),
      radianceViewProj: new Mat([...m]),
      radiance: [size[0], size[1], radianceLevels(size[0], size[1]) - 1, 0],
      slab: screenSlab([...m], size[1]),
      traced: [1, 0, 0, 0],
      front: [0, 0, 0, 0],
      temporal: [0, 0, 0, 0],
      grid: [2, Math.ceil(size[0] / 2), Math.ceil(size[1] / 2), 2],
      surroundings: [0, 0, 0, 0],
      scene: [REFLECTION_RULES.reflectionScreenSteps.default, 0, 0, 0],
    },
    view: {
      inverseViewProjection: new Mat([...inverse]),
      camera: eye,
      viewport: [size[0], size[1], 0, 0],
    },
  }
}

/**
 * The shipped reflection functions over the depth `depth` and the view uniform `reflectionView`:
 * a read of the radiance image gives, as its colour, the point it reads and the level, `[x, y,
 * level, 1]` — the footprint's colour is their weighted mean —; `counter` counts the cells the
 * march reads (one load of the nearest layer each: a cell's nearest, or a pixel's slopes) and lists
 * the reads; `overrides` stand in for shipped functions.
 */
export function reflectionRunner(
  depth: DepthField,
  { reflectionView, view }: Views,
  overrides: object = {},
) {
  const counter = { loads: 0, taps: [] as number[][], cells: [] as number[][] }
  const token = { depth: { layers: HIZ_DEPTH_LAYERS }, pyramid: {}, image: {} }
  const run = shaderRun<{
    reflectionLobeOf: (R: Vec3, alpha: number, lobe: number[]) => Lobe
    reflectionPixelAt: (P: Vec3) => number
    reflectionSeen: (P: Vec3, N: Vec3, lobe: Lobe, pixel: number) => Seen
    reflectionRay: (
      P: Vec3,
      N: Vec3,
      lobe: Lobe,
      pixel: number,
    ) => { o: number[]; d: number[]; end: number }
    screenMarch: (
      o: number[],
      d: number[],
      end: number,
      thickness: number,
      slab: number[],
      cap: number,
    ) => { t: number; plane: number[]; pixel: number[]; front: boolean }
    screenMarchEnd: (o: number[], d: number[], size: number[]) => number
    screenMarchBudget: (d: number[], end: number, levels: number) => number
    reflectionConeAt: (distance: number, pixel: number, lobe: Lobe) => Cone
    reflectionConeTangent: (alpha: number) => number
    reflectionFootprint: (
      Q: number[],
      hit: Vec3,
      pixel: number,
      lobe: Lobe,
      cone: Cone,
      toView: number[],
      surface: { pixel: number[]; plane: number[]; thickness: number },
    ) => { color: number[]; weight: number }
  }>(
    wgslModule(reflectionStagesWgsl(1), reflectionLightViewWgsl(REFLECTION_GROUP)),
    [
      'reflectionLobeOf',
      'reflectionBands',
      'reflectionSeen',
      'reflectionConeAt',
      'reflectionReach',
      'reflectionFootprint',
      'reflectionRadianceAt',
      'reflectionLevelRead',
      'reflectionLevelColor',
      'reflectionDepthWeight',
      'reflectionRay',
      'reflectionPixelAt',
      'screenMarch',
      ...HIZ_DEPTH_READERS,
      'screenMarchEnd',
      'screenBack',
      'screenMarchBudget',
      'worldAt',
      'viewToEye',
      'reflectionLevelTrust',
      'reflectionEdgeFade',
      'reflectionConeTangent',
      'reflectionReadTangent',
    ].filter((name) => !(name in overrides)),
    {
      reflectionView,
      view,
      hizDepth: token.depth,
      hizPyramid: token.pyramid,
      hizLevels: depth.levels,
      reflectionImage: token.image,
      reflectionSampler: {},
      textureDimensions: () => [reflectionView.radiance[0], reflectionView.radiance[1]],
      textureLoad: depthLoads(depth, token, (cell) => {
        counter.loads++
        counter.cells.push(cell)
      }),
      // A tap names its pyramid level: the mip it reads, the lit image's level 0.
      textureSampleLevel: (_: unknown, __: unknown, uv: number[], lod: number) => {
        const tap = [uv[0] * reflectionView.radiance[0], uv[1] * reflectionView.radiance[1], lod, 1]
        counter.taps.push(tap)
        return tap
      },
      ...overrides,
    },
  )
  return {
    ...run,
    counter,
    levels: depth.levels.count[0],
    slab: reflectionView.slab,
    thickness: REFLECTION_CONSTANTS.REFLECTION_THICKNESS,
  }
}

/** The depth `depth` seen by `view`, and its views: what the shipped reflection runs over. */
export function sceneFromDepth(view: Camera, depth: ArrayLike<number>) {
  return [
    depthField(view.width, view.height, depth),
    viewOf(view.m, view.inverse, [...view.eye, 1], [view.width, view.height]),
  ] as const
}

/** A still view of `boxes` from `view`: its depth, the box each pixel shows, the shipped reflection. */
export function sceneOver(view: Camera, boxes: Box[]) {
  const { depth, shown } = rasterize(view, boxes)
  return { depth, shown, ...reflectionRunner(...sceneFromDepth(view, depth)) }
}
