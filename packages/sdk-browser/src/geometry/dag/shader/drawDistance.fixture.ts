// The shipped draw distance WGSL (`drawDistanceWgsl.ts`) run in JavaScript for a test: placement 3
// and group 5, the pose of the placement any matrix, the view's uniform changed between calls.
import { DRAW_FAR_WORD, DRAW_NEAR_WORD } from '../frameTable.ts'
import { DAG_DRAW_DISTANCE_WGSL } from './drawDistanceWgsl.ts'
import {
  CULL_DRAW_DISTANCE_OFF,
  CULL_NO_DRAW_DISTANCES,
  CULL_SPHERE_EDGE_OFF,
} from './viewsWgsl.ts'
import { OCCLUSION_TWO_PASS } from './occlusionWgsl.ts'
import { TREE_DRAW_FAR, TREE_DRAW_NEAR } from '../nodeLayout.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'

/** What a kernel of the draw distance's WGSL is asked: the root's bounds, a box in the placement's
 *  space. */
type Bounds = { minimum: number[]; maximum: number[] }

/** A column-major pose: the scales `scale` along its axes after the rotation about z by `turn`
 *  radians and the rotation about x by `lean`, then the translation `shift`. */
export function poseOf(shift: number[], scale = [1, 1, 1], turn = 0, lean = 0) {
  const [cz, sz, cx, sx] = [Math.cos(turn), Math.sin(turn), Math.cos(lean), Math.sin(lean)]
  // R = Rx(lean) · Rz(turn), column by column, each column then stretched.
  const columns = [
    [cz, cx * sz, sx * sz],
    [-sz, cx * cz, sx * cz],
    [0, -sx, cx],
  ]
  return [
    ...columns.flatMap((column, axis) => [...column.map((v) => v * scale[axis]), 0]),
    ...shift,
    1,
  ]
}

/** The functions of `DAG_DRAW_DISTANCE_WGSL` run in JavaScript, with the words they read set by
 *  `placement` and `group`; `view` is the uniform they read. */
export function drawKernel(pose: readonly number[] = poseOf([0, 0, 0])) {
  const words = new Map<string, number>(),
    view = {
      viewDistanceScale: 1,
      primitiveDistanceScale: 1,
      occlusion: OCCLUSION_TWO_PASS,
      cullOff: 0,
    }
  const matrix = new Mat(pose)
  const kernel = shaderRun<{
    outsideDrawDistances(
      distance: number,
      radius: number,
      near: number,
      far: number,
      scale: number,
    ): boolean
    drawSphereRadius(pose: Mat, half: number[]): number
    outsideDrawDistance(w: number, mark: number, node: Bounds): boolean
    outsideGroupDrawDistance(t: number, low: number[], high: number[]): boolean
  }>(
    DAG_DRAW_DISTANCE_WGSL,
    ['outsideDrawDistances', 'drawSphereRadius', 'outsideDrawDistance', 'outsideGroupDrawDistance'],
    {
      cutView: view,
      OCCLUSION_TWO_PASS,
      CULL_DRAW_DISTANCE_OFF,
      CULL_NO_DRAW_DISTANCES,
      CULL_SPHERE_EDGE_OFF,
      cullOff: (bits: number) => (view.cullOff & bits) !== 0,
      preparedPose: () => matrix,
      framesWord: (w: number, k: number) => words.get(`frame ${w} ${k}`) ?? 0,
      treeWord: (t: number, k: number) => words.get(`tree ${t} ${k}`) ?? 0,
    },
  )
  const set = (key: string, near: number, nearWord: number, far: number, farWord: number) => {
    words.set(`${key} ${nearWord}`, f32Bits(near))
    words.set(`${key} ${farWord}`, f32Bits(far))
  }
  return {
    view,
    pose: matrix,
    ...kernel,
    placement: (near: number, far: number) =>
      set('frame 3', near, DRAW_NEAR_WORD, far, DRAW_FAR_WORD),
    group: (near: number, far: number) => set('tree 5', near, TREE_DRAW_NEAR, far, TREE_DRAW_FAR),
  }
}

/** The world box of the box `low`–`high` of a placement's space under the pose `m` (sixteen
 *  column-major numbers), found by carrying its eight corners over: its low and high corners. */
export function carriedBounds(m: readonly number[], low: number[], high: number[]) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity]
  for (let corner = 0; corner < 8; corner++) {
    const p = [0, 1, 2].map((a) => (corner & (1 << a) ? high[a] : low[a]))
    for (let row = 0; row < 3; row++) {
      const v = m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row]
      lo[row] = Math.min(lo[row], v)
      hi[row] = Math.max(hi[row], v)
    }
  }
  return { low: lo, high: hi }
}

/**
 * The radius of the sphere of the box `low`–`high` under the pose `m`, found as the reference's
 * transformed bounding sphere is, by other means than the cut's: the box's half diagonal times the
 * greatest of the lengths of the pose's rows, held to the half diagonal of the box its eight
 * corners make (`carriedBounds`).
 */
export function referenceSphereRadius(m: readonly number[], low: number[], high: number[]) {
  const half = [0, 1, 2].map((a) => 0.5 * (high[a] - low[a]))
  const rowLengths = [0, 1, 2].map((row) => Math.hypot(m[row], m[4 + row], m[8 + row]))
  const carried = carriedBounds(m, low, high)
  const reach = Math.hypot(...[0, 1, 2].map((a) => 0.5 * (carried.high[a] - carried.low[a])))
  return Math.min(Math.hypot(...half) * Math.max(...rowLengths), reach)
}

/** A pose and a box drawn at random: stretched unevenly, turned, the box long on one axis or
 *  another, at a distance. */
export function placement(next: () => number, spread = 60) {
  const range = (low: number, high: number) => low + next() * (high - low)
  const half = [0, 1, 2].map(() => range(0.05, 1) * (next() < 0.3 ? 30 : 1)),
    scale = [0, 1, 2].map(() => (next() < 0.5 ? 1 : range(0.2, 10)))
  const m = poseOf(
    [0, 1, 2].map(() => range(-spread, spread) + range(-300, 300)),
    scale,
    range(0, 6.28),
    range(0, 6.28),
  )
  return { m, low: half.map((v) => -v), high: half }
}

/** The members of a group at random, each with its pose, box, kind and distances. */
export function members(next: () => number) {
  return Array.from({ length: 1 + Math.floor(next() * 5) }, () => {
    const { m, low, high } = placement(next, 40),
      near = next() < 0.5 ? 0 : next() * 200,
      instance = next() < 0.4
    const carried = carriedBounds(m, low, high)
    return {
      near,
      far: next() < 0.25 ? 0 : near + 1 + next() * 300,
      instance,
      carried,
      centre: [0, 1, 2].map((a) => 0.5 * (carried.low[a] + carried.high[a])),
      radius: instance ? 0 : referenceSphereRadius(m, low, high),
    }
  })
}
