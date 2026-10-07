// Defect 6's cases (`inverseTranspose3`, DAG selection kernel): geometry, camera, raw orientation
// and CPU decision, shared by its proof, defect 10's (`pages/culled-face-reflection.gpu.ts`) and
// the engine's own draw (`engineDraws.ts`).
import { triangleCone } from '../../kit/reference/cone.ts'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import {
  frustumExcludesBox,
  frustumPlanesFromMatrix,
} from '../../../packages/sdk-core/src/index.ts'
import { frustumPlanesToLocal } from '../../../packages/sdk-browser/src/gpu/dag/oracle/math.fixture.ts'
import { type NormalCone } from '../../../packages/sdk-browser/src/page/cone/cone.ts'
import { coneCullsPageWith } from '../../../packages/sdk-browser/src/page/cone/cone.fixture.ts'
import { coneContextFor } from '../../../packages/sdk-browser/src/page/cone/cone.fixture.ts'
import { createConeContext } from '../../../packages/sdk-browser/src/page/cone/cone.fixture.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { selectVisiblePages } from '../../../packages/sdk-browser/src/page/cut/cut.fixture.ts'
import type { DagRoot } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'
import {
  createEngineCamera,
  readCameraWorld,
} from '../../../packages/sdk-browser/src/camera/world.ts'
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { project } from '../kit/cameraRig.ts'
import { worldPose, type PoseParams } from './lightingNormalCases.ts'

type Vec3 = [number, number, number]
/** A case's pose: `PoseParams`, its world size, and whether it is mirrored. */
interface CaseInput extends PoseParams {
  worldSize: number
  mirrored?: boolean
}
export interface Case extends CaseInput {
  positions: number[]
  indices: number[]
  min: Vec3
  max: Vec3
  cone: NormalCone
  world: G.Matrix4
  mirrored: boolean
}

export const VIEWPORT: [number, number] = [1000, 1000]
/** The fixed camera on −Z, looking at the origin where each object is centred whatever its
 *  rotation (`buildCase`): only orientation changes from case to case. */
export const camera = G.perspectiveCamera(60, 1, 0.1, 100)
camera.position.set(0, 0, -9)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld(true)
/** The engine's view of that camera, posed once: the CPU and the GPU kernel read the same one. */
export const view = readCameraWorld(createEngineCamera(), camera)
const WORLD_PLANES = new Float64Array(24)
frustumPlanesFromMatrix(WORLD_PLANES, view.viewProjection)

/** Two triangles sharing the local origin: normals (±1,0,1)/√2, a local cone of axis (0,0,1) and
 *  half-angle 45°. `L` scales the local coordinates; the world size stays whatever `s`. */
function localGeometry(L: number) {
  const positions = [0, 0, 0, L, 0, -L, 0, L, 0, 0, 0, 0, -L, 0, -L, 0, -L, 0]
  return {
    positions,
    indices: [0, 1, 2, 3, 4, 5],
    min: [-L, -L, -L] as Vec3,
    max: [L, L, 0] as Vec3,
  }
}

/** A rotation and scale (uniform or not), centred at the world origin whatever the rotation;
 *  `mirrored` negates the 3×3's third column: still conformal, its determinant's sign flipped.
 *  The pose is `worldPose`'s: defects 6 and 9 exercise the same matrices. */
export function buildCase({
  s,
  kind,
  worldSize,
  axis,
  angleDeg,
  mirrored = false,
}: CaseInput): Case {
  const { positions, indices, min, max } = localGeometry(worldSize / s)
  const world = worldPose({ s, kind, axis, angleDeg })
  if (mirrored) for (const k of [8, 9, 10]) world.elements[k] = -world.elements[k]
  const centre = new G.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
    .applyMatrix4(world)
    .negate()
  world.setPosition(centre.x, centre.y, centre.z)
  const cone = triangleCone(positions, indices)
  return {
    positions,
    indices,
    cone,
    min,
    max,
    world,
    s,
    kind,
    worldSize,
    axis,
    angleDeg,
    mirrored,
  }
}

/** The RAW geometric orientation: the transformed vertices' `cross(e1, e2)` against the camera,
 *  the frustum, the area in pixels. Not what the engine draws — under a mirror it swaps the culled
 *  face (`windingCw`), and `frontVisible` names the face opposite the one on screen; the engine's
 *  truth, measured by rasterisation, is `engineDraws.ts`. */
export function rawOrientation(lit: Case) {
  const { indices } = lit
  const triples = Array.from({ length: indices.length / 3 }, (_, t) =>
    indices.slice(3 * t, 3 * t + 3),
  )
  const triangles = triples.map((triangle) => {
    const v = triangle.map((i) =>
      new G.Vector3().fromArray(lit.positions, i * 3).applyMatrix4(lit.world),
    )
    const normal = new G.Vector3()
      .subVectors(v[1], v[0])
      .cross(new G.Vector3().subVectors(v[2], v[0]))
    normal.normalize()
    const centre = v[0].clone().add(v[1]).add(v[2]).divideScalar(3)
    const facing = normal.dot(camera.position.clone().sub(centre).normalize())
    const ndc = v.map((p) => project(p.clone(), camera))
    const inView = ndc.every((p) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z > 0 && p.z < 1)
    const cross2 =
      (ndc[1].x - ndc[0].x) * (ndc[2].y - ndc[0].y) - (ndc[2].x - ndc[0].x) * (ndc[1].y - ndc[0].y)
    const areaPixels = (Math.abs(cross2) * (VIEWPORT[0] / 2) * (VIEWPORT[1] / 2)) / 2
    return { facing, inView, areaPixels }
  })
  const frontVisible = triangles.some((t) => t.facing > 0 && t.inView && t.areaPixels > 1)
  return { triangles, frontVisible }
}

/** What a case's page always carries: its local box, its cone, a zero level error. */
const pageOf = (lit: Case) => ({
  url: '0',
  lodError: 0,
  min: lit.min,
  max: lit.max,
  cone: lit.cone,
})

/** The cases packed for the GPU kernel: one root and one page per case, the case's sphere for
 *  radius; packed worlds brought back to the eye, as the engine feeds them — relative view and
 *  absolute world would mix otherwise. */
export const packCases = (cases: Case[]) =>
  packedWorldsToRenderOrigin(
    packDagSelection(
      cases.map((lit): DagRoot => ({
        world: lit.world,
        pages: [{ ...pageOf(lit), parentError: null, sphere: [0, 0, 0, lit.worldSize] }],
      })),
    ),
    cases.map((lit): DagRoot => ({ world: lit.world, pages: [] })),
    view.eye,
  )

/** Whether the cluster is in the frustum: its local box against the planes taken to local space. */
export function inFrustum(lit: Case): boolean {
  const local = new Float64Array(24)
  frustumPlanesToLocal(local, WORLD_PLANES, lit.world.elements)
  return !frustumExcludesBox(local, ...lit.min, ...lit.max)
}

/** Whether the CPU's normal cone culls the case's page (`coneCullsPageWith`), and whether its
 *  transform is conformal. */
export function coneDecision(lit: Case) {
  const context = coneContextFor(createConeContext(), lit.world, view.eye)
  return {
    conformal: context.conformal,
    coneCulls: coneCullsPageWith(context, lit.cone, lit.world, lit.min, lit.max),
  }
}

/** `coneCullsPageWith` and `selectVisiblePages` on the same page: the CPU's two entries. */
export function cpuDecision(lit: Case) {
  const { conformal, coneCulls } = coneDecision(lit)
  const box = new G.Box3(new G.Vector3(...lit.min), new G.Vector3(...lit.max)).applyMatrix4(
    lit.world,
  )
  const page = {
    ...pageOf(lit),
    id: '0',
    triangles: 2,
    matrix: lit.world,
    material: surfaceOf(G.basicSurface({ side: G.FRONT_SIDE })),
  }
  const root = {
    world: lit.world,
    pages: [page],
    worldBox: new Float64Array([...box.min.toArray(), ...box.max.toArray()]),
  }
  const triangles = selectVisiblePages([root], view, {
    pixelError: 0,
    viewport: VIEWPORT,
  }).displayedTriangles
  return { conformal, coneCulls, culls: triangles === 0, triangles }
}
