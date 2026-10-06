// A sponza-sized atrium for the light-tile work counts (#1249): a 30 × 14 m court 14 m high, two
// storeys of arcades on each long side — columns every 3 m, lintels, gallery floors —, hanging
// drapes and end walls, open to the sky over the court. Synthetic: it stands for sponza's depth
// (near columns in front of far walls in the same tiles), never for its image. `atriumDepth`
// ray-casts it as the engine's depth buffer holds it — reverse-Z, infinite far, 0 on the sky.
import { mulberry32 } from '../../../site/examples/kit/random.ts'
import {
  pixelRay,
  rayDepth,
  type Vec3,
} from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import type { TileView } from '../../oracles/browser/gpuLightGridOracle.ts'
import { slab, type Light } from './lightTileCity.ts'

type Box = { lo: Vec3; hi: Vec3 }
const HALF_X = 15,
  HALF_Z = 7,
  HEIGHT = 14,
  ARCADE_Z = 4
const box = (lo: Vec3, hi: Vec3): Box => ({ lo, hi })
/** The atrium's footprint, its 0.3 m floor and end walls included: the box its model spans. */
export const ATRIUM_BOUNDS = {
  min: { x: -HALF_X - 0.3, y: -0.3, z: -HALF_Z - 0.3 },
  max: { x: HALF_X + 0.3, y: HEIGHT, z: HALF_Z + 0.3 },
}

/** The atrium's boxes: floor, walls, two storeys of arcades on each side, drapes, gallery roofs. */
function atriumBoxes(): Box[] {
  const boxes: Box[] = [
    box([-HALF_X, -0.3, -HALF_Z], [HALF_X, 0, HALF_Z]),
    box([-HALF_X - 0.3, 0, -HALF_Z], [-HALF_X, HEIGHT, HALF_Z]),
    box([HALF_X, 0, -HALF_Z], [HALF_X + 0.3, HEIGHT, HALF_Z]),
  ]
  for (const side of [-1, 1]) {
    const wall = side * HALF_Z,
      arcade = side * ARCADE_Z
    const across = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)]
    const [wz0, wz1] = across(wall, wall + side * 0.3)
    boxes.push(box([-HALF_X, 0, wz0], [HALF_X, HEIGHT, wz1]))
    const [gz0, gz1] = across(arcade - side * 0.4, wall)
    for (const [floor, top] of [
      [0, 6],
      [6.3, 10],
    ]) {
      for (let x = -12; x <= 12; x += 3)
        boxes.push(box([x - 0.4, floor, arcade - 0.4], [x + 0.4, top, arcade + 0.4]))
      boxes.push(box([-HALF_X, top - 0.7, arcade - 0.4], [HALF_X, top, arcade + 0.4]))
      boxes.push(box([-HALF_X, top, gz0], [HALF_X, top + 0.3, gz1]))
    }
    boxes.push(box([-HALF_X, HEIGHT - 0.3, gz0], [HALF_X, HEIGHT, gz1]))
    // Drapes between the upper columns, every other bay, a hand's breadth in front of them.
    const [dz0, dz1] = across(arcade - side * 0.6, arcade - side * 0.65)
    for (let x = -10.5; x <= 10.5; x += 6) boxes.push(box([x - 1.1, 6.6, dz0], [x + 1.1, 9.4, dz1]))
  }
  return boxes
}

/** `count` lamps of range `range`, uniform in the atrium's volume, from a fixed seed. */
export function atriumLamps(count: number, range: number, seed = 1249): Light[] {
  const r = mulberry32(seed),
    u = (lo: number, hi: number) => Math.fround(lo + (hi - lo) * r())
  return Array.from({ length: count }, () => ({
    centre: [u(-HALF_X + 0.5, HALF_X - 0.5), u(0.3, HEIGHT - 0.5), u(-HALF_Z + 0.3, HALF_Z - 0.3)],
    radius: Math.fround(range),
  }))
}

/** Entry parameter of the ray `o + s·d` into `b`, Infinity on a miss or behind the origin. */
function hit(o: Vec3, d: Vec3, b: Box) {
  const [near, far] = slab(o, d, b.lo, b.hi)
  const entry = Math.max(near, 0)
  return entry <= far ? entry : Infinity
}

/** The depth buffer of `view` over the atrium, row by row: NEAR / distance in f32, 0 on the sky.
 *  `shown`, when given, receives the index of the box each pixel shows, −1 on the sky; `layers`,
 *  the boxes its ray enters — the fragments a raster with no depth order draws there. */
export function atriumDepth(
  view: TileView,
  boxes = atriumBoxes(),
  shown?: Int32Array,
  layers?: Uint16Array,
) {
  const depths = new Float32Array(view.width * view.height)
  for (let py = 0; py < view.height; py++)
    for (let px = 0; px < view.width; px++) {
      const { o, d } = pixelRay(view, px, py)
      let s = Infinity,
        nearest = -1
      boxes.forEach((b, index) => {
        const at = hit(o, d, b)
        if (layers && at < Infinity) layers[py * view.width + px]++
        if (at < s) [s, nearest] = [at, index]
      })
      depths[py * view.width + px] = s === Infinity ? 0 : rayDepth(s)
      if (shown) shown[py * view.width + px] = nearest
    }
  return depths
}

/** The moving camera's poses: down the court, turning toward the arcades, from the ground. */
export const ATRIUM_POSES: { eye: Vec3; yaw: number; pitch: number }[] = [
  { eye: [-13.5, 1.7, 0], yaw: -Math.PI / 2, pitch: 0.05 },
  { eye: [-9, 1.7, 1.5], yaw: -Math.PI / 2 + 0.35, pitch: 0.1 },
  { eye: [-4, 1.7, -1.5], yaw: -Math.PI / 2 - 0.6, pitch: 0.15 },
  { eye: [2, 1.7, 0.5], yaw: -Math.PI / 2 + 0.9, pitch: 0.2 },
]
