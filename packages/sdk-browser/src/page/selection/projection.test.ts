// The cut's projections, shared distance included, do not change a bit from the general path.
// Oracle: the general path, copied into `../../../../../bench/oracles/browser/cut-budget.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { projectedClusterError, type ClusterCut } from './math.ts'
import { clusterPixels } from './frame.fixture.ts'
import {
  projectedErrorAt,
  viewDepth,
  viewDepthOf,
  viewLateral,
  viewLateralOf,
} from './projection.ts'
import { errorFloorAt } from './projection.fixture.ts'
import {
  referenceErrorFloorPixels,
  referenceProjectCentre,
  referenceProjectedClusterError,
} from '../../../../../bench/oracles/browser/cut-budget.ts'
import { obliqueCamera } from './dag.fixture.ts'

const camera = obliqueCamera()
const view = camera.matrixWorldInverse.elements
const STRETCH = 1.25,
  FOCAL = 640,
  NEAR = camera.near
/** Spheres prepare accepts, plus those it rejects: the domain and its edges. */
const SPHERES: Array<number[] | null | undefined> = [
  [0, 0, 0, 1],
  [40, -3, 120, 0],
  [-1e5, 0, 1e5, 250],
  // A sphere centred behind the eye, and one that touches the near plane.
  [0, 0, 20, 2],
  [3, 2, 9, 0.5],
  null,
  undefined,
]
const ERRORS = [0, -0, 1e-6, 0.5, 4, 1e9, Infinity, undefined, null]

/** Every record of the product, unfiltered: the test only judges agreement of the two paths. */
function* records(): Generator<ClusterCut> {
  for (const lodError of ERRORS)
    for (const sphere of SPHERES)
      for (const parentError of ERRORS)
        for (const parentSphere of [SPHERES[0], SPHERES[2], null])
          yield {
            lodError: lodError as number | undefined,
            sphere: sphere ?? undefined,
            parentError: parentError as number | null | undefined,
            parentSphere,
          }
}

/** Verdict of a path: its value, or the fact that it refused the data. */
function verdict<V>(run: () => V): { value: V | undefined; threw: boolean } {
  try {
    return { value: run(), threw: false }
  } catch {
    return { value: undefined, threw: true }
  }
}

/** `[own, parent]` of the general path, copied out of its buffer. */
const pixels = (rec: ClusterCut) =>
  Array.from(clusterPixels(rec, view, STRETCH, FOCAL, NEAR, 1, new Float64Array(2)))

test('the cut rule reads the pre-lot projections, at the same bits', () => {
  for (const rec of records()) {
    const shared = verdict(() => pixels(rec))
    const reference = verdict(() => [
      referenceProjectedClusterError(rec.lodError ?? 0, rec.sphere, 0, view, STRETCH, FOCAL, NEAR),
      referenceProjectedClusterError(
        rec.parentError,
        rec.parentSphere ?? rec.sphere,
        0,
        view,
        STRETCH,
        FOCAL,
        NEAR,
      ),
    ])
    assert.equal(shared.threw, reference.threw, JSON.stringify(rec))
    if (!shared.threw)
      shared.value!.forEach((v, i) =>
        assert.ok(Object.is(v, reference.value![i]), `${JSON.stringify(rec)} [${i}]`),
      )
  }
})

test('a malformed own error is refused when the sphere is there', () => {
  for (const lodError of [-1, Number.NaN]) {
    const rec: ClusterCut = { lodError, sphere: [0, 0, 20, 1], parentError: 1 }
    assert.throws(() => pixels(rec))
  }
})

test("the shared quantities yield the general path's projections, at the same bits", () => {
  for (const sphere of SPHERES) {
    if (!sphere) continue
    const lateral = viewLateral(sphere, 0, view),
      depth = viewDepth(sphere, 0, view)
    const centre = referenceProjectCentre(sphere, 0, view)
    assert.equal(lateral, Math.sqrt(centre[0] * centre[0] + centre[1] * centre[1]))
    assert.equal(depth, -centre[2])
    for (const error of ERRORS) {
      assert.deepEqual(
        verdict((): boolean =>
          Object.is(
            projectedErrorAt(
              error as number | null | undefined,
              lateral,
              depth,
              sphere[3],
              STRETCH,
              FOCAL,
              NEAR,
            ),
            referenceProjectedClusterError(error, sphere, 0, view, STRETCH, FOCAL, NEAR),
          ),
        ),
        { value: true, threw: false },
        `projection ${error} ${sphere}`,
      )
      assert.ok(
        Object.is(
          errorFloorAt(error as number, depth, sphere[3], STRETCH, FOCAL),
          referenceErrorFloorPixels(
            error,
            STRETCH,
            referenceProjectCentre(sphere, 0, view),
            sphere[3],
            FOCAL,
          ),
        ),
        `floor ${error} ${sphere}`,
      )
      assert.ok(
        Object.is(
          projectedClusterError(error as number, sphere, 0, view, STRETCH, FOCAL, NEAR),
          referenceProjectedClusterError(error, sphere, 0, view, STRETCH, FOCAL, NEAR),
        ) || !Number.isFinite(error as number),
        `projected error ${error} ${sphere}`,
      )
    }
  }
})

test('component by component, the axis and the depth equal those taken from the sphere', () => {
  for (const sphere of SPHERES) {
    if (!sphere) continue
    assert.equal(viewLateralOf(sphere[0], sphere[1], sphere[2], view), viewLateral(sphere, 0, view))
    assert.equal(viewDepthOf(sphere[0], sphere[1], sphere[2], view), viewDepth(sphere, 0, view))
  }
})

test('axis and depth propagate as NaN and equal zero at the origin of the frame', () => {
  assert.ok(Number.isNaN(viewLateralOf(NaN, 0, 0, view)))
  assert.ok(Number.isNaN(viewDepthOf(0, 0, NaN, view)))
  const originView = new G.Matrix4().identity().elements
  assert.equal(viewLateralOf(0, 0, 0, originView), 0)
  assert.equal(viewDepthOf(0, 0, 0, originView), -0)
})
