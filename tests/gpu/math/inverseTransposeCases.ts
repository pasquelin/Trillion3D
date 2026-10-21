// Defect 6's cases: geometry, camera and raw orientation, shared by defect 10's proof
// (`pages/culled-face-mirrored.gpu.ts`) and the engine's own draw (`engineDraws.ts`).
import { boxCenter } from '../../../packages/math/src/geometry/box.ts'
import * as G from '../../../packages/sdk-browser/src/scene/host/graph/graph.fixture.ts'
import type { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts'
import { Vector3 } from '../../../packages/sdk-core/src/world/math/vector3.ts'
import { createEngineCamera } from '../../../packages/sdk-browser/src/camera/engineCamera.ts'
import { readCameraWorld } from '../../../packages/sdk-browser/src/camera/world.ts'
import { project } from '../../kit/device/cameraRig.ts'
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
  world: Matrix4
  mirrored: boolean
}

const VIEWPORT: [number, number] = [1000, 1000]
/** The fixed camera on −Z, looking at the origin where each object is centred whatever its
 *  rotation (`buildCase`): only orientation changes from case to case. */
export const camera = G.perspectiveCamera(60, 1, 0.1, 100)
camera.position.set(0, 0, -9)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld(true)
/** The engine's view of that camera, posed once: the CPU and the GPU kernel read the same one. */
export const view = readCameraWorld(createEngineCamera(), camera)

/** Two triangles sharing the local origin: normals (±1,0,1)/√2. `L` scales the local
 *  coordinates; the world size stays whatever `s`. */
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
  const mid = new Float64Array(3)
  boxCenter(mid, 0, min[0], min[1], min[2], max[0], max[1], max[2])
  const centre = new Vector3(mid[0], mid[1], mid[2]).applyMatrix4(world).negate()
  world.setPosition(centre.x, centre.y, centre.z)
  return {
    positions,
    indices,
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
      new Vector3().fromArray(lit.positions, i * 3).applyMatrix4(lit.world),
    )
    const normal = new Vector3().subVectors(v[1], v[0]).cross(new Vector3().subVectors(v[2], v[0]))
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
