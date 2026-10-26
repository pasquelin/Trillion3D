// The horizon search's first pass written a second time, apart from the shader, in plain scalars and arrays, from the steps
// themselves: the tests set it against the shipped WGSL run by `shaderRun`, pixel by pixel (`chain.fixture.ts`). Distances are
// centimetres, as the shader's.
import { clamp, fract, lerp, saturate } from '../../../../../math/src/scalar/reals.ts'
import { dotVector3 as dot } from '../../../../../math/src/vector/vector.ts'
import { cross, subtract, unit, type Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import {
  ASPECT,
  cm,
  FOV_HALF_TAN,
  HEIGHT,
  WIDTH,
  type createScene,
  type settingsOf,
} from '../scene.fixture.ts'

export type Scene = ReturnType<typeof createScene>
export type Settings = ReturnType<typeof settingsOf>

const P00 = 1 / (ASPECT * FOV_HALF_TAN)
const P11 = 1 / FOV_HALF_TAN
/** The steps and the first level of a shader quality, the turns and the offsets of the image ranks, as the notes give them. */
const QUALITY = [
  [4, 2],
  [6, 1],
  [8, 0],
  [12, 0],
  [20, 0],
]
const TURNS = [60, 300, 180, 240, 120, 0]
const OFFSETS = [0.1, 0.6, 0.35, 0.85]

/** A cosine of the angle as the arc: the polynomial the search takes, mirrored. */
const arcCos = (x: number) => {
  const a = Math.abs(x)
  const r = (-0.156583 * a + Math.PI / 2) * Math.sqrt(1 - a)
  return x >= 0 ? r : Math.PI - r
}

/** The point of the view at a position of the picture (0 to 1, y down) and a depth. */
export const viewPos = (uv: number[], depth: number): Vec3 => [
  ((uv[0] * 2 - 1) / P00) * depth,
  ((1 - uv[1] * 2) / P11) * depth,
  depth,
]

/** The pixel a position falls in. */
export const pixelOf = (uv: number[]) => [
  clamp(Math.floor(uv[0] * WIDTH), 0, WIDTH - 1),
  clamp(Math.floor(uv[1] * HEIGHT), 0, HEIGHT - 1),
]

/** The smaller step of the two a value takes to its neighbours. */
const smaller = (l: number, m: number, r: number) =>
  Math.abs(m - l) < Math.abs(r - m) ? m - l : r - m

/** The normal the neighbours' depths give: the smaller step of each axis, the points they make, the cross of the two. */
export function depthNormal(scene: Scene, uv: number[], mid: Vec3): Vec3 {
  const [x, y] = pixelOf(uv)
  const z = scene.device(x, y)
  const dx = smaller(scene.device(x - 1, y), z, scene.device(x + 1, y))
  const dy = smaller(scene.device(x, y - 1), z, scene.device(x, y + 1))
  const right = subtract(viewPos([uv[0] + 1 / WIDTH, uv[1]], cm(z + dx)), mid)
  const down = subtract(viewPos([uv[0], uv[1] + 1 / HEIGHT], cm(z + dy)), mid)
  return unit(cross(right, down))
}

/** The directions' turn and the steps' offset a pixel gets: the noise of its place, turned by the image's rank. */
function randomOf(x: number, y: number, rank: number) {
  const turn = (TURNS[rank % 6] * Math.PI) / 360
  const phase = OFFSETS[Math.floor(rank / 6) % 4] * 0.25
  const yy = 16384 - y
  const noise = fract(52.9829189 * fract(x * 0.06711056 + yy * 0.00583715))
  const tex = [Math.cos(noise * Math.PI), Math.sin(noise * Math.PI)]
  const offset = 0.25 * ((((yy - x) % 4) + 4) % 4)
  return {
    dir: [
      tex[0] * Math.cos(turn) - tex[1] * Math.sin(turn),
      tex[0] * Math.sin(turn) + tex[1] * Math.cos(turn),
    ],
    phase: fract(offset + phase),
  }
}

/** The angles a direction's two sides find: the highest horizon along each, the steps up the pyramid. */
function searchOf(
  scene: Scene,
  s: Settings,
  uv: number[],
  dir: number[],
  radius: number,
  phase: number,
  pos: Vec3,
  view: Vec3,
  atten: number,
) {
  const [taps, bias] = QUALITY[s.shaderQuality]
  const best = [-1, -1]
  const cell = (at: number[], mip: number) => {
    const side = 2 ** (mip + 1)
    return cm(
      scene.farthest(
        Math.floor((at[0] * WIDTH) / side),
        Math.floor((at[1] * HEIGHT) / side),
        mip + 1,
      ),
    )
  }
  for (let i = 1; i <= taps; i++) {
    const along = [
      dir[0] * Math.max(radius * (i + phase), i + 1),
      -dir[1] * Math.max(radius * (i + phase), i + 1),
    ]
    const mip = bias + (i === 2 ? 1 : 0) + (i > 3 ? 2 : 0)
    ;[1, -1].forEach((sign, side) => {
      const at = [uv[0] + sign * along[0], uv[1] + sign * along[1]]
      const v = subtract(viewPos(at, cell(at, mip)), pos)
      const lenSq = dot(v, v)
      const fall = saturate(lenSq * atten)
      if (fall >= 1) return
      const angle = lerp(dot(v, view) / Math.sqrt(lenSq + 0.0001), best[side], fall)
      best[side] = angle > best[side] ? angle : lerp(angle, best[side], s.horizon.thickness)
    })
  }
  return best.map((c) => arcCos(clamp(c, -1, 1)))
}

/** The share of the sky a direction's horizons leave, against the normal projected into the plane of the direction and the view. */
function integralOf(angles: number[], dir: number[], view: Vec3, normal: Vec3) {
  const plane = unit(cross([dir[0], dir[1], 0], view))
  const perp = cross(view, plane)
  const proj = subtract(
    normal,
    plane.map((p) => p * dot(normal, plane)),
  )
  const length = Math.hypot(...proj) + 0.000001
  const cosAng = dot(proj, perp) / length
  const gamma = arcCos(cosAng) - Math.PI / 2
  const cosGamma = dot(proj, view) / length
  const sinGamma = cosAng * -2
  const ax = gamma + Math.max(-angles[0] - gamma, -Math.PI / 2)
  const ay = gamma + Math.min(angles[1] - gamma, Math.PI / 2)
  return (
    length *
    0.25 *
    (ax * sinGamma +
      cosGamma -
      Math.cos(2 * ax - gamma) +
      (ay * sinGamma + cosGamma - Math.cos(2 * ay - gamma)))
  )
}

/** The search and the integral of the pixel `(x, y)` of a target `scale` times smaller than the image, at the image's `rank`. */
export function combineOf(
  scene: Scene,
  s: Settings,
  scale: number,
  rank: number,
  [x, y]: number[],
) {
  const { horizon } = s
  const uv = [
    (x + 0.5) / (WIDTH / scale) + 0.125 / WIDTH,
    (y + 0.5) / (HEIGHT / scale) + 0.125 / HEIGHT,
  ]
  const [px, py] = pixelOf(uv)
  const depth = cm(scene.device(px, py))
  if (depth > s.fadeDistanceCm) return 1
  const pos = viewPos(uv, depth)
  const n = scene.normal(px, py)
  const normal: Vec3 = horizon.normals ? ([n[0], n[1], -n[2]] as Vec3) : depthNormal(scene, uv, pos)
  const view = pos.map((p) => -p / Math.hypot(...pos)) as Vec3
  const radius = horizon.radiusCm
  const [taps] = QUALITY[s.shaderQuality]
  const step = Math.max(Math.min((radius * HEIGHT * P00) / pos[2], 256), taps) / (taps + 1)
  const random = randomOf(x, y, horizon.pauseJitter ? 0 : rank)
  let { dir, phase } = random
  const delta = Math.PI / horizon.angles
  const count = Math.trunc(horizon.angles)
  let sum = 0
  for (let a = 0; a < count; a++) {
    const angles = searchOf(
      scene,
      s,
      uv,
      [dir[0] / WIDTH, dir[1] / HEIGHT],
      step,
      phase,
      pos,
      view,
      2 / (radius * radius),
    )
    sum += integralOf(angles, dir, view, normal)
    dir = [
      dir[0] * Math.cos(delta) - dir[1] * Math.sin(delta),
      dir[0] * Math.sin(delta) + dir[1] * Math.cos(delta),
    ]
    phase = fract(phase + 0.617)
  }
  return lerp((sum / count) * (2 / Math.PI), 1, saturate(depth * s.fadeMultiplier + s.fadeAddend))
}
