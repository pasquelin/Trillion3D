// The partition's formulas in their packages/math homes, each against the expression it replaced.
//
// `lensSlope`, the perspective `cellReach` and the super-roots' `cos` are the same operations in
// the same order (`perspectiveDiagonalSlope`, `frustumCornerDistance`, `length2(1, slope)`, whose
// `1 * 1` is exact): the sweep holds them bit for bit, `aspect ** 2` against `aspect * aspect`
// included. The orthographic `cellReach` and the super-roots' eye distance leave `Math.hypot`
// for `length3`, which can move the last bit. Neither number reaches a pixel or a GPU buffer:
// the reach and the error decide which cells and index pages are read, the rung the rows are
// sized at and a read priority, while the GPU cut alone decides what is drawn and a cell not read
// is drawn by its super-roots. The sweep holds every decision they take the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HALTON_SWEEP, edgeValues, haltonSpan } from '../../../math/src/sequence/sweep.fixture.ts'
import { drawnView, perspectiveSlope } from '../../../math/src/projection/camera.ts'
import { projectedErrorAt } from '../page/selection/projection.ts'
import { AHEAD } from './aheadShare.ts'
import { cellReach, KEEP } from './plan.ts'
import { heldSide, rungOf } from './sizing.ts'
import { cellSuperRootError, lensSlope } from './superRoots.ts'

/** The old `lensSlope`. */
const oldLensSlope = (fov: number, aspect: number, zoom: number) =>
  perspectiveSlope(fov, zoom || 1) * Math.sqrt(1 + aspect ** 2)

/** The old perspective `cellReach`. */
function oldPerspectiveReach(fov: number, aspect: number, far: number, zoom: number) {
  const slope = perspectiveSlope(fov, zoom || 1)
  return far * Math.sqrt(1 + slope * slope * (1 + aspect * aspect))
}

const view = new Float64Array(4)
/** The old orthographic `cellReach`. */
function oldOrthographicReach(optics: Parameters<typeof cellReach>[0]) {
  const box = optics.orthographic!
  const [x, y, width, height] = drawnView(box, optics.aspect, optics.zoom || 1, view)
  const depth = Math.max(Math.abs(optics.far), Math.abs(optics.near))
  return Math.hypot(depth, Math.abs(x) + Math.abs(width), Math.abs(y) + Math.abs(height))
}

type Lens = Parameters<typeof cellSuperRootError>[3]
/** The old `cellSuperRootError`. */
function oldSuperRootError(bounds: Float64Array, eye: number[], lens: Lens) {
  const centre = Math.hypot(bounds[1] - eye[0], bounds[2] - eye[1], bounds[3] - eye[2])
  const distance = Math.max(0, centre - bounds[4])
  const cos = 1 / Math.sqrt(1 + lens.slope * lens.slope),
    sin = lens.slope * cos
  const focal = Math.max(lens.pixelScale[0], lens.pixelScale[1])
  const p = lens.perspective ?? 1
  return projectedErrorAt(bounds[0], distance * sin, distance * cos, 0, 1, focal, lens.near, p)
}

const optics = { fov: 60, aspect: 16 / 9, near: 0.1, far: 1000, zoom: 1, orthographic: null }

test('lensSlope and the perspective reach are the old expressions, bit for bit', () => {
  const aspects = edgeValues(0, 8)
  for (let i = 1; i <= HALTON_SWEEP; i++) aspects.push(haltonSpan(i, 2, 0.05, 8))
  for (let i = 0; i < aspects.length; i++) {
    const aspect = aspects[i],
      k = i + 1
    const fov = haltonSpan(k, 3, 1, 179),
      zoom = k % 7 === 0 ? 0 : haltonSpan(k, 5, 0.1, 10),
      far = haltonSpan(k, 7, 0.01, 1e7)
    const lens = { fov, aspect, zoom, orthographic: null, near: 0.1, far }
    assert.ok(Object.is(lensSlope(lens), oldLensSlope(fov, aspect, zoom)), `slope ${i}`)
    assert.ok(Object.is(cellReach(lens), oldPerspectiveReach(fov, aspect, far, zoom)), `reach ${i}`)
  }
})

/** The plan's decisions on a cell `distance` away for `reach`, and the rows' rung. */
const reachDecisions = (reach: number, distance: number, cube: number) => [
  distance <= reach,
  distance <= reach * (1 + AHEAD),
  distance > reach * (1 + KEEP),
  distance > reach,
  rungOf(heldSide(reach, cube, new Map([[0, [0.5, 2]]])), cube),
]

test('the orthographic reach on length3 takes every decision the old one took', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const left = haltonSpan(i, 2, -1e4, 1e4),
      bottom = haltonSpan(i, 3, -1e4, 1e4)
    const box = {
      left,
      right: left + haltonSpan(i, 5, -1e4, 1e4),
      bottom,
      top: bottom + haltonSpan(i, 7, -1e4, 1e4),
      fitAspect: i % 3 === 0,
    }
    const lens = {
      ...optics,
      orthographic: box,
      zoom: haltonSpan(i, 11, 0.05, 20),
      near: haltonSpan(i, 13, -1e4, 1),
      far: haltonSpan(i, 17, 0, 1e6),
    }
    const old = oldOrthographicReach(lens),
      cube = haltonSpan(i, 19, 1, 1e4)
    // A cell's distance is its box's, never the reach's: drawn on the sweep, up to twice the reach.
    for (const base of [23, 29, 31]) {
      const distance = haltonSpan(i, base, 0, 2) * old
      assert.deepEqual(
        reachDecisions(cellReach(lens), distance, cube),
        reachDecisions(old, distance, cube),
        `${i} at ${distance}`,
      )
    }
  }
})

/** The plan's three choices on a cell whose super-roots project `error` against `target`. */
const errorDecisions = (error: number, target: number) => {
  const ratio = error / target
  return [ratio > 1, ratio * (1 + AHEAD) > 1, ratio * (1 + KEEP) <= 1]
}

test("the super-roots' error on length3 takes every decision the old one took", () => {
  const bounds = new Float64Array(5)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    bounds[0] = i % 61 === 0 ? 0 : haltonSpan(i, 2, 1e-4, 10)
    for (let k = 0; k < 3; k++) bounds[1 + k] = haltonSpan(i, [3, 5, 7][k], -1e5, 1e5)
    bounds[4] = haltonSpan(i, 11, 0, 2e4)
    const eye = [0, 1, 2].map((k) => haltonSpan(i, [13, 17, 19][k], -1e5, 1e5))
    const lens = {
      pixelScale: [haltonSpan(i, 23, 1, 4000), haltonSpan(i, 29, 1, 4000)] as [number, number],
      pixelError: haltonSpan(i, 31, 0.25, 4),
      near: haltonSpan(i, 37, 1e-3, 10),
      perspective: i % 5 === 0 ? 0 : 1,
      slope: haltonSpan(i, 41, 0, 6),
    }
    const old = oldSuperRootError(bounds, eye, lens),
      now = cellSuperRootError(bounds, 0, eye, lens)
    for (const target of [lens.pixelError, lens.pixelError / 64, lens.pixelError * 64])
      assert.deepEqual(errorDecisions(now, target), errorDecisions(old, target), `${i}`)
  }
})
