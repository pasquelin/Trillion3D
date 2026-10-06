// Defect 1 (cone reject at small scale): `isConformal` must judge on purely relative length and
// orthogonality ratios, never on an additive tolerance which, at small scale, hides a real
// anisotropic deformation. The first test retakes the trigger case of
// `tests/gpu/dag/cone-non-uniform-scale.gpu.ts`; the following cover degenerate 3×3s, then
// confirm that reject remains possible for any uniform scale and rotation, as before this batch.
import { triangleCone } from '../../../../../tests/kit/reference/cone.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { coneContextFor, coneCullsPageWith, createConeContext, type NormalCone } from './cone.ts'
import { selectVisiblePages } from '../cut/cut.ts'
import type { ClusterRoot } from '../selection/types.ts'
import type { PageRecord } from '../cut/state.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'

const VIEWPORT: [number, number] = [1000, 1000]
const POSITIONS = [0, 0, 0, 1e6, 0, -1e6, 0, 1e6, 0, 0, 0, 0, -1e6, 0, -1e6, 0, -1e6, 0]
const INDICES = [0, 1, 2, 3, 4, 5]
const TRIANGLES = INDICES.length / 3
const MIN = [-1e6, -1e6, -1e6]
const MAX = [1e6, 1e6, 0]

/** Camera of the trigger case: the face of both triangles faces it, in the frustum. */
function camera() {
  const cam = G.perspectiveCamera(60, 1, 0.1, 100)
  cam.position.set(6, 0, -9)
  cam.lookAt(0, 0, -0.5)
  cam.updateMatrixWorld(true)
  return cam
}

/** A single cluster, the full CPU cut — only the fields `selectFlat` actually reads. */
function trianglesGardes(world: G.Matrix4, cone: NormalCone, cam: G.Camera) {
  const page = {
    min: MIN,
    max: MAX,
    cone,
    triangles: TRIANGLES,
    lodError: 0,
  } as unknown as PageRecord
  const root = { world, pages: [page], cones: true } as unknown as ClusterRoot<PageRecord>
  return selectVisiblePages([root], engineCamera(cam), { pixelError: 0, viewport: VIEWPORT })
    .displayedTriangles
}

test('non-uniform scale at small scale (1e-8, 1e-6, 1e-6), trigger case: both triangles stay', () => {
  const cone = triangleCone(POSITIONS, INDICES)
  const world = new G.Matrix4().makeScale(1e-8, 1e-6, 1e-6)
  const cam = camera()
  const ctx = coneContextFor(createConeContext(), world, engineCamera(cam).eye)
  assert.equal(
    coneCullsPageWith(ctx, cone, world, MIN, MAX),
    false,
    'coneCullsPageWith rejects the face though it is visible',
  )
  assert.equal(trianglesGardes(world, cone, cam), TRIANGLES, 'selectVisiblePages loses the face')
})

test('a degenerate 3×3 (null scale on one axis, hence a null column) is not conformal: the cluster stays', () => {
  const cone: NormalCone = { axis: [0, 0, 1], angle: Math.PI / 6 }
  const cam = camera()
  for (const scale of [
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
  ] as const) {
    const world = new G.Matrix4().makeScale(scale[0], scale[1], scale[2])
    const ctx = coneContextFor(createConeContext(), world, engineCamera(cam).eye)
    assert.equal(ctx.conformal, false, `scale ${scale}`)
    assert.equal(
      coneCullsPageWith(ctx, cone, world, [-1, -1, 0], [1, 1, 0]),
      false,
      `box kept for scale ${scale}`,
    )
  }
})

test('a 3×3 with a NaN or infinite term is not conformal: the cluster stays', () => {
  const cone: NormalCone = { axis: [0, 0, 1], angle: Math.PI / 6 }
  const cam = camera()
  for (const [index, valeur] of [
    [0, NaN],
    [5, Infinity],
    [10, -Infinity],
  ] as const) {
    const world = new G.Matrix4()
    world.elements[index] = valeur
    const ctx = coneContextFor(createConeContext(), world, engineCamera(cam).eye)
    assert.equal(ctx.conformal, false, `term ${index} = ${valeur}`)
    assert.equal(
      coneCullsPageWith(ctx, cone, world, [-1, -1, 0], [1, 1, 0]),
      false,
      `box kept for term ${index} = ${valeur}`,
    )
  }
})

test('uniform scale from 1e-8 to 1e3, with rotation: a face with its back to the camera stays rejected', () => {
  const cone: NormalCone = { axis: [0, 0, 1], angle: Math.PI / 6 }
  for (const scale of [1e-8, 1e-4, 1, 1e3]) {
    for (const euler of [
      [0, 0, 0],
      [0.3, -0.5, 0.2],
    ] as const) {
      const q = new G.Quaternion().setFromEuler(new G.Euler(...euler))
      const world = new G.Matrix4().compose(new G.Vector3(), q, new G.Vector3(scale, scale, scale))
      const conforme = coneContextFor(createConeContext(), world, engineCamera(camera()).eye)
      assert.equal(conforme.conformal, true, `scale ${scale} rotation ${euler}`)
      // The context's normal matrix is flat: the test puts it back in an object to apply it.
      const normal = new G.Matrix3()
      normal.elements.set(conforme.normal)
      const worldAxis = new G.Vector3(...cone.axis).applyMatrix3(normal).normalize()
      const distance = Math.max(5, scale * 2000)
      const cam = G.perspectiveCamera(55, 1, 0.1, distance * 100)
      cam.position.copy(worldAxis).multiplyScalar(-distance)
      cam.lookAt(0, 0, 0)
      cam.updateMatrixWorld(true)
      const ctxArriere = coneContextFor(createConeContext(), world, engineCamera(cam).eye)
      assert.equal(
        coneCullsPageWith(ctxArriere, cone, world, [-1, -1, -1], [1, 1, 1]),
        true,
        `scale ${scale} rotation ${euler}: back-facing face not rejected`,
      )
    }
  }
})
