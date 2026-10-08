// An off-axis simplified cluster is not accepted under the threshold its true displacement
// exceeds. A fine triangle off the axis, view centre (8, 0, −10), and its coarse replacement, the
// same triangle shifted vertically by ε, chosen so the on-axis formula `ε·f / (|C| − r)` would
// announce 0.39 px where the vertices truly move 0.5 px. At 0.4 px, every cut keeps the fine one:
// the CPU cut (`selectVisiblePages`, flat and with a culling node and its bounds), the kernel's
// Node oracle and the WGSL kernel.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { selectVisiblePages } from '../../../packages/sdk-browser/src/page/cut/cut.fixture.ts'
import { projectedClusterError } from '../../../packages/sdk-browser/src/page/selection/math.ts'
import { cullingBounds } from '../../../packages/sdk-browser/src/page/cut/bounds.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/gpu/dag/oracle/oracle.fixture.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { project } from '../kit/cameraRig.ts'
import { runSelectionKernel } from './selectionKernel.ts'

const THRESHOLD = 0.4
const VIEWPORT: [number, number] = [1920, 1080]
const FINE = [8, 0, -10, 8.01, 0, -10, 8, 0.01, -10]

/** A vertex list's box, and its sphere: the box centre, out to the farthest vertex. */
function boundsOf(vertices: number[]) {
  const box = new G.Box3().setFromArray(vertices)
  const c = box.getCenter(new G.Vector3())
  let r = 0
  for (let i = 0; i < vertices.length; i += 3)
    r = Math.max(r, c.distanceTo(new G.Vector3().fromArray(vertices, i)))
  return { sphere: [c.x, c.y, c.z, r], min: box.min.toArray(), max: box.max.toArray() }
}

function offAxisCase() {
  const camera = G.perspectiveCamera(60, VIEWPORT[0] / VIEWPORT[1], 0.1, 1000)
  camera.updateMatrixWorld(true)
  const focal = (VIEWPORT[1] * camera.projectionMatrix.elements[5]) / 2
  // ε such that the on-axis formula announces 0.39 px for the coarse sphere.
  const [ax, ay, az, ar] = boundsOf([...FINE, 8, 0.006, -10]).sphere
  const epsilon = (0.39 * (Math.hypot(ax, ay, az) - ar)) / focal
  const coarse = FINE.map((v, i) => (i % 3 === 1 ? v + epsilon : v))
  const [fineBox, coarseBox] = [boundsOf(FINE), boundsOf([...FINE, ...coarse])]
  // The true screen displacement, in pixels, between the fine and coarse vertices.
  let displacement = 0
  for (let i = 0; i < FINE.length; i += 3) {
    const a = project(new G.Vector3().fromArray(FINE, i), camera)
    const b = project(new G.Vector3().fromArray(coarse, i), camera)
    displacement = Math.max(
      displacement,
      Math.hypot((b.x - a.x) * VIEWPORT[0], (b.y - a.y) * VIEWPORT[1]) / 2,
    )
  }
  const world = new G.Matrix4(),
    material = surfaceOf(G.basicSurface({ side: G.DOUBLE_SIDE }))
  const page = (id: number, box: typeof fineBox, lodError: number, parent: number | null) => ({
    id,
    url: String(id),
    triangles: 1,
    depthLayer: 0,
    ...box,
    lodError,
    parentError: parent,
    parentSphere: parent === null ? null : coarseBox.sphere,
    matrix: world,
    material,
  })
  const pages = [page(0, coarseBox, epsilon, null), page(1, fineBox, 0, epsilon)]
  // One leaf node holding both clusters: box, sphere, no replacement (−1), two pages.
  const nodes = new Float64Array(15)
  nodes.set([...coarseBox.min, ...coarseBox.max, ...coarseBox.sphere, -1, 0, 0, 0, 2])
  const announced = projectedClusterError(
    epsilon,
    coarseBox.sphere,
    0,
    camera.matrixWorldInverse.elements,
    1,
    focal,
    camera.near,
  )
  return { camera, world, pages, culling: { nodes, stride: 15 }, displacement, announced }
}

test('the CPU cut, the oracle and the GPU keep the fine cluster off the axis', async () => {
  const { camera, world, pages, culling, displacement, announced } = offAxisCase()
  const names = (ids: number[]) => ids.map((id) => (id === 0 ? 'coarse' : 'fine'))
  const uniforms = cameraSelectionUniforms(engineCamera(camera), THRESHOLD, VIEWPORT)
  const variants = { flat: undefined, 'with a node': culling }
  const cuts: Record<string, string[]> = {}
  const cases = Object.entries(variants).map(([variant, node]) => {
    const cpu = selectVisiblePages(
      [
        {
          world,
          pages,
          culling: node && { ...node, bounds: cullingBounds(node, pages) },
        },
      ],
      engineCamera(camera),
      { pixelError: THRESHOLD, viewport: VIEWPORT },
    )
    cuts[`cpu, ${variant}`] = names(cpu.shown.map((page) => page.id))
    // The kernel works in the render frame: the world is brought to the eye, as the engine does.
    const packed = packedWorldsToRenderOrigin(
      packDagSelection([{ world, pages, culling: node }]),
      [{ world, pages: [] }],
      uniforms.cameraWorld,
    )
    cuts[`oracle, ${variant}`] = names(evaluateDagSelectionKernel(packed, uniforms).pageIds)
    return { name: variant, packed, uniforms }
  })
  const { adapter, readings } = await runSelectionKernel(cases)
  for (const reading of readings) cuts[`gpu, ${reading.name}`] = names(reading.pages)
  console.log(JSON.stringify({ adapter, displacement, announced, cuts }))
  assert.ok(displacement > THRESHOLD, 'the case must actually exceed the threshold')
  assert.ok(announced >= displacement, 'the CPU underestimates the error')
  for (const [cut, kept] of Object.entries(cuts))
    assert.deepEqual(kept, ['fine'], `${cut}: the coarse cluster is wrongly accepted`)
})
