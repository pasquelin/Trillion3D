// Cone rejection under a non-uniform transform at small scale (defect 1). Two real triangles at
// large local coordinates placed by a scale (1e-8, 1e-6, 1e-6): a two-unit object facing the
// camera, wholly in the frustum. The transform is not conformal — lengths change a hundredfold —
// so the normal cone does not transport and the cluster must be kept, by `coneCullsPageWith`,
// `selectVisiblePages`, the kernel's Node oracle and the WGSL kernel alike. The fix loosens nothing
// conformal: a cluster under a uniform scale and a rotation, back to the camera, stays rejected.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { OPEN_CONE, type NormalCone } from '../../../packages/sdk-browser/src/page/cone/cone.ts'
import { coneCullsPageWith } from '../../../packages/sdk-browser/src/page/cone/cone.fixture.ts'
import { coneContextFor } from '../../../packages/sdk-browser/src/page/cone/cone.fixture.ts'
import { createConeContext } from '../../../packages/sdk-browser/src/page/cone/cone.fixture.ts'
import { selectVisiblePages } from '../../../packages/sdk-browser/src/page/cut/cut.fixture.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts'
import { signedArea } from '../../../bench/oracles/browser/cpu-image/projection.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/gpu/dag/oracle/oracle.fixture.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { triangleCone } from '../../kit/reference/cone.ts'
import { project } from '../kit/cameraRig.ts'
import { runSelectionKernel, type SelectionCase } from './selectionKernel.ts'

const VIEWPORT: [number, number] = [1000, 1000]
const POSITIONS = [0, 0, 0, 1e6, 0, -1e6, 0, 1e6, 0, 0, 0, 0, -1e6, 0, -1e6, 0, -1e6, 0]
const INDICES = [0, 1, 2, 3, 4, 5]
const MIN = [-1e6, -1e6, -1e6],
  MAX = [1e6, 1e6, 0]

/** The trigger case: the scale, the triangles' cone, and a camera that sees their face. */
function triggerCase() {
  const world = new G.Matrix4().makeScale(1e-8, 1e-6, 1e-6)
  const camera = G.perspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(6, 0, -9)
  camera.lookAt(0, 0, -0.5)
  camera.updateMatrixWorld(true)
  return { world, camera, cone: triangleCone(POSITIONS, INDICES) }
}

/** One page under `world`, with and without its cone, packed in the render frame of `camera`
 *  (its eye the origin), as the frame carries it to the GPU. */
function coneCases(
  name: string,
  world: G.Matrix4,
  camera: ReturnType<typeof G.perspectiveCamera>,
  page: object,
  cone: NormalCone,
) {
  const uniforms = cameraSelectionUniforms(engineCamera(camera), 0, VIEWPORT)
  const pack = (pageCone: NormalCone) =>
    packedWorldsToRenderOrigin(
      packDagSelection([
        { world, pages: [{ url: '0', lodError: 0, parentError: null, ...page, cone: pageCone }] },
      ]),
      [{ world, pages: [] }],
      uniforms.cameraWorld,
    )
  return [
    { name: `${name} with its cone`, packed: pack(cone), uniforms },
    { name: `${name} without a cone`, packed: pack(OPEN_CONE), uniforms },
  ] satisfies SelectionCase[]
}

test('every cut keeps a visible face under a small non-uniform scale', async () => {
  const { world, camera, cone } = triggerCase()
  const triangles = INDICES.length / 3
  // What the camera sees, from the world vertices: the face toward it, large, in the frustum.
  const corners = [0, 1, 2].map((i) =>
    new G.Vector3().fromArray(POSITIONS, i * 3).applyMatrix4(world),
  )
  const normal = new G.Vector3()
    .subVectors(corners[1], corners[0])
    .cross(new G.Vector3().subVectors(corners[2], corners[0]))
    .normalize()
  const facing = normal.dot(camera.position.clone().sub(corners[0]).normalize())
  const ndc = corners.map((v) => project(v.clone(), camera))
  const area = (Math.abs(signedArea(ndc[0], ndc[1], ndc[2])) * VIEWPORT[0] * VIEWPORT[1]) / 8
  assert.ok(facing > 0 && area > 100, 'the case must show a visible face')
  assert.ok(ndc.every((v) => Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z > 0 && v.z < 1))

  const context = coneContextFor(createConeContext(), world, engineCamera(camera).eye)
  assert.equal(
    coneCullsPageWith(context, cone, world, MIN, MAX),
    false,
    'CPU: the cone must not reject a visible face',
  )
  const box = new G.Box3(new G.Vector3(...MIN), new G.Vector3(...MAX)).applyMatrix4(world)
  const material = surfaceOf(G.basicSurface({ side: G.FRONT_SIDE }))
  for (const cones of [true, false]) {
    const page = {
      id: '0',
      url: '0',
      triangles,
      min: MIN,
      max: MAX,
      // Without its cone, the page is tested on its box alone.
      cone: cones ? cone : OPEN_CONE,
      lodError: 0,
      matrix: world,
      material,
    }
    const worldBox = new Float64Array([...box.min.toArray(), ...box.max.toArray()])
    const { displayedTriangles } = selectVisiblePages(
      [{ world, pages: [page], worldBox }],
      engineCamera(camera),
      { pixelError: 0, viewport: VIEWPORT },
    )
    assert.equal(displayedTriangles, triangles, `CPU cut, cones ${cones}: the face is lost`)
  }
  const cases = coneCases(
    'trigger',
    world,
    camera,
    { sphere: [0, 0, -0.5, 2], min: MIN, max: MAX },
    cone,
  )
  assert.deepEqual(evaluateDagSelectionKernel(cases[0].packed, cases[0].uniforms).pageIds, [0])
  const { adapter, readings } = await runSelectionKernel(cases)
  console.log(JSON.stringify({ adapter, cone, kept: readings.map(({ pages }) => pages) }))
  for (const { name, pages } of readings) assert.deepEqual(pages, [0], `GPU, ${name}: rejected`)
})

test('the GPU still rejects a conformal cluster back to the camera', async () => {
  const cone: NormalCone = { axis: [0, 0, 1], angle: Math.PI / 6 }
  const world = new G.Matrix4().compose(
    new G.Vector3(2, -1, 3),
    new G.Quaternion().setFromEuler(new G.Euler(0.3, -0.5, 0.2)),
    new G.Vector3(50, 50, 50),
  )
  const centre = new G.Vector3().applyMatrix4(world)
  const axis = new G.Vector3(...cone.axis)
    .applyMatrix3(new G.Matrix3().getNormalMatrix(world))
    .normalize()
  // The camera behind the face, on its axis.
  const camera = G.perspectiveCamera(55, 1, 0.1, 100000)
  camera.position.copy(axis).multiplyScalar(-500).add(centre)
  camera.lookAt(centre)
  camera.updateMatrixWorld(true)
  const page = { sphere: [...centre.toArray(), 3], min: [-1, -1, -1], max: [1, 1, 1] }
  const { readings } = await runSelectionKernel(coneCases('conformal', world, camera, page, cone))
  assert.deepEqual(readings[0].pages, [], 'a conformal back-facing cluster must stay rejected')
  assert.deepEqual(readings[1].pages, [0], 'witness: without its cone, the cluster stays')
})
