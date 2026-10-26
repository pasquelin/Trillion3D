// The material fixtures, one per feature the engine claims: base colour, its map — repeated and
// turned, nearest, anisotropic —, alpha MASK at its cutoff, BLEND, emissive, metal-roughness,
// normal map and double-sided. Each fixture is a square facing the camera — turned to a grazing
// angle for anisotropy —, its material and where it is read.
//
// The materials are built in the proof's page, where the maps' canvases are drawn.
import * as G from '../../../packages/sdk-browser/src/scene/host/graph/graph.fixture.ts'
import * as img from './materialImages.ts'
import { SIZE, type Fixture } from './materialFixtureShape.ts'
import { DEG2RAD } from '../../../packages/math/src/constants.ts'

/** Points inside the square, away from its edges: the centre and the four quadrant centres. */
const CENTRE = [SIZE >> 1, SIZE >> 1]
const QUADRANTS = [
  [SIZE * 0.32, SIZE * 0.32],
  [SIZE * 0.68, SIZE * 0.32],
  [SIZE * 0.32, SIZE * 0.68],
  [SIZE * 0.68, SIZE * 0.68],
].map((p) => p.map(Math.round))
const INSIDE = [CENTRE, ...QUADRANTS]
/** A row across the middle of a square at a grazing angle (`tilt`), inside its width. */
const GRAZING_ROW = Array.from({ length: 49 }, (_, i) => [24 + i, SIZE >> 1])
/** Levels of spread along `GRAZING_ROW` anisotropy 16 must add to 1. */
export const ANISOTROPY_GAIN = 64

/** An unlit fixture: a basic material, read at the points `extra` names, else inside the square. */
const unlit = (
  name: string,
  params: () => G.SurfaceParameters,
  extra: Partial<Fixture> = {},
): Fixture => ({
  name,
  material: () => G.basicSurface(params()),
  points: INSIDE,
  ...extra,
})

/** A lit fixture: a standard material under the sun. */
const lit = (
  name: string,
  params: () => G.SurfaceParameters,
  extra: Partial<Fixture> = {},
): Fixture => ({
  name,
  material: () => G.standardSurface(params()),
  lit: true,
  points: INSIDE,
  ...extra,
})

/** The blended square: pure red at half opacity, whatever it is composed over. */
const BLEND = (): G.SurfaceParameters => ({
  color: 0xff2020,
  transparent: true,
  opacity: 0.5,
})

/**
 * Each fixture: `material()` builds it in the page; `lit` declares the sun; `back` turns the
 * square away from the camera; `behind` puts an opaque square of that colour behind it, and no
 * hole — the engine shows no background at its `points`; `points` are read on the engine's image.
 * Every fixture must publish a held frame.
 */
export const fixtures: Fixture[] = [
  unlit('base colour', () => ({ color: 0x993322 })),
  unlit('base colour map', () => ({ map: img.colourMap(img.FOUR_COLOURS) }), {
    points: QUADRANTS,
  }),
  // The two 8-bit alphas on either side of the cutoff: 128/255 is kept, 127/255 is cut. Read at
  // the quadrant centres, far from the edge where keep and discard meet.
  unlit(
    'alpha mask at cutoff',
    () => ({
      map: img.colourMap([
        [255, 255, 255, 128],
        [255, 255, 255, 127],
        [255, 255, 255, 127],
        [255, 255, 255, 128],
      ]),
      alphaTest: 0.5,
    }),
    { points: QUADRANTS },
  ),
  // The engine composes a blend surface over the display background in display space. With no
  // opaque row there is no occluder history to establish, and the still image is held like any
  // other (#198).
  unlit('blend over the background', BLEND),
  // Between two drawn surfaces the engine blends in linear radiance and encodes at composition
  // (`docs/ENGINE.md` § Proofs).
  unlit('blend over an opaque surface', BLEND, { behind: 0x2244aa }),
  // #360: the four-colour map repeated four times each way and turned 30°, mixed under
  // magnification. A read at the raw UV shows the four quadrants once, upright.
  unlit(
    'map repeated and turned',
    () => {
      const map = img.colourMap(img.FOUR_COLOURS)
      map.wrapS = map.wrapT = 'repeat'
      map.magFilter = 'linear'
      map.repeat.set(4, 4)
      map.rotation = 30 * DEG2RAD
      return { map }
    },
    { points: INSIDE },
  ),
  // #361: at the quadrant points the square's UV falls 0.15 to 0.3 of a texel from an edge of
  // the 8×8 checker: nearest reads one texel, black or white, the mixed read a grey.
  unlit('nearest checker magnified', () => ({ map: img.checkerMap() }), { points: QUADRANTS }),
  // #361: stripes on a square turned 75° away, a footprint four times longer along V: anisotropy
  // 1 greys them out at the level of V, 16 keeps the level of U: the proof is the contrast the
  // engine gains (`ANISOTROPY_GAIN`, the runner).
  ...[1, 16].map((anisotropy) =>
    unlit(`grazing stripes, anisotropy ${anisotropy}`, () => ({ map: img.stripeMap(anisotropy) }), {
      tilt: -75 * DEG2RAD,
      points: GRAZING_ROW,
      // #443: the gap to the ground truth is reported.
      truth: true,
    }),
  ),
  // Review of #389: the camera raster alone cuts, on the colour read's alpha (`maskKeep`); a
  // second cut in the resolve left holes, 51 at 80°, 33 at 84° on Apple M3. At 88° (past the 16:1
  // grant) leaf edges are judged by holes.
  ...[80, 84, 88].map((degrees) =>
    unlit(`foliage at a grazing angle of ${degrees}°, anisotropy 16`, img.foliage, {
      tilt: -degrees * DEG2RAD,
      behind: 0x6a3d9a,
      points: GRAZING_ROW,
      truth: true,
    }),
  ),
  unlit('double-sided back face', () => ({ color: 0x2299cc, side: G.DOUBLE_SIDE }), {
    back: true,
  }),
  unlit('single-sided back face', () => ({ color: 0x2299cc }), { back: true }),
  lit(
    'double-sided back face, lit',
    () => ({ color: 0x2299cc, roughness: 1, side: G.DOUBLE_SIDE }),
    { back: true },
  ),
  lit('rough dielectric', () => ({ color: 0x808080, roughness: 1, metalness: 0 })),
  lit('polished metal', () => ({ color: 0xc0a060, roughness: 0.3, metalness: 1 })),
  lit('emissive', () => ({ color: 0x111111, roughness: 1, emissive: 0x881100 })),
  lit(
    'normal map',
    () => ({ color: 0x808080, roughness: 0.8, normalMap: img.texture(img.TILTED_NORMAL) }),
    { tangents: true },
  ),
]
