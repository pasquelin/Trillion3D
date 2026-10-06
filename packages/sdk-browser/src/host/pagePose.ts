import type { HostMesh } from './resources.ts'
import { copyElements, sameElements, type MatrixElements } from '../math/matrixElements.ts'

/** The pose each page mesh was given last, while it stays in the graph (`forgetHostPose`). */
const posed = new WeakMap<HostMesh, Float64Array>()

/** The pose a drawn page wears: the sixteen floats the engine composed for it, written in place,
 *  which the graph's link hears as a pose (the draw walks only what moved, `changedSubtrees.ts`).
 *  The same pose again writes nothing: every drawn page is posed at every frame, and recomposing
 *  every page each frame for poses that never moved is a cost. */
export const setHostPose = (mesh: HostMesh, pose: MatrixElements) => {
  const next = pose.elements
  let last = posed.get(mesh)
  if (last && sameElements(last, next)) return
  if (!last) posed.set(mesh, (last = new Float64Array(16)))
  copyElements(last, next)
  mesh.matrix.fromArray(next)
  mesh._link?.pose(mesh)
}

/** A page mesh leaving the graph: its next pose is written whatever it was. */
export const forgetHostPose = (mesh: HostMesh) => posed.delete(mesh)
