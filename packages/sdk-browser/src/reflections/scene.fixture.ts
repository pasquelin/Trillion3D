// The reflection's shipped WGSL over synthetic views, for its tests: the shipped `reflectionSeen`
// and march run in JavaScript (`reflectionRunner`) over a depth pyramid (`depthField.fixture.ts`)
// of boxes seen by a camera (`boxes.fixture.ts`).
import { Mat, shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { HIZ_NEAREST } from '../gpu/hiz/pyramidTexture.ts'
import { depthField, type DepthField } from './depthField.fixture.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'
import { rasterize, type Box, type Camera, type V3 } from './boxes.fixture.ts'

type Seen = { color: number[]; confidence: number }
type Lobe = { R: V3; T: V3; bands: number[]; widths: number[] }
type Cone = { short: number; long: number; level: number }
type ReflectionView = {
  viewProj: Mat
  inverseViewProj: Mat
  radianceViewProj: Mat
  camera: number[]
  screen: number[]
  radiance: number[]
  counts: number[]
  display: number[]
  surroundings: number[]
}
/** The view uniform of a still view `view`: the radiance image is the depth's own. */
export function viewOf(
  m: Iterable<number>,
  inverse: Iterable<number>,
  eye: number[],
  size: number[],
  scale: number,
): ReflectionView {
  return {
    viewProj: new Mat([...m]),
    inverseViewProj: new Mat([...inverse]),
    radianceViewProj: new Mat([...m]),
    camera: eye,
    screen: [size[0], size[1], scale, 0],
    radiance: [size[0], size[1], Math.ceil(Math.log2(Math.max(size[0], size[1]))), 0],
    counts: [1, 0, 0, 0],
    display: [0, 0, 0, 1],
    surroundings: [0, 0, 0, 0],
  }
}

/**
 * The shipped reflection functions over the depth `depth` and the view uniform `reflectionView`:
 * a read of the radiance image gives, as its colour, the point it reads and the level,
 * `[x, y, level, 1]` — the footprint's colour is their weighted mean —; `counter`
 * counts the cells the march reads (one load of the nearest layer each: a cell's nearest, or a
 * pixel's slopes) and lists the reads; `overrides` stand in for shipped functions.
 */
export function reflectionRunner(
  depth: DepthField,
  reflectionView: ReflectionView,
  overrides: object = {},
) {
  const counter = { loads: 0, taps: [] as number[][] }
  const token = { depth: {}, pyramid: {}, radiance: {} }
  const run = shaderRun<{
    reflectionLobeOf: (R: V3, alpha: number, lobe: number[]) => Lobe
    reflectionSeen: (P: V3, N: V3, lobe: Lobe) => Seen
    reflectionMarch: (
      o: number[],
      d: number[],
      end: number,
    ) => { t: number; plane: number[]; pixel: number[] }
    reflectionScreenEnd: (o: number[], d: number[], size: number[]) => number
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
    wgslModule(reflectedRadianceWgsl(1)),
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
      'reflectionMarch',
      'hizPlane',
      'hizCell',
      'hizLevelCount',
      'hizCullFarthest',
      'hizNearest',
      'hizWholeFarthest',
      'hizTexel',
      'reflectionScreenEnd',
      'reflectionSlab',
      'reflectionToEye',
      'reflectionWorldAt',
      'reflectionLevelTrust',
      'reflectionEdgeFade',
      'reflectionConeTangent',
    ].filter((name) => !(name in overrides)),
    {
      reflectionView,
      hizDepth: token.depth,
      hizPyramid: token.pyramid,
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
      ReflectionHit: (t: number, plane: number[], pixel: number[]) => ({ t, plane, pixel }),
      ReflectionCone: (short: number, long: number, level: number) => ({ short, long, level }),
      ReflectionTaps: (color: number[], weight: number) => ({ color, weight }),
      ReflectionSurface: (pixel: number[], plane: number[], thickness: number) => ({
        pixel,
        plane,
        thickness,
      }),
      textureDimensions: () => [reflectionView.radiance[0], reflectionView.radiance[1]],
      textureLoad: (t: object, cell: number[], layer: number) => {
        if (t === token.depth) return [depth.depthAt(cell)]
        if (layer === HIZ_NEAREST) counter.loads++
        return [depth.word(cell, layer)]
      },
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
  return { ...run, counter }
}

/** A still view of `boxes` from `view`: its depth, which box each pixel shows, and the shipped
 *  reflection over it. */
export function sceneOver(view: Camera, boxes: Box[]) {
  const { depth, shown } = rasterize(view, boxes)
  const runner = reflectionRunner(
    depthField(view.width, view.height, depth),
    viewOf(view.m, view.inverse, [...view.eye, 1], [view.width, view.height], view.scale),
  )
  return { depth, shown, ...runner }
}
