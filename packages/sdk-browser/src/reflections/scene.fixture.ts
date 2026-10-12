// The reflection's shipped WGSL over synthetic views, for its tests: the shipped `reflectionSeen`
// and march run in JavaScript (`reflectionRunner`) over a depth pyramid (`depthField.fixture.ts`)
// of boxes seen by a camera (`boxes.fixture.ts`).
import { Mat, shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { depthField, depthLoads, HIZ_DEPTH_READERS, type DepthField } from './depthField.fixture.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'
import { reflectionLightViewWgsl, REFLECTION_GROUP } from './viewLayout.ts'
import { screenSlab } from '../gpu/hiz/screenSlab.ts'
import { reflectionConstant } from './constants.fixture.ts'
import { rasterize, type Box, type Camera, type V3 } from './boxes.fixture.ts'

type Seen = { color: number[]; confidence: number }
type Lobe = { R: V3; T: V3; bands: number[]; widths: number[] }
type Cone = { short: number; long: number; level: number }
type ReflectionView = {
  viewProj: Mat
  radianceViewProj: Mat
  radiance: number[]
  slab: number[]
  traced: number[]
  proxy: number[]
  surroundings: number[]
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
      radiance: [size[0], size[1], Math.ceil(Math.log2(Math.max(size[0], size[1]))), 0],
      slab: screenSlab([...m], size[1]),
      traced: [1, 0, 0, 0],
      proxy: [0, 0, 0, 0],
      surroundings: [0, 0, 0, 0],
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
  const token = { depth: {}, pyramid: {}, front: {}, radiance: {} }
  const run = shaderRun<{
    reflectionLobeOf: (R: V3, alpha: number, lobe: number[]) => Lobe
    reflectionSeen: (P: V3, N: V3, lobe: Lobe) => Seen
    reflectionRay: (P: V3, N: V3, lobe: Lobe) => { o: number[]; d: number[]; end: number }
    screenMarch: (
      o: number[],
      d: number[],
      end: number,
      thickness: number,
      slab: number[],
    ) => { t: number; plane: number[]; pixel: number[]; front: boolean }
    screenMarchEnd: (o: number[], d: number[], size: number[]) => number
    screenMarchBudget: (d: number[], end: number, levels: number) => number
    reflectionConeAt: (distance: number, pixel: number, lobe: Lobe) => Cone
    reflectionFootprint: (
      Q: number[],
      hit: V3,
      pixel: number,
      lobe: Lobe,
      cone: Cone,
      toView: number[],
      surface: { pixel: number[]; plane: number[]; thickness: number },
    ) => { color: number[]; weight: number }
  }>(
    wgslModule(reflectedRadianceWgsl(1), reflectionLightViewWgsl(REFLECTION_GROUP)),
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
    ].filter((name) => !(name in overrides)),
    {
      reflectionView,
      view,
      hizDepth: token.depth,
      hizPyramid: token.pyramid,
      hizFront: token.front,
      hizLevels: depth.levels,
      reflectionRadiance: token.radiance,
      reflectionSampler: {},
      ReflectionSeen: (color: number[], confidence: number) => ({ color, confidence }),
      ReflectionLobe: (R: V3, T: V3, bands: number[], widths: number[]) => ({
        R,
        T,
        bands,
        widths,
      }),
      ReflectionRay: (o: number[], d: number[], end: number) => ({ o, d, end }),
      ScreenHit: (t: number, plane: number[], pixel: number[], front: boolean) => ({
        t,
        plane,
        pixel,
        front,
      }),
      ReflectionCone: (short: number, long: number, level: number) => ({ short, long, level }),
      ReflectionTaps: (color: number[], weight: number) => ({ color, weight }),
      ReflectionSurface: (pixel: number[], plane: number[], thickness: number) => ({
        pixel,
        plane,
        thickness,
      }),
      textureDimensions: () => [reflectionView.radiance[0], reflectionView.radiance[1]],
      textureLoad: depthLoads(depth, token, (cell) => {
        counter.loads++
        counter.cells.push(cell)
      }),
      textureSampleLevel: (_: unknown, __: unknown, uv: number[], level: number) => {
        const tap = [
          uv[0] * reflectionView.radiance[0],
          uv[1] * reflectionView.radiance[1],
          level,
          1,
        ]
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
    thickness: reflectionConstant('REFLECTION_THICKNESS'),
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
